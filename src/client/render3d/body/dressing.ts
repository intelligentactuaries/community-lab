// Putting clothes on a body so that nothing shows through anything: the way a
// dresser layers garments, from the skin out. Each garment comes from one of
// MakeHuman's outfits and is fitted to the body on its own, so two garments
// from different outfits (a blouse from one, jeans from another) cross each
// other wherever they meet, and a garment can dip into a body built fuller
// than the one it was made on. Here every garment is laid over what is
// already worn: lifted off the skin by a few millimetres, and off every layer
// under it, wherever it lies below or too close to it. Then what lies well
// under an outer layer is not drawn (the skin under clothes, a shirt's tails
// tucked into a skirt, the waistband under a jumper), as MetaHuman hides the
// body under a garment; within a few centimetres of the outer layer's edges
// everything is kept, so when the person moves no edge lifts to show a hole.
//
// How each garment lies on the skin, and how any two lie over each other, are
// worked out once on a typical body of each sex (what each covers, and where
// on the surface beneath each vertex lies); a person's garments are then
// lifted on their own body, starting from there and stepping across the
// surface's triangles to the nearest point: a few milliseconds a person.
import { buildBody, type Body } from './build';
import type { Kit } from './kit';
import { fitProxy, proxyTriangles, type ProxyData } from './proxy';
import type { Sex } from './shape';
import { Surface, closestOnTriangle, newHit, vertexNormals, type Hit } from './surface';

/** How far a garment stands off the skin, and off a garment under it (metres). */
export const CLEAR_SKIN = 0.004;
export const CLEAR_CLOTH = 0.005;
/** How far below or above a surface a vertex is still taken to be over it (deeper is another part of the body). */
const REACH = 0.04;
/** What lies under a garment this far in from its edges (metres along it), and this close beneath it, is not drawn. */
const EDGE = 0.035;
const UNDER = 0.07;

/**
 * The order garments are worn in, from the skin out. Tops go over the bottoms, except a blouse or a T-shirt worn with
 * a full skirt, which is tucked into it (as a dress has a waist); overalls and a suit's jacket over the shirt; a coat's
 * tails under the jacket that makes its top (so the two read as one coat); a jacket and a sari's pallu over everything.
 */
export function rankOf(id: string, wear: readonly string[]): number {
  if (id.startsWith('shoes')) return 0;
  if (id === 'onesie') return 1;
  if (BOTTOMS.has(id)) return 2;
  if (TOPS.has(id)) {
    const tucked = (id === 'f_blouse' || id === 'f_tee') && wear.some((w) => w === 'skirt_long' || w === 'skirt_knee');
    return tucked ? 1.5 : 3;
  }
  if (id === 'm_overalls' || id === 'm_suit') return 4;
  if (id === 'coat') return 4.5;
  if (id === 'm_jacket') return 5;
  if (id === 'sari_pallu') return 6;
  if (id.startsWith('hat_')) return 7;
  return 3;
}
const BOTTOMS = new Set(['m_jeans', 'm_trousers', 'm_shorts', 'f_jeans', 'f_shorts', 'f_capri', 'f_skirt', 'skirt_knee', 'skirt_long']);
const TOPS = new Set(['m_tee', 'm_shirt', 'm_longtee', 'm_worktee', 'f_tee', 'f_blouse']);
/** Hats: rigid on the head, worn as made. */
const RIGID = (id: string) => id.startsWith('hat_');

/** Triangles that share a corner with each triangle (CSR). */
interface Adjacency {
  start: Uint32Array;
  items: Uint32Array;
}

function adjacency(tris: ArrayLike<number>, nVerts: number): Adjacency {
  const nt = tris.length / 3;
  // Triangles at each vertex, then each triangle's neighbours through its corners.
  const vs = new Uint32Array(nVerts + 1);
  for (let i = 0; i < tris.length; i++) vs[tris[i] + 1]++;
  for (let v = 0; v < nVerts; v++) vs[v + 1] += vs[v];
  const vt = new Uint32Array(tris.length);
  const fill = new Uint32Array(nVerts);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) vt[vs[tris[t * 3 + k]] + fill[tris[t * 3 + k]]++] = t;
  const start = new Uint32Array(nt + 1);
  const lists: number[][] = [];
  for (let t = 0; t < nt; t++) {
    const set = new Set<number>();
    for (let k = 0; k < 3; k++) {
      const v = tris[t * 3 + k];
      for (let j = vs[v]; j < vs[v + 1]; j++) if (vt[j] !== t) set.add(vt[j]);
    }
    lists.push([...set]);
    start[t + 1] = start[t] + set.size;
  }
  const items = new Uint32Array(start[nt]);
  for (let t = 0; t < nt; t++) items.set(lists[t], start[t]);
  return { start, items };
}

