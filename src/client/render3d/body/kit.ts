// The people's kit (built by scripts/humans/build.py from MakeHuman's CC0
// data): the base mesh, the targets that shape it (sex, age, muscle, weight,
// ancestry, face and body details), the skeleton whose joints the targets
// move, skin weights, and the proxies bound to the base mesh (eyes, brows,
// lashes, hair, clothes, a light body for distance). One binary: 'MHK1', the
// length of a JSON header, the header, then the typed arrays it lists.

export interface TargetInfo {
  name: string;
  kind: 'dense' | 'sparse';
  offset: number;
  count?: number;
  scale: number;
  /** Index into the joint displacement table (targets.joints: one [bones+points × 3] block per target). */
  joint: number;
}

export interface DetailInfo {
  name: string;
  lo: number[];
  hi: number[];
}

export interface ProxyInfo {
  name: string;
  kind: string;
  vertices: number;
  triangles: number;
  /** MakeHuman's scale references: per axis [vertex a, vertex b, base distance] (shipped indices). */
  scale: Array<[number, number, number] | null>;
  /** Base vertices (shipped indices) this proxy hides on the body. */
  deletes: number;
  /** Which texture atlas its uvs point into, and its colour slots (clothes). */
  atlas?: string;
  slots?: string[];
  [k: string]: unknown;
}

export interface KitMeta {
  version: number;
  bones: { names: string[]; parents: number[] };
  points: string[];
  targets: TargetInfo[];
  macro: Record<string, number>;
  details: DetailInfo[];
  body: { vertices: number; triangles: number };
  proxies?: ProxyInfo[];
  textures?: Record<string, string>;
  [k: string]: unknown;
}

type ArrayInfo = { type: 'f32' | 'i16' | 'u16' | 'u8' | 'i8' | 'u32' | 'i32'; offset: number; length: number };

export interface Kit {
  meta: KitMeta;
  /** Shipped base vertices (the body and the helpers proxies bind to), metres, MakeHuman's rest pose. */
  base: Float32Array;
  vertices: number;
  /** Bones and extra points (fingertips, top of the head...), base positions. */
  joints: Float32Array;
  boneNames: string[];
  boneParents: number[];
  points: string[];
  skinIndex: Uint8Array;
  skinWeight: Float32Array;
  targetsDense: Int16Array;
  targetsIndex: Uint16Array;
  targetsValue: Int16Array;
  targetsJoints: Float32Array;
  array(name: string): Float32Array | Int16Array | Uint16Array | Uint8Array | Int8Array | Uint32Array | Int32Array;
  has(name: string): boolean;
}

export async function loadKit(url: string): Promise<Kit> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`people kit: ${res.status}`);
  return parseKit(await res.arrayBuffer());
}

export function parseKit(buf: ArrayBuffer): Kit {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'MHK1') throw new Error('people kit: not a kit');
  const headLen = dv.getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, headLen))) as KitMeta & { arrays: Record<string, ArrayInfo> };
  const start = 8 + headLen;
  const arrays = head.arrays;
  const cache = new Map<string, ReturnType<Kit['array']>>();
  const array = (name: string) => {
    let a = cache.get(name);
    if (a) return a;
    const info = arrays[name];
    if (!info) throw new Error(`people kit: no ${name}`);
    const at = start + info.offset;
    switch (info.type) {
      case 'f32':
        a = new Float32Array(buf, at, info.length);
        break;
      case 'i16':
        a = new Int16Array(buf, at, info.length);
        break;
      case 'u16':
        a = new Uint16Array(buf, at, info.length);
        break;
      case 'u8':
        a = new Uint8Array(buf, at, info.length);
        break;
      case 'i8':
        a = new Int8Array(buf, at, info.length);
        break;
      case 'u32':
        a = new Uint32Array(buf, at, info.length);
        break;
      default:
        a = new Int32Array(buf, at, info.length);
    }
    cache.set(name, a);
    return a;
  };
  const base = array('base') as Float32Array;
  const sw = array('skinWeight') as Uint8Array;
  const skinWeight = new Float32Array(sw.length);
  for (let i = 0; i < sw.length; i += 4) {
    const t = sw[i] + sw[i + 1] + sw[i + 2] + sw[i + 3] || 1;
    for (let k = 0; k < 4; k++) skinWeight[i + k] = sw[i + k] / t;
  }
  return {
    meta: head,
    base,
    vertices: base.length / 3,
    joints: array('joints') as Float32Array,
    boneNames: head.bones.names,
    boneParents: head.bones.parents,
    points: head.points,
    skinIndex: array('skinIndex') as Uint8Array,
    skinWeight,
    targetsDense: array('targets.dense') as Int16Array,
    targetsIndex: array('targets.index') as Uint16Array,
    targetsValue: array('targets.value') as Int16Array,
    targetsJoints: array('targets.joints') as Float32Array,
    array,
    has: (name: string) => name in arrays,
  };
}
