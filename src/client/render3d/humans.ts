// The people's bodies, built per person from MakeHuman's parametric human
// (CC0; scripts/humans/build.py makes the kit): the body shaped by sex, age,
// build, ancestry and face and body details (body/shape.ts), posed into the
// rest pose the animator expects (body/rest.ts) and scaled to the person's
// height; eyes, eyebrows, eyelashes and hair fitted to it the way MakeHuman
// fits them; skin painted over photographic skin maps in any tone, with
// stubble, a close crop and the lines of age where they belong. Each person
// has a skeleton of their own (the kit's joints for their body) and a few
// meshes: the skin, the eyes, the hair (with brows and lashes), the clothes.
import * as THREE from 'three';
import eyesUrl from './assets/people/eyes.png?url';
import fieldsUrl from './assets/people/fields.png?url';
import clothesUrl from './assets/people/clothes.jpg?url';
import hairUrl from './assets/people/hair.webp?url';
import kitUrl from './assets/people/kit.bin?url';
import skinDarkUrl from './assets/people/skin_dark.jpg?url';
import skinLightUrl from './assets/people/skin_light.jpg?url';
import { buildBody, gather, seamlessNormals, toRest, type Body } from './body/build';
import { loadKit, type Kit, type ProxyInfo } from './body/kit';
import type { BodyParams } from './body/shape';
import { HAIR_STYLES, type Look } from './look';

export type { Look };

export interface ProxyKit {
  info: ProxyInfo;
  ref: Uint16Array;
  /** Binding weights (steps of 1/4096) and offsets (16-bit steps of offScale metres). */
  w: Int16Array;
  off: Int16Array;
  offScale: number;
  scale: Array<[number, number, number] | null>;
  /** Skin weights in the kit's bones (for the rest pose), and per render vertex in the animated bones (for the GPU). */
  kitSkinIndex: Uint8Array;
  kitSkinWeight: Float32Array;
  skinIndex: THREE.BufferAttribute;
  skinWeight: THREE.BufferAttribute;
  src: Uint16Array;
  uv: THREE.BufferAttribute;
  index: Uint16Array;
  deletes: Uint16Array;
  /** Clothes: the body's triangles it hides, and each render vertex's colour slot within the garment. */
  hide: Uint16Array | null;
  slot: Uint8Array | null;
  count: number;
  renderCount: number;
}

export interface HumanKit {
  kit: Kit;
  /** The animated bones (the kit's, without the finger segments) and their parents; each kit bone's animated bone. */
  names: string[];
  parents: number[];
  animOf: Uint8Array;
  body: { src: Uint16Array; uv: THREE.BufferAttribute; index: THREE.BufferAttribute; skinIndex: THREE.BufferAttribute; skinWeight: THREE.BufferAttribute; count: number };
  proxies: Map<string, ProxyKit>;
  tex: { skinLight: THREE.Texture; skinDark: THREE.Texture; fields: THREE.Texture; hair: THREE.Texture; eyes: THREE.Texture; clothes: THREE.Texture };
  /** The skin maps' own tones (linear), and their luminances. */
  tone: { light: THREE.Vector3; dark: THREE.Vector3 };
}

let kit: HumanKit | null = null;
let loading: Promise<HumanKit> | null = null;

/** How dark it is (0 day .. 1 night): the pupils dilate in the dark. People3D sets it each frame. */
const NIGHT = { value: 0 };
export function setPeopleNight(n: number): void {
  NIGHT.value = Math.max(0, Math.min(1, n));
}
/** Where the two irises lie on the eye map (centres and radii, map coordinates), measured from the map as it loads. */
const IRIS = { c: { value: [new THREE.Vector2(0.29, 0.7), new THREE.Vector2(0.7, 0.29)] }, r: { value: [0.115, 0.115] } };
export function irisPlaces(): { c: THREE.Vector2[]; r: number[] } {
  return { c: IRIS.c.value, r: IRIS.r.value };
}

/** The loaded kit, or null until it has arrived (loadHumans starts it). */
export function humanKit(): HumanKit | null {
  return kit;
}

export function loadHumans(): Promise<HumanKit> {
  loading ??= Promise.all([loadKit(kitUrl), texture(skinLightUrl), texture(skinDarkUrl), texture(fieldsUrl), texture(hairUrl), texture(eyesUrl), texture(clothesUrl)]).then(([k, skinLight, skinDark, fields, hair, eyes, clothes]) => {
    measureIrises(eyes.image as ImageBitmap);
    kit = makeKit(k, { skinLight, skinDark, fields, hair, eyes, clothes });
    return kit;
  });
  return loading;
}

/**
 * Find the two irises on the eye map (the mask in its blue channel): the centre and radius of each, so the
 * shader knows how far out on the iris a texel lies (for the limbal ring and the pupil). The map's two largest
 * blobs; a mask that cannot be read leaves the built-in estimate.
 */
export function measureIrises(bmp: ImageBitmap | null | undefined): void {
  if (!bmp || typeof document === 'undefined') return;
  try {
    const W = bmp.width;
    const H = bmp.height;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0);
    const found = irisBlobs(g.getImageData(0, 0, W, H).data, W, H);
    found.forEach((b, k) => {
      IRIS.c.value[k].set(b.cx / W, b.cy / H);
      IRIS.r.value[k] = b.r / W;
    });
  } catch (e) {
    console.warn('people: eye map not measured', e);
  }
}

