// A triangle surface for the questions dressing asks of it: the nearest point
// on it to a point (and which side of it the point lies), and where a short
// ray first meets it. Triangles are binned in a uniform grid of cells a few
// centimetres across, so a query looks at the few triangles near it.

export interface Hit {
  /** The triangle, the point on it, its barycentric weights. */
  tri: number;
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
  w: number;
  /** Distance to it, and along the surface's normal there (positive outside, the side its triangles face). */
  dist: number;
  signed: number;
  /** The surface's normal there (interpolated, unit). */
  nx: number;
  ny: number;
  nz: number;
}

export function newHit(): Hit {
  return { tri: -1, x: 0, y: 0, z: 0, u: 0, v: 0, w: 0, dist: Infinity, signed: 0, nx: 0, ny: 0, nz: 0 };
}

export class Surface {
  readonly pos: Float32Array;
  readonly tris: ArrayLike<number>;
  /** Per vertex, the smooth normal (area-weighted). */
  readonly normals: Float32Array;
  private cell: number;
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private nx = 1;
  private ny = 1;
  private nz = 1;
  private start: Uint32Array;
  private items: Uint32Array;
  private stamp: Uint32Array;
  private gen = 0;

  /**
   * pos: xyz per vertex; tris: vertex index triples; keep: which triangles take part (all when unset);
   * cell: the grid's spacing (about the largest distance queries reach).
   */
  constructor(pos: Float32Array, tris: ArrayLike<number>, cell = 0.04, keep?: (t: number) => boolean) {
    this.pos = pos;
    this.tris = tris;
    this.cell = cell;
    const nt = tris.length / 3;
    this.normals = vertexNormals(pos, tris);
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    const used: number[] = [];
    for (let t = 0; t < nt; t++) {
      if (keep && !keep(t)) continue;
      used.push(t);
      for (let k = 0; k < 3; k++) {
        const i = tris[t * 3 + k] * 3;
        x0 = Math.min(x0, pos[i]);
        x1 = Math.max(x1, pos[i]);
        y0 = Math.min(y0, pos[i + 1]);
        y1 = Math.max(y1, pos[i + 1]);
        z0 = Math.min(z0, pos[i + 2]);
        z1 = Math.max(z1, pos[i + 2]);
      }
    }
    if (!used.length) {
      x0 = y0 = z0 = 0;
      x1 = y1 = z1 = 0;
    }
    this.ox = x0 - cell;
    this.oy = y0 - cell;
    this.oz = z0 - cell;
    this.nx = Math.max(1, Math.ceil((x1 - x0) / cell) + 2);
    this.ny = Math.max(1, Math.ceil((y1 - y0) / cell) + 2);
    this.nz = Math.max(1, Math.ceil((z1 - z0) / cell) + 2);
    const cells = this.nx * this.ny * this.nz;
    const count = new Uint32Array(cells + 1);
    // Each triangle's span of cells (its bounds), once.
    const box = new Int32Array(used.length * 6);
    for (let j = 0; j < used.length; j++) {
      const t = used[j];
      const a = tris[t * 3] * 3;
      const b = tris[t * 3 + 1] * 3;
      const cc = tris[t * 3 + 2] * 3;
      box[j * 6] = this.ix(Math.min(pos[a], pos[b], pos[cc]));
      box[j * 6 + 1] = this.ix(Math.max(pos[a], pos[b], pos[cc]));
      box[j * 6 + 2] = this.iy(Math.min(pos[a + 1], pos[b + 1], pos[cc + 1]));
      box[j * 6 + 3] = this.iy(Math.max(pos[a + 1], pos[b + 1], pos[cc + 1]));
      box[j * 6 + 4] = this.iz(Math.min(pos[a + 2], pos[b + 2], pos[cc + 2]));
      box[j * 6 + 5] = this.iz(Math.max(pos[a + 2], pos[b + 2], pos[cc + 2]));
    }
    const nx = this.nx;
    const nxy = this.nx * this.ny;
    for (let j = 0; j < used.length; j++) {
      for (let z = box[j * 6 + 4]; z <= box[j * 6 + 5]; z++) for (let y = box[j * 6 + 2]; y <= box[j * 6 + 3]; y++) for (let x = box[j * 6]; x <= box[j * 6 + 1]; x++) count[x + nx * y + nxy * z + 1]++;
    }
    for (let c = 0; c < cells; c++) count[c + 1] += count[c];
    this.start = count;
    const items = new Uint32Array(count[cells]);
    const fill = new Uint32Array(cells);
    for (let j = 0; j < used.length; j++) {
      const t = used[j];
      for (let z = box[j * 6 + 4]; z <= box[j * 6 + 5]; z++) {
        for (let y = box[j * 6 + 2]; y <= box[j * 6 + 3]; y++) {
          for (let x = box[j * 6]; x <= box[j * 6 + 1]; x++) {
            const c = x + nx * y + nxy * z;
            items[count[c] + fill[c]++] = t;
          }
        }
      }
    }
    this.items = items;
    this.stamp = new Uint32Array(nt);
  }

