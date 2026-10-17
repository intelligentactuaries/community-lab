// The people's clothes and poses up close: every garment lies over the skin
// and over whatever is worn under it (nothing comes through anything), what
// lies well under clothes is not drawn but faces and hands always are, tops
// reach over the waistband of what is worn below, the kit's suit and skirts
// are cut cleanly, and people stand, walk and sit without their hands in
// their own bodies.
import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { alivePeople } from '../src/sim/ctx';
import { Simulation } from '../src/sim/engine';
import { buildBody, type Body } from '../src/client/render3d/body/build';
import { dress, dressKit, layerOf, type Layer } from '../src/client/render3d/body/dressing';
import { parseKit } from '../src/client/render3d/body/kit';
import { proxiesOf, proxyTriangles } from '../src/client/render3d/body/proxy';
import type { BodyParams } from '../src/client/render3d/body/shape';
import { Surface, closestOnTriangle, newHit } from '../src/client/render3d/body/surface';
import { dressFor } from '../src/client/render3d/dress';
import { Human, makeKit } from '../src/client/render3d/humans';
import type { Look } from '../src/client/render3d/look';
import { Motion, idleAct, styleFor, type Act, type ArmStyle } from '../src/client/render3d/motion';

const kit = parseKit(await Bun.file(new URL('../src/client/render3d/assets/people/kit.bin', import.meta.url)).arrayBuffer());
const P = proxiesOf(kit);
const dk = dressKit(kit, P);
const names = kit.boneNames;
/** Each shipped vertex's bone (the one that carries it most). */
const carrier = new Int16Array(kit.vertices).map((_, v) => {
  let b = -1;
  let w = 0;
  for (let j = 0; j < 4; j++) {
    if (kit.skinWeight[v * 4 + j] > w) {
      w = kit.skinWeight[v * 4 + j];
      b = kit.skinIndex[v * 4 + j];
    }
  }
  return b;
});
const bonesLike = (re: RegExp) => new Set(names.map((n, i) => (re.test(n) ? i : -1)).filter((i) => i >= 0));
const HAND = bonesLike(/^(hand|f\d\d)[LR]$/);
const FACE = bonesLike(/^(jaw|eye[LR]|lid[LR])$/);
const ARM = bonesLike(/^(upperarm|forearm|hand|f\d\d)[LR]$/);

function bodyFor(look: Pick<Look, 'sex' | 'gender' | 'age' | 'weight' | 'muscle' | 'ancestry' | 'details' | 'height'>): Body {
  const p: BodyParams = { sex: look.sex, gender: look.gender, age: look.age, weight: look.weight, muscle: look.muscle, ancestry: look.ancestry, details: look.details };
  return buildBody(kit, p, look.height);
}

/** Vertices of each layer that lie more than 2 mm below the skin or a layer under it (hats are worn as made, rigid). */
function through(body: Body, layers: Layer[]): { bad: number; all: number; deepest: number } {
  const h = newHit();
  const skin = new Surface(body.pos, dk.bodyTris, 0.02);
  let bad = 0;
  let all = 0;
  let deepest = 0;
  layers.forEach((L, k) => {
    if (L.id.startsWith('hat_')) return;
    const lower = [skin, ...layers.slice(0, k).filter((x) => x.rank < L.rank).map((x) => new Surface(x.pos, x.tris, 0.04))];
    for (let i = 0; i < L.proxy.count; i++) {
      all++;
      for (const s of lower) {
        if (s.nearest(L.pos[i * 3], L.pos[i * 3 + 1], L.pos[i * 3 + 2], 0.03, h) && h.signed < -0.002) {
          bad++;
          deepest = Math.min(deepest, h.signed);
          break;
        }
      }
    }
  });
  return { bad, all, deepest };
}

