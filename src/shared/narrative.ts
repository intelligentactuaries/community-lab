// Turns the simulation state into prompts for an LLM — the "generative
// agents" recipe (Park et al. 2023): a persona, its relationships, a short
// memory of recent events, the setting, and a strict output format. Pure
// functions on World so both the browser (which owns the running world) and
// the server (which only relays to the model) can use them.

import { ARCHETYPE_LABEL } from '../sim/personality';
import { fmtClock, WEEKDAYS } from '../sim/time';
import type { Conversation, Person, World } from '../sim/types';
import { CITY, COMMUNITY, cityOf } from '../sim/world';

/** Where someone lives, as a phrase: "Kanana, in Emmaus — the rich city — in Unity Province, South Africa". */
function homePhrase(world: World, p: Person | null): string {
  const hh = p ? world.households[p.householdId] : null;
  const com = hh ? world.buildings[hh.houseId]?.community : null;
  if (!com) return `Unity Province (around ${world.meta.placeName}) in South Africa`;
  const city = CITY[cityOf(com)];
  return `${COMMUNITY[com].name}, in ${city.name} — ${city.blurb} — in Unity Province, South Africa`;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const JOB_LABEL: Record<string, string> = {
  pilot: 'an airline pilot', busdriver: 'a bus driver', pastor: 'the pastor', doctor: 'the doctor', nurse: 'a nurse', teacher: 'a teacher', police: 'a police officer', magistrate: 'the magistrate', clerk: 'the court clerk', shopkeeper: 'the shopkeeper', vendor: 'a market vendor', farmer: 'a farmer', farmhand: 'a farm worker', builder: 'a builder', office: 'an office worker', homemaker: 'a homemaker', unemployed: 'unemployed', retired: 'retired', student: 'a school pupil', child: 'a small child',
};

function moodWord(m: number): string {
  if (m > 0.5) return 'joyful';
  if (m > 0.2) return 'content';
  if (m > -0.2) return 'even-tempered';
  if (m > -0.5) return 'low';
  return 'despondent';
}

function traitWords(p: Person): string {
  const b = p.big5;
  const out: string[] = [];
  out.push(b.E > 0.65 ? 'outgoing' : b.E < 0.35 ? 'reserved' : 'sociable enough');
  out.push(b.A > 0.65 ? 'warm and accommodating' : b.A < 0.35 ? 'blunt and competitive' : 'fair-minded');
  out.push(b.C > 0.65 ? 'disciplined' : b.C < 0.35 ? 'easy-going, a little disorganised' : 'reliable');
  out.push(b.N > 0.65 ? 'anxious and quick to worry' : b.N < 0.35 ? 'calm under pressure' : 'steady');
  out.push(b.O > 0.65 ? 'curious and imaginative' : b.O < 0.35 ? 'traditional and practical' : 'open to new ideas');
  return out.join(', ');
}

export function fullName(p: Person): string {
  return `${p.firstName} ${p.surname}`;
}

export function personCard(world: World, p: Person): string {
  const hh = world.households[p.householdId];
  const partner = p.partnerId ? world.people[p.partnerId] : null;
  const kids = p.childIds.map((id) => world.people[id]).filter((c) => c && c.alive).map((c) => `${c.firstName} (${c.age})`);
  const ill = p.health.illnesses.map((i) => i.name).join(', ');
  const cond = p.health.conditions.filter((c) => !c.startsWith('hiv')).join(', ');
  const hist = p.history.slice(-5).map((h) => `day ${h.day}: ${h.text}`).join('; ');
  const lines = [
    `${fullName(p)} — ${p.sex === 'M' ? 'man' : 'woman'}, ${p.age}, ${JOB_LABEL[p.job] ?? p.job}, education: ${p.education}.`,
    `Personality (${ARCHETYPE_LABEL[p.archetype]}): ${traitWords(p)}. Mood today: ${moodWord(p.mood)}${p.stress > 0.6 ? ', under real stress' : ''}. Faith: ${p.faith > 0.75 ? 'devout' : p.faith > 0.4 ? 'churchgoing' : 'lukewarm'}.`,
    `Family: ${p.marital}${partner ? ` to ${fullName(partner)}` : ''}${kids.length ? `; children ${kids.join(', ')}` : ''}; lives with the ${hh?.name ?? '?'} household${hh?.poor ? ' (struggling financially)' : ''}.`,
  ];
  if (ill || cond) lines.push(`Health: ${ill ? `currently has ${ill}` : 'well'}${cond ? `; lives with ${cond}` : ''}.`);
  if (p.grief) lines.push(`Grieving for ${p.grief.forName}.`);
  if (p.pregnancy && world.day - p.pregnancy.conceivedDay > 90) lines.push('Expecting a baby.');
  if (hist) lines.push(`Recent life: ${hist}.`);
  return lines.join('\n');
}

export function settingLine(world: World, conv: Conversation): string {
  const day = world.day;
  const startMs = Date.UTC(2026, 0, 1); // display-only; the UI passes the real date separately
  void startMs;
  const b = conv.buildingId ? world.buildings[conv.buildingId] : null;
  const w = world.weather;
  const clock = fmtClock(world.minuteOfDay);
  const weekday = WEEKDAYS[(day + 4) % 7];
  void weekday;
  const where = b ? `${b.name} (${COMMUNITY[b.community]?.name ?? ''}, ${CITY[cityOf(b.community)]?.name ?? ''})` : 'on the road';
  const first = world.people[conv.participantIds[0]] ?? null;
  return `Setting: ${where}, ${clock}, ${w.season}, ${w.condition} (${w.tempMax}°C)${world.holiday ? `, ${world.holiday}` : ''}. Home: ${homePhrase(world, first)}.`;
}

export function recentCommunityNews(world: World, days = 10, max = 8): string[] {
  const cut = world.day - days;
  return world.events
    .filter((e) => e.day >= cut && e.kind !== 'holiday' && e.kind !== 'weather' && e.kind !== 'birthday')
    .slice(-max)
    .map((e) => e.text);
}

function relationshipLine(world: World, a: Person, b: Person): string {
  const r = a.relationships[b.id];
  if (!r) return `${a.firstName} and ${b.firstName} barely know each other.`;
  const s = r.strength;
  const warmth = s > 0.6 ? 'very close' : s > 0.3 ? 'on good terms' : s > 0 ? 'cordial' : s > -0.3 ? 'cool toward each other' : 'at odds';
  return `${a.firstName} and ${b.firstName} are ${r.kind === 'spouse' ? 'married' : r.kind === 'partner' ? 'courting' : r.kind}s, ${warmth}.`;
}

/** Messages that ask the model to script a whole short exchange. */
export function dialogueMessages(world: World, conv: Conversation, opts: { lines?: number; isoDate?: string; weekday?: string } = {}): ChatMessage[] {
  const parts = conv.participantIds.map((id) => world.people[id]).filter(Boolean);
  const n = opts.lines ?? (parts.length > 1 ? 6 : 4);
  const names = parts.map((p) => p.firstName);
  const system = [
    'You write short, natural, realistic spoken dialogue for an agent-based community simulation used by actuaries and social scientists.',
    'Rules:',
    `- Output EXACTLY ${n} lines and nothing else. Each line is "Name: words". Use only these names: ${names.join(', ')}.`,
    '- No narration, no stage directions, no quotation marks, no markdown, no emojis, no explanations.',
    '- Keep each line under 25 words. Let personality, mood, faith, health and recent events shape what is said. South African English is fine (a little "eish", "sharp", "yebo" is natural, but do not overdo it).',
    `- The conversation's tone is "${conv.tone}" and the topic is "${conv.topic}".`,
    parts.length === 1 ? '- This is a sermon or prayer spoken to a congregation: warm, scriptural, brief.' : '- Alternate speakers naturally; the last line should end the exchange.',
  ].join('\n');
  const user = [
    settingLine(world, conv) + (opts.isoDate ? ` Date: ${opts.weekday ?? ''} ${opts.isoDate}.` : ''),
    '',
    ...parts.map((p) => personCard(world, p)),
    '',
    parts.length === 2 ? relationshipLine(world, parts[0], parts[1]) : '',
    '',
    `Recent community news: ${recentCommunityNews(world).join(' | ') || 'a quiet week'}.`,
    conv.lines.length ? `\nThey have already said:\n${conv.lines.map((l) => `${l.chorus ? 'The congregation (singing)' : world.people[l.speakerId]?.firstName ?? '?'}: ${l.text}`).join('\n')}\nContinue from here (do not repeat those lines).` : '',
    '',
    `Write the ${n} lines now.`,
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** Messages for interviewing one resident (chat with a person). */
export function interviewMessages(world: World, p: Person, history: ChatMessage[], isoDate?: string): ChatMessage[] {
  const system = [
    `You are ${fullName(p)}, a resident of ${homePhrase(world, p)}, inside an agent-based simulation. Stay in character. Answer in the first person, briefly (1-3 sentences), in plain spoken English.`,
    'You only know what an ordinary resident would know: your own life, your family, your neighbours, church, work, and the community news below. If asked something outside that, say you would not know.',
    'Never mention being an AI, a model, or a simulation. No markdown.',
    '',
    personCard(world, p),
    '',
    `Today: ${isoDate ?? ''} ${fmtClock(world.minuteOfDay)}, ${world.weather.season}, ${world.weather.condition}.`,
    `Recent community news: ${recentCommunityNews(world, 30, 10).join(' | ') || 'a quiet month'}.`,
  ].join('\n');
  return [{ role: 'system', content: system }, ...history.slice(-12)];
}

/** Parse "Name: text" lines back to speaker ids. Unknown names are attributed round-robin. */
export function parseDialogue(text: string, participants: Person[]): Array<{ speakerId: string; text: string }> {
  const out: Array<{ speakerId: string; text: string }> = [];
  const byName = new Map(participants.map((p) => [p.firstName.toLowerCase(), p.id] as const));
  let i = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*\d.)\s]+/, '');
    if (!line) continue;
    const m = /^([A-Za-z' .-]{1,40}?)\s*[:：]\s*(.+)$/.exec(line);
    let speakerId: string | undefined;
    let body = line;
    if (m) {
      const key = m[1].trim().toLowerCase().split(' ')[0];
      speakerId = byName.get(key);
      body = m[2].trim();
    }
    if (!speakerId) speakerId = participants[i % participants.length].id;
    body = body.replace(/^["“”']+|["“”']+$/g, '');
    if (body) out.push({ speakerId, text: body });
    i++;
  }
  return out;
}