/** The two largest blobs of iris mask (blue over half) in RGBA pixels: centre (px) and the radius of a disc of their area. */
export function irisBlobs(d: Uint8ClampedArray | Uint8Array, W: number, H: number): Array<{ cx: number; cy: number; r: number; n: number }> {
  const seen = new Uint8Array(W * H);
  const blobs: Array<{ cx: number; cy: number; r: number; n: number }> = [];
  const stack: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (seen[i] || d[i * 4 + 2] < 128) continue;
    let n = 0;
    let sx = 0;
    let sy = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % W;
      const y = (j - x) / W;
      n++;
      sx += x;
      sy += y;
      if (x > 0 && !seen[j - 1] && d[(j - 1) * 4 + 2] >= 128) (seen[j - 1] = 1), stack.push(j - 1);
      if (x < W - 1 && !seen[j + 1] && d[(j + 1) * 4 + 2] >= 128) (seen[j + 1] = 1), stack.push(j + 1);
      if (y > 0 && !seen[j - W] && d[(j - W) * 4 + 2] >= 128) (seen[j - W] = 1), stack.push(j - W);
      if (y < H - 1 && !seen[j + W] && d[(j + W) * 4 + 2] >= 128) (seen[j + W] = 1), stack.push(j + W);
    }
    blobs.push({ cx: sx / n + 0.5, cy: sy / n + 0.5, r: Math.sqrt(n / Math.PI), n });
  }
  return blobs.sort((a, b) => b.n - a.n).slice(0, 2);
}

/**
 * A tileable micro-normal map, the pores and fine grain of skin, repeated many times over the body (as MetaHuman's
 * micro normal is): soft dimples scattered at random and a fine grain, wrapped so the tile has no seam.
 */
