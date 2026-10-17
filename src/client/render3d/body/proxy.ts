// A proxy from the kit (eyes, brows, lashes, hair, a garment, a light body),
// as plain arrays: its binding to the base mesh (three vertices, weights and
// an offset, as MakeHuman binds them), its surface (render vertices copying
// its vertices across texture seams, triangles), its skin weights in the
// kit's bones, and for clothes the body it covers and its colour slots.
// Fitting puts it on a body as MakeHuman does, then carries it into the
// body's rest pose and scale. No three.js: the tests and the scripts use it.
import { toRest, type Body } from './build';
import type { Kit, ProxyInfo } from './kit';

export interface ProxyData {
  key: string;
  info: ProxyInfo;
  ref: Uint16Array;
  /** Binding weights (steps of 1/4096) and offsets (16-bit steps of offScale metres). */
  w: Int16Array;
  off: Int16Array;
  offScale: number;
  scale: Array<[number, number, number] | null>;
  /** Skin weights in the kit's bones (four per vertex). */
  kitSkinIndex: Uint8Array;
  kitSkinWeight: Float32Array;
  /** Each render vertex's proxy vertex, its uv (16-bit), the triangles over the render vertices. */
  src: Uint16Array;
  uv: Uint16Array;
  index: Uint16Array;
  /** Base vertices (shipped indices) MakeHuman deletes under it. */
  deletes: Uint16Array;
  /** Clothes: the body's triangles it hides, and each render vertex's colour slot within the garment. */
  hide: Uint16Array | null;
  slot: Uint8Array | null;
  /** Clothes: the body's vertices (shipped indices) it covers, and how far over them it lies (kit units). */
  covers: Uint16Array | null;
  count: number;
  renderCount: number;
}

export function proxyData(k: Kit, info: ProxyInfo): ProxyData {
  const key = info.key as string;
  const sw8 = k.array(`${key}.skinWeight`) as Uint8Array;
  const kitSkinWeight = new Float32Array(sw8.length);
  for (let i = 0; i < sw8.length; i++) kitSkinWeight[i] = sw8[i] / 255;
  const src = k.array(`${key}.src`) as Uint16Array;
  return {
    key,
    info,
    ref: k.array(`${key}.ref`) as Uint16Array,
    w: k.array(`${key}.w`) as Int16Array,
    off: k.array(`${key}.off`) as Int16Array,
    offScale: (info.offScale as number) ?? 1,
    scale: info.scale,
    kitSkinIndex: k.array(`${key}.skinIndex`) as Uint8Array,
    kitSkinWeight,
    src,
    uv: k.array(`${key}.uv`) as Uint16Array,
    index: k.array(`${key}.index`) as Uint16Array,
    deletes: k.array(`${key}.deletes`) as Uint16Array,
    hide: k.has(`${key}.hide`) ? (k.array(`${key}.hide`) as Uint16Array) : null,
    slot: k.has(`${key}.slot`) ? (k.array(`${key}.slot`) as Uint8Array) : null,
    covers: k.has(`${key}.covers`) ? (k.array(`${key}.covers`) as Uint16Array) : null,
    count: info.vertices,
    renderCount: src.length,
  };
}

/** Every proxy in the kit, by key ('clothes.m_tee', 'hair.bob01', ...). */
export function proxiesOf(k: Kit): Map<string, ProxyData> {
  const out = new Map<string, ProxyData>();
  for (const info of k.meta.proxies ?? []) out.set(info.key as string, proxyData(k, info));
  return out;
}

/** A proxy's vertices fitted to a body (as MakeHuman fits them), then carried into the rest pose and scale. */
export function fitProxy(p: ProxyData, body: Body, out: Float32Array): void {
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

/** A proxy's triangles over its own vertices (the render vertices' triangles taken back to the vertices they copy). */
export function proxyTriangles(p: ProxyData): Uint16Array {
  const out = new Uint16Array(p.index.length);
  for (let i = 0; i < p.index.length; i++) out[i] = p.src[p.index[i]];
  return out;
}