/**
 * The nearest point to (x, y, z) on the surface, found by stepping from a starting triangle to whichever neighbour is
 * nearer until none is (the surfaces here are smooth, so this ends at the nearest point when started near it).
 * Returns the squared distance; the triangle and barycentric weights into out.
 */
function walk(P: Float32Array, T: ArrayLike<number>, adj: Adjacency, start: number, x: number, y: number, z: number, out: Hit): number {
  let cur = start;
  let a = T[cur * 3] * 3;
  let b = T[cur * 3 + 1] * 3;
  let c = T[cur * 3 + 2] * 3;
  let best = closestOnTriangle(x, y, z, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2], BC);
  out.tri = cur;
  out.u = BC[0];
  out.v = BC[1];
  out.w = BC[2];
  for (let step = 0; step < 12; step++) {
    let moved = -1;
    for (let k = adj.start[cur]; k < adj.start[cur + 1]; k++) {
      const t = adj.items[k];
      a = T[t * 3] * 3;
      b = T[t * 3 + 1] * 3;
      c = T[t * 3 + 2] * 3;
      const d2 = closestOnTriangle(x, y, z, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2], BC);
      if (d2 < best - 1e-14) {
        best = d2;
        moved = t;
        out.tri = t;
        out.u = BC[0];
        out.v = BC[1];
        out.w = BC[2];
      }
    }
    if (moved < 0) break;
    cur = moved;
  }
  return best;
}
const BC = new Float64Array(3);

/** The point and normal at out's triangle and weights, and the signed distance of (x, y, z) above it. */
function settle(P: Float32Array, N: Float32Array, T: ArrayLike<number>, x: number, y: number, z: number, out: Hit): void {
  const a = T[out.tri * 3] * 3;
  const b = T[out.tri * 3 + 1] * 3;
  const c = T[out.tri * 3 + 2] * 3;
  out.x = P[a] * out.u + P[b] * out.v + P[c] * out.w;
  out.y = P[a + 1] * out.u + P[b + 1] * out.v + P[c + 1] * out.w;
  out.z = P[a + 2] * out.u + P[b + 2] * out.v + P[c + 2] * out.w;
  let nx = N[a] * out.u + N[b] * out.v + N[c] * out.w;
  let ny = N[a + 1] * out.u + N[b + 1] * out.v + N[c + 1] * out.w;
  let nz = N[a + 2] * out.u + N[b + 2] * out.v + N[c + 2] * out.w;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  out.nx = nx;
  out.ny = ny;
  out.nz = nz;
  out.signed = (x - out.x) * nx + (y - out.y) * ny + (z - out.z) * nz;
  out.dist = Math.hypot(x - out.x, y - out.y, z - out.z);
}

/** How a garment lies on the typical body of a sex. */
interface Lie {
  /**
   * Its vertices fitted and lifted off the skin, their surface, and each one's distance from the garment's edges (edge:
   * from the edges that can lift, not a waistband; edgeAll: from every edge).
   */
  pos: Float32Array;
  surf: Surface;
  edge: Float32Array;
  edgeAll: Float32Array;
  /** For each vertex, the body triangle nearest it, or -1 where it lies well clear of the skin. */
  skinStart: Int32Array;
  /** The body's (shipped) vertices it covers. */
  covers: Uint8Array;
  /** Body vertices just under it that it does not hide (near its edges), and its triangle nearest each. */
  pokes: Pokes;
}

/**
 * Points of what lies under a garment that are near enough to come up through it between its vertices (a garment's
 * triangles are larger than the body's, and an inner garment has its buttons and belt loops), each with the garment's
 * triangle nearest it.
 */
interface Pokes {
  verts: Uint32Array;
  tris: Uint32Array;
}