describe('the surface queries dressing rests on', () => {
  test('the nearest point and a ray’s first hit are the ones a search of every triangle finds', () => {
    const body = bodyFor({ sex: 'F', age: 30, height: 1.62, weight: 0.5, muscle: 0.5, ancestry: { african: 1, asian: 0, caucasian: 0 }, details: {} });
    const Pp = body.pos;
    const T = dk.bodyTris;
    const s = new Surface(Pp, T, 0.02);
    const h = newHit();
    const bc = new Float64Array(3);
    let seed = 11;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let q = 0; q < 300; q++) {
      const v = Math.floor(rnd() * 13380);
      const x = Pp[v * 3] + (rnd() - 0.5) * 0.06;
      const y = Pp[v * 3 + 1] + (rnd() - 0.5) * 0.06;
      const z = Pp[v * 3 + 2] + (rnd() - 0.5) * 0.06;
      let best = 0.04 * 0.04;
      for (let t = 0; t < T.length; t += 3) {
        const a = T[t] * 3;
        const b = T[t + 1] * 3;
        const c = T[t + 2] * 3;
        best = Math.min(best, closestOnTriangle(x, y, z, Pp[a], Pp[a + 1], Pp[a + 2], Pp[b], Pp[b + 1], Pp[b + 2], Pp[c], Pp[c + 1], Pp[c + 2], bc));
      }
      const found = s.nearest(x, y, z, 0.04, h);
      if (best < 0.04 * 0.04) {
        expect(found).toBe(true);
        expect(h.dist).toBeCloseTo(Math.sqrt(best), 6);
      } else expect(found).toBe(false);
      // A ray straight up from the point: its first hit, if any, is no further than any triangle it passes through.
      if (s.ray(x, y, z, 0, 1, 0, 0.3, h)) expect(h.dist).toBeLessThanOrEqual(0.3);
    }
  });
});

describe('clothes are layered over the body and each other', () => {
  const sim = new Simulation({ seed: 'dressing' });
  const world = sim.world;
  const people = alivePeople(world).filter((_, i) => i % 3 === 0);
  const idle = { working: false, school: false, church: false, asleep: false };
  const ways = [idle, { ...idle, working: true }, { ...idle, church: true }, { ...idle, school: true }];

  test('everyone, every way they dress: nothing comes through the skin or what is worn under it', () => {
    let bad = 0;
    let all = 0;
    let deepest = 0;
    for (const p of people) {
      for (const ctx of ways) {
        if (ctx.school && (p.age < 5 || p.age >= 19)) continue;
        const { look } = dressFor(world, p, ctx);
        const wear = look.wear.map((w) => w.id).filter((id) => P.has(`clothes.${id}`));
        const body = bodyFor(look);
        const layers = wear.map((id) => layerOf(P.get(`clothes.${id}`)!, id, body, wear));
        const r = dress(dk, body, look.sex, layers);
        const t = through(body, r.layers);
        bad += t.bad;
        all += t.all;
        deepest = Math.min(deepest, t.deepest);
        // What is hidden under clothes is never a hand or the face.
        for (let tri = 0; tri < r.bodyHidden.length; tri++) {
          if (!r.bodyHidden[tri]) continue;
          for (let c = 0; c < 3; c++) {
            const b = carrier[dk.bodyTris[tri * 3 + c]];
            expect(HAND.has(b) || FACE.has(b)).toBe(false);
          }
        }
      }
    }
    expect(all).toBeGreaterThan(100_000);
    // (Of millions of vertices, a few hundredths of a percent graze what is under them by a few millimetres.)
    expect(bad / all).toBeLessThan(0.0015);
    expect(deepest).toBeGreaterThan(-0.025);
  }, 300_000);

  test('a top reaches over the waistband of the jeans, trousers or shorts worn with it: no bare waist', () => {
    const pairs: Array<['M' | 'F', string, string]> = [
      ['F', 'f_blouse', 'f_jeans'], ['F', 'f_tee', 'f_jeans'], ['F', 'f_blouse', 'f_shorts'], ['F', 'f_tee', 'f_shorts'],
      ['M', 'm_tee', 'm_jeans'], ['M', 'm_shirt', 'm_trousers'], ['M', 'm_longtee', 'm_jeans'], ['M', 'm_tee', 'm_shorts'],
    ];
    const h = newHit();
    for (const [sex, top, bottom] of pairs) {
      for (const weight of [0.3, 0.6, 0.9]) {
        const body = bodyFor({ sex, age: 35, height: sex === 'F' ? 1.62 : 1.74, weight, muscle: 0.5, ancestry: { african: 0.5, asian: 0, caucasian: 0.5 }, details: {} });
        const wear = [bottom, top];
        const layers = wear.map((id) => layerOf(P.get(`clothes.${id}`)!, id, body, wear));
        const r = dress(dk, body, sex, layers);
        const surf = r.layers.map((L) => new Surface(L.pos, L.tris, 0.04));
        const skin = new Surface(body.pos, dk.bodyTris, 0.02);
        const hipY = body.joints[names.indexOf('hips') * 3 + 1];
        // The skin all round the waist, between the hips and a hand's breadth above them: none of it left bare.
        const shown = new Uint8Array(kit.vertices);
        for (let t = 0; t < r.bodyHidden.length; t++) if (!r.bodyHidden[t]) for (let c = 0; c < 3; c++) shown[dk.bodyTris[t * 3 + c]] = 1;
        let band = 0;
        let bare = 0;
        for (let v = 0; v < 13380; v++) {
          const y = body.pos[v * 3 + 1];
          if (y < hipY || y > hipY + 0.12 || ARM.has(carrier[v])) continue;
          const n = skin.normals;
          if (Math.abs(n[v * 3 + 1]) > 0.6) continue;
          band++;
          if (!shown[v]) continue;
          const covered = surf.some((s) => s.ray(body.pos[v * 3], body.pos[v * 3 + 1], body.pos[v * 3 + 2], n[v * 3], n[v * 3 + 1], n[v * 3 + 2], 0.08, h));
          if (!covered) bare++;
        }
        expect(band).toBeGreaterThan(100);
        expect(bare / band).toBeLessThan(0.01);
      }
    }
  });

  test('a suit is one garment in three colours (jacket, shirt, tie), its parts told apart in its texture', () => {
    const suit = P.get('clothes.m_suit')!;
    expect(suit.info.slots).toEqual(['main', 'shirt', 'tie']);
    // Every face takes the suit's first colour slot; which of the three a texel shows is in the atlas.
    expect([...suit.slot!].every((s) => s === 0)).toBe(true);
  });

  test('a knee-length skirt and a coat’s tails end in a hem round one ring of the skirt, not in steps', () => {
    for (const id of ['skirt_knee', 'coat']) {
      const p = P.get(`clothes.${id}`)!;
      const body = bodyFor({ sex: 'F', age: 35, height: 1.64, weight: 0.5, muscle: 0.5, ancestry: { african: 1, asian: 0, caucasian: 0 }, details: {} });
      const L = layerOf(p, id, body, [id]);
      const T = proxyTriangles(p);
      // The open edges' vertices, and the lowest of them: within a ring's own slope of each other.
      const use = new Map<number, number>();
      for (let t = 0; t < T.length; t += 3) {
        for (let k = 0; k < 3; k++) {
          const a = T[t + k];
          const b = T[t + ((k + 1) % 3)];
          const key = a < b ? a * 65536 + b : b * 65536 + a;
          use.set(key, (use.get(key) ?? 0) + 1);
        }
      }
      const edge = new Set<number>();
      for (const [key, n] of use) if (n === 1) edge.add(Math.floor(key / 65536)).add(key % 65536);
      const ys = [...edge].map((v) => L.pos[v * 3 + 1]).sort((a, b) => a - b);
      const hem = ys.filter((y) => y < ys[0] + 0.08);
      // The hem goes all the way round: as many vertices as a ring of the tube has (less the coat's opening).
      expect(hem.length).toBeGreaterThanOrEqual(id === 'coat' ? 26 : 36);
      expect(hem[hem.length - 1] - hem[0]).toBeLessThan(0.07);
    }
  });
});

