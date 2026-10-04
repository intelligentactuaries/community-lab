// Social life: mood, stress and grief dynamics; relationship upkeep;
// conversations (procedural chatter that an LLM can replace on demand);
// the Sunday sermon; disputes and their resolution — talk, pastoral
// mediation, or a fight that the police must handle.

import type { Ctx } from './ctx';
import { alivePeople, clamp, dist, fullName, householdMembers } from './ctx';
import { conflictProneness, resilience, sociability } from './personality';
import { raiseIncident } from './security';
import { communityOfPerson } from './population';
import { CHURCH_IDS, CITIES, cityOf, landmark } from './world';
import type { Activity, Conversation, Hymn, Person, Relationship } from './types';

const SOCIAL_KINDS = new Set<Activity['kind']>(['rest', 'idle', 'fellowship', 'visit', 'play', 'shop', 'lunch', 'breakfast', 'dinner', 'youth', 'biblestudy', 'choir', 'celebration', 'funeral', 'sport', 'chores', 'wedding', 'work', 'clinic', 'court', 'match', 'concert', 'flight']);
const QUIET_KINDS = new Set<Activity['kind']>(['sleep', 'church', 'school', 'homeschool', 'hospital']);

// ─── Procedural chatter ────────────────────────────────────────────────────

type Tone = Conversation['tone'];

const OPENERS: Record<Tone, string[]> = {
  warm: ['How are you, my friend?', 'Good to see you!', 'It has been too long.', 'How is the family?', 'You look well today.'],
  neutral: ['Morning.', 'Busy day?', 'Did you hear about the meeting?', 'How is work treating you?', 'Any news?'],
  tense: ['We need to talk.', 'This cannot go on.', 'I heard what you said about me.', 'Why was the fence moved again?', 'Your dog was in my yard.'],
  grief: ['I am so sorry for your loss.', 'We are praying for you.', 'If you need anything, anything at all...', 'They were loved by everyone.'],
  joy: ['Congratulations!', 'What wonderful news!', 'Praise God, I am so happy for you.', 'We must celebrate this!'],
  gossip: ['Did you hear?', 'Between us...', 'You did not hear it from me, but...', 'Guess who I saw at the market.'],
  prayer: ['Let us pray together.', 'The Lord is our shepherd.', 'Give thanks in all circumstances.', 'Blessed are the peacemakers.'],
};

const TOPIC_LINES: Record<string, string[]> = {
  weather: ['This heat is something else.', 'We need the rain badly.', 'The storm last night kept the children awake.', 'Winter came early this year.', 'Lovely morning, isn\'t it?'],
  church: ['The sermon on Sunday spoke to me.', 'Are you coming to Bible study on Wednesday?', 'The choir needs more voices.', 'Pastor is visiting the sick this week.'],
  work: ['The clinic was full again today.', 'Prices at the market keep climbing.', 'The harvest looks good this year.', 'They are hiring at the co-op, I heard.', 'Long shift tonight.'],
  family: ['The little one is walking now!', 'My mother is not well.', 'The children are growing so fast.', 'We are expecting again.', 'My son wants to study in the city.'],
  health: ['Half the school has the flu.', 'Take care of that cough.', 'The nurse says it is nothing serious.', 'Rest, that is all you need.'],
  money: ['The grant came late this month.', 'School fees are due again.', 'We are saving for a car.', 'The funeral scheme paid out, thank God.'],
  community: ['Someone was seen near the Mokoena place last night.', 'The police were quick this time.', 'We should fix the road before the rains.', 'The youth day was a success.'],
  faith: ['God has been good to us.', 'Keep the faith, sister.', 'Pray for me, brother.', 'His mercies are new every morning.'],
};

const CLOSERS = ['Go well.', 'See you on Sunday.', 'Greet the family.', 'God bless.', 'Sharp, sharp.', 'Take care now.'];

const SERMON_LINES = [
  'Brothers and sisters, turn with me to Psalm 23.',
  'The Lord is my shepherd; I shall not want.',
  'Love your neighbour as yourself.',
  'Let us give thanks for the rain and the harvest.',
  'Blessed are the peacemakers, for they shall be called children of God.',
  'Bear one another\'s burdens.',
  'Do not be anxious about tomorrow.',
  'Let us pray for those who are sick and those who mourn.',
  'Go in peace to love and serve.',
];

/** Hymn numbers for a funeral and for a wedding. */
const OCCASION = { grief: [87, 118, 142, 1], joy: [21, 305, 233, 64, 142] };

/**
 * The order of service at a funeral and at a wedding, said in turn (with the names of the one who has died, or of
 * the groom and the bride), then the lines a pastor comes back to between the hymns.
 */
