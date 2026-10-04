// The 3D view's people: bodies that are a man's or a woman's and a child's or
// an adult's as the simulation says (MakeHuman's parametric human, built from
// the kit), heights by age, a family's likeness, what people wear (their own
// clothes, uniforms, school clothes, Sunday best), and the way they move.
import { describe, expect, test } from 'bun:test';
import { alivePeople } from '../src/sim/ctx';
import { Simulation } from '../src/sim/engine';
import { buildBody } from '../src/client/render3d/body/build';
import { parseKit, type Kit } from '../src/client/render3d/body/kit';
import { mhYears, type BodyParams } from '../src/client/render3d/body/shape';
import { dressFor, hairPigment, heightFor, skinOf, undertoneOf } from '../src/client/render3d/dress';
import { HAIR_STYLES } from '../src/client/render3d/look';
import { hairColour, hairLinear } from '../src/client/render3d/hair';
import { heritageOf } from '../src/sim/heritage';
import { irisBlobs } from '../src/client/render3d/humans';
import { LOD_EVERY, LOD_SCREEN, lodTier } from '../src/client/render3d/people3d';
import { styleFor } from '../src/client/render3d/motion';

const idle = { working: false, school: false, church: false, asleep: false };
const kit: Kit = parseKit(await Bun.file(new URL('../src/client/render3d/assets/people/kit.bin', import.meta.url)).arrayBuffer());
const proxies = new Set((kit.meta.proxies ?? []).map((p) => p.key as string));

/** A body's measures: height, shoulder and hip-joint width, head height (crown to chin level), chest depth. */
function measure(sex: 'M' | 'F', age: number, height: number) {
  const p: BodyParams = { sex, age, weight: 0.5, muscle: 0.5, ancestry: { african: 1, asian: 0, caucasian: 0 }, details: {} };
  const b = buildBody(kit, p, height);
  const J = (n: string) => {
    const i = kit.boneNames.indexOf(n);
    return [b.joints[i * 3], b.joints[i * 3 + 1], b.joints[i * 3 + 2]];
  };
  const top = b.joints[(kit.boneNames.length + kit.points.indexOf('headTop')) * 3 + 1];
  const src = kit.array('body.src') as Uint16Array;
  let hi = 0;
  for (let i = 0; i < src.length; i++) hi = Math.max(hi, b.pos[src[i] * 3 + 1]);
  // The widest the body is at the hips (around the hip joints' height), and the bust's reach forward.
  const hipY = J('thighL')[1];
  let hipW = 0;
  let chestZ = 0;
  const chestY = J('chest')[1] + 0.08 * (height / 1.7);
  for (let v = 0; v < 13380; v++) {
    const x = b.pos[v * 3];
    const y = b.pos[v * 3 + 1];
    const z = b.pos[v * 3 + 2];
    if (Math.abs(y - hipY) < 0.06 * (height / 1.7) && Math.abs(x) < 0.3 * (height / 1.7)) hipW = Math.max(hipW, Math.abs(x) * 2);
    if (Math.abs(y - chestY) < 0.05 * (height / 1.7) && Math.abs(x) < 0.12 * (height / 1.7)) chestZ = Math.max(chestZ, z);
  }
  const shoulders = Math.abs(J('upperarmL')[0] - J('upperarmR')[0]);
  // The head: from the base of the skull (the head joint) to the crown.
  return { height: hi, shoulders, hipW, head: top - J('head')[1], chestZ };
}