/** How one garment lies over another on the typical body. */
interface Over {
  /** The outer garment's vertices near the inner one, and the inner triangle each is nearest. */
  verts: Uint16Array;
  tris: Uint32Array;
  /** The inner garment's vertices the outer one covers. */
  covers: Uint8Array;
  /** Inner vertices just under the outer garment that it does not hide. */
  pokes: Pokes;
}

/** What dressing needs of the kit, made once, with what it has worked out so far. */
export interface DressKit {
  kit: Kit;
  /** The kit's proxies by key ('clothes.m_tee', ...). */
  proxies: ReadonlyMap<string, ProxyData>;
  /** The body's triangles over its shipped vertices (the kit's body.index through body.src), and how many vertices. */
  bodyTris: Uint16Array;
  nVerts: number;
  bodyAdj: Adjacency;
  canon: Partial<Record<Sex, { body: Body; skin: Surface }>>;
  /** The body's vertices' neighbours, and those never hidden (the hands and the face); made when first needed. */
  bodyNb?: Adjacency;
  alwaysShown?: Uint8Array;
  lies: Map<string, Lie>;
  overs: Map<string, Over>;
  proxyAdj: WeakMap<ProxyData, Adjacency>;
}

export function dressKit(kit: Kit, proxies: ReadonlyMap<string, ProxyData>): DressKit {
  const src = kit.array('body.src') as Uint16Array;
  const idx = kit.array('body.index') as Uint16Array;
  const bodyTris = new Uint16Array(idx.length);
  for (let i = 0; i < idx.length; i++) bodyTris[i] = src[idx[i]];
  const nVerts = kit.vertices;
  return { kit, proxies, bodyTris, nVerts, bodyAdj: adjacency(bodyTris, nVerts), canon: {}, lies: new Map(), overs: new Map(), proxyAdj: new WeakMap() };
}

/** The typical body of a sex (a woman of 1.64 m, a man of 1.75 m, of average build and mixed ancestry) and its skin. */
function canon(dk: DressKit, sex: Sex): { body: Body; skin: Surface } {
  let c = dk.canon[sex];
  if (!c) {
    const body = buildBody(dk.kit, { sex, age: 35, weight: 0.5, muscle: 0.5, ancestry: { african: 0.34, asian: 0.33, caucasian: 0.33 }, details: {} }, sex === 'F' ? 1.64 : 1.75);
    c = dk.canon[sex] = { body, skin: new Surface(body.pos, dk.bodyTris, 0.02) };
  }
  return c;
}

function proxyAdjacency(dk: DressKit, p: ProxyData, tris: Uint16Array): Adjacency {
  let a = dk.proxyAdj.get(p);
  if (!a) {
    a = adjacency(tris, p.count);
    dk.proxyAdj.set(p, a);
  }
  return a;
}

/** One garment on a body: its fitted vertices (lifted here), triangles over them, and which are drawn. */
export interface Layer {
  id: string;
  proxy: ProxyData;
  /** Rest-pose positions of the proxy's vertices (fitted), adjusted in place. */
  pos: Float32Array;
  /** Triangles over the proxy's vertices, in the order of its render triangles. */
  tris: Uint16Array;
  /** Per triangle: 1 when hidden under an outer layer (filled in by dress). */
  hidden: Uint8Array;
  /** Order from the skin out. */
  rank: number;
}

/** A garment fitted to a body, ready to be dressed. */
export function layerOf(p: ProxyData, id: string, body: Body, wear: readonly string[]): Layer {
  const pos = new Float32Array(p.count * 3);
  fitProxy(p, body, pos);
  return { id, proxy: p, pos, tris: proxyTriangles(p), hidden: new Uint8Array(0), rank: rankOf(id, wear) };
}

export interface DressResult {
  /** Per body triangle (the kit's body.index order): 1 when hidden under clothes. */
  bodyHidden: Uint8Array;
  /** The layers in order from the skin out (the same objects, lifted and with their hidden triangles marked). */
  layers: Layer[];
}

/**
 * Dress a body (built at its height, in the rest pose): the layers (fitted, in any order) are ranked, lifted clear of
 * the skin and of each other from the skin out, and what lies under them is marked hidden.
 */