let microTex: THREE.CanvasTexture | null = null;
function microNormals(): THREE.CanvasTexture {
  if (microTex) return microTex;
  const N = 128;
  const hgt = new Float32Array(N * N);
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 1100; i++) {
    const cx = Math.round(rnd() * N);
    const cy = Math.round(rnd() * N);
    const r = 1.1 + rnd() * 2.0;
    const depth = 0.35 + rnd() * 0.65;
    const R = Math.ceil(r * 2);
    for (let y = -R; y <= R; y++) {
      for (let x = -R; x <= R; x++) {
        const q = (x * x + y * y) / (r * r);
        if (q > 4) continue;
        hgt[((((cy + y) % N) + N) % N) * N + ((((cx + x) % N) + N) % N)] -= depth * Math.exp(-q * 1.5);
      }
    }
  }
  for (let i = 0; i < N * N; i++) hgt[i] += (rnd() - 0.5) * 0.3;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const hx = hgt[y * N + ((x + 1) % N)] - hgt[y * N + ((x - 1 + N) % N)];
      const hy = hgt[((y + 1) % N) * N + x] - hgt[((y - 1 + N) % N) * N + x];
      const nx = -hx * 1.2;
      const ny = -hy * 1.2;
      const l = Math.hypot(nx, ny, 1);
      const o = (y * N + x) * 4;
      img.data[o] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
      img.data[o + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
      img.data[o + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(70, 70);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  microTex = t;
  return t;
}

function texture(url: string): Promise<THREE.Texture> {
  // Every map holds data (ratios, fields, detail with coverage), not colours: decoded as stored, without the
  // browser's premultiplied alpha (which would lose the colour under a clear texel) or colour conversion.
  const loader = new THREE.ImageBitmapLoader();
  loader.setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  return loader.loadAsync(url).then((bmp) => {
    const t = new THREE.Texture(bmp as unknown as HTMLImageElement);
    t.flipY = false;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  });
}

function makeKit(k: Kit, tex: HumanKit['tex']): HumanKit {
  const isFinger = (n: string) => /^f\d\d[LR]$/.test(n);
  const names: string[] = [];
  const animOf = new Uint8Array(k.boneNames.length);
  k.boneNames.forEach((n, i) => {
    if (!isFinger(n)) {
      animOf[i] = names.length;
      names.push(n);
    }
  });
  k.boneNames.forEach((n, i) => {
    if (isFinger(n)) animOf[i] = names.indexOf(`hand${n.slice(-1)}`);
  });
  const parents = names.map((n) => {
    const p = k.boneParents[k.boneNames.indexOf(n)];
    return p < 0 ? -1 : animOf[p];
  });
  // GPU skin attributes per render vertex, from the kit's per-vertex weights.
  const skinAttrs = (src: ArrayLike<number>, idx: ArrayLike<number>, wt: ArrayLike<number>) => {
    const si = new Uint16Array(src.length * 4);
    const sw = new Float32Array(src.length * 4);
    for (let i = 0; i < src.length; i++) {
      for (let j = 0; j < 4; j++) {
        si[i * 4 + j] = animOf[idx[src[i] * 4 + j]];
        sw[i * 4 + j] = wt[src[i] * 4 + j];
      }
    }
    return { skinIndex: new THREE.BufferAttribute(si, 4), skinWeight: new THREE.BufferAttribute(sw, 4) };
  };
  const bsrc = k.array('body.src') as Uint16Array;
  const bs = skinAttrs(bsrc, k.skinIndex, k.skinWeight);
  const body = {
    src: bsrc,
    uv: new THREE.BufferAttribute(k.array('body.uv') as Float32Array, 2),
    index: new THREE.BufferAttribute(k.array('body.index') as Uint16Array, 1),
    skinIndex: bs.skinIndex,
    skinWeight: bs.skinWeight,
    count: bsrc.length,
  };
  const proxies = new Map<string, ProxyKit>();
  for (const info of k.meta.proxies ?? []) {
    const key = info.key as string;
    const sw8 = k.array(`${key}.skinWeight`) as Uint8Array;
    const kitSkinWeight = new Float32Array(sw8.length);
    for (let i = 0; i < sw8.length; i++) kitSkinWeight[i] = sw8[i] / 255;
    const kitSkinIndex = k.array(`${key}.skinIndex`) as Uint8Array;
    const src = k.array(`${key}.src`) as Uint16Array;
    const s = skinAttrs(src, kitSkinIndex, kitSkinWeight);
    proxies.set(key, {
      info,
      ref: k.array(`${key}.ref`) as Uint16Array,
      w: k.array(`${key}.w`) as Int16Array,
      off: k.array(`${key}.off`) as Int16Array,
      offScale: (info.offScale as number) ?? 1,
      scale: info.scale,
      kitSkinIndex,
      kitSkinWeight,
      skinIndex: s.skinIndex,
      skinWeight: s.skinWeight,
      src,
      uv: new THREE.BufferAttribute(k.array(`${key}.uv`) as Uint16Array, 2, true),
      index: k.array(`${key}.index`) as Uint16Array,
      deletes: k.array(`${key}.deletes`) as Uint16Array,
      hide: k.has(`${key}.hide`) ? (k.array(`${key}.hide`) as Uint16Array) : null,
      slot: k.has(`${key}.slot`) ? (k.array(`${key}.slot`) as Uint8Array) : null,
      count: info.vertices,
      renderCount: src.length,
    });
  }
  const tl = (k.meta.skin as { toneLight: number[]; toneDark: number[] }).toneLight;
  const td = (k.meta.skin as { toneLight: number[]; toneDark: number[] }).toneDark;
  return { kit: k, names, parents, animOf, body, proxies, tex, tone: { light: new THREE.Vector3(...tl), dark: new THREE.Vector3(...td) } };
}

/** A proxy's vertices fitted to a body (as MakeHuman fits them), then carried into the rest pose and scale. */
function fitProxy(p: ProxyKit, body: Body, out: Float32Array): void {
  const v = body.modelled;
  const s = [1, 1, 1];
  for (let n = 0; n < 3; n++) {
    const sc = p.scale[n];
    if (sc) s[n] = Math.abs(v[sc[0] * 3 + n] - v[sc[1] * 3 + n]) / sc[2];
  }
  const { ref, w, off } = p;
  const W = 1 / 4096;
  const O = p.offScale;
  for (let i = 0; i < p.count; i++) {
    const a = ref[i * 3] * 3;
    const b = ref[i * 3 + 1] * 3;
    const c = ref[i * 3 + 2] * 3;
    const wa = w[i * 3] * W;
    const wb = w[i * 3 + 1] * W;
    const wc = w[i * 3 + 2] * W;
    for (let k = 0; k < 3; k++) out[i * 3 + k] = wa * v[a + k] + wb * v[b + k] + wc * v[c + k] + off[i * 3 + k] * O * s[k];
  }
  toRest(body, out, p.count, p.kitSkinIndex, p.kitSkinWeight);
}

/** Static attributes of several proxies drawn as one mesh (shared by everyone wearing the same set). */
interface Merged {
  parts: ProxyKit[];
  uv: THREE.BufferAttribute;
  slot: THREE.BufferAttribute;
  skinIndex: THREE.BufferAttribute;
  skinWeight: THREE.BufferAttribute;
  index: THREE.BufferAttribute;
  count: number;
}
const mergedCache = new Map<string, Merged>();

function merged(k: HumanKit, keys: string[], slots: number[]): Merged {
  const id = keys.map((x, i) => `${x}:${slots[i]}`).join('|');
  let m = mergedCache.get(id);
  if (m) return m;
  const parts = keys.map((x) => k.proxies.get(x)!);
  const count = parts.reduce((s, p) => s + p.renderCount, 0);
  const tris = parts.reduce((s, p) => s + p.index.length, 0);
  const uv = new Uint16Array(count * 2);
  const slot = new Float32Array(count);
  const si = new Uint16Array(count * 4);
  const sw = new Float32Array(count * 4);
  const index = new Uint32Array(tris);
  let o = 0;
  let t = 0;
  parts.forEach((p, pi) => {
    uv.set(p.uv.array as Uint16Array, o * 2);
    if (p.slot) for (let i = 0; i < p.renderCount; i++) slot[o + i] = slots[pi] + p.slot[i];
    else slot.fill(slots[pi], o, o + p.renderCount);
    si.set(p.skinIndex.array as Uint16Array, o * 4);
    sw.set(p.skinWeight.array as Float32Array, o * 4);
    for (let i = 0; i < p.index.length; i++) index[t + i] = p.index[i] + o;
    o += p.renderCount;
    t += p.index.length;
  });
  m = {
    parts,
    uv: new THREE.BufferAttribute(uv, 2, true),
    slot: new THREE.BufferAttribute(slot, 1),
    skinIndex: new THREE.BufferAttribute(si, 4),
    skinWeight: new THREE.BufferAttribute(sw, 4),
    index: new THREE.BufferAttribute(index, 1),
    count,
  };
  mergedCache.set(id, m);
  return m;
}

const IDENTITY = new THREE.Matrix4();
const tmpC = new THREE.Color();
const tmpV3 = new THREE.Vector3();
/** The light bodies' material: colour per vertex (everyone shares it). */
const LOD_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
/** Colour slots for a person's clothes (a garment has one to three). */
const CLOTH_SLOTS = 16;

const bodyIndexCache = new Map<string, THREE.BufferAttribute>();
/** The body's triangles less those the garments hide (shared by everyone wearing the same garments). */
function bodyIndex(k: HumanKit, ids: string[]): THREE.BufferAttribute {
  const key = [...ids].sort().join('|');
  let a = bodyIndexCache.get(key);
  if (a) return a;
  const all = k.body.index.array as Uint16Array;
  if (!ids.length) {
    a = k.body.index;
  } else {
    const hidden = new Uint8Array(all.length / 3);
    for (const id of ids) {
      const h = k.proxies.get(`clothes.${id}`)?.hide;
      if (h) for (let i = 0; i < h.length; i++) hidden[h[i]] = 1;
    }
    const out: number[] = [];
    for (let t = 0; t < hidden.length; t++) if (!hidden[t]) out.push(all[t * 3], all[t * 3 + 1], all[t * 3 + 2]);
    a = new THREE.BufferAttribute(new Uint16Array(out), 1);
  }
  bodyIndexCache.set(key, a);
  return a;
}

/** One person's figure. */
export class Human {
  /**
   * Full figures built this frame may not exceed this (people3d sets it each frame): building one takes a few
   * milliseconds, so a crowd coming into view is built over several frames, the light body standing in meanwhile.
   */
  static budget = Infinity;
  readonly root = new THREE.Group();
  readonly bones: THREE.Bone[];
  readonly skeleton: THREE.Skeleton;
  readonly body: THREE.SkinnedMesh;
  private eyes: THREE.SkinnedMesh;
  private hair: THREE.SkinnedMesh;
  private clothes: THREE.SkinnedMesh;
  /** The light body for distance, painted per vertex. */
  private lod: THREE.SkinnedMesh;
  private skinMat: THREE.MeshStandardMaterial;
  private eyeMat: THREE.MeshStandardMaterial;
  private hairMat: THREE.MeshStandardMaterial;
  private clothMat: THREE.MeshStandardMaterial;
  private u = {
    tone: { value: new THREE.Vector3() },
    dark: { value: 0 },
    aged: { value: 0 },
    crop: { value: 0 },
    recede: { value: 0 },
    hairCol: { value: new THREE.Vector3() },
    beard: { value: 0 },
    iris: { value: new THREE.Vector3() },
    hairCols: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    cloth: { value: Array.from({ length: CLOTH_SLOTS }, () => new THREE.Vector4()) },
    /** The eyeballs' centres (figure frame, at rest) and radius: the lids' shade on them is drawn from these. */
    eyeC: { value: [new THREE.Vector3(0.03, 1.6, 0.08), new THREE.Vector3(-0.03, 1.6, 0.08)] },
    eyeR: { value: 0.012 },
    /** In bed: the duvet's frame (its inverse) and the half-extents of the footprint within which the figure is not drawn. */
    duvetOn: { value: 0 },
    duvetInv: { value: new THREE.Matrix4() },
    duvetHalf: { value: new THREE.Vector3() },
  };
  private byName = new Map<string, THREE.Bone>();
  private look: Look | null = null;
  private bodyKey = '';
  /** What the full figure and the light body were last built for ('' when they need building). */
  private nearKey = '';
  private farKey = '';
  private built: Body | null = null;
  /** How far shoes lift the figure off the ground (their soles). */
  footLift = 0;
  /** The whole figure's scale (the body is built at its height: 1). */
  scale = 1;
  /** Kept for the labels: the head's size relative to an adult's. */
  headScale = 1;
  /** Standing hip height and the legs, metres (for the animator). */
  hipY = 0.9;
  legs = { thigh: 0.42, shin: 0.42, ankle: 0.085, hipDrop: 0.025, seat: 0.1 };
  /** Eye height above the hips, and the top of the head above the head joint. */
  eyeY = 0.68;
  headTop = 0.16;
  /** Arm length relative to an adult's (reach targets are given for an adult), and the arms' rest geometry. */
  armScale = 1;
  arms: ArmsRest | null = null;
  height = 1.7;
  far = false;
  /** The build's stoutness (1 an average build): the girth of the capsules that stand for the body. */
  stout = 1;

  constructor(readonly kit: HumanKit) {
    const bones = kit.names.map((name) => {
      const b = new THREE.Bone();
      b.name = name;
      this.byName.set(name, b);
      return b;
    });
    bones.forEach((b, i) => (kit.parents[i] >= 0 ? bones[kit.parents[i]].add(b) : this.root.add(b)));
    this.bones = bones;
    this.skeleton = new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4()));
    this.skinMat = skinMaterial(kit, this.u);
    this.eyeMat = eyeMaterial(kit, this.u);
    this.hairMat = hairMaterial(kit, this.u);
    this.clothMat = clothMaterial(kit, this.u);
    const g = new THREE.BufferGeometry();
    g.setAttribute('uv', kit.body.uv);
    g.setAttribute('skinIndex', kit.body.skinIndex);
    g.setAttribute('skinWeight', kit.body.skinWeight);
    g.setIndex(kit.body.index);
    this.body = this.skinned(g, this.skinMat);
    this.eyes = this.skinned(new THREE.BufferGeometry(), this.eyeMat);
    this.eyes.castShadow = false;
    this.hair = this.skinned(new THREE.BufferGeometry(), this.hairMat);
    this.clothes = this.skinned(new THREE.BufferGeometry(), this.clothMat);
    this.lod = this.skinned(new THREE.BufferGeometry(), LOD_MAT);
    this.showNear(false);
    this.lod.visible = false;
  }

  private skinned(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.SkinnedMesh {
    const m = new THREE.SkinnedMesh(geo, mat);
    // Poses reach well outside the rest pose's bounds (lying down, arms up): the people are culled by distance instead.
    m.frustumCulled = false;
    m.castShadow = true;
    m.receiveShadow = true;
    this.root.add(m);
    m.bind(this.skeleton, IDENTITY);
    return m;
  }

  bone(name: string): THREE.Bone {
    const b = this.byName.get(name);
    if (!b) throw new Error(`no bone ${name}`);
    return b;
  }

  /** Shape, paint and dress the figure (the meshes follow as they are next shown). */
  setLook(look: Look): void {
    const k = this.kit;
    this.look = look;
    const bp: BodyParams = { sex: look.sex, gender: look.gender, age: look.age, weight: look.weight, muscle: look.muscle, ancestry: look.ancestry, details: look.details };
    const bodyKey = JSON.stringify([bp, Math.round(look.height * 1000)]);
    if (bodyKey !== this.bodyKey || !this.built) {
      this.bodyKey = bodyKey;
      this.built = buildBody(k.kit, bp, look.height);
      this.rest(this.built);
    }
    // Paint: skin tone and which skin map it follows, age, stubble, crop, eyes, hair; each garment's colours.
    const tone = srgbToLinear(look.skin, this.u.tone.value);
    const lum = (v: THREE.Vector3) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
    const ll = Math.log(lum(k.tone.light));
    const ld = Math.log(lum(k.tone.dark));
    this.u.dark.value = THREE.MathUtils.clamp((ll - Math.log(Math.max(1e-4, lum(tone)))) / (ll - ld), 0, 1);
    this.u.aged.value = THREE.MathUtils.clamp((look.age - 40) / 40, 0, 1);
    this.u.crop.value = look.crop;
    this.u.recede.value = look.recede;
    srgbToLinear(look.hairColor, this.u.hairCol.value);
    this.u.beard.value = look.beard;
    srgbToLinear(look.eyes, this.u.iris.value);
    srgbToLinear(look.hairColor, this.u.hairCols.value[0]);
    srgbToLinear(look.browColor, this.u.hairCols.value[1]);
    srgbToLinear(look.browColor, this.u.hairCols.value[2]).multiplyScalar(0.55);
    let slot = 0;
    for (const w of look.wear) {
      const p = k.proxies.get(`clothes.${w.id}`);
      if (!p) continue;
      (p.info.slots ?? ['main']).forEach((name, i) => {
        const v = this.u.cloth.value[slot + i];
        if (!v) return;
        if (name === 'own') v.set(1, 1, 1, 0);
        else {
          srgbToLinear(w.colors[i] ?? w.colors[0] ?? '#808080', tmpV3);
          v.set(tmpV3.x, tmpV3.y, tmpV3.z, 1);
        }
      });
      slot += p.info.slots?.length ?? 1;
    }
    this.height = look.height;
    this.stout = 0.85 + 0.4 * look.weight;
    this.update();
  }

  /**
   * Under a duvet: the skin, clothes and hair within its footprint are not drawn (the duvet drapes over them),
   * as MetaHuman hides the body under a garment; null shows the whole figure again.
   */
  setDuvet(inv: THREE.Matrix4 | null, half?: THREE.Vector3): void {
    if (!inv || !half) {
      this.u.duvetOn.value = 0;
      return;
    }
    this.u.duvetOn.value = 1;
    this.u.duvetInv.value.copy(inv);
    this.u.duvetHalf.value.copy(half);
  }

  /** Near: the full figure; far: the light body. */
  setFar(far: boolean): void {
    if (far === this.far) return;
    this.far = far;
    this.update();
  }

  /** Build what is to be shown (the full figure within this frame's budget, else the light body for now). */
  private update(): void {
    const look = this.look;
    if (!look || !this.built) return;
    const wearIds = look.wear.map((w) => w.id).filter((id) => this.kit.proxies.has(`clothes.${id}`));
    const nearKey = `${this.bodyKey}|${look.hair}|${look.brows}|${look.lashes}|${wearIds.join(',')}`;
    const farKey = `${nearKey}|${JSON.stringify(look.wear)}|${look.skin}|${look.hairColor}|${look.crop}`;
    let near = !this.far;
    if (near && nearKey !== this.nearKey) {
      if (Human.budget > 0) {
        Human.budget--;
        this.buildNear(look, wearIds);
        this.nearKey = nearKey;
      } else near = false;
    }
    if (!near && farKey !== this.farKey) {
      this.buildFar(look, wearIds);
      this.farKey = farKey;
    }
    this.showNear(near);
    this.lod.visible = !near;
  }

  private showNear(on: boolean): void {
    this.body.visible = on;
    this.eyes.visible = on;
    this.hair.visible = on;
    this.clothes.visible = on && this.clothes.geometry.index !== null && this.clothes.geometry.index.count > 0;
  }

  private buildNear(look: Look, wearIds: string[]): void {
    const k = this.kit;
    const body = this.built!;
    const g = this.body.geometry;
    const pos = new Float32Array(k.body.count * 3);
    gather(body.pos, k.body.src, pos);
    const nor = new Float32Array(k.body.count * 3);
    seamlessNormals(body.pos, k.body.src, k.body.index.array as Uint16Array, k.kit.vertices, nor);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(bodyIndex(k, wearIds));
    this.setProxies(this.eyes, merged(k, ['eyes.eyes'], [0]));
    const hairKeys: string[] = [];
    const hairSlots: number[] = [];
    if (look.hair) {
      hairKeys.push(`hair.${look.hair}`);
      hairSlots.push(0);
    }
    hairKeys.push(`brows.${look.brows}`, `lashes.${look.lashes}`);
    hairSlots.push(1, 2);
    this.setProxies(this.hair, merged(k, hairKeys, hairSlots));
    // Clothes: the garments as one mesh; each garment's slots follow the one before's in the palette.
    const bases: number[] = [];
    let n = 0;
    for (const id of wearIds) {
      bases.push(n);
      n += k.proxies.get(`clothes.${id}`)!.info.slots?.length ?? 1;
    }
    if (wearIds.length) {
      const cp = this.setProxies(this.clothes, merged(k, wearIds.map((id) => `clothes.${id}`), bases));
      let lo = Infinity;
      for (let i = 1; i < cp.length; i += 3) lo = Math.min(lo, cp[i]);
      this.footLift = Math.max(0, -lo);
    } else {
      this.clothes.geometry.dispose();
      this.clothes.geometry = new THREE.BufferGeometry();
      this.footLift = 0;
    }
  }

  /** The light body: MakeHuman's low proxy for the person's sex, painted: skin, hair on the scalp, each garment. */
  private buildFar(look: Look, wearIds: string[]): void {
    const k = this.kit;
    const name = look.sex === 'F' ? 'female1605' : 'male1591';
    const p = k.proxies.get(`lod.${name}`);
    if (!p) return;
    const m = merged(k, [`lod.${name}`], [0]);
    this.setProxies(this.lod, m);
    const col = new Float32Array(m.count * 3);
    // Per proxy vertex, then out to the render vertices.
    const pv = new Float32Array(p.count * 3);
    const skin = srgbToLinear(look.skin, new THREE.Vector3());
    const hair = srgbToLinear(look.hairColor, new THREE.Vector3());
    const hairMask = k.kit.array(`lod.${name}.hair`) as Uint8Array;
    const cover = look.hair ? 1 : look.crop;
    for (let i = 0; i < p.count; i++) {
      const h = Math.min(1, (hairMask[i] / 255) * 1.4) * cover;
      pv[i * 3] = skin.x + (hair.x - skin.x) * h;
      pv[i * 3 + 1] = skin.y + (hair.y - skin.y) * h;
      pv[i * 3 + 2] = skin.z + (hair.z - skin.z) * h;
    }
    const c = new THREE.Vector3();
    for (const w of look.wear) {
      if (!wearIds.includes(w.id) || !k.kit.has(`lod.${name}.cover.${w.id}`)) continue;
      const own = (k.proxies.get(`clothes.${w.id}`)?.info.slots ?? [])[0] === 'own';
      if (own) c.set(0.035, 0.03, 0.028);
      else srgbToLinear(w.colors[0] ?? '#808080', c);
      const cv = k.kit.array(`lod.${name}.cover.${w.id}`) as Uint16Array;
      for (let j = 0; j < cv.length; j++) {
        const i = cv[j];
        pv[i * 3] = c.x;
        pv[i * 3 + 1] = c.y;
        pv[i * 3 + 2] = c.z;
      }
    }
    gather(pv, p.src, col);
    this.lod.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }

  /** Bones at the body's joints (no rotation), the metrics the animator needs. */
  private rest(b: Body): void {
    const k = this.kit;
    const J = b.joints;
    const at = (name: string) => {
      const i = k.kit.boneNames.indexOf(name);
      return new THREE.Vector3(J[i * 3], J[i * 3 + 1], J[i * 3 + 2]);
    };
    const pt = (name: string) => {
      const i = k.kit.boneNames.length + k.kit.points.indexOf(name);
      return new THREE.Vector3(J[i * 3], J[i * 3 + 1], J[i * 3 + 2]);
    };
    const world = k.names.map((n) => (n === 'root' ? new THREE.Vector3() : at(n)));
    this.bones.forEach((bone, i) => {
      const p = k.parents[i];
      bone.position.copy(world[i]);
      if (p >= 0) bone.position.sub(world[p]);
      bone.quaternion.identity();
      this.skeleton.boneInverses[i].makeTranslation(-world[i].x, -world[i].y, -world[i].z);
    });
    const hips = at('hips');
    const thigh = at('thighL');
    const shin = at('shinL');
    const foot = at('footL');
    this.hipY = hips.y;
    this.legs = {
      thigh: thigh.distanceTo(shin),
      shin: shin.distanceTo(foot),
      ankle: foot.y,
      hipDrop: hips.y - thigh.y,
      seat: 0.1 * (thigh.distanceTo(shin) / 0.42),
    };
    this.eyeY = at('eyeL').y - hips.y;
    this.headTop = pt('headTop').y - at('head').y;
    this.headScale = this.headTop / 0.16;
    // The eye joints sit at the eyeballs' centres (the eyes turn about them); an adult's eyeball is 12 mm in radius.
    this.u.eyeC.value[0].copy(at('eyeL'));
    this.u.eyeC.value[1].copy(at('eyeR'));
    this.u.eyeR.value = 0.012 * this.headScale;
    this.arms = armsRest(at);
    this.armScale = (this.arms.L.l1 + this.arms.L.l2) / 0.53;
  }

  private setProxies(mesh: THREE.SkinnedMesh, m: Merged): Float32Array {
    const body = this.built!;
    const pos = new Float32Array(m.count * 3);
    const nor = new Float32Array(m.count * 3);
    let o = 0;
    for (const p of m.parts) {
      const fitted = new Float32Array(p.count * 3);
      fitProxy(p, body, fitted);
      const pp = pos.subarray(o * 3, (o + p.renderCount) * 3);
      gather(fitted, p.src, pp);
      seamlessNormals(fitted, p.src, p.index, p.count, nor.subarray(o * 3, (o + p.renderCount) * 3));
      o += p.renderCount;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', m.uv);
    g.setAttribute('slot', m.slot);
    g.setAttribute('skinIndex', m.skinIndex);
    g.setAttribute('skinWeight', m.skinWeight);
    g.setIndex(m.index);
    mesh.geometry.dispose();
    mesh.geometry = g;
    return pos;
  }

  setShadows(on: boolean): void {
    this.body.castShadow = on;
    this.hair.castShadow = on;
    this.clothes.castShadow = on;
    this.lod.castShadow = on;
  }

  dispose(): void {
    this.body.geometry.dispose();
    this.eyes.geometry.dispose();
    this.hair.geometry.dispose();
    this.clothes.geometry.dispose();
    this.lod.geometry.dispose();
    this.clothMat.dispose();
    this.skinMat.dispose();
    this.eyeMat.dispose();
    this.hairMat.dispose();
    this.skeleton.dispose();
  }
}

export interface ArmRest {
  /** Collarbone and shoulder joints (figure frame, at rest); the shoulder relative to the collarbone. */
  clav: THREE.Vector3;
  s: THREE.Vector3;
  l1: number;
  l2: number;
  /** Rest directions of the upper arm and forearm, and the elbow's hinge. */
  a1: THREE.Vector3;
  a2: THREE.Vector3;
  h: THREE.Vector3;
}
export interface ArmsRest {
  L: ArmRest;
  R: ArmRest;
  /** Between the shoulders (reach targets are given from here). */
  mid: THREE.Vector3;
}

function armsRest(at: (n: string) => THREE.Vector3): ArmsRest {
  const arm = (sd: 'L' | 'R'): ArmRest => {
    const clav = at(`clavicle${sd}`);
    const S = at(`upperarm${sd}`);
    const E = at(`forearm${sd}`);
    const W = at(`hand${sd}`);
    const a1 = E.clone().sub(S);
    const l1 = a1.length();
    a1.normalize();
    const a2 = W.clone().sub(E);
    const l2 = a2.length();
    a2.normalize();
    // The elbow flexes toward the front: its hinge is across the arm, facing forward.
    const h = a1.clone().cross(new THREE.Vector3(0, 0, 1)).normalize();
    return { clav, s: S.clone().sub(clav), l1, l2, a1, a2, h };
  };
  return { L: arm('L'), R: arm('R'), mid: at('upperarmL').add(at('upperarmR')).multiplyScalar(0.5) };
}

function srgbToLinear(hex: string, out: THREE.Vector3): THREE.Vector3 {
  tmpC.set(hex);
  // Color.set converts sRGB hex to linear under three's colour management.
  return out.set(tmpC.r, tmpC.g, tmpC.b);
}

type Uniforms = Record<string, THREE.IUniform>;

/**
 * Hiding within a duvet's footprint (see people3d's beds and duvet.ts): the fragment's world position is taken
 * into the duvet's frame and discarded when it lies within the footprint below the height the duvet covers.
 */
function underDuvet(sh: { vertexShader: string; fragmentShader: string }): void {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDuvetP;').replace('#include <project_vertex>', '#include <project_vertex>\nvDuvetP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float duvetOn; uniform mat4 duvetInv; uniform vec3 duvetHalf; varying vec3 vDuvetP;')
    .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (duvetOn > 0.5) { vec3 dl = (duvetInv * vec4(vDuvetP, 1.0)).xyz; if (abs(dl.x) < duvetHalf.x && abs(dl.z) < duvetHalf.z && dl.y < duvetHalf.y) discard; }');
}

/**
 * Light under the skin, the way MetaHuman's subsurface profile has it, in one function: the diffuse response
 * wraps past the terminator, each channel as far as it travels in flesh (MetaHuman's mean free path colour,
 * 0.35 : 0.136 : 0.0875, red furthest), and the terminator itself reddens (its scatter colour, red-dominant).
 * Only the diffuse light is scattered; the highlights stay where the light is.
 */
const SKIN_WRAP = `
vec3 skinWrap( float ndl ) {
	vec3 w = vec3( 0.36, 0.14, 0.09 );
	vec3 d = clamp( ( vec3( ndl ) + w ) / ( ( 1.0 + w ) * ( 1.0 + w ) ), 0.0, 1.0 );
	float term = smoothstep( -0.25, 0.25, ndl ) * ( 1.0 - smoothstep( 0.25, 0.7, ndl ) );
	return d + vec3( 0.13, 0.025, 0.008 ) * term;
}`;
/** three's physical lighting with the skin's scattered diffuse in place of the plain cosine (the same chunk otherwise). */
function skinLighting(): string {
  const src = THREE.ShaderChunk.lights_physical_pars_fragment;
  const a = 'vec3 irradiance = dotNL * directLight.color;';
  const b = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';
  if (!src.includes(a) || !src.includes(b)) {
    console.warn('people: three.js lighting has changed; the skin scatters no light');
    return src;
  }
  return src.replace(a, `${a}\n\tvec3 skinIrr = skinWrap( dot( geometryNormal, directLight.direction ) ) * directLight.color;`).replace(b, b.replace('irradiance', 'skinIrr'));
}

/**
 * The skin: the person's tone over the skin maps (light or dark, as their tone is), stubble, a close crop, age.
 * Shaded as skin is (after MetaHuman's skin material): its own reflectance (MetaHuman's specular of 0.85 is a
 * 3.4 % reflectance, an index of refraction of 1.45, not plastic's 4 %), its roughness (0.65 at the base, less
 * on the nose and brow), a micro-normal for the pores, the sheen of the peach fuzz (MetaHuman's fuzz colour),
 * and light that scatters below the surface.
 */
function skinMaterial(k: HumanKit, u: Uniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshPhysicalMaterial({ map: k.tex.skinLight, roughness: 0.6, metalness: 0, ior: 1.45, normalMap: microNormals(), normalScale: new THREE.Vector2(0.3, 0.3), sheen: 0.14, sheenRoughness: 0.75, sheenColor: new THREE.Color(0.25, 0.23, 0.176) });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, { skinDark: { value: k.tex.skinDark }, fields: { value: k.tex.fields } });
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D skinDark; uniform sampler2D fields;
uniform vec3 tone; uniform float dark; uniform float aged; uniform float crop; uniform float recede; uniform vec3 hairCol; uniform float beard;
float hairAmt = 0.0;
${SKIN_WRAP}`,
      )
      .replace('#include <lights_physical_pars_fragment>', skinLighting())
      .replace(
        '#include <map_fragment>',
        `{
  vec3 rl = texture2D(map, vMapUv).rgb;
  vec3 rd = texture2D(skinDark, vMapUv).rgb;
  vec3 rel = exp2(mix(rl, rd, dark) * 8.0 - 4.0);
  vec4 f = texture2D(fields, vMapUv);
  vec3 col = tone * rel;
  // (On the scalp the age channel holds the receding order instead.)
  float onScalp = smoothstep(0.05, 0.35, f.r);
  col *= mix(1.0, f.b * 2.0, aged * 0.8 * (1.0 - onScalp));
  float grain = f.a * 2.0;
  // Stubble: the beard's field, broken up by the hair's grain.
  float bd = smoothstep(0.05, 0.55, f.g) * beard * clamp(0.6 + (grain - 1.0) * 0.8, 0.0, 1.0);
  col = mix(col, hairCol * 0.8, bd * 0.6);
  // A close crop: inside the hairline (ragged by the grain, further back as it recedes), matte, the scalp showing
  // through light hair.
  float edge = 0.5 + (grain - 1.0) * 0.12;
  float light = dot(hairCol, vec3(0.2126, 0.7152, 0.0722));
  float grey = smoothstep(0.05, 0.4, light);
  float kept = 1.0 - smoothstep(1.0 - recede - 0.08, 1.0 - recede + 0.08, f.b + (grain - 1.0) * 0.06);
  hairAmt = smoothstep(edge - 0.14, edge + 0.1, f.r) * crop * mix(0.97, 0.72, grey) * kept;
  // Dark hair: curls in its own colour; grey: salt and pepper (dark strands among the white).
  vec3 strands = mix(hairCol * clamp(grain, 0.35, 1.5), mix(hairCol * 0.28, hairCol, smoothstep(0.75, 1.25, grain)), grey);
  col = mix(col, strands, hairAmt);
  diffuseColor.rgb *= col;
}`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.97, hairAmt);');
    underDuvet(sh);
  };
  m.customProgramCacheKey = () => 'people-skin-3';
  return m;
}

/**
 * The eyes: the white of the eye and the iris in the person's colour, with what MetaHuman's eye has that a flat
 * one lacks: a wet cornea (a clear coat over the whole eyeball, MetaHuman's index of refraction 1.336 and
 * cornea roughness 0.075), a dark limbal ring where the iris meets the white (from 0.725 of the iris out), a
 * pupil that widens in the dark, the sclera tinted a little with the skin, and the shade of the lids on the
 * top and bottom of the eyeball (its eye occlusion shell).
 */
function eyeMaterial(k: HumanKit, u: Uniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshPhysicalMaterial({ map: k.tex.eyes, roughness: 0.3, metalness: 0, ior: 1.336, clearcoat: 1, clearcoatRoughness: 0.075 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, { night: NIGHT, irisC: IRIS.c, irisR: IRIS.r });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec3 eyeC[2]; uniform float eyeR;\nvarying vec3 vEye;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
{
  // Which eyeball this vertex is on, and where on it (in radii, at rest): the lids' shade follows.
  vec3 c = distance(position, eyeC[0]) < distance(position, eyeC[1]) ? eyeC[0] : eyeC[1];
  vEye = (position - c) / eyeR;
}`,
    );
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 iris; uniform float dark; uniform float night; uniform vec2 irisC[2]; uniform float irisR[2];\nvarying vec3 vEye;').replace(
      '#include <map_fragment>',
      `{
  vec3 t = texture2D(map, vMapUv).rgb;
  // The white, tinted a little toward the skin's warmth in darker skin (MetaHuman's sclera tint follows the skin tone).
  vec3 white = vec3(0.93, 0.86, 0.8) * mix(vec3(1.0), vec3(0.95, 0.88, 0.78), dark * 0.6) * t.r;
  // How far out on the iris this is (0 at its centre, 1 at its edge).
  float r = min(distance(vMapUv, irisC[0]) / irisR[0], distance(vMapUv, irisC[1]) / irisR[1]);
  vec3 ic = iris * t.g * 2.0;
  ic *= 1.0 - 0.6 * smoothstep(0.725 - 0.085, 1.0, r);
  float pupil = mix(0.3, 0.52, night);
  ic *= smoothstep(pupil - 0.045, pupil + 0.045, r);
  vec3 col = mix(white, ic, t.b);
  col *= 1.0 - 0.6 * smoothstep(0.1, 0.85, vEye.y) - 0.25 * smoothstep(-0.35, -0.9, vEye.y);
  diffuseColor.rgb *= col;
}`,
    );
  };
  m.customProgramCacheKey = () => 'people-eyes-2';
  return m;
}

