// What each person looks like today. The body follows who they are: sex,
// age (a child's proportions and face, puberty, the changes of age), height
// for their age and sex, a build of their own, their ancestry and a face
// inherited from their parents (a child resembles both; the families who
// founded the district have their own), skin from their family's roots, the
// hair of their sex, age and family. Then what they are wearing: their own
// small wardrobe, worn a different way each day (one piece in their
// household's colour, so a family still reads together), a uniform at work,
// school uniform on school days, Sunday best at church, warmer clothes and a
// beanie in winter, night clothes in bed.
import * as THREE from 'three';
import type { Person, World } from '../../sim/types';
import { plotColor } from '../lib/householdColor';
import { heritageOf, type Heritage } from '../../sim/heritage';
import { hairColour } from './hair';
import type { BrowStyle, HairStyle, LashStyle, Look, Wear } from './look';
import { hash01, mixHex } from './materials';

/** Skin tones, light to deep. */
const SKIN = ['#EFCFB8', '#E2B495', '#C99A75', '#AA7753', '#8C5B3C', '#6E452C', '#553421', '#402619'];

type Roots = Heritage;
const TONE_RANGE: Record<Roots, [number, number]> = {
  nguni: [4, 7.6], sotho: [3.8, 7.2], tsonga: [4.5, 7.8], afrikaner: [0, 1.6], english: [0, 1.4], indian: [2.4, 4.8], coloured: [2.2, 4.8],
};
/**
 * MakeHuman's ancestry sets for each: its African, Asian and European faces and builds. South Africa's Indian
 * families (Tamil and Telugu for the most part) have no set of their own: mostly the European, with some of the
 * African's breadth of nose and lips.
 */
const ANCESTRY: Record<Roots, [number, number, number]> = {
  nguni: [1, 0, 0], sotho: [1, 0, 0], tsonga: [1, 0, 0], afrikaner: [0, 0, 1], english: [0, 0, 1], indian: [0.25, 0.05, 0.7], coloured: [0.45, 0.2, 0.35],
};
const AFRICAN = new Set<Roots>(['nguni', 'sotho', 'tsonga']);
const WHITE = new Set<Roots>(['afrikaner', 'english']);

/** The people of the family a person was born into (it stays when a woman takes her husband's name). */
function rootsOf(p: Person, world: World): Roots {
  if (p.heritage) return p.heritage;
  const hh = world.households[p.householdId];
  const bySurname = heritageOf(p.surname);
  return bySurname !== 'nguni' || !hh ? bySurname : heritageOf(hh.name);
}

/** Whose ways of dress and hair a person follows: their own family's, or (born here) one parent's. */
function styleOf(world: World, p: Person, depth = 0): Roots {
  return remember(world, `style|${p.id}`, () => {
    const ps = depth < 6 ? parentsOf(world, p) : [];
    if (!ps.length) return rootsOf(p, world);
    const from = ps[Math.floor(hash01(p.id, 91) * ps.length)];
    return styleOf(world, from, depth + 1);
  });
}

/** Parents who are (or were) in the world. */
function parentsOf(world: World, p: Person): Person[] {
  const out: Person[] = [];
  for (const id of p.parentIds ?? []) {
    const q = world.people[id];
    if (q) out.push(q);
  }
  return out;
}

/** Inherited traits, remembered per world (a person's never change). */
const memo = new WeakMap<World, Map<string, unknown>>();
function remember<T>(world: World, key: string, make: () => T): T {
  let m = memo.get(world);
  if (!m) memo.set(world, (m = new Map()));
  if (m.has(key)) return m.get(key) as T;
  const v = make();
  m.set(key, v);
  return v;
}

/** Skin tone on the SKIN scale: a child between their parents; the founding families by their roots. */
function tone(world: World, p: Person, depth = 0): number {
  return remember(world, `tone|${p.id}`, () => {
    const ps = depth < 6 ? parentsOf(world, p) : [];
    const me = hash01(p.id, 5) - 0.5;
    if (ps.length) {
      const avg = ps.reduce((s, q) => s + tone(world, q, depth + 1), 0) / ps.length;
      return clamp(avg + me * 0.5, 0, SKIN.length - 1);
    }
    const [a, b] = TONE_RANGE[rootsOf(p, world)];
    const fam = hash01(p.householdId, 3);
    return clamp(a + (b - a) * (0.25 + fam * 0.5) + me * 1.1, 0, SKIN.length - 1);
  });
}