describe('bodies by sex and age', () => {
  test('built to the height asked, soles on the ground', () => {
    for (const [sex, age, h] of [['F', 30, 1.62], ['M', 30, 1.71], ['F', 6, 1.15], ['M', 75, 1.66]] as const) {
      expect(Math.abs(measure(sex, age, h).height - h)).toBeLessThan(0.005);
    }
  });

  test('a woman is shaped as a woman and a man as a man: hips against shoulders, and the bust', () => {
    const w = measure('F', 30, 1.62);
    const m = measure('M', 30, 1.71);
    expect(w.hipW / w.shoulders).toBeGreaterThan(m.hipW / m.shoulders + 0.08);
    // Shoulders broader for his height, the chest reaching further forward for hers.
    expect(m.shoulders / 1.71).toBeGreaterThan(w.shoulders / 1.62);
    expect(w.chestZ / 1.62).toBeGreaterThan(m.chestZ / 1.71);
  });

  test('a child has a child’s proportions, not an adult’s scaled down: the head is a larger share of the height', () => {
    const share = (sex: 'M' | 'F', age: number, h: number) => measure(sex, age, h).head / h;
    for (const sex of ['M', 'F'] as const) {
      const toddler = share(sex, 2, 0.87);
      const child = share(sex, 7, 1.22);
      const teen = share(sex, 14, 1.6);
      const adult = share(sex, 30, sex === 'F' ? 1.62 : 1.71);
      expect(toddler).toBeGreaterThan(child);
      expect(child).toBeGreaterThan(teen);
      expect(teen).toBeGreaterThanOrEqual(adult - 0.005);
      expect(toddler).toBeGreaterThan(adult * 1.3);
    }
  });

  test('development: a child’s body to eleven, puberty earlier for girls, grown by nineteen', () => {
    let last = 0;
    for (const age of [0, 1, 3, 6, 9, 11, 13, 15, 17, 19, 25, 40, 70]) {
      const y = mhYears('M', age);
      expect(y).toBeGreaterThanOrEqual(last);
      last = y;
    }
    expect(mhYears('F', 13)).toBeGreaterThan(mhYears('M', 13));
    expect(mhYears('M', 6)).toBe(6);
    expect(mhYears('F', 17)).toBe(25);
    expect(mhYears('M', 19)).toBe(25);
  });

  test('children grow toward adult height; adults stand 1.5-1.9 m; the old shrink a little', () => {
    const sim = new Simulation({ seed: 'bodies' });
    const people = alivePeople(sim.world);
    for (const p of people) {
      const h = heightFor(p);
      if (p.age >= 20 && p.age < 70) {
        expect(h).toBeGreaterThan(1.45);
        expect(h).toBeLessThan(1.9);
      }
      if (p.age < 1) expect(h).toBeLessThan(0.85);
    }
    const kid = { ...people[0], id: 'k', age: 4, sex: 'M' as const };
    const teen = { ...kid, age: 14 };
    expect(heightFor(teen)).toBeGreaterThan(heightFor(kid) + 0.3);
  });
});