  /** Whether the box around a point (or a segment's box) reaches the grid at all. */
  private reaches(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    const c = this.cell;
    return x1 >= this.ox && y1 >= this.oy && z1 >= this.oz && x0 <= this.ox + this.nx * c && y0 <= this.oy + this.ny * c && z0 <= this.oz + this.nz * c;
  }

  private ix(x: number): number {
    return Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.ox) / this.cell)));
  }
  private iy(y: number): number {
    return Math.max(0, Math.min(this.ny - 1, Math.floor((y - this.oy) / this.cell)));
  }
  private iz(z: number): number {
    return Math.max(0, Math.min(this.nz - 1, Math.floor((z - this.oz) / this.cell)));
  }

  /**
   * The nearest point on the surface within maxDist of (x, y, z), into out; false when there is none. The cells are
   * searched in shells outward from the point's own, stopping once no unsearched cell can hold anything nearer.
   */
  nearest(x: number, y: number, z: number, maxDist: number, out: Hit): boolean {
    out.tri = -1;
    out.dist = maxDist;
    if (!this.reaches(x - maxDist, y - maxDist, z - maxDist, x + maxDist, y + maxDist, z + maxDist)) return false;
    const g = this.next();
    const c = this.cell;
    const fx = (x - this.ox) / c;
    const fy = (y - this.oy) / c;
    const fz = (z - this.oz) / c;
    const px = Math.floor(fx);
    const py = Math.floor(fy);
    const pz = Math.floor(fz);
    // How far the point is from its own cell's nearest face: the first shell reaches at least that far.
    const inner = Math.min(fx - px, px + 1 - fx, fy - py, py + 1 - fy, fz - pz, pz + 1 - fz) * c;
    const shells = Math.ceil(maxDist / c) + 1;
    const P = this.pos;
    const T = this.tris;
    let best = maxDist * maxDist;
    for (let r = 0; r <= shells; r++) {
      for (let dz = -r; dz <= r; dz++) {
        const cz = pz + dz;
        if (cz < 0 || cz >= this.nz) continue;
        for (let dy = -r; dy <= r; dy++) {
          const cy = py + dy;
          if (cy < 0 || cy >= this.ny) continue;
          const edge = Math.abs(dz) === r || Math.abs(dy) === r;
          for (let dx = -r; dx <= r; dx += edge ? 1 : 2 * r || 1) {
            const cx = px + dx;
            if (cx < 0 || cx >= this.nx) continue;
            const cell = cx + this.nx * (cy + this.ny * cz);
            for (let k = this.start[cell]; k < this.start[cell + 1]; k++) {
              const t = this.items[k];
              if (this.stamp[t] === g) continue;
              this.stamp[t] = g;
              const a = T[t * 3] * 3;
              const b = T[t * 3 + 1] * 3;
              const cc = T[t * 3 + 2] * 3;
              const d2 = closestOnTriangle(x, y, z, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[cc], P[cc + 1], P[cc + 2], BC);
              if (d2 < best) {
                best = d2;
                out.tri = t;
                out.u = BC[0];
                out.v = BC[1];
                out.w = BC[2];
              }
            }
          }
        }
      }
      // Everything within inner + r cells has been seen.
      const seen = inner + r * c;
      if (best <= seen * seen) break;
    }
    if (out.tri < 0) return false;
    this.finish(x, y, z, out);
    out.dist = Math.sqrt(best);
    return true;
  }

  /**
   * Where the segment from (ox, oy, oz) along the unit direction (dx, dy, dz) for up to maxDist first meets the
   * surface (either side of a triangle), into out (dist is the distance along the ray); false when it does not.
   */
  ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, out: Hit): boolean {
    out.tri = -1;
    const ex = ox + dx * maxDist;
    const ey = oy + dy * maxDist;
    const ez = oz + dz * maxDist;
    if (!this.reaches(Math.min(ox, ex), Math.min(oy, ey), Math.min(oz, ez), Math.max(ox, ex), Math.max(oy, ey), Math.max(oz, ez))) return false;
    const g = this.next();
    const P = this.pos;
    const T = this.tris;
    const c = this.cell;
    // Where the segment enters the grid (it may start outside it).
    let t0 = 0;
    let t1 = maxDist;
    const slab = (o: number, d: number, lo: number, hi: number): boolean => {
      if (Math.abs(d) < 1e-12) return o >= lo && o <= hi;
      let a = (lo - o) / d;
      let b = (hi - o) / d;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      return t0 <= t1;
    };
    if (!slab(ox, dx, this.ox, this.ox + this.nx * c) || !slab(oy, dy, this.oy, this.oy + this.ny * c) || !slab(oz, dz, this.oz, this.oz + this.nz * c)) return false;
    let best = maxDist;
    // Walk the cells the segment passes through, in order (Amanatides and Woo): a hit inside the cell being searched
    // cannot be bettered by a later cell.
    const ex0 = ox + dx * t0;
    const ey0 = oy + dy * t0;
    const ez0 = oz + dz * t0;
    let cx = this.ix(ex0);
    let cy = this.iy(ey0);
    let cz = this.iz(ez0);
    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const sz = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    let tx = sx ? ((cx + (sx > 0 ? 1 : 0)) * c + this.ox - ox) / dx : Infinity;
    let ty = sy ? ((cy + (sy > 0 ? 1 : 0)) * c + this.oy - oy) / dy : Infinity;
    let tz = sz ? ((cz + (sz > 0 ? 1 : 0)) * c + this.oz - oz) / dz : Infinity;
    const dtx = sx ? c / Math.abs(dx) : Infinity;
    const dty = sy ? c / Math.abs(dy) : Infinity;
    const dtz = sz ? c / Math.abs(dz) : Infinity;
    for (let steps = 0; steps < 256; steps++) {
      const cellExit = Math.min(tx, ty, tz);
      const cell = cx + this.nx * (cy + this.ny * cz);
      for (let k = this.start[cell]; k < this.start[cell + 1]; k++) {
        const t = this.items[k];
        if (this.stamp[t] === g) continue;
        this.stamp[t] = g;
        const a = T[t * 3] * 3;
        const b = T[t * 3 + 1] * 3;
        const cc = T[t * 3 + 2] * 3;
        const e1x = P[b] - P[a];
        const e1y = P[b + 1] - P[a + 1];
        const e1z = P[b + 2] - P[a + 2];
        const e2x = P[cc] - P[a];
        const e2y = P[cc + 1] - P[a + 1];
        const e2z = P[cc + 2] - P[a + 2];
        const hx = dy * e2z - dz * e2y;
        const hy = dz * e2x - dx * e2z;
        const hz = dx * e2y - dy * e2x;
        const det = e1x * hx + e1y * hy + e1z * hz;
        if (Math.abs(det) < 1e-12) continue;
        const f = 1 / det;
        const wx = ox - P[a];
        const wy = oy - P[a + 1];
        const wz = oz - P[a + 2];
        const u = f * (wx * hx + wy * hy + wz * hz);
        if (u < 0 || u > 1) continue;
        const qx = wy * e1z - wz * e1y;
        const qy = wz * e1x - wx * e1z;
        const qz = wx * e1y - wy * e1x;
        const v = f * (dx * qx + dy * qy + dz * qz);
        if (v < 0 || u + v > 1) continue;
        const tt = f * (e2x * qx + e2y * qy + e2z * qz);
        if (tt < 0 || tt >= best) continue;
        best = tt;
        out.tri = t;
        out.u = 1 - u - v;
        out.v = u;
        out.w = v;
      }
      if (best <= cellExit || cellExit > t1) break;
      if (tx <= ty && tx <= tz) {
        cx += sx;
        tx += dtx;
        if (cx < 0 || cx >= this.nx) break;
      } else if (ty <= tz) {
        cy += sy;
        ty += dty;
        if (cy < 0 || cy >= this.ny) break;
      } else {
        cz += sz;
        tz += dtz;
        if (cz < 0 || cz >= this.nz) break;
      }
    }
    if (out.tri < 0) return false;
    this.finish(ox + dx * best, oy + dy * best, oz + dz * best, out);
    out.dist = best;
    return true;
  }

  /** The hit's point, interpolated normal and the signed distance of (x, y, z) from it. */
  private finish(x: number, y: number, z: number, out: Hit): void {
    const P = this.pos;
    const N = this.normals;
    const T = this.tris;
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
  }

  private next(): number {
    this.gen = (this.gen + 1) >>> 0;
    if (this.gen === 0) {
      this.stamp.fill(0);
      this.gen = 1;
    }
    return this.gen;
  }
}