function liturgy(kind: 'funeral' | 'wedding', names: string[]): { order: string[]; again: string[] } {
  if (kind === 'funeral') {
    const name = names[0] ?? 'our brother';
    return {
      order: [
        `We are gathered to give thanks for the life of ${name}.`,
        'I am the resurrection and the life, says the Lord.',
        'The Lord is my shepherd; I shall not want.',
        'Yea, though I walk through the valley of the shadow of death, I will fear no evil.',
        "In my Father's house are many rooms.",
        'Blessed are those who mourn, for they shall be comforted.',
        `We commend ${name} to the mercy of God.`,
        'Let us hold the family in our prayers in the days ahead.',
      ],
      again: ['Blessed are those who mourn, for they shall be comforted.', 'Let us hold the family in our prayers in the days ahead.', 'The Lord gave, and the Lord has taken away; blessed be the name of the Lord.', 'I am the resurrection and the life, says the Lord.'],
    };
  }
  const [groom = 'the groom', bride = 'the bride'] = names;
  return {
    order: [
      'Dearly beloved, we are gathered here in the sight of God to join this man and this woman in marriage.',
      'Love is patient, love is kind.',
      'Two are better than one, for if they fall, one will lift up the other.',
      `${groom}, will you love, comfort, honour and keep ${bride}, in sickness and in health?`,
      `${bride}, will you love, comfort, honour and keep ${groom}, in sickness and in health?`,
      'What God has joined together, let no one separate.',
      `${groom} and ${bride}, I now pronounce you husband and wife.`,
      'Let us pray for this new family and the home they will make.',
    ],
    again: ['Love is patient, love is kind.', 'Two are better than one, for if they fall, one will lift up the other.', 'Let us pray for this new family and the home they will make.', 'May the Lord bless your home and keep you.'],
  };
}

/** Whose funeral or wedding a pastor is conducting, from the service's label ("… funeral of Sipho Dlamini", "… wedding of Thabo & Lerato"). */
function namesIn(label: string | undefined): string[] {
  const m = /(?:funeral|wedding) of (.+)$/.exec(label ?? '');
  return m ? m[1].split(' & ') : [];
}

// ─── Hymns ─────────────────────────────────────────────────────────────────
// The hymn book: a verse each, all long out of copyright, and one the whole
// country knows. The pastor calls the number; the congregation sings the lines.

const HYMNS: ReadonlyArray<{ number: number; title: string; verse: readonly string[] }> = [
  { number: 142, title: 'Amazing Grace', verse: ['Amazing grace, how sweet the sound,', 'That saved a wretch like me.', 'I once was lost, but now am found,', 'Was blind, but now I see.'] },
  { number: 87, title: 'Abide With Me', verse: ['Abide with me, fast falls the eventide;', 'The darkness deepens; Lord, with me abide.', 'When other helpers fail and comforts flee,', 'Help of the helpless, O abide with me.'] },
  { number: 21, title: 'Holy, Holy, Holy', verse: ['Holy, holy, holy! Lord God Almighty!', 'Early in the morning our song shall rise to Thee.', 'Holy, holy, holy! Merciful and mighty!', 'God in three Persons, blessed Trinity!'] },
  { number: 305, title: 'What a Friend We Have in Jesus', verse: ['What a friend we have in Jesus,', 'All our sins and griefs to bear!', 'What a privilege to carry', 'Everything to God in prayer.'] },
  { number: 64, title: 'Guide Me, O Thou Great Jehovah', verse: ['Guide me, O Thou great Jehovah,', 'Pilgrim through this barren land.', 'I am weak, but Thou art mighty;', 'Hold me with Thy powerful hand.'] },
  { number: 233, title: 'Blessed Assurance', verse: ['Blessed assurance, Jesus is mine!', 'Oh, what a foretaste of glory divine!', 'Heir of salvation, purchase of God,', 'Born of His Spirit, washed in His blood.'] },
  { number: 118, title: 'It Is Well With My Soul', verse: ['When peace like a river attendeth my way,', 'When sorrows like sea billows roll,', 'Whatever my lot, Thou hast taught me to say,', 'It is well, it is well with my soul.'] },
  { number: 1, title: "Nkosi Sikelel' iAfrika", verse: ["Nkosi sikelel' iAfrika,", "Maluphakanyisw' uphondo lwayo,", 'Yizwa imithandazo yethu,', 'Nkosi sikelela, thina lusapho lwayo.'] },
];

/** A hymn line goes up every two minutes, the same beat the sermon keeps. */
const HYMN_BEAT = 2;
/** However the individual rolls fall, at least this share of the pews sings every hymn: a congregation sings. */
const HYMN_FLOOR = 0.7;
/** Below this many in the pews the pastor preaches on and waits for the room. */
const MIN_CONGREGATION = 8;

/**
 * How likely this person is to join in. Almost everyone does — that is what a
 * congregation is — but the very small cannot, the very ill have no breath for
 * it (both return 0), and a few simply stand and listen: shy, low, or not the
 * singing sort.
 */
function singPropensity(p: Person): number {
  if (p.age < 3) return 0;
  if (p.health.state === 'critical') return 0;
  const p_sing =
    0.7 +
    0.22 * p.faith +
    0.1 * p.big5.E +
    0.08 * p.mood -
    0.12 * p.stress -
    (p.health.state === 'healthy' ? 0 : 0.12) -
    (p.grief ? 0.1 : 0) -
    (p.age < 7 ? 0.25 : 0);
  return clamp(p_sing, 0.15, 0.98);
}