/**
 * The skin's undertone, 0 cool (olive, yellower) .. 1 warm (redder), 0.5 neither: MetaHuman's second axis of
 * skin tone (its V, beside the darkness U). A child's lies between their parents'; a founding family's is its own.
 */
export function undertoneOf(world: World, p: Person, depth = 0): number {
  return remember(world, `under|${p.id}`, () => {
    const ps = depth < 6 ? parentsOf(world, p) : [];
    const me = hash01(p.id, 6) - 0.5;
    if (ps.length) return clamp(ps.reduce((s, q) => s + undertoneOf(world, q, depth + 1), 0) / ps.length + me * 0.3, 0, 1);
    return clamp(0.5 + (hash01(p.householdId, 4) - 0.5) * 0.6 + me * 0.4, 0, 1);
  });
}

/** A person's skin (the vehicles' passengers use it too): its darkness on the SKIN scale, then its undertone. */
export function skinOf(world: World, p: Person): string {
  const t = tone(world, p);
  const i = Math.floor(t);
  const base = mixHex(SKIN[i], SKIN[Math.min(SKIN.length - 1, i + 1)], t - i);
  const w = (undertoneOf(world, p) - 0.5) * 2;
  const c = new THREE.Color(base);
  // Warm: more red, less blue; cool: a little less red, a touch more green. The lightness stays.
  c.r = clamp(c.r * (1 + 0.07 * w), 0, 1);
  c.g = clamp(c.g * (1 - 0.025 * w), 0, 1);
  c.b = clamp(c.b * (1 - 0.06 * w), 0, 1);
  return `#${c.getHexString()}`;
}

function ancestryOf(world: World, p: Person, depth = 0): [number, number, number] {
  return remember(world, `anc|${p.id}`, () => {
    const ps = depth < 6 ? parentsOf(world, p) : [];
    if (ps.length) {
      const s = [0, 0, 0];
      for (const q of ps) ancestryOf(world, q, depth + 1).forEach((v, i) => (s[i] += v / ps.length));
      return s as [number, number, number];
    }
    return ANCESTRY[rootsOf(p, world)];
  });
}

/** Face and body details (see look.ts), each person's own: a child's lie between their parents'. */
const FACE: Array<[string, number]> = [
  ['noseWidth', 0.5], ['noseLength', 0.4], ['noseDepth', 0.3], ['noseBridge', 0.4], ['noseTip', 0.4], ['nostrils', 0.4], ['mouthWidth', 0.4], ['upperLip', 0.4], ['lowerLip', 0.4],
  ['chinProminent', 0.4], ['chinWidth', 0.4], ['chinHeight', 0.3], ['jawWidth', 0.4], ['cheekBones', 0.4], ['cheekVolume', 0.4], ['eyeSize', 0.3], ['eyeSpacing', 0.3], ['eyeOpen', 0.3],
  ['eyeTilt', 0.3], ['browsHeight', 0.3], ['browsAngle', 0.3], ['forehead', 0.3], ['headFat', 0.3], ['earSize', 0.35], ['earFlap', 0.35], ['neckWidth', 0.25],
];
function faceOf(world: World, p: Person, depth = 0): number[] {
  return remember(world, `face|${p.id}`, () => {
    const own = FACE.map(([, amp], i) => (hash01(p.id, 101 + i) * 2 - 1) * amp);
    const ps = depth < 6 ? parentsOf(world, p) : [];
    if (!ps.length) return own;
    const fs = ps.map((q) => faceOf(world, q, depth + 1));
    // Each feature from one parent or the other (or between them), with a little of the child's own.
    return own.map((o, i) => {
      const pick = hash01(p.id, 201 + i);
      const inh = fs.length === 1 ? fs[0][i] : pick < 0.4 ? fs[0][i] : pick < 0.8 ? fs[1][i] : (fs[0][i] + fs[1][i]) / 2;
      return inh * 0.8 + o * 0.35;
    });
  });
}