const BC = new Float64Array(3);

/** Squared distance from p to the triangle abc, its closest point's barycentric weights into bc (Ericson's method). */
export function closestOnTriangle(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, bc: Float64Array): number {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let u: number;
  let v: number;
  let w: number;
  if (d1 <= 0 && d2 <= 0) {
    u = 1;
    v = 0;
    w = 0;
  } else {
    const bpx = px - bx;
    const bpy = py - by;
    const bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) {
      u = 0;
      v = 1;
      w = 0;
    } else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const t = d1 / (d1 - d3);
        u = 1 - t;
        v = t;
        w = 0;
      } else {
        const cpx = px - cx;
        const cpy = py - cy;
        const cpz = pz - cz;
        const d5 = abx * cpx + aby * cpy + abz * cpz;
        const d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) {
          u = 0;
          v = 0;
          w = 1;
        } else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const t = d2 / (d2 - d6);
            u = 1 - t;
            v = 0;
            w = t;
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
              u = 0;
              v = 1 - t;
              w = t;
            } else {
              const den = 1 / (va + vb + vc);
              v = vb * den;
              w = vc * den;
              u = 1 - v - w;
            }
          }
        }
      }
    }
  }
  bc[0] = u;
  bc[1] = v;
  bc[2] = w;
  const qx = ax * u + bx * v + cx * w - px;
  const qy = ay * u + by * v + cy * w - py;
  const qz = az * u + bz * v + cz * w - pz;
  return qx * qx + qy * qy + qz * qz;
}

/** Smooth vertex normals of a triangle mesh (area-weighted face normals). */
export function vertexNormals(pos: Float32Array, tris: ArrayLike<number>): Float32Array {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3;
    const b = tris[t + 1] * 3;
    const c = tris[t + 2] * 3;
    const ux = pos[b] - pos[a];
    const uy = pos[b + 1] - pos[a + 1];
    const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a];
    const vy = pos[c + 1] - pos[a + 1];
    const vz = pos[c + 2] - pos[a + 2];
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      n[i] += fx;
      n[i + 1] += fy;
      n[i + 2] += fz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}