export function dress(dk: DressKit, body: Body, sex: Sex, layers: Layer[]): DressResult {
  layers.sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : 1));
  const skinN = vertexNormals(body.pos, dk.bodyTris);
  const h = newHit();
  const normals: Float32Array[] = [];
  const bodyCover = new Uint8Array(dk.nVerts);
  layers.forEach((L, k) => {
    const lie = lieOf(dk, sex, L.id, L.proxy, L.tris);
    for (let v = 0; v < dk.nVerts; v++) bodyCover[v] |= lie.covers[v];
    // A hat is rigid on the head as it was made (it hides what is under it, but is not reshaped).
    if (RIGID(L.id)) {
      normals.push(vertexNormals(L.pos, L.tris));
      return;
    }
    const P = L.pos;
    const n = L.proxy.count;
    const moved = new Float32Array(n);
    // Off the skin: from the body triangle nearest it on the typical body, to the nearest point of this one's skin.
    const start = lie.skinStart;
    for (let i = 0; i < n; i++) {
      if (start[i] < 0) continue;
      const x = P[i * 3];
      const y = P[i * 3 + 1];
      const z = P[i * 3 + 2];
      if (walk(body.pos, dk.bodyTris, dk.bodyAdj, start[i], x, y, z, h) > REACH * REACH) continue;
      settle(body.pos, skinN, dk.bodyTris, x, y, z, h);
      if (h.signed >= CLEAR_SKIN) continue;
      const d = CLEAR_SKIN - h.signed;
      P[i * 3] += h.nx * d;
      P[i * 3 + 1] += h.ny * d;
      P[i * 3 + 2] += h.nz * d;
      moved[i] += d;
    }
    // Off each layer under it, where they lie close on the typical body.
    const overs: Array<[Over, number]> = [];
    for (let j = 0; j < k; j++) {
      const M = layers[j];
      if (M.rank >= L.rank) continue;
      const o = overOf(dk, sex, L, M);
      overs.push([o, j]);
      const adj = proxyAdjacency(dk, M.proxy, M.tris);
      for (let q = 0; q < o.verts.length; q++) {
        const i = o.verts[q];
        const x = P[i * 3];
        const y = P[i * 3 + 1];
        const z = P[i * 3 + 2];
        if (walk(M.pos, M.tris, adj, o.tris[q], x, y, z, h) > REACH * REACH) continue;
        settle(M.pos, normals[j], M.tris, x, y, z, h);
        if (h.signed >= CLEAR_CLOTH) continue;
        const d = CLEAR_CLOTH - h.signed;
        P[i * 3] += h.nx * d;
        P[i * 3 + 1] += h.ny * d;
        P[i * 3 + 2] += h.nz * d;
        moved[i] += d;
      }
    }
    // And over whatever comes up through it between its vertices: the skin near its edges, an inner garment's
    // buttons and belt loops. The triangle it comes through is lifted over it.
    const LN = vertexNormals(P, L.tris);
    const adjL = proxyAdjacency(dk, L.proxy, L.tris);
    const over = (pts: Float32Array, ptsN: Float32Array, pk: Pokes, clear: number) => {
      for (let q = 0; q < pk.verts.length; q++) {
        const v = pk.verts[q];
        const x = pts[v * 3];
        const y = pts[v * 3 + 1];
        const z = pts[v * 3 + 2];
        if (walk(P, L.tris, adjL, pk.tris[q], x, y, z, h) > REACH * REACH) continue;
        settle(P, LN, L.tris, x, y, z, h);
        // Only what lies under it, facing the same way (not a neighbouring part of the body beside it), and only a
        // little way through (deeper is something else).
        if (h.signed <= -clear || h.signed > 0.012 || ptsN[v * 3] * h.nx + ptsN[v * 3 + 1] * h.ny + ptsN[v * 3 + 2] * h.nz < 0.5) continue;
        liftTriangle(P, L.tris, h, h.signed + clear, moved);
      }
    };
    over(body.pos, skinN, lie.pokes, CLEAR_SKIN);
    for (const [o, j] of overs) over(layers[j].pos, normals[j], o.pokes, CLEAR_CLOTH);
    smoothMoves(L, moved);
    normals.push(vertexNormals(P, L.tris));
  });
  // Hidden: the triangles all of whose corners an outer layer covers.
  layers.forEach((M, j) => {
    const cov = new Uint8Array(M.proxy.count);
    for (let k = j + 1; k < layers.length; k++) {
      if (layers[k].rank <= M.rank) continue;
      const c = overOf(dk, sex, layers[k], M).covers;
      for (let v = 0; v < cov.length; v++) cov[v] |= c[v];
    }
    M.hidden = allCovered(M.tris, cov);
  });
  return { bodyHidden: allCovered(dk.bodyTris, bodyCover), layers };
}