/**
 * Hair pigment by the family's roots (see hair.ts: melanin, and how red it is): the range a founding family's
 * lies in, the share with fair hair (little melanin) and the share with red hair (mostly pheomelanin).
 */
export interface HairPigment {
  melanin: number;
  redness: number;
}
const PIGMENT: Record<Roots, { melanin: [number, number]; redness: [number, number]; fair?: number; red?: number }> = {
  nguni: { melanin: [0.88, 0.97], redness: [0, 0.12] },
  sotho: { melanin: [0.88, 0.97], redness: [0, 0.12] },
  tsonga: { melanin: [0.88, 0.97], redness: [0, 0.12] },
  afrikaner: { melanin: [0.45, 0.85], redness: [0.05, 0.35], fair: 0.52, red: 0.03 },
  english: { melanin: [0.45, 0.85], redness: [0.05, 0.35], fair: 0.5, red: 0.04 },
  indian: { melanin: [0.9, 0.97], redness: [0, 0.06] },
  coloured: { melanin: [0.6, 0.95], redness: [0.02, 0.2], fair: 0.12 },
};

/**
 * A person's hair pigment, theirs for life: the founding families' from their roots (a family tends the same way,
 * each member a little their own), a child's between their parents' with a little of their own.
 */
export function hairPigment(world: World, p: Person, depth = 0): HairPigment {
  return remember(world, `hair|${p.id}`, () => {
    const ps = depth < 6 ? parentsOf(world, p) : [];
    const own = hash01(p.id, 27) - 0.5;
    if (ps.length) {
      const inh = ps.map((q) => hairPigment(world, q, depth + 1));
      const melanin = inh.reduce((s, x) => s + x.melanin, 0) / inh.length;
      const redness = inh.reduce((s, x) => s + x.redness, 0) / inh.length;
      return { melanin: clamp(melanin + own * 0.16, 0.03, 0.97), redness: clamp(redness + (hash01(p.id, 28) - 0.5) * 0.12, 0, 1) };
    }
    const g = PIGMENT[rootsOf(p, world)];
    const fam = hash01(p.householdId, 29);
    const u = hash01(p.id, 30);
    if (g.red && u < g.red) return { melanin: 0.15 + hash01(p.id, 31) * 0.25, redness: 0.75 + hash01(p.id, 32) * 0.2 };
    const [r0, r1] = g.redness;
    const redness = clamp(r0 + (r1 - r0) * (0.3 + fam * 0.4 + own * 0.6), 0, 1);
    if (g.fair && u < (g.red ?? 0) + g.fair) return { melanin: clamp(0.06 + 0.36 * (0.15 + fam * 0.5 + own * 0.7), 0.04, 0.45), redness };
    const [m0, m1] = g.melanin;
    return { melanin: clamp(m0 + (m1 - m0) * (0.3 + fam * 0.4 + own * 0.6), 0.03, 0.97), redness };
  });
}

const EYES_DARK = ['#2C1A0E', '#3A2414', '#4A2E18'];
const EYES_LIGHT = ['#4A6FA0', '#5E8A6A', '#6B5236', '#3A2414', '#7A9AB8'];

/** Wardrobe colours: everyday tops, trousers and skirts. */
const TOPS = ['#F4F3EF', '#2B2C31', '#3E5C8A', '#8E3B3B', '#5B7B5A', '#C9A15B', '#6A4C7A', '#D9D4C7', '#2F6F8F', '#B55D3A', '#E8C6C0', '#4A4F57'];
const TROUSERS = ['#2E3A55', '#26282D', '#6E6A60', '#4E3D30', '#1F2E3D', '#5E646C', '#3E4A3A', '#8A7A5E', '#3B4E6E'];
const DENIM = ['#34466A', '#2B3A55', '#3D5378', '#27324A', '#4A5E82'];
const SKIRTS = ['#2E3A55', '#6A2E3E', '#3E5C4A', '#26282D', '#8A5A3A', '#5B3F6E', '#B58A4A', '#34466A'];
const SCHOOL = ['#1F3B6E', '#1E4D3A', '#6A1E2E', '#3A3A44'];
const WRAPS = ['#B8432E', '#2F5DA8', '#D9A62E', '#6B2E6E', '#1E7A5A', '#E0E0DA', '#8A2432'];
/** Saris: the cloth and its border. */
const SARIS: Array<[string, string]> = [['#B0203A', '#D4A93A'], ['#1F5FA8', '#D4A93A'], ['#1E7A5A', '#E3C75A'], ['#6A2E6E', '#D4A93A'], ['#E0567A', '#F2E3A0'], ['#F08A24', '#9B1B30'], ['#F4F1E6', '#C9A23A'], ['#2E3A7A', '#C0C4CC']];