function joinsIn(p: Person, rng: ReturnType<Ctx['rng']['stream']>): boolean {
  const q = singPropensity(p);
  return q > 0 && rng.bernoulli(q);
}

/**
 * The floor: if the rolls left fewer than HYMN_FLOOR of the pews singing, the
 * likeliest of the silent join in — the way a hesitant voice is carried along
 * once the room is going. Deterministic (propensity, then id), so it adds no
 * draws to the stream.
 */
function keepTheFloor(ctx: Ctx, hymn: Hymn): void {
  const world = ctx.world;
  const pews = hymn.singerIds.length + hymn.silentIds.length;
  const need = Math.ceil(HYMN_FLOOR * pews) - hymn.singerIds.length;
  if (need <= 0) return;
  const carried = hymn.silentIds
    .map((id) => ({ id, q: world.people[id] ? singPropensity(world.people[id]) : 0 }))
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q || (a.id < b.id ? -1 : 1))
    .slice(0, need)
    .map((x) => x.id);
  if (!carried.length) return;
  const set = new Set(carried);
  hymn.silentIds = hymn.silentIds.filter((id) => !set.has(id));
  hymn.singerIds.push(...carried);
}

/** Everyone in the pews of this church right now, pastor included. */
/** Everyone in the church for the service now running there (a Sunday service, a funeral or a wedding). */
function congregation(ctx: Ctx, pulpit: string, kind: Activity['kind'] = 'church'): Person[] {
  return alivePeople(ctx.world).filter(
    (p) => !p.away && !p.inVehicleId && p.loc.buildingId === pulpit && p.plan[p.planIdx]?.kind === kind,
  );
}

/**
 * The pastor calls a hymn and the room stands. The announcement is his line;
 * from the next beat the verse belongs to everyone singing.
 */
function startHymn(ctx: Ctx, sermon: Conversation, pastor: Person, pews: Person[]): void {
  const rng = ctx.rng.stream('social');
  const world = ctx.world;
  const recent = new Set(sermon.lines.filter((l) => l.chorus).map((l) => l.text));
  // The hymns for the occasion: the Sunday service sings any of them.
  const book = sermon.tone === 'grief' || sermon.tone === 'joy' ? HYMNS.filter((h) => OCCASION[sermon.tone as 'grief' | 'joy'].includes(h.number)) : HYMNS;
  const pool = book.filter((h) => !h.verse.some((v) => recent.has(v)));
  const pick = rng.pick(pool.length ? pool : book);
  const singerIds: string[] = [pastor.id];
  const silentIds: string[] = [];
  for (const p of pews) {
    if (p.id === pastor.id) continue;
    (joinsIn(p, rng) ? singerIds : silentIds).push(p.id);
  }
  const hymn: Hymn = {
    number: pick.number,
    title: pick.title,
    verse: [...pick.verse],
    lineIdx: -1,
    lineMinute: world.minute,
    singerIds,
    silentIds,
  };
  keepTheFloor(ctx, hymn);
  sermon.hymn = hymn;
  sermon.lines.push({ speakerId: pastor.id, text: `We will now sing hymn number ${pick.number}, “${pick.title}”.`, minute: world.minute });
}

/**
 * Move the verse on a line at a time; when it runs out the room sits and the
 * pastor picks up where he left off. Singing together lifts a congregation —
 * a small, shared nudge to mood and stress for those who joined in.
 */
function hymnMinute(ctx: Ctx, sermon: Conversation, pulpit: string, pastor: Person): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('social');
  const hymn = sermon.hymn!;
  if (world.minute - hymn.lineMinute < HYMN_BEAT) return;
  hymn.lineIdx++;
  hymn.lineMinute = world.minute;
  if (hymn.lineIdx < hymn.verse.length) {
    // Latecomers find the page and join the verse already in progress.
    const singing = new Set(hymn.singerIds);
    const silent = new Set(hymn.silentIds);
    for (const p of congregation(ctx, pulpit, pastor.plan[pastor.planIdx]?.kind)) {
      if (singing.has(p.id) || silent.has(p.id)) continue;
      (joinsIn(p, rng) ? hymn.singerIds : hymn.silentIds).push(p.id);
    }
    keepTheFloor(ctx, hymn);
    sermon.lines.push({ speakerId: pastor.id, text: hymn.verse[hymn.lineIdx], minute: world.minute, chorus: true });
    return;
  }
  for (const id of hymn.singerIds) {
    const p = world.people[id];
    if (!p || !p.alive) continue;
    p.mood = clamp(p.mood + 0.03, -1, 1);
    p.stress = clamp(p.stress - 0.03, 0, 1);
  }
  sermon.hymn = null;
  sermon.nextHymnMinute = world.minute + 16 + rng.int(12);
  world.stats.hymnsSung++;
  nextLine(ctx, sermon); // the pastor resumes at once, so no gap over the pulpit
}