/**
 * Move a triangle's corners out along the surface's normal at a hit so that the surface there moves by d: each corner
 * by its barycentric weight over the sum of their squares.
 */
function liftTriangle(P: Float32Array, T: ArrayLike<number>, h: Hit, d: number, moved: Float32Array): void {
  const k = d / (h.u * h.u + h.v * h.v + h.w * h.w);
  const ws = [h.u, h.v, h.w];
  for (let c = 0; c < 3; c++) {
    const i = T[h.tri * 3 + c];
    const m = ws[c] * k;
    P[i * 3] += h.nx * m;
    P[i * 3 + 1] += h.ny * m;
    P[i * 3 + 2] += h.nz * m;
    moved[i] += m;
  }
}

/**
 * The points of a surface (vertices and normals) that lie just under a garment without being hidden by it (near its
 * edges, or not covered), away from its edges and facing the way it does: they may come up through it.
 */
function pokesUnder(pos: Float32Array, normals: Float32Array, n: number, covered: Uint8Array, garment: Surface, gTris: Uint16Array, edgeAll: Float32Array): Pokes {
  const h = newHit();
  const verts: number[] = [];
  const tris: number[] = [];
  for (let v = 0; v < n; v++) {
    if (covered[v]) continue;
    if (!garment.nearest(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], REACH * 0.75, h)) continue;
    if (h.signed > 0.02 || normals[v * 3] * h.nx + normals[v * 3 + 1] * h.ny + normals[v * 3 + 2] * h.nz < 0.3) continue;
    const e = edgeAll[gTris[h.tri * 3]] * h.u + edgeAll[gTris[h.tri * 3 + 1]] * h.v + edgeAll[gTris[h.tri * 3 + 2]] * h.w;
    if (e < 0.01) continue;
    verts.push(v);
    tris.push(h.tri);
  }
  return { verts: Uint32Array.from(verts), tris: Uint32Array.from(tris) };
}

function allCovered(T: Uint16Array, cov: Uint8Array): Uint8Array {
  const out = new Uint8Array(T.length / 3);
  for (let t = 0; t < out.length; t++) out[t] = cov[T[t * 3]] & cov[T[t * 3 + 1]] & cov[T[t * 3 + 2]];
  return out;
}

/**
 * Work out ahead of time how each garment lies on the typical body of each sex (what dressing someone in it first
 * would otherwise take): one garment a step, so it can be done a little at a time when the page is idle. Returns
 * whether there is more to do.
 */
export function prepareStep(dk: DressKit): boolean {
  for (const sex of ['F', 'M'] as const) {
    for (const [key, p] of dk.proxies) {
      if (!key.startsWith('clothes.')) continue;
      const id = key.slice('clothes.'.length);
      if (dk.lies.has(`${sex}|${id}`)) continue;
      lieOf(dk, sex, id, p, proxyTriangles(p));
      return true;
    }
  }
  return false;
}