export interface Dressing {
  look: Look;
  /** Changes when the clothes change (another day, going to work, the season). */
  key: string;
}

/** Standing height (m) for age and sex, WHO-like medians with a personal spread (half from the parents). */
export function heightFor(p: Person): number {
  const a = p.age;
  const f = p.sex === 'F';
  const pts: Array<[number, number, number]> = [
    [0, 0.5, 0.49], [1, 0.75, 0.74], [2, 0.87, 0.86], [3, 0.96, 0.95], [4, 1.03, 1.02], [5, 1.1, 1.09], [6, 1.16, 1.15], [8, 1.28, 1.27],
    [10, 1.38, 1.38], [12, 1.49, 1.51], [14, 1.62, 1.58], [16, 1.69, 1.61], [18, 1.71, 1.62],
  ];
  let h = f ? 1.62 : 1.71;
  for (let i = 1; i < pts.length; i++) {
    if (a <= pts[i][0]) {
      const [a0, m0, f0] = pts[i - 1];
      const [a1, m1, f1] = pts[i];
      const t = (a - a0) / (a1 - a0);
      h = f ? f0 + (f1 - f0) * t : m0 + (m1 - m0) * t;
      break;
    }
  }
  if (a > 70) h -= (a - 70) * 0.002;
  return h * (1 + (hash01(p.id, 61) - 0.5) * 0.085);
}

/** A colour a little lighter or darker (so a family's clothes are related, not identical). */
function shade(c: string, t: number): string {
  return t >= 0 ? mixHex(c, '#FFFFFF', t) : mixHex(c, '#000000', -t);
}

export interface DressContext {
  working: boolean;
  school: boolean;
  church: boolean;
  asleep: boolean;
}