function pickTopic(ctx: Ctx, a: Person, b: Person): keyof typeof TOPIC_LINES {
  const rng = ctx.rng.stream('social');
  const w = ctx.world.weather;
  const opts: Array<[keyof typeof TOPIC_LINES, number]> = [
    ['weather', w.condition === 'clear' ? 0.6 : 1.4],
    ['church', 0.6 + (a.faith + b.faith)],
    ['work', a.workplaceId && b.workplaceId ? 1.4 : 0.6],
    ['family', a.householdId === b.householdId ? 1.6 : 0.9],
    ['health', a.health.illnesses.length || b.health.illnesses.length ? 1.8 : 0.4],
    ['money', ctx.world.households[a.householdId]?.poor || ctx.world.households[b.householdId]?.poor ? 1.3 : 0.5],
    ['community', ctx.world.stats.incidents > 0 ? 0.9 : 0.4],
    ['faith', (a.faith + b.faith) * 0.5],
  ];
  return rng.weighted(opts);
}

function toneFor(ctx: Ctx, a: Person, b: Person, rel: Relationship | undefined, kind: Activity['kind']): Tone {
  const rng = ctx.rng.stream('social');
  if (kind === 'funeral' || a.grief || b.grief) return 'grief';
  if (kind === 'wedding' || kind === 'celebration') return 'joy';
  if (kind === 'biblestudy' || kind === 'youth' || kind === 'choir') return rng.bernoulli(0.5) ? 'prayer' : 'warm';
  // After-service fellowship is where the congregation builds each other up:
  // warm, sometimes prayerful, at worst a bit of news-trading. Quarrels start
  // at home, at work or over the fence, and are brought to the pastor.
  if (kind === 'fellowship') return rng.weighted([['warm', 0.6], ['prayer', 0.25], ['gossip', 0.15]] as const);
  const strength = rel?.strength ?? 0;
  const tension = (conflictProneness(a.big5) + conflictProneness(b.big5)) / 2 + (a.stress + b.stress) / 4 - strength * 0.5;
  if (rng.bernoulli(clamp(tension * 0.35, 0, 0.6))) return 'tense';
  if (rng.bernoulli(0.15 + 0.2 * b.big5.E)) return 'gossip';
  return strength > 0.4 ? 'warm' : 'neutral';
}

export function startConversation(ctx: Ctx, a: Person, b: Person, kind: Activity['kind']): Conversation {
  const rng = ctx.rng.stream('social');
  const world = ctx.world;
  const rel = a.relationships[b.id];
  const tone = toneFor(ctx, a, b, rel, kind);
  const topic = pickTopic(ctx, a, b);
  const id = ctx.nextId('conversation');
  const dur = tone === 'tense' ? 3 + rng.int(4) : 3 + rng.int(9);
  const c: Conversation = {
    id,
    participantIds: [a.id, b.id],
    buildingId: a.loc.buildingId,
    x: (a.loc.x + b.loc.x) / 2,
    y: (a.loc.y + b.loc.y) / 2,
    startMinute: world.minute,
    endMinute: world.minute + dur,
    topic,
    lines: [{ speakerId: a.id, text: rng.pick(OPENERS[tone]), minute: world.minute }],
    llm: 'none',
    tone,
  };
  world.conversations[id] = c;
  a.conversationId = id;
  b.conversationId = id;
  a.heading = Math.atan2(b.loc.y - a.loc.y, b.loc.x - a.loc.x);
  b.heading = a.heading + Math.PI;
  world.stats.conversations++;
  a.socialToday++;
  b.socialToday++;
  return c;
}

function nextLine(ctx: Ctx, c: Conversation): void {
  const rng = ctx.rng.stream('social');
  const world = ctx.world;
  const last = c.lines[c.lines.length - 1];
  const others = c.participantIds.filter((id) => id !== last?.speakerId);
  const speaker = others.length ? rng.pick(others) : c.participantIds[0];
  const remaining = c.endMinute - world.minute;
  let text: string;
  if (remaining <= 1) text = rng.pick(CLOSERS);
  else if (c.topic === 'sermon' && (c.tone === 'grief' || c.tone === 'joy')) {
    // A funeral or a wedding: the order of service, then the lines he returns to.
    const pastor = world.people[c.participantIds[0]];
    const said = new Set(c.lines.map((x) => x.text));
    const { order, again } = liturgy(c.tone === 'grief' ? 'funeral' : 'wedding', namesIn(pastor?.plan[pastor.planIdx]?.label));
    text = order.find((l) => !said.has(l)) ?? rng.pick(again);
  } else if (c.topic === 'sermon') {
    const pool = SERMON_LINES.filter((l) => !c.lines.some((x) => x.text === l));
    text = pool.length ? rng.pick(pool) : rng.pick(SERMON_LINES);
  } else if (c.tone === 'prayer') text = rng.pick(TOPIC_LINES.faith);
  else if (c.tone === 'tense') text = rng.pick(['I did not do that.', 'You always say that.', 'Let us not shout.', 'The pastor should hear about this.', 'Fine. We will settle it properly.', 'Keep your voice down.']);
  else if (c.tone === 'grief') text = rng.pick(['Thank you for coming.', 'It still does not feel real.', 'The church has been so kind.', 'One day at a time.']);
  else {
    const pool = (TOPIC_LINES[c.topic] ?? TOPIC_LINES.weather).filter((l) => !c.lines.some((x) => x.text === l));
    text = pool.length ? rng.pick(pool) : rng.pick(CLOSERS);
  }
  c.lines.push({ speakerId: speaker, text, minute: world.minute });
}