/** How a garment lies on the typical body of a sex: fitted, lifted off the skin, where it meets the skin, what it covers. */
function lieOf(dk: DressKit, sex: Sex, id: string, p: ProxyData, tris: Uint16Array): Lie {
  const key = `${sex}|${id}`;
  let lie = dk.lies.get(key);
  if (lie) return lie;
  const { body, skin } = canon(dk, sex);
  const pos = new Float32Array(p.count * 3);
  fitProxy(p, body, pos);
  const h = newHit();
  const skinStart = new Int32Array(p.count).fill(-1);
  const moved = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    if (!skin.nearest(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], REACH * 1.5, h)) continue;
    skinStart[i] = h.tri;
    if (h.signed >= CLEAR_SKIN || RIGID(id)) continue;
    const d = CLEAR_SKIN - h.signed;
    pos[i * 3] += h.nx * d;
    pos[i * 3 + 1] += h.ny * d;
    pos[i * 3 + 2] += h.nz * d;
    moved[i] = d;
  }
  smoothMoves({ id, proxy: p, pos, tris, hidden: new Uint8Array(0), rank: 0 }, moved);
  const surf = new Surface(pos, tris, REACH);
  // A waistband hugs the waist and does not lift as the hem of a top or a skirt can, so what is tucked in under it is
  // hidden right up to it: the edges counted from are all but the top edge of a skirt, trousers or shorts.
  const edge = edgeDistance(pos, tris, p.count, BOTTOMS.has(id) ? topEdge(pos, tris, p.count) : undefined);
  const edgeAll = BOTTOMS.has(id) ? edgeDistance(pos, tris, p.count) : edge;
  const covers = coverage(body.pos, skin.normals, dk.nVerts, surf, edge, tris);
  fillIslands(covers, (dk.bodyNb ??= neighbours(dk.bodyTris, dk.nVerts)), closeTo(surf, body.pos));
  // The hands and the face are always drawn: a cuff over the back of the hand lifts as the wrist bends.
  const shown = (dk.alwaysShown ??= alwaysShown(dk.kit));
  for (let v = 0; v < covers.length; v++) if (shown[v]) covers[v] = 0;
  const pokes = pokesUnder(body.pos, skin.normals, dk.nVerts, covers, surf, tris, edgeAll);
  lie = { pos, surf, edge, edgeAll, skinStart, covers, pokes };
  dk.lies.set(key, lie);
  return lie;
}

/** How outer lies over inner on the typical body of a sex: which outer vertices are near which inner triangles, what it covers. */
function overOf(dk: DressKit, sex: Sex, outer: Layer, inner: Layer): Over {
  const key = `${sex}|${outer.id}>${inner.id}`;
  let o = dk.overs.get(key);
  if (o) return o;
  const a = lieOf(dk, sex, outer.id, outer.proxy, outer.tris);
  const b = lieOf(dk, sex, inner.id, inner.proxy, inner.tris);
  // The outer garment lifted off the inner one (as dressing does), then which of its vertices lie near it.
  const pos = a.pos.slice();
  const h = newHit();
  const moved = new Float32Array(outer.proxy.count);
  const verts: number[] = [];
  const tris: number[] = [];
  for (let i = 0; i < outer.proxy.count; i++) {
    if (!b.surf.nearest(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], REACH * 1.5, h)) continue;
    verts.push(i);
    tris.push(h.tri);
    if (h.signed >= CLEAR_CLOTH || h.dist > REACH || RIGID(outer.id)) continue;
    const d = CLEAR_CLOTH - h.signed;
    pos[i * 3] += h.nx * d;
    pos[i * 3 + 1] += h.ny * d;
    pos[i * 3 + 2] += h.nz * d;
    moved[i] = d;
  }
  smoothMoves({ id: outer.id, proxy: outer.proxy, pos, tris: outer.tris, hidden: new Uint8Array(0), rank: 0 }, moved);
  const surf = new Surface(pos, outer.tris, REACH);
  const covers = coverage(b.pos, b.surf.normals, inner.proxy.count, surf, a.edge, outer.tris);
  fillIslands(covers, neighbours(inner.tris, inner.proxy.count), closeTo(surf, b.pos));
  const pokes = pokesUnder(b.pos, b.surf.normals, inner.proxy.count, covers, surf, outer.tris, a.edgeAll);
  o = { verts: Uint16Array.from(verts), tris: Uint32Array.from(tris), covers, pokes };
  dk.overs.set(key, o);
  return o;
}

/** The body's vertices the hands and the face carry (by the bone that carries each most): never hidden under clothes. */
function alwaysShown(kit: Kit): Uint8Array {
  const keep = new Set(kit.boneNames.map((n, i) => (/^(hand|f\d\d)[LR]$|^(jaw|eye[LR]|lid[LR])$/.test(n) ? i : -1)).filter((i) => i >= 0));
  const out = new Uint8Array(kit.vertices);
  for (let v = 0; v < kit.vertices; v++) {
    let best = 0;
    let bone = -1;
    for (let j = 0; j < 4; j++) {
      if (kit.skinWeight[v * 4 + j] > best) {
        best = kit.skinWeight[v * 4 + j];
        bone = kit.skinIndex[v * 4 + j];
      }
    }
    if (keep.has(bone)) out[v] = 1;
  }
  return out;
}