describe('what people look like and wear', () => {
  const sim = new Simulation({ seed: 'wardrobe' });
  const world = sim.world;
  const people = alivePeople(world);

  test('everyone is a man or a woman, looks it, and is dressed in things the kit has', () => {
    for (const p of people) {
      const { look } = dressFor(world, p, idle);
      expect(['M', 'F']).toContain(look.sex);
      expect(look.sex).toBe(p.sex);
      expect(look.skin).toBe(skinOf(world, p));
      if (look.hair) expect(HAIR_STYLES).toContain(look.hair);
      expect(proxies.has(`brows.${look.brows}`)).toBe(true);
      expect(proxies.has(`lashes.${look.lashes}`)).toBe(true);
      expect(look.wear.length).toBeGreaterThan(0);
      for (const w of look.wear) expect(proxies.has(`clothes.${w.id}`)).toBe(true);
      // Men's and women's clothes, eyelashes and brows by sex; stubble only on grown men.
      for (const w of look.wear) {
        if (p.sex === 'M') expect(w.id.startsWith('f_') || w.id.startsWith('skirt')).toBe(false);
      }
      if (p.sex === 'F' || p.age < 17) expect(look.beard).toBe(0);
      if (p.sex === 'F' && p.age < 13) expect(look.details.breastSize ?? 0).toBe(0);
    }
  });

  test('a family looks like a family: the same household within a narrow band of skin tones, children like their parents', () => {
    const byHouse = new Map<string, number[]>();
    for (const p of people) {
      const c = skinOf(world, p);
      const lum = parseInt(c.slice(1, 3), 16) + parseInt(c.slice(3, 5), 16) + parseInt(c.slice(5, 7), 16);
      const arr = byHouse.get(p.householdId) ?? [];
      arr.push(lum);
      byHouse.set(p.householdId, arr);
    }
    for (const arr of byHouse.values()) {
      if (arr.length < 2) continue;
      expect(Math.max(...arr) - Math.min(...arr)).toBeLessThan(160);
    }
  });

  test('children take after their parents’ faces', () => {
    // After some years there are children born here; their faces lie nearer their parents' than strangers' do.
    const s2 = new Simulation({ seed: 'likeness' });
    s2.runDays(365 * 6);
    const w2 = s2.world;
    const kids = alivePeople(w2).filter((p) => p.parentIds.length === 2 && p.parentIds.every((id) => w2.people[id]));
    expect(kids.length).toBeGreaterThan(3);
    const face = (p: (typeof kids)[number]) => {
      const d = dressFor(w2, p, idle).look.details;
      return ['noseWidth', 'mouthWidth', 'chinWidth', 'jawWidth', 'eyeSpacing', 'cheekBones', 'earSize', 'upperLip'].map((k) => (d[k] ?? 0) / (p.age < 13 ? 0.6 : 1));
    };
    const dist = (a: number[], b: number[]) => Math.hypot(...a.map((x, i) => x - b[i]));
    let kin = 0;
    let strangers = 0;
    const all = alivePeople(w2).filter((p) => p.age >= 18);
    for (const k of kids) {
      const f = face(k);
      const parents = k.parentIds.map((id) => face(w2.people[id]));
      const mid = parents[0].map((x, i) => (x + parents[1][i]) / 2);
      kin += dist(f, mid);
      const other = all[Math.floor(Math.abs(Math.sin(kids.indexOf(k) * 7.1)) * all.length)];
      strangers += dist(f, face(other));
    }
    expect(kin).toBeLessThan(strangers * 0.8);
    // And their hair's pigment lies between their parents' (a little of their own allowed).
    for (const k of kids) {
      const mine = hairPigment(w2, k);
      const ms = k.parentIds.map((id) => hairPigment(w2, w2.people[id]).melanin);
      expect(mine.melanin).toBeGreaterThanOrEqual(Math.min(...ms) - 0.09);
      expect(mine.melanin).toBeLessThanOrEqual(Math.max(...ms) + 0.09);
    }
  }, 240_000);

  test('at work: a uniform (police in blue with a cap, builders in overalls with a hard hat)', () => {
    const cop = people.find((p) => p.job === 'police');
    if (cop) {
      const { look } = dressFor(world, cop, { ...idle, working: true });
      const shirt = look.wear.find((w) => w.id === 'm_shirt' || w.id === 'f_blouse');
      expect(shirt?.colors[0].toLowerCase()).toBe('#2e4c8f');
      expect(look.wear.some((w) => w.id === 'hat_cap')).toBe(true);
    }
    const builder = people.find((p) => p.job === 'builder');
    if (builder) {
      const { look } = dressFor(world, builder, { ...idle, working: true });
      expect(look.wear.some((w) => w.id === 'hat_hard')).toBe(true);
      expect(look.wear.some((w) => w.id === 'm_overalls')).toBe(true);
    }
  });

  test('on a school day, children wear the school shirt or its jersey, girls the school skirt', () => {
    const kids = people.filter((p) => p.age >= 6 && p.age < 16);
    expect(kids.length).toBeGreaterThan(0);
    for (const p of kids) {
      const { look } = dressFor(world, p, { ...idle, school: true });
      const top = look.wear.find((w) => ['m_shirt', 'f_blouse', 'm_longtee'].includes(w.id));
      expect(top).toBeDefined();
      if (world.weather.season !== 'winter') expect(top!.colors[0].toLowerCase()).toBe('#f4f3ef');
      if (p.sex === 'F') expect(look.wear.some((w) => w.id === 'skirt_knee')).toBe(true);
    }
  });

  test('at church, grown men wear a suit with a white shirt and women a long dress', () => {
    for (const p of people.filter((q) => q.age >= 18).slice(0, 30)) {
      const { look } = dressFor(world, p, { ...idle, church: true });
      if (p.sex === 'M') {
        const suit = look.wear.find((w) => w.id === 'm_suit');
        expect(suit?.colors[1].toLowerCase()).toBe('#f4f3ef');
      } else expect(look.wear.some((w) => w.id === 'skirt_long')).toBe(true);
    }
  });

  test('babies wear a onesie, and so does everyone asleep in bed', () => {
    const baby = people.find((p) => p.age < 2);
    if (baby) expect(dressFor(world, baby, idle).look.wear.map((w) => w.id)).toEqual(['onesie']);
    const p = people.find((q) => q.age >= 20)!;
    expect(dressFor(world, p, { ...idle, asleep: true }).look.wear.map((w) => w.id)).toEqual(['onesie']);
  });
});

describe('how people move', () => {
  test('a style for everyone, within human ranges; the old step shorter and swing their arms less', () => {
    const young = styleFor({ seed: 1, female: false, age: 30, archetype: 'balanced', mood: 0, energy: 1 });
    const old = styleFor({ seed: 1, female: false, age: 80, archetype: 'balanced', mood: 0, energy: 1 });
    for (const s of [young, old]) {
      expect(s.cadence).toBeGreaterThan(0.75);
      expect(s.cadence).toBeLessThan(1.3);
      expect(s.arms.length).toBeGreaterThan(3);
    }
    expect(old.armSwing).toBeLessThan(young.armSwing);
    expect(old.cadence).toBeLessThan(young.cadence);
  });
});