export function endConversation(ctx: Ctx, c: Conversation, outcome: 'ok' | 'dispute'): void {
  const world = ctx.world;
  for (const id of c.participantIds) {
    const p = world.people[id];
    if (p && p.conversationId === c.id) p.conversationId = null;
  }
  // Relationship upkeep, over every ordered pair in the group.
  const members = c.participantIds.map((id) => world.people[id]).filter((p): p is Person => !!p);
  if (members.length >= 2) {
    const delta = outcome === 'dispute' ? -0.12 : c.tone === 'tense' ? -0.03 : c.tone === 'warm' || c.tone === 'joy' ? 0.05 : 0.025;
    const pairs: Array<readonly [Person, Person]> = [];
    for (const x of members) for (const y of members) if (x !== y) pairs.push([x, y] as const);
    for (const [x, y] of pairs) {
      const r = x.relationships[y.id];
      if (r) {
        r.strength = clamp(r.strength + delta, -1, 1);
        r.lastInteraction = world.day;
        if (r.kind === 'acquaintance' && r.strength > 0.35) r.kind = 'friend';
        if (r.strength < -0.4 && (r.kind === 'friend' || r.kind === 'acquaintance' || r.kind === 'neighbour')) r.kind = 'rival';
      } else x.relationships[y.id] = { kind: 'acquaintance', strength: 0.15 + delta, since: world.day, lastInteraction: world.day };
    }
    for (const p of members) p.mood = clamp(p.mood + (outcome === 'dispute' ? -0.15 : c.tone === 'warm' || c.tone === 'joy' ? 0.04 : 0.02), -1, 1);
  }
  // Keep a bounded transcript history in world.conversations (recent ones only)
  const ids = Object.keys(world.conversations);
  if (ids.length > 60) {
    ids.sort((p, q) => world.conversations[p].startMinute - world.conversations[q].startMinute);
    for (const id of ids.slice(0, ids.length - 60)) delete world.conversations[id];
  }
}

/**
 * After the service the congregation breaks into small groups: everyone at
 * fellowship who is not already talking is drawn into the nearest group, or
 * paired with the nearest neighbour who is also free. Groups run to three, and
 * as conversations end people re-pair with someone else, so the room mingles.
 */