/** Each vertex's neighbours along the mesh's edges (CSR). */
function neighbours(T: ArrayLike<number>, n: number): Adjacency {
  const sets: Array<Set<number>> = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < T.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      sets[T[t + k]].add(T[t + ((k + 1) % 3)]);
      sets[T[t + ((k + 1) % 3)]].add(T[t + k]);
    }
  }
  const start = new Uint32Array(n + 1);
  for (let v = 0; v < n; v++) start[v + 1] = start[v] + sets[v].size;
  const items = new Uint32Array(start[n]);
  for (let v = 0; v < n; v++) items.set([...sets[v]], start[v]);
  return { start, items };
}

/**
 * A small patch left uncovered with covered all round it, every point of it close under the garment, lies under the
 * garment too (a hollow such as the armpit, where the rays from the skin pass between the sleeve and the body of a
 * shirt): it is covered. Patches that open onto the rest of the body (the neck above a collar, the legs below a hem, a
 * hand out of a sleeve) are large or reach out from under the garment, and stay as they are.
 */
function fillIslands(cov: Uint8Array, nb: Adjacency, under: (v: number) => boolean, most = 600): void {
  const n = cov.length;
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  const patch: number[] = [];
  for (let s = 0; s < n; s++) {
    if (cov[s] || seen[s] || nb.start[s] === nb.start[s + 1]) continue;
    patch.length = 0;
    stack.push(s);
    seen[s] = 1;
    let touches = false;
    while (stack.length) {
      const v = stack.pop()!;
      patch.push(v);
      for (let k = nb.start[v]; k < nb.start[v + 1]; k++) {
        const w = nb.items[k];
        if (cov[w]) {
          touches = true;
          continue;
        }
        if (!seen[w]) {
          seen[w] = 1;
          stack.push(w);
        }
      }
    }
    if (touches && patch.length <= most && patch.every(under)) for (const v of patch) cov[v] = 1;
  }
}

/** Whether a point lies within a few centimetres of a garment (for fillIslands). */
function closeTo(garment: Surface, pos: Float32Array): (v: number) => boolean {
  const h = newHit();
  return (v) => garment.nearest(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], 0.045, h);
}

/**
 * Which of a surface's vertices lie well under a garment: a ray out along the vertex's normal meets the garment close
 * above it, at a place on the garment far enough from its edges. The ray starts a little below the vertex, so a bump
 * that comes up through the garment between its vertices (a garment's triangles are larger than the body's) is
 * covered too.
 */
function coverage(pos: Float32Array, normals: Float32Array, n: number, garment: Surface, edge: Float32Array, gTris: Uint16Array): Uint8Array {
  const out = new Uint8Array(n);
  const h = newHit();
  const back = 0.012;
  for (let v = 0; v < n; v++) {
    const nx = normals[v * 3];
    const ny = normals[v * 3 + 1];
    const nz = normals[v * 3 + 2];
    if (!garment.ray(pos[v * 3] - nx * back, pos[v * 3 + 1] - ny * back, pos[v * 3 + 2] - nz * back, nx, ny, nz, UNDER + back, h)) continue;
    const far = edge[gTris[h.tri * 3]] * h.u + edge[gTris[h.tri * 3 + 1]] * h.v + edge[gTris[h.tri * 3 + 2]] * h.w;
    if (far >= EDGE) out[v] = 1;
  }
  return out;
}