/**
 * Hair, brows and lashes: strands' brightness from the atlas, each in its colour (slot 0 hair, 1 brows, 2
 * lashes), with the highlight stretched along the strands, as hair's is (an anisotropic gloss, after Unreal's
 * hair shading: the strands run down the atlas).
 */
function hairMaterial(k: HumanKit, u: Uniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshPhysicalMaterial({ map: k.tex.hair, roughness: 0.42, metalness: 0, alphaTest: 0.3, side: THREE.DoubleSide, alphaToCoverage: true, anisotropy: 0.6, anisotropyRotation: Math.PI / 2 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float slot;\nvarying float vSlot;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvSlot = slot;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 hairCols[3];\nvarying float vSlot;')
      .replace(
        '#include <map_fragment>',
        `{
  vec4 t = texture2D(map, vMapUv);
  vec3 c = vSlot < 0.5 ? hairCols[0] : vSlot < 1.5 ? hairCols[1] : hairCols[2];
  diffuseColor.rgb *= c * t.rgb * 2.0;
  diffuseColor.a *= t.a;
}`,
      );
    underDuvet(sh);
  };
  m.customProgramCacheKey = () => 'people-hair-3';
  return m;
}

/** Clothes: each garment's shading from the atlas in the person's colours (slot 'own' keeps the texture's colours). */
function clothMaterial(k: HumanKit, u: Uniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: k.tex.clothes, roughness: 0.86, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float slot;\nvarying float vSlot;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvSlot = slot;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec4 cloth[${CLOTH_SLOTS}];\nvarying float vSlot;`)
      .replace(
        '#include <map_fragment>',
        `{
  vec3 t = texture2D(map, vMapUv).rgb;
  vec4 c = cloth[int(vSlot + 0.5)];
  diffuseColor.rgb *= c.a > 0.5 ? c.rgb * t.r * 2.0 : pow(t, vec3(2.2));
}`,
      );
    underDuvet(sh);
  };
  m.customProgramCacheKey = () => 'people-cloth-2';
  return m;
}

export { HAIR_STYLES };