function fellowshipMinute(ctx: Ctx, rng: ReturnType<Ctx['rng']['stream']>): void {
  const world = ctx.world;
  const atFellowship = (p: Person) => p.plan[p.planIdx]?.kind === 'fellowship';
  const fellows = alivePeople(world).filter((p) => !p.away && !p.inVehicleId && p.age >= 3 && atFellowship(p));
  if (fellows.length < 2) return;
  const free = fellows.filter((p) => !p.conversationId);
  const taken = new Set<string>();
  for (const p of free) {
    if (taken.has(p.id) || p.conversationId) continue;
    if (!rng.bernoulli(0.85)) continue;
    // Join a nearby pair, making it a group of three.
    let joined = false;
    if (rng.bernoulli(0.32)) {
      for (const id in world.conversations) {
        const c = world.conversations[id];
        if (c.participantIds.length !== 2 || !c.buildingId || world.buildings[c.buildingId]?.kind !== 'church') continue;
        if (!c.participantIds.every((q) => world.people[q]?.conversationId === id && atFellowship(world.people[q]))) continue;
        if (dist(p.loc.x, p.loc.y, c.x, c.y) > 12) continue;
        c.participantIds.push(p.id);
        p.conversationId = id;
        c.endMinute = Math.max(c.endMinute, world.minute + 3);
        p.socialToday++;
        taken.add(p.id);
        joined = true;
        break;
      }
    }
    if (joined) continue;
    // Otherwise pair with the nearest neighbour who is also free.
    let best: Person | null = null;
    let bestD = 16;
    for (const q of free) {
      if (q === p || taken.has(q.id) || q.conversationId) continue;
      const d = dist(p.loc.x, p.loc.y, q.loc.x, q.loc.y);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    if (!best) continue;
    startConversation(ctx, p, best, 'fellowship');
    taken.add(p.id);
    taken.add(best.id);
    // Stand together: the partner steps over so the group reads as a huddle
    // rather than two people shouting across the hall.
    if (bestD > 3.5) {
      const dx = best.loc.x - p.loc.x;
      const dy = best.loc.y - p.loc.y;
      const l = Math.hypot(dx, dy) || 1;
      const nx = p.loc.x + (dx / l) * 2.2;
      const ny = p.loc.y + (dy / l) * 2.2;
      best.path = [{ x: nx, y: ny }];
      best.target = best.target
        ? { ...best.target, x: nx, y: ny, spotId: null }
        : { x: nx, y: ny, buildingId: best.loc.buildingId, roomId: best.loc.roomId, spotId: null };
    }
  }
}

/** Runs once per simulated minute in micro mode. */
export function socialMinute(ctx: Ctx): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('social');
  const mod = world.minuteOfDay;
  // Progress / end conversations
  for (const id in world.conversations) {
    const c = world.conversations[id];
    const participants = c.participantIds.map((pid) => world.people[pid]);
    const active = participants.every((p) => p && p.alive && p.conversationId === c.id);
    if (!active) continue;
    if (world.minute >= c.endMinute) {
      const dispute = c.tone === 'tense' && rng.bernoulli(0.35);
      endConversation(ctx, c, dispute ? 'dispute' : 'ok');
      if (dispute && participants.length === 2) startDispute(ctx, participants[0], participants[1], c.buildingId, c.x, c.y);
      continue;
    }
    if (c.hymn) continue; // the room is singing; nobody talks over a hymn
    if (c.llm === 'none' || c.llm === 'failed') {
      if (rng.bernoulli(0.7)) nextLine(ctx, c);
    }
  }
  // ── The pulpit ──────────────────────────────────────────────────────────
  // While the pastor is leading a service he is preaching, without a gap: the
  // sermon is one long conversation that gains a line every couple of minutes,
  // which is what keeps a speech bubble over him for the whole service. Every
  // twenty minutes or so he calls a hymn and the whole congregation takes over.
  // He conducts the church's funerals and weddings from the pulpit the same way.
  for (const pulpit of CHURCH_IDS) {
  const pastorId = world.roles.pastorByChurch[pulpit] ?? null;
  const pastor = pastorId ? world.people[pastorId] : null;
  const service = pastor?.plan[pastor.planIdx];
  const leading = !!service && (service.kind === 'church' || ((service.kind === 'funeral' || service.kind === 'wedding') && service.role === 'lead'));
  if (pastor && pastor.alive && !pastor.away && leading && pastor.loc.buildingId === pulpit) {
    const tone = service!.kind === 'funeral' ? 'grief' : service!.kind === 'wedding' ? 'joy' : 'prayer';
    let sermon = pastor.conversationId ? world.conversations[pastor.conversationId] : null;
    if (!sermon || sermon.topic !== 'sermon') {
      const id = ctx.nextId('conversation');
      sermon = { id, participantIds: [pastor.id], buildingId: pulpit, x: pastor.loc.x, y: pastor.loc.y, startMinute: world.minute, endMinute: world.minute + 3, topic: 'sermon', lines: [], llm: 'none', tone, hymn: null, nextHymnMinute: world.minute + 6 };
      world.conversations[id] = sermon;
      pastor.conversationId = id;
      if (tone === 'prayer') world.stats.churchServices++;
    }
    sermon.x = pastor.loc.x;
    sermon.y = pastor.loc.y;
    sermon.endMinute = world.minute + 3;
    const scripted = sermon.llm === 'streaming' || sermon.llm === 'pending';
    if (sermon.hymn) {
      hymnMinute(ctx, sermon, pulpit, pastor);
    } else {
      // A hymn needs a congregation: while the pews are still filling the
      // pastor holds off rather than singing to an empty church.
      const due = !scripted && world.minute >= (sermon.nextHymnMinute ?? Infinity);
      const pews = due ? congregation(ctx, pulpit, service!.kind) : [];
      if (due && pews.length >= MIN_CONGREGATION) startHymn(ctx, sermon, pastor, pews);
      else {
        if (due) sermon.nextHymnMinute = world.minute + 2;
        const last = sermon.lines[sermon.lines.length - 1];
        // A bubble stays up for 2.5 simulated minutes, so a new line every 2
        // keeps him speaking without a break. A scripted sermon paces itself.
        if (!scripted && (!last || world.minute - last.minute >= 2)) nextLine(ctx, sermon);
      }
    }
  }
  }
  fellowshipMinute(ctx, rng);
  // New conversations among co-located idle people
  const people = alivePeople(world).filter((p) => !p.away && !p.inVehicleId && p.path.length === 0 && !p.conversationId && p.age >= 3);
  const byRoom = new Map<string, Person[]>();
  for (const p of people) {
    const a = p.plan[p.planIdx];
    if (!a || QUIET_KINDS.has(a.kind)) continue;
    if (!SOCIAL_KINDS.has(a.kind)) continue;
    const key = `${p.loc.buildingId ?? 'out'}:${p.loc.roomId ?? 'x'}`;
    (byRoom.get(key) ?? byRoom.set(key, []).get(key)!).push(p);
  }
  for (const group of byRoom.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      const a = group[i];
      if (a.conversationId) continue;
      for (let j = i + 1; j < group.length; j++) {
        const b = group[j];
        if (b.conversationId) continue;
        if (dist(a.loc.x, a.loc.y, b.loc.x, b.loc.y) > 7) continue;
        const kind = a.plan[a.planIdx]?.kind ?? 'idle';
        const rel = a.relationships[b.id];
        const base = kind === 'fellowship' || kind === 'celebration' || kind === 'visit' ? 0.12 : kind === 'work' ? 0.015 : kind === 'match' || kind === 'concert' ? 0.02 : 0.035;
        const p = base * (0.4 + sociability(a.big5) + sociability(b.big5)) * (1 + (rel?.strength ?? 0));
        if (rng.bernoulli(clamp(p, 0, 0.5))) {
          startConversation(ctx, a, b, kind);
          break;
        }
      }
    }
  }
}

