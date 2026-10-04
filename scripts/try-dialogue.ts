// End-to-end check of the dialogue path: build a world, find a conversation,
// build the prompt, stream it through the running API server, parse lines.
import { Simulation } from '../src/sim/engine';
import { dialogueMessages, interviewMessages, parseDialogue } from '../src/shared/narrative';

const sim = new Simulation({ seed: 'dialogue-demo' });
sim.setMicro(true);
// Sunday after church → fellowship conversations
sim.advance(11 * 60 + 5);
let conv = Object.values(sim.world.conversations).find((c) => c.participantIds.length === 2 && c.participantIds.every((id) => sim.world.people[id]?.conversationId === c.id));
for (let i = 0; !conv && i < 120; i++) {
  sim.advance(1);
  conv = Object.values(sim.world.conversations).find((c) => c.participantIds.length === 2 && c.participantIds.every((id) => sim.world.people[id]?.conversationId === c.id));
}
if (!conv) throw new Error('no conversation found');
const parts = conv.participantIds.map((id) => sim.world.people[id]);
console.log('conversation:', parts.map((p) => `${p.firstName} ${p.surname} (${p.age}${p.sex}, ${p.job}, ${p.archetype})`).join(' & '), '| tone', conv.tone, '| topic', conv.topic, '| at', conv.buildingId);
const msgs = dialogueMessages(sim.world, conv, { lines: 6, isoDate: '2026-01-04', weekday: 'Sunday' });
console.log('--- prompt (user part) ---\n' + msgs[1].content.slice(0, 1400) + '\n---');
async function stream(messages: typeof msgs, label: string, maxTokens = 600) {
  const t0 = performance.now();
  const r = await fetch('http://localhost:3020/api/dialogue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages, salt: label, maxTokens, cache: false }) });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} ${await r.text()}`);
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  let first = 0;
  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let i = buf.indexOf('\n\n');
    while (i !== -1) {
      const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data:'));
      buf = buf.slice(i + 2);
      if (line) {
        const j = JSON.parse(line.slice(5)) as { delta?: string; done?: boolean; error?: string; provider?: string; model?: string };
        if (j.provider) console.log(`[${label}] provider ${j.provider} / ${j.model}`);
        if (j.delta) {
          if (!first) first = performance.now() - t0;
          text += j.delta;
        }
        if (j.error) console.log(`[${label}] ERROR ${j.error}`);
      }
      i = buf.indexOf('\n\n');
    }
  }
  console.log(`[${label}] first token ${first.toFixed(0)}ms, total ${(performance.now() - t0).toFixed(0)}ms, ${text.length} chars`);
  return text;
}
const text = await stream(msgs, 'dialogue');
console.log('--- raw ---\n' + text + '\n--- parsed ---');
for (const l of parseDialogue(text, parts)) console.log(`${sim.world.people[l.speakerId].firstName}: ${l.text}`);
// Interview
const pastor = sim.world.people[sim.world.roles.pastorId!];
const im = interviewMessages(sim.world, pastor, [{ role: 'user', content: 'Pastor, how is the congregation doing this year, and what worries you most?' }], '2026-01-04');
const answer = await stream(im, 'interview', 300);
console.log('--- interview ---\n' + answer);