describe('people hold themselves as people do', () => {
  const T = () => new THREE.Texture();
  const hk = makeKit(kit, { skinLight: T(), skinDark: T(), fields: T(), hair: T(), eyes: T(), clothes: T() });
  const src = kit.array('body.src') as Uint16Array;
  const idx = kit.array('body.index') as Uint16Array;
  const v3 = new THREE.Vector3();

  function posed(sex: 'M' | 'F', weight: number, arms: ArmStyle, act: Partial<Act>, wear: string[]) {
    const h = new Human(hk);
    h.setLook({ sex, age: 35, height: sex === 'F' ? 1.62 : 1.74, weight, muscle: 0.5, ancestry: { african: 0.5, asian: 0, caucasian: 0.5 }, details: {}, skin: '#8C5B3C', eyes: '#3A2414', hair: null, hairColor: '#16110E', crop: 1, recede: 0, brows: 'eyebrow001', browColor: '#16110E', lashes: 'eyelashes01', beard: 0, wear: wear.map((id) => ({ id, colors: ['#808080'] })), onesie: null });
    const m = new Motion(h, styleFor({ seed: 3, female: sex === 'F', age: 35, archetype: 'balanced', mood: 0, energy: 1 }), 5);
    const mm = m as unknown as { arms: ArmStyle; armsUntil: number; fidgetAt: number; gazeAt: number };
    mm.arms = arms;
    mm.armsUntil = 1e9;
    mm.fidgetAt = 1e9;
    mm.gazeAt = 1e9;
    const a = { ...idleAct(), ...act };
    for (let i = 0; i < 60; i++) m.update(0.5 + i * 0.016, 0.016, a);
    m.snap();
    h.root.updateMatrixWorld(true);
    // The body as posed (skinned on the CPU), by shipped vertex.
    const pos = h.body.geometry.getAttribute('position');
    const Pp = new Float32Array(kit.vertices * 3);
    for (let i = 0; i < pos.count; i++) {
      v3.fromBufferAttribute(pos, i);
      h.body.applyBoneTransform(i, v3);
      const s = src[i];
      Pp[s * 3] = v3.x;
      Pp[s * 3 + 1] = v3.y;
      Pp[s * 3 + 2] = v3.z;
    }
    return { h, Pp };
  }

  /** How many of the palms' vertices lie more than 2 cm inside the trunk or the legs (resting on the body presses in a little). */
  function palmsInside(Pp: Float32Array): number {
    const tris: number[] = [];
    for (let i = 0; i < idx.length; i += 3) {
      const t = [src[idx[i]], src[idx[i + 1]], src[idx[i + 2]]];
      if (t.some((v) => ARM.has(carrier[v]))) continue;
      tris.push(...t);
    }
    const s = new Surface(Pp, Uint32Array.from(tris), 0.03);
    const h = newHit();
    const palm = bonesLike(/^hand[LR]$/);
    let n = 0;
    const seen = new Set<number>();
    for (let i = 0; i < idx.length; i++) {
      const v = src[idx[i]];
      if (seen.has(v) || !palm.has(carrier[v])) continue;
      seen.add(v);
      if (s.nearest(Pp[v * 3], Pp[v * 3 + 1], Pp[v * 3 + 2], 0.05, h) && h.signed < -0.02) n++;
    }
    return n;
  }

  test('standing, the feet are about a hip’s width apart, not planted wide', () => {
    for (const sex of ['F', 'M'] as const) {
      for (const weight of [0.3, 0.9]) {
        const { h } = posed(sex, weight, 'relaxed', { base: 'stand' }, ['shoes05']);
        const l = h.bone('footL').getWorldPosition(new THREE.Vector3());
        const r = h.bone('footR').getWorldPosition(new THREE.Vector3());
        expect(l.x - r.x).toBeGreaterThan(0.18);
        expect(l.x - r.x).toBeLessThan(0.36);
      }
    }
  }, 120_000);

  test('the hands stay out of the body: standing in every habit (bar the pockets), walking, sitting with them on the lap', () => {
    const cases: Array<[ArmStyle, Partial<Act>]> = [
      ['relaxed', { base: 'stand' }], ['crossed', { base: 'stand' }], ['behind', { base: 'stand' }], ['akimbo', { base: 'stand' }], ['clasped', { base: 'stand' }], ['phone', { base: 'stand' }],
      ['relaxed', { base: 'walk', speed: 1.3, simSpeed: 1.3 }], ['relaxed', { base: 'sit', seat: 0.46 }],
    ];
    for (const sex of ['F', 'M'] as const) {
      for (const weight of [0.3, 0.9]) {
        for (const [arms, act] of cases) {
          const { Pp } = posed(sex, weight, arms, act, sex === 'F' ? ['f_jeans', 'f_tee', 'shoes05'] : ['m_jeans', 'm_tee', 'shoes05']);
          expect({ sex, weight, arms, base: act.base, palms: palmsInside(Pp) }).toEqual({ sex, weight, arms, base: act.base, palms: 0 });
        }
      }
    }
  }, 300_000);

  test('a phone in the hand when someone looks at it, and none otherwise', () => {
    const { h } = posed('M', 0.5, 'phone', { base: 'stand' }, ['m_jeans', 'm_tee']);
    const phone = h.bone('handR').children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh | undefined;
    expect(phone?.visible).toBe(true);
    const { h: h2 } = posed('M', 0.5, 'relaxed', { base: 'stand' }, ['m_jeans', 'm_tee']);
    const none = h2.bone('handR').children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh | undefined;
    expect(none?.visible ?? false).toBe(false);
  }, 120_000);
});