// ─── Disputes ──────────────────────────────────────────────────────────────

export function startDispute(ctx: Ctx, a: Person, b: Person, buildingId: string | null, x: number, y: number): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('social');
  world.stats.disputes++;
  const cause = rng.pick(['money', 'a fence line', 'noise', 'a loan', 'gossip', 'the children', 'a borrowed tool', 'livestock in the garden', 'a broken promise']);
  ctx.emit({ kind: 'dispute', severity: 'alert', text: `${fullName(a)} and ${fullName(b)} are in a dispute over ${cause}.`, personIds: [a.id, b.id], buildingId: buildingId ?? undefined, x, y });
  a.alertTimer = 30;
  b.alertTimer = 30;
  const agree = (a.big5.A + b.big5.A) / 2;
  const heat = (conflictProneness(a.big5) + conflictProneness(b.big5)) / 2 + (a.stress + b.stress) / 3;
  // 1) talk it out
  if (rng.bernoulli(clamp(0.35 + 0.5 * agree - 0.3 * heat, 0.05, 0.9))) {
    a.mood = clamp(a.mood - 0.05, -1, 1);
    b.mood = clamp(b.mood - 0.05, -1, 1);
    return;
  }
  // 2) pastoral mediation — where the parties have a pastor at all
  const ownChurch = landmark(communityOfPerson(world, a), 'church');
  const pastorId = ownChurch ? world.roles.pastorByChurch[ownChurch] ?? null : null;
  const pastor = pastorId ? world.people[pastorId] : null;
  const faith = (a.faith + b.faith) / 2;
  if (ownChurch && pastor && pastor.alive && !pastor.away && rng.bernoulli(clamp(0.25 + 0.55 * faith, 0, 0.9))) {
    world.stats.mediations++;
    const ok = rng.bernoulli(clamp(0.45 + 0.3 * pastor.big5.A + 0.25 * agree - 0.2 * heat, 0.1, 0.95));
    ctx.emit({ kind: 'mediation', severity: ok ? 'joy' : 'alert', text: ok ? `Pastor ${pastor.surname} mediated between ${a.firstName} and ${b.firstName}; they reconciled.` : `Pastor ${pastor.surname}'s mediation between ${a.firstName} and ${b.firstName} failed.`, personIds: [a.id, b.id, pastor.id], buildingId: ownChurch });
    if (ok) {
      for (const [x1, y1] of [[a, b], [b, a]] as const) {
        const r = x1.relationships[y1.id];
        if (r) r.strength = clamp(r.strength + 0.15, -1, 1);
      }
      a.faith = clamp(a.faith + 0.02, 0, 1);
      b.faith = clamp(b.faith + 0.02, 0, 1);
      return;
    }
  }
  // 3) escalation
  if (rng.bernoulli(clamp(0.3 + 0.6 * heat - 0.3 * agree, 0.05, 0.85))) {
    world.stats.fights++;
    const kind = a.householdId === b.householdId ? 'domestic' : 'fight';
    raiseIncident(ctx, kind, [a.id, b.id], x, y, buildingId, { aggressorId: heat > 0.5 && a.big5.A < b.big5.A ? a.id : b.id });
  } else {
    ctx.emit({ kind: 'dispute', severity: 'info', text: `${a.firstName} and ${b.firstName} are no longer speaking.`, personIds: [a.id, b.id] });
    const r1 = a.relationships[b.id];
    const r2 = b.relationships[a.id];
    if (r1) r1.strength = clamp(r1.strength - 0.3, -1, 1);
    if (r2) r2.strength = clamp(r2.strength - 0.3, -1, 1);
  }
}

// ─── Daily dynamics ────────────────────────────────────────────────────────