export function dressFor(world: World, p: Person, ctx: DressContext): Dressing {
  const hh = world.households[p.householdId];
  const house = hh ? world.buildings[hh.houseId] : null;
  const family = plotColor(house?.plot ?? null, false);
  const roots = rootsOf(p, world);
  const female = p.sex === 'F';
  const age = p.age;
  const adult = age >= 18;
  const winter = world.weather.season === 'winter';
  const cold = winter || world.weather.tempMax < 14;
  const day = world.day;
  const r = (salt: number) => hash01(p.id, salt);
  const rd = (salt: number) => hash01(`${p.id}|${day}`, salt);
  const pick = <T,>(arr: readonly T[], x: number) => arr[Math.min(arr.length - 1, Math.floor(x * arr.length))];

  // ── The body ──
  const [african, asian, caucasian] = ancestryOf(world, p);
  // Where the build lies between the female and male shapes (MetaHuman's masculine–feminine axis): a grown
  // person a little way in from their sex's end, some slighter, some broader; children at it.
  const gender = adult ? (female ? r(24) * 0.24 : 1 - r(24) * 0.24) : female ? 0 : 1;
  // Build: a personal tendency; the middle years fill out (women a little more), children stay slight.
  let weight = 0.5 + (r(21) - 0.5) * 0.36 + (age >= 30 && age < 70 ? 0.08 : 0) + (female && age >= 25 ? 0.06 : 0);
  if (age < 16) weight = 0.46 + (r(21) - 0.5) * 0.12;
  let muscle = female ? 0.45 + (r(23) - 0.5) * 0.2 : 0.55 + (r(23) - 0.5) * 0.3;
  if (age < 14 || age >= 70) muscle -= 0.08;
  if (p.job === 'builder' || p.job === 'farmhand' || p.job === 'farmer' || p.job === 'police') muscle += 0.15;
  weight = clamp(weight, 0.15, 0.95);
  muscle = clamp(muscle, 0.2, 0.95);
  const face = faceOf(world, p);
  const kid = age < 13 ? 0.6 : 1;
  const details: Record<string, number> = {};
  FACE.forEach(([name], i) => (details[name] = face[i] * kid));
  // One or two of MakeHuman's head shapes, mildly.
  details.headRound = age < 6 ? 0.3 : r(131) * 0.3;
  details.headOval = r(132) * 0.3;
  details.headSquare = female ? 0 : r(133) * 0.35;
  if (adult) {
    if (female) {
      details.breastSize = (r(141) - 0.45) * 0.8;
      details.hips = (r(142) - 0.4) * 0.5;
      const shape = r(143);
      if (weight > 0.55) details[shape < 0.4 ? 'femPear' : shape < 0.7 ? 'femApple' : 'femHourglass'] = (weight - 0.5) * 0.9;
      else if (shape < 0.35) details.femHourglass = 0.25;
    } else {
      details.shoulders = (r(141) - 0.4) * 0.5;
      if (weight > 0.55 && age >= 35) details.manApple = (weight - 0.5) * 1.2;
      if (muscle > 0.6) details.manTrapezoid = (muscle - 0.55) * 1.2;
    }
    if (weight > 0.6) details.doubleChin = (weight - 0.6) * 1.5;
  }
  if (p.pregnancy) {
    const g = clamp((day - p.pregnancy.conceivedDay) / Math.max(1, p.pregnancy.dueDay - p.pregnancy.conceivedDay), 0, 1);
    // Showing from the second trimester, fully at term.
    details.pregnant = clamp((g - 0.3) / 0.7, 0, 1) * (p.pregnancy.twins ? 1.15 : 1);
  }

  // ── Skin, eyes, hair ──
  // Hair and dress follow the family's ways (born here: one parent's); colouring follows the ancestry.
  const style = styleOf(world, p);
  const skin = skinOf(world, p);
  // Hair colour from its pigment (inherited), greying from an onset of their own (the early forties to the
  // mid sixties) to white by about eighty.
  const pig = hairPigment(world, p);
  const onset = 42 + r(33) * 22;
  const whiteness = clamp((age - onset) / (80 - onset), 0, 1);
  const hairColor = hairColour(pig.melanin, pig.redness, whiteness * whiteness * (3 - 2 * whiteness));
  const eyes = WHITE.has(style) && caucasian > 0.6 ? pick(EYES_LIGHT, r(9)) : style === 'coloured' && r(10) < 0.2 ? pick(['#6B5236', '#5E8A6A'], r(9)) : pick(EYES_DARK, r(9));
  const hs = r(11);
  let hair: HairStyle | null = null;
  let crop = 0;
  let recede = 0;
  if (age < 2) crop = 0.35 + age * 0.3;
  else if (!female) {
    // Men and boys: a close crop for most of African descent (an afro for some young men), a short cut otherwise
    // (Indian men's always black); the hairline recedes with age for some.
    if (AFRICAN.has(style)) {
      if (age >= 14 && age < 35 && hs < 0.12) hair = 'afro01';
      else crop = 1;
    } else if (style === 'coloured' && hs < 0.45) crop = 1;
    else if (style === 'indian') hair = pick(['short02', 'short04', 'short01'] as const, hs);
    else hair = pick(['short02', 'short01', 'short04', 'short03'] as const, hs);
    if (age >= 35 && r(12) < (style === 'indian' ? 0.3 : 0.45)) {
      recede = clamp((age - 35) / 30, 0, 1) * (0.5 + r(13) * 0.5);
      if (recede > 0.35 && hair) {
        hair = null;
        crop = 1;
      }
    }
  } else if (age < 13) {
    // Girls: plaits and ponytails; puffs of curls or a close crop for some of African descent.
    if (AFRICAN.has(style)) hair = pick(['ponytail01', 'braid01', 'afro01', null, 'bob02'] as const, hs);
    else if (style === 'indian') hair = pick(['braid01', 'ponytail01', 'long01', 'braid01'] as const, hs);
    else hair = pick(['ponytail01', 'long01', 'braid01', 'bob02'] as const, hs);
    if (!hair) crop = 1;
  } else if (AFRICAN.has(style)) {
    hair = pick(['bob02', 'ponytail01', 'long01', 'afro01', null, 'braid01', 'bob02', null] as const, hs);
    if (age >= 55 && r(14) < 0.5) hair = null;
    if (!hair) crop = 0.95;
  } else if (style === 'indian') {
    // Long black hair, plaited or tied back; a shorter cut for some younger women.
    hair = pick(['braid01', 'long01', 'ponytail01', 'braid01', age < 35 ? 'bob02' : 'ponytail01'] as const, hs);
  } else if (style === 'coloured') {
    hair = pick(['long01', 'ponytail01', 'bob02', 'afro01', null] as const, hs);
    if (!hair) crop = 0.95;
  } else {
    hair = pick(['long01', 'ponytail01', 'bob02', 'braid01', 'short03'] as const, hs);
    if (age >= 60) hair = pick(['bob02', 'short03', 'short01'] as const, hs);
  }
  const brows: BrowStyle = female ? pick(['eyebrow010', 'eyebrow006', 'eyebrow011', 'eyebrow007'] as const, r(15)) : pick(['eyebrow001', 'eyebrow002', 'eyebrow008', 'eyebrow009', 'eyebrow012'] as const, r(15));
  const lashes: LashStyle = female && age >= 12 ? 'eyelashes02' : 'eyelashes01';
  const browColor = mixHex(hairColor, '#0A0806', age >= 62 ? 0.1 : 0.3);
  // Stubble or a close beard for grown men, each his own (some clean-shaven).
  const beard = !female && age >= 17 ? (r(16) < 0.3 ? 0 : 0.25 + r(17) * 0.6) * clamp((age - 16) / 6, 0, 1) : 0;

  // ── Clothes ──
  const wear: Wear[] = [];
  const W = (id: string, ...colors: string[]) => wear.push({ id, colors });
  const tops = [shade(family, (r(41) - 0.5) * 0.35), pick(TOPS, r(42)), pick(TOPS, r(43))];
  const top = tops[Math.floor(rd(44) * 3)];
  const trouser = pick(TROUSERS, female ? r(45) : rd(45));
  const denim = pick(DENIM, r(46));
  const jeansToday = rd(47) < 0.55;
  const sneakers = pick(['shoes05', 'shoes06', 'shoes02'] as const, r(48));
  const smart = pick(['shoes04', 'shoes01'] as const, r(49));
  let onesie: string | null = null;
  let hat: Wear | null = null;
  const wrapColour = pick(WRAPS, ctx.church ? rd(57) : r(57));
  // Older women (and many at church) of African families wear a head wrap.
  const wrap = female && AFRICAN.has(style) && ((age >= 55 ? r(31) < 0.6 : age >= 25 ? r(31) < 0.15 : false) || (ctx.church && adult && rd(32) < 0.55));
  // Indian women wear a sari to church most Sundays, and older women on many days.
  const sari = female && style === 'indian' && age >= 16 && !ctx.asleep && !ctx.school && !(ctx.working && uniform(p.job)) && (ctx.church ? rd(34) < 0.65 : age >= 50 ? rd(34) < 0.4 : rd(34) < 0.06);
  if (wrap) hat = { id: 'hat_wrap', colors: [wrapColour, wrapColour] };
  if (cold && !ctx.working && !ctx.church && !wrap && rd(33) < (age < 13 ? 0.5 : 0.3)) {
    const c = pick(['#2B2C31', '#8E3B3B', '#3E5C8A', '#5B7B5A', '#C9A15B'], r(58));
    hat = { id: 'hat_beanie', colors: [c, shade(c, -0.2)] };
  }
  if (age < 2 || ctx.asleep) {
    // A baby's onesie; night clothes in bed (mostly under the duvet).
    onesie = age < 2 ? pick(['#F2E6D8', '#D8E6F2', '#F2D8E0', '#E0F2D8'], r(53)) : pick(['#D8DDE6', '#E6D8DD', '#DDE6D8'], r(59));
    W('onesie', onesie);
    hat = null;
  } else if (ctx.school && age >= 5 && age < 19) {
    const sc = pick(SCHOOL, hash01(p.plan[p.planIdx]?.buildingId ?? 'school', 3));
    if (female) {
      W('skirt_knee', sc);
      W(cold ? 'm_longtee' : 'f_blouse', cold ? sc : '#F4F3EF');
    } else {
      W(age < 12 && !cold ? 'm_shorts' : 'm_trousers', '#5D636B');
      W(cold ? 'm_longtee' : 'm_shirt', cold ? sc : '#F4F3EF');
    }
    W('shoes04');
  } else if (sari) {
    // The sari: the skirt of it to the ankles, a short-sleeved blouse, the pallu over the left shoulder.
    const [cloth, border] = pick(SARIS, ctx.church ? rd(35) : r(35));
    W('skirt_long', cloth);
    W('f_tee', rd(36) < 0.5 ? border : cloth);
    W('sari_pallu', cloth, border);
    W('shoes01');
  } else if (ctx.church && age >= 13) {
    // Sunday best: a dark suit and a white shirt; a long dress for women.
    if (female) {
      const dress = pick(['#1F2A44', '#6A2E3E', '#F4F3EF', '#2E5A4A', '#5B3F6E'], rd(55));
      W('skirt_long', dress);
      W('f_blouse', rd(56) < 0.6 ? dress : '#F4F3EF');
      W('shoes01');
    } else {
      const suit = pick(['#1D1D22', '#2A2F3A', '#3A3A40'], rd(55));
      W('m_trousers', suit);
      W('m_suit', suit, '#F4F3EF', pick(['#6A1E2E', '#1F3B6E', '#2B2C31', '#5B3F6E'], rd(58)));
      W('shoes04');
    }
  } else if (ctx.working && uniform(p.job)) {
    const u = uniform(p.job)!;
    for (const [id, colors] of female ? u.f ?? u.m : u.m) W(id, ...colors);
    if (u.hat) hat = { id: u.hat[0], colors: u.hat[1] };
  } else if (female) {
    // Women: a skirt or a long skirt most days (more so with age), jeans or trousers others; a blouse or a T-shirt.
    const sk = rd(50);
    const skirtDay = sk < (age >= 50 ? 0.7 : age >= 13 ? 0.45 : 0.35);
    const skirt = pick(SKIRTS, rd(49));
    if (skirtDay) W(age >= 40 || sk < 0.15 ? 'skirt_long' : age < 13 ? 'skirt_knee' : rd(51) < 0.5 ? 'f_skirt' : 'skirt_knee', rd(52) < 0.35 ? top : skirt);
    else if (!cold && age < 40 && rd(52) < 0.25) W('f_shorts', denim);
    else W('f_jeans', jeansToday ? denim : trouser);
    W(rd(54) < 0.5 || age >= 40 ? 'f_blouse' : 'f_tee', top);
    if (cold) W('m_jacket', pick(TROUSERS, r(56)));
    W(age >= 40 ? smart : rd(55) < 0.6 ? sneakers : smart);
  } else {
    // Men and boys: jeans or trousers (shorts in summer for boys and some men), a T-shirt, a shirt or a long-sleeved top.
    if (!cold && age < 60 && rd(52) < (age < 13 ? 0.55 : 0.2)) W('m_shorts', jeansToday ? denim : trouser);
    else W(jeansToday || age < 18 ? 'm_jeans' : 'm_trousers', jeansToday ? denim : trouser);
    const t = rd(54);
    W(cold ? (t < 0.5 ? 'm_longtee' : 'm_shirt') : t < 0.45 ? 'm_tee' : t < 0.75 ? 'm_shirt' : 'm_longtee', top);
    if (cold && rd(56) < 0.7) W('m_jacket', pick(TROUSERS, r(56)));
    W(age >= 45 ? smart : rd(55) < 0.6 ? sneakers : smart);
  }
  if (hat) {
    wear.push(hat);
    // Under a hat, no hair mesh (short hair painted on the scalp shows at the edges).
    if (hat.id !== 'hat_straw' || hair === 'afro01') {
      if (hair) crop = Math.max(crop, 0.9);
      hair = null;
    }
  }

  const look: Look = {
    sex: p.sex,
    gender,
    age,
    height: heightFor(p),
    weight,
    muscle,
    ancestry: { african, asian, caucasian },
    details,
    skin,
    eyes,
    hair,
    hairColor,
    crop,
    recede,
    brows,
    browColor,
    lashes,
    beard,
    wear,
    onesie,
  };
  const key = `${day}|${ctx.working ? p.job : ''}|${ctx.school ? 's' : ''}|${ctx.church ? 'c' : ''}|${ctx.asleep ? 'z' : ''}|${winter ? 'w' : ''}|${Math.floor(age)}|${p.pregnancy ? Math.floor((day - p.pregnancy.conceivedDay) / 14) : ''}`;
  return { look, key };
}

