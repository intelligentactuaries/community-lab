// LLM dialogue orchestration: script a conversation (on demand or
// automatically when the viewer is zoomed in), pace the lines at a natural
// speaking rate in SIM time, and interview a resident.
import { dialogueMessages, interviewMessages, parseDialogue, type ChatMessage } from '../../shared/narrative';
import type { Conversation, Person } from '../../sim/types';
import { WEEKDAYS } from '../../sim/time';
import { streamDialogue } from './api';
import { store } from './simStore';

interface Pending {
  queue: Array<{ speakerId: string; text: string }>;
  nextRelease: number; // sim minute
  raw: string;
  parsedCount: number;
  abort: () => void;
}

const pending = new Map<string, Pending>();
export const aiStatus = { inflight: 0, lastError: '' as string, lastModel: '' as string };

function isoNow(): { isoDate: string; weekday: string } {
  const cal = store.cal();
  return { isoDate: cal.isoDate, weekday: WEEKDAYS[cal.weekday] };
}

/** Speaking time for a line, in sim minutes (~150 words per minute + a beat). */
function speakMinutes(text: string): number {
  const words = text.split(/\s+/).length;
  return Math.max(0.08, words / 150 + 0.04);
}

export function scriptConversation(convId: string, lines?: number): boolean {
  const world = store.sim.world;
  const c = world.conversations[convId];
  if (!c || pending.has(convId) || c.llm === 'streaming' || c.llm === 'pending' || c.llm === 'done') return false;
  const parts = c.participantIds.map((id) => world.people[id]).filter(Boolean);
  if (!parts.length) return false;
  const msgs = dialogueMessages(world, c, { lines: lines ?? (parts.length > 1 ? 6 : 4), ...isoNow() });
  c.llm = 'pending';
  const p: Pending = { queue: [], nextRelease: world.minute, raw: '', parsedCount: 0, abort: () => {} };
  pending.set(convId, p);
  aiStatus.inflight++;
  const seed = `${store.params.seed}:${convId}`;
  p.abort = streamDialogue(
    msgs,
    { salt: seed, maxTokens: 700, temperature: 0.85 },
    {
      onMeta: (m) => {
        aiStatus.lastModel = `${m.provider}/${m.model}${m.cached ? ' (cached)' : ''}`;
      },
      onDelta: (t) => {
        p.raw += t;
        c.llm = 'streaming';
        // parse complete lines only
        const complete = p.raw.lastIndexOf('\n');
        if (complete > 0) {
          const parsed = parseDialogue(p.raw.slice(0, complete), parts);
          for (let i = p.parsedCount; i < parsed.length; i++) p.queue.push(parsed[i]);
          p.parsedCount = parsed.length;
        }
      },
      onDone: (text) => {
        const parsed = parseDialogue(text, parts);
        for (let i = p.parsedCount; i < parsed.length; i++) p.queue.push(parsed[i]);
        p.parsedCount = parsed.length;
        c.llm = 'done';
        aiStatus.inflight = Math.max(0, aiStatus.inflight - 1);
        if (!parsed.length) c.llm = 'failed';
        store.bump();
      },
      onError: (msg) => {
        aiStatus.lastError = msg;
        c.llm = 'failed';
        aiStatus.inflight = Math.max(0, aiStatus.inflight - 1);
        pending.delete(convId);
        store.bump();
      },
    },
  );
  // Replace the procedural opener once the model speaks.
  c.lines = [];
  store.bump();
  return true;
}

/** Called every animation frame: release queued lines in sim time; auto-script when zoomed in. */
export function dialogueTick(): void {
  const world = store.sim.world;
  for (const [id, p] of pending) {
    const c = world.conversations[id];
    if (!c) {
      p.abort();
      pending.delete(id);
      continue;
    }
    const live = c.participantIds.every((pid) => world.people[pid]?.conversationId === id);
    if (!live && c.llm !== 'streaming' && c.llm !== 'pending') {
      pending.delete(id);
      continue;
    }
    while (p.queue.length && world.minute >= p.nextRelease) {
      const line = p.queue.shift()!;
      c.lines.push({ speakerId: line.speakerId, text: line.text, minute: world.minute });
      p.nextRelease = world.minute + speakMinutes(line.text);
      // keep the participants talking until the queue drains
      c.endMinute = Math.max(c.endMinute, p.nextRelease + 0.5);
      const sp = world.people[line.speakerId];
      const other = c.participantIds.find((x) => x !== line.speakerId);
      if (sp && other && world.people[other]) sp.heading = Math.atan2(world.people[other].loc.y - sp.loc.y, world.people[other].loc.x - sp.loc.x);
    }
    if (c.llm === 'done' && !p.queue.length) pending.delete(id);
    if (c.llm === 'streaming' || c.llm === 'pending') c.endMinute = Math.max(c.endMinute, world.minute + 2);
  }
  // Auto mode: script whatever is visible when zoomed in.
  if (store.aiMode === 'auto' && store.running && store.sim.micro && store.camera.zoom >= 9 && aiStatus.inflight < 1) {
    const { w, h } = store.viewport;
    const cam = store.camera;
    const vis = (x: number, y: number) => Math.abs((x - cam.x) * cam.zoom) < w / 2 && Math.abs((y - cam.y) * cam.zoom) < h / 2;
    for (const id in world.conversations) {
      const c = world.conversations[id];
      if (c.llm !== 'none' || !vis(c.x, c.y)) continue;
      const live = c.participantIds.every((pid) => world.people[pid]?.conversationId === id);
      if (!live || c.endMinute - world.minute < 2) continue;
      scriptConversation(id);
      break;
    }
  }
}

export function cancelAll(): void {
  for (const [, p] of pending) p.abort();
  pending.clear();
  aiStatus.inflight = 0;
}

/** Interview a resident. Returns an abort function; streams assistant text via cb. */
export function interview(p: Person, history: ChatMessage[], cb: { onDelta: (t: string) => void; onDone: (t: string) => void; onError: (m: string) => void }): () => void {
  const msgs = interviewMessages(store.sim.world, p, history, store.cal().isoDate);
  return streamDialogue(msgs, { salt: `${store.params.seed}:${p.id}:${history.length}`, maxTokens: 300, temperature: 0.8, cache: false }, cb);
}
