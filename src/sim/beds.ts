// Who sleeps where at home. A husband and wife share a bed: the head of the
// house and their spouse the double bed in the main bedroom, another married
// couple living in (grandparents, usually) a bed together in a room of their
// own when the house has one. The children and the other grown-ups have a bed
// each in the other rooms, sisters with sisters and brothers with brothers as
// far as the beds allow, and double up only when the family has outgrown them.
import type { Household, Person, Spot, World } from './types';

/** Where one person sleeps: the room, the bed, and their side of it (metres across from its middle). */
export interface Berth {
  roomId: string;
  spotId: string;
  side: number;
}

/** A bed's width in metres: a double, or a three-quarter bed. */
export function bedWidth(s: Spot): number {
  return s.double ? 1.7 : 1.2;
}

interface Bed {
  roomId: string;
  spot: Spot;
  sleepers: Person[];
}

/** Every member of the household's bed in their house (none if the house has no beds). */
export function berths(world: World, hh: Household): Map<string, Berth> {
  const out = new Map<string, Berth>();
  const house = world.buildings[hh.houseId];
  if (!house) return out;
  const beds: Bed[] = [];
  for (const r of house.rooms) {
    if (r.kind !== 'bedroom') continue;
    for (const s of r.spots) if (s.kind === 'bed') beds.push({ roomId: r.id, spot: s, sleepers: [] });
  }
  if (!beds.length) return out;
  const members = hh.memberIds.map((id) => world.people[id]).filter((p): p is Person => !!p && p.alive);
  if (!members.length) return out;
  const home = new Set(members.map((p) => p.id));
  const spouse = (p: Person) => (p.marital === 'married' && p.partnerId && home.has(p.partnerId) ? world.people[p.partnerId] : undefined);
  const byAge = [...members].sort((a, b) => b.age - a.age || (a.id < b.id ? -1 : 1));
  const head = (hh.headId && home.has(hh.headId) ? world.people[hh.headId] : undefined) ?? byAge.find((p) => p.age >= 18) ?? byAge[0];
  // The couples (the head's first, then the eldest), man then wife; everyone else on their own.
  const couples: Person[][] = [];
  const singles: Person[] = [];
  const seen = new Set<string>();
  for (const p of [head, ...byAge]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const q = spouse(p);
    if (q && !seen.has(q.id)) {
      seen.add(q.id);
      couples.push(p.sex === 'M' ? [p, q] : [q, p]);
    } else if (p === head) couples.push([p]);
    else singles.push(p);
  }
  const roomOf = (id: string) => beds.filter((b) => b.roomId === id);
  const married = (b: Bed) => b.sleepers.length > 0 && !!spouse(b.sleepers[0]);
  const coupleIn = (id: string) => roomOf(id).some(married);
  const inRoom = (id: string) => roomOf(id).reduce((n, b) => n + b.sleepers.length, 0);
  // The head of the house in the double bed; other couples in another double if there is one, else in the emptiest room.
  for (const c of couples) {
    const free = beds.filter((b) => !b.sleepers.length);
    const bed = free.find((b) => b.spot.double) ?? least(free, (b) => inRoom(b.roomId) * 10 - roomOf(b.roomId).length) ?? least(beds, (b) => b.sleepers.length)!;
    bed.sleepers.push(...c);
  }
  // The rest, sisters first and the eldest first: a bed in a room of their own sex, then any bed in a room without a
  // couple, then one in a couple's room. With none left, in beside the fewest, a brother beside a brother, a child
  // beside a child (never in with a husband and wife).
  singles.sort((a, b) => (a.sex === b.sex ? b.age - a.age : a.sex === 'F' ? -1 : 1));
  for (const p of singles) {
    const free = beds.filter((b) => !b.sleepers.length);
    const beside = (b: Bed) => b.sleepers.length * 4 + (b.sleepers.some((q) => q.sex !== p.sex) ? 2 : 0) + (b.sleepers.some((q) => q.age >= 18 !== p.age >= 18) ? 1 : 0);
    const bed =
      free.find((b) => !coupleIn(b.roomId) && roomOf(b.roomId).every((o) => o.sleepers.every((q) => q.sex === p.sex))) ??
      free.find((b) => !coupleIn(b.roomId)) ??
      free[0] ??
      least(beds.filter((b) => !married(b)), beside) ??
      least(beds, (b) => b.sleepers.length)!;
    bed.sleepers.push(p);
  }
  // Side by side across each bed, as far apart as it allows.
  for (const b of beds) {
    const n = b.sleepers.length;
    const gap = n > 1 ? Math.min(0.84, (bedWidth(b.spot) - 0.5) / (n - 1)) : 0;
    b.sleepers.forEach((p, k) => out.set(p.id, { roomId: b.roomId, spotId: b.spot.id, side: Math.round((k - (n - 1) / 2) * gap * 100) / 100 }));
  }
  return out;
}

/** A person's bed at home, if the house has beds (and they are of its household). */
export function berthOf(world: World, p: Person): Berth | undefined {
  const hh = world.households[p.householdId];
  return hh ? berths(world, hh).get(p.id) : undefined;
}

/** The first of the items with the least score. */
function least<T>(items: T[], score: (t: T) => number): T | undefined {
  let best: T | undefined;
  let min = Infinity;
  for (const t of items) {
    const v = score(t);
    if (v < min) {
      min = v;
      best = t;
    }
  }
  return best;
}