type Outfit = Array<[string, string[]]>;
/** Uniforms at work: what men wear, what women wear (if different), and a hat. */
function uniform(job: string): { m: Outfit; f?: Outfit; hat?: [string, string[]] } | null {
  switch (job) {
    case 'police':
      return { m: [['m_trousers', ['#1F2A44']], ['m_shirt', ['#2E4C8F']], ['shoes03', []]], f: [['f_jeans', ['#1F2A44']], ['f_blouse', ['#2E4C8F']], ['shoes04', []]], hat: ['hat_cap', ['#1F2A44', '#101522']] };
    case 'nurse':
      return { m: [['m_trousers', ['#6FB7C9']], ['m_tee', ['#6FB7C9']], ['shoes05', []]], f: [['f_jeans', ['#6FB7C9']], ['f_tee', ['#6FB7C9']], ['shoes05', []]] };
    case 'doctor':
      return { m: [['m_trousers', ['#5B6068']], ['m_shirt', ['#9DB9D6']], ['coat', ['#FBFBF8']], ['shoes04', []]], f: [['f_jeans', ['#5B6068']], ['f_blouse', ['#9DB9D6']], ['coat', ['#FBFBF8']], ['shoes04', []]] };
    case 'pastor':
      return { m: [['m_trousers', ['#1D1D22']], ['m_suit', ['#1D1D22', '#FFFFFF', '#1D1D22']], ['shoes04', []]], f: [['skirt_long', ['#1D1D22']], ['f_blouse', ['#1D1D22']], ['shoes04', []]] };
    case 'magistrate':
    case 'attorney':
      return { m: [['m_trousers', ['#2B2C31']], ['m_suit', ['#1D1D22', '#F4F3EF', '#2B2C31']], ['shoes04', []]], f: [['f_skirt', ['#1D1D22']], ['f_blouse', ['#F4F3EF']], ['coat', ['#1D1D22']], ['shoes04', []]] };
    case 'teacher':
    case 'clerk':
      return { m: [['m_trousers', ['#3B4E6E']], ['m_shirt', ['#F4F3EF']], ['shoes04', []]], f: [['f_skirt', ['#34466A']], ['f_blouse', ['#F4F3EF']], ['shoes01', []]] };
    case 'busdriver':
      return { m: [['m_trousers', ['#27334A']], ['m_shirt', ['#3B5E8C']], ['shoes04', []]], f: [['f_jeans', ['#27334A']], ['f_blouse', ['#3B5E8C']], ['shoes04', []]], hat: ['hat_cap', ['#27334A', '#101522']] };
    case 'pilot':
      return { m: [['m_trousers', ['#1F2A44']], ['m_shirt', ['#FBFBF8']], ['shoes04', []]], f: [['f_jeans', ['#1F2A44']], ['f_blouse', ['#FBFBF8']], ['shoes04', []]], hat: ['hat_cap', ['#1F2A44', '#D4A93A']] };
    case 'builder':
      return { m: [['m_worktee', ['#F4F3EF']], ['m_overalls', ['#FF8A1F']], ['shoes03', []]], hat: ['hat_hard', ['#F7C948', '#F7C948']] };
    case 'farmer':
    case 'farmhand':
      return { m: [['m_worktee', ['#D9D4C7']], ['m_overalls', ['#5E7A46']], ['shoes03', []]], hat: ['hat_straw', ['#D8B96A', '#6A4A2A']] };
    default:
      return null;
  }
}

function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}