export function socialDayStep(ctx: Ctx): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('social');
  const P = ctx.params;
  const people = alivePeople(world);
  const holidayJoy = world.holiday ? 0.08 : 0;
  for (const p of people) {
    const hh = world.households[p.householdId];
    const res = resilience(p.big5);
    // Mood baseline: personality, faith, health, poverty, season/weather
    let base = 0.15 + 0.35 * (1 - p.big5.N) + 0.15 * p.faith - 0.35 * (hh?.poor ? 1 : 0) * (1 - res) + holidayJoy;
    if (p.health.illnesses.length) base -= 0.25;
    if (world.weather.condition === 'clear' && world.weather.tempMax > 18 && world.weather.tempMax < 30) base += 0.05;
    if (p.grief) base -= 0.5 * p.grief.intensity;
    p.mood = clamp(p.mood + (base - p.mood) * (0.08 + 0.12 * res) + rng.normal(0, 0.04), -1, 1);
    p.stress = clamp(p.stress * 0.97 + (p.health.illnesses.length ? 0.02 : 0) + (p.job === 'unemployed' && p.age < 60 ? 0.01 : 0) - 0.01 * p.faith, 0, 1);
    p.energy = 0.9;
    p.socialToday = 0;
    if (p.alertTimer > 0) p.alertTimer = 0;
    if (p.grief) {
      const left = p.grief.untilDay - world.day;
      if (left <= 0) {
        p.grief = null;
      } else p.grief.intensity = clamp(p.grief.intensity * 0.995, 0.05, 1);
    }
    if (p.romanceCooldown > 0) p.romanceCooldown--;
    // Relationship decay
    for (const id in p.relationships) {
      const r = p.relationships[id];
      const other = world.people[id];
      if (!other || !other.alive || other.emigrated) {
        if (r.kind === 'friend' || r.kind === 'acquaintance' || r.kind === 'colleague' || r.kind === 'neighbour' || r.kind === 'rival') delete p.relationships[id];
        continue;
      }
      if (r.kind === 'friend' || r.kind === 'acquaintance' || r.kind === 'rival') {
        if (world.day - r.lastInteraction > 60) r.strength = clamp(r.strength * 0.995, -1, 1);
      }
    }
  }
  // Macro-mode social upkeep: co-resident and co-worker ties strengthen; friendships form.
  if (!ctx.micro) {
    for (const p of people) {
      if (p.age < 3) continue;
      const mates = householdMembers(world, p.householdId).filter((q) => q !== p);
      for (const q of mates) {
        const r = p.relationships[q.id];
        if (r) {
          r.lastInteraction = world.day;
          r.strength = clamp(r.strength + 0.002, -1, 1);
        }
      }
      if (rng.bernoulli(0.02 * sociability(p.big5))) {
        const cands = people.filter((q) => q !== p && q.householdId !== p.householdId && Math.abs(q.age - p.age) < (p.age < 18 ? 4 : 15) && !p.relationships[q.id]);
        if (cands.length) {
          const q = rng.pick(cands);
          p.relationships[q.id] = { kind: 'acquaintance', strength: 0.2, since: world.day, lastInteraction: world.day };
          q.relationships[p.id] = { kind: 'acquaintance', strength: 0.2, since: world.day, lastInteraction: world.day };
        }
      }
      world.stats.conversations += Math.round(2 + 4 * sociability(p.big5));
    }
  }
  // Daily dispute rolls (both modes) — households, neighbours, workplaces
  const adults = people.filter((p) => p.age >= 15 && !p.away);
  const dailyBase = P.disputeRate / 100 / 365.25;
  for (const a of adults) {
    const hh = world.households[a.householdId];
    const conflict = conflictProneness(a.big5);
    const pDay = dailyBase * (0.4 + 2.2 * conflict) * (1 + a.stress) * (hh?.poor ? 1.4 : 1) * (a.mood < -0.3 ? 1.5 : 1);
    if (!rng.bernoulli(clamp(pDay, 0, 0.2))) continue;
    // Who with? Household member, neighbour, colleague, rival
    const cands = Object.entries(a.relationships)
      .filter(([id, r]) => world.people[id]?.alive && !world.people[id].emigrated && !world.people[id].away && world.people[id].age >= 15 && (r.kind === 'spouse' || r.kind === 'neighbour' || r.kind === 'colleague' || r.kind === 'rival' || r.kind === 'sibling' || r.strength < 0))
      .map(([id, r]) => [world.people[id], r] as const);
    if (!cands.length) continue;
    const [b] = rng.weighted(cands.map(([q, r]) => [[q, r] as const, r.kind === 'rival' ? 3 : r.kind === 'spouse' ? 1.5 : 1] as const));
    const house = world.buildings[hh.houseId];
    startDispute(ctx, a, b, house?.id ?? null, house ? house.x + house.w / 2 : a.loc.x, house ? house.y + house.h / 2 : a.loc.y);
  }
}

/** Grieve for someone: called from the death handler. */
export function bereave(ctx: Ctx, p: Person, forWhom: Person, intensity: number, days: number): void {
  const res = resilience(p.big5);
  p.grief = { forId: forWhom.id, forName: fullName(forWhom), untilDay: ctx.world.day + Math.round(days * (1.3 - 0.6 * res)), intensity: clamp(intensity * (1.2 - 0.4 * res), 0.1, 1) };
  p.mood = clamp(p.mood - 0.6 * intensity, -1, 1);
  p.stress = clamp(p.stress + 0.3 * intensity, 0, 1);
}

/**
 * Church attendance for the analytics (called on Sundays, from the day's
 * plans): the count at the service by city, against the residents of the
 * cities that have congregations at all, so the share is a share of the
 * church-going region and Newhaven does not drag it down.
 */
export function recordChurchAttendance(ctx: Ctx): void {
  const world = ctx.world;
  const people = alivePeople(world);
  const byCity: Record<string, number> = {};
  let attending = 0;
  let population = 0;
  const religious = new Set(CITIES.filter((c) => c.religious).map((c) => c.id));
  for (const p of people) {
    const city = cityOf(communityOfPerson(world, p));
    if (religious.has(city)) population++;
    const a = p.plan.find((x) => x.kind === 'church' && x.start <= 600 && x.end > 600);
    if (!a) continue;
    attending++;
    byCity[city] = (byCity[city] ?? 0) + 1;
  }
  world.stats.weeklyChurch.push({ day: world.day, attendance: attending, population, byCity });
  if (world.stats.weeklyChurch.length > 1600) world.stats.weeklyChurch.shift();
}