/** Spread each vertex's lift a little to its neighbours, so a garment lifted over another rises smoothly, not in spikes. */
function smoothMoves(L: Layer, moved: Float32Array): void {
  const n = L.proxy.count;
  let any = false;
  for (let i = 0; i < n; i++) if (moved[i] > 0) any = true;
  if (!any) return;
  const T = L.tris;
  const P = L.pos;
  const nrm = vertexNormals(P, T);
  let cur = moved;
  for (let it = 0; it < 2; it++) {
    const sum = new Float32Array(n);
    const cnt = new Uint16Array(n);
    for (let t = 0; t < T.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = T[t + k];
        const b = T[t + ((k + 1) % 3)];
        sum[a] += cur[b];
        cnt[a]++;
        sum[b] += cur[a];
        cnt[b]++;
      }
    }
    const next = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const avg = cnt[i] ? sum[i] / cnt[i] : 0;
      // Only ever further out: a neighbour's lift carries over at half strength.
      next[i] = Math.max(cur[i], avg * 0.5);
    }
    for (let i = 0; i < n; i++) {
      const extra = next[i] - cur[i];
      if (extra <= 0) continue;
      P[i * 3] += nrm[i * 3] * extra;
      P[i * 3 + 1] += nrm[i * 3 + 1] * extra;
      P[i * 3 + 2] += nrm[i * 3 + 2] * extra;
    }
    cur = next;
  }
}

/** The open edges of a mesh: each vertex on one, which of them are joined along it (edges only one triangle uses). */
function openEdges(T: Uint16Array, n: number): number[][] {
  const use = new Map<number, number>();
  const key = (a: number, b: number) => (a < b ? a * 65536 + b : b * 65536 + a);
  for (let t = 0; t < T.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const kk = key(T[t + k], T[t + ((k + 1) % 3)]);
      use.set(kk, (use.get(kk) ?? 0) + 1);
    }
  }
  const nb: number[][] = Array.from({ length: n }, () => []);
  for (const [kk, c] of use) {
    if (c !== 1) continue;
    const a = Math.floor(kk / 65536);
    const b = kk % 65536;
    nb[a].push(b);
    nb[b].push(a);
  }
  return nb;
}

/** The vertices of a garment's highest open edge (the waistband of a skirt or trousers). */
export function topEdge(P: Float32Array, T: Uint16Array, n: number): Set<number> {
  const nb = openEdges(T, n);
  const seen = new Uint8Array(n);
  let best: number[] = [];
  let bestY = -Infinity;
  for (let s = 0; s < n; s++) {
    if (seen[s] || !nb[s].length) continue;
    const loop: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const v = stack.pop()!;
      loop.push(v);
      for (const w of nb[v]) {
        if (!seen[w]) {
          seen[w] = 1;
          stack.push(w);
        }
      }
    }
    let y = 0;
    for (const v of loop) y += P[v * 3 + 1];
    y /= loop.length;
    if (loop.length > 8 && y > bestY) {
      bestY = y;
      best = loop;
    }
  }
  return new Set(best);
}

/**
 * How far each vertex lies from the mesh's open edges, along its edges (Dijkstra from every vertex on a boundary: an
 * edge only one triangle uses), not counting the edge vertices in skip.
 */
export function edgeDistance(P: Float32Array, T: Uint16Array, n: number, skip?: Set<number>): Float32Array {
  const edgeUse = new Map<number, number>();
  const key = (a: number, b: number) => (a < b ? a * 65536 + b : b * 65536 + a);
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let t = 0; t < T.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = T[t + k];
      const b = T[t + ((k + 1) % 3)];
      const kk = key(a, b);
      const c = edgeUse.get(kk) ?? 0;
      edgeUse.set(kk, c + 1);
      if (!c) {
        adj[a].push(b);
        adj[b].push(a);
      }
    }
  }
  const dist = new Float32Array(n).fill(Infinity);
  const heap: Array<[number, number]> = [];
  const push = (d: number, v: number) => {
    heap.push([d, v]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  for (const [kk, c] of edgeUse) {
    if (c !== 1) continue;
    const a = Math.floor(kk / 65536);
    const b = kk % 65536;
    for (const v of [a, b]) {
      if (skip?.has(v)) continue;
      if (dist[v] !== 0) {
        dist[v] = 0;
        push(0, v);
      }
    }
  }
  while (heap.length) {
    const [d, v] = pop();
    if (d > dist[v]) continue;
    for (const w of adj[v]) {
      const nd = d + Math.hypot(P[w * 3] - P[v * 3], P[w * 3 + 1] - P[v * 3 + 1], P[w * 3 + 2] - P[v * 3 + 2]);
      if (nd < dist[w]) {
        dist[w] = nd;
        push(nd, w);
      }
    }
  }
  return dist;
}