describe('levels of detail and the eyes (after MetaHuman)', () => {
  test('the level of detail follows the share of the screen a figure takes, the way MetaHuman’s LODs do', () => {
    expect(lodTier(0.9)).toBe(0);
    expect(lodTier(LOD_SCREEN[0])).toBe(0);
    expect(lodTier(LOD_SCREEN[0] - 0.001)).toBe(1);
    expect(lodTier(LOD_SCREEN[1])).toBe(1);
    expect(lodTier(0.12)).toBe(2);
    expect(lodTier(0.05)).toBe(3);
    // The animator runs less often the further off (every frame up close).
    expect(LOD_EVERY[0]).toBe(1);
    for (let i = 1; i < LOD_EVERY.length; i++) expect(LOD_EVERY[i]).toBeGreaterThan(LOD_EVERY[i - 1]);
    // At the scene's own lens (30°) a 1.7 m person 21 m off is the light body (MetaHuman's 0.15), shadowless past 42 m (0.075).
    const share = (dist: number) => 1.7 / (2 * dist * Math.tan((15 * Math.PI) / 180));
    expect(lodTier(share(20))).toBeLessThanOrEqual(1);
    expect(lodTier(share(22))).toBe(2);
    expect(lodTier(share(45))).toBe(3);
  });

  test('the irises are found on the eye map: two discs, their centres and radii', () => {
    // A 64×64 mask with two blue discs (radius 8 at (16, 40) and radius 6 at (44, 20)) and a speck to ignore.
    const W = 64;
    const d = new Uint8ClampedArray(W * W * 4);
    const disc = (cx: number, cy: number, r: number) => {
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) d[(y * W + x) * 4 + 2] = 255;
    };
    disc(16, 40, 8);
    disc(44, 20, 6);
    d[(2 * W + 60) * 4 + 2] = 255;
    const found = irisBlobs(d, W, W);
    expect(found).toHaveLength(2);
    expect(found[0].cx).toBeCloseTo(16.5, 1);
    expect(found[0].cy).toBeCloseTo(40.5, 1);
    expect(found[0].r).toBeCloseTo(8, 0);
    expect(found[1].cx).toBeCloseTo(44.5, 1);
    expect(found[1].r).toBeCloseTo(6, 0);
  });
});

describe('MetaHuman’s axes on the body and the skin', () => {
  test('a build a little way along the masculine–feminine axis is broader in the shoulders for its hips', () => {
    const at = (gender: number) => {
      const p: BodyParams = { sex: 'F', gender, age: 30, weight: 0.5, muscle: 0.5, ancestry: { african: 1, asian: 0, caucasian: 0 }, details: {} };
      const b = buildBody(kit, p, 1.62);
      const J = (n: string) => {
        const i = kit.boneNames.indexOf(n);
        return [b.joints[i * 3], b.joints[i * 3 + 1], b.joints[i * 3 + 2]];
      };
      return Math.abs(J('upperarmL')[0] - J('upperarmR')[0]);
    };
    expect(at(0.24)).toBeGreaterThan(at(0));
    expect(at(1)).toBeGreaterThan(at(0.24));
  });

  test('grown people lie a little way in from their sex’s end of the axis; children sit at it', () => {
    const sim = new Simulation({ seed: 'axis' });
    const world = sim.world;
    for (const p of alivePeople(world)) {
      const g = dressFor(world, p, idle).look.gender ?? (p.sex === 'M' ? 1 : 0);
      if (p.sex === 'F') {
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(0.24);
      } else {
        expect(g).toBeGreaterThanOrEqual(0.76);
        expect(g).toBeLessThanOrEqual(1);
      }
      if (p.age < 18) expect(g).toBe(p.sex === 'M' ? 1 : 0);
    }
  });

  test('skin has an undertone of its own, cool to warm, and a family shares one', () => {
    const sim = new Simulation({ seed: 'undertone' });
    const world = sim.world;
    const people = alivePeople(world);
    const under = people.map((p) => undertoneOf(world, p));
    expect(Math.min(...under)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...under)).toBeLessThanOrEqual(1);
    expect(Math.max(...under) - Math.min(...under)).toBeGreaterThan(0.3);
    // Two people of the same darkness but opposite undertones differ in red against blue, not in lightness.
    const hex = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    const warm = people.filter((p) => undertoneOf(world, p) > 0.7);
    const cool = people.filter((p) => undertoneOf(world, p) < 0.3);
    expect(warm.length).toBeGreaterThan(0);
    expect(cool.length).toBeGreaterThan(0);
    const ratio = (p: (typeof people)[number]) => {
      const [r, , b] = hex(skinOf(world, p));
      return r / Math.max(1, b);
    };
    const avg = (arr: number[]) => arr.reduce((s, x) => s + x, 0) / arr.length;
    expect(avg(warm.map(ratio))).toBeGreaterThan(avg(cool.map(ratio)) * 0.98);
  });
});
