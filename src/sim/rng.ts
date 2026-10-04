// Deterministic pseudo-random numbers with NAMED STREAMS.
//
// Every stochastic submodel (mortality, fertility, movement, weather, ...)
// draws from its own stream derived from the master seed. This is the
// "common random numbers" variance-reduction technique actuaries use in
// stochastic projections: changing the fertility assumption does not disturb
// the sequence of mortality draws, so two scenarios differ only where the
// assumption differs. The generator is xoshiro128** (Blackman & Vigna 2018)
// seeded through splitmix32; the same (seed, stream) pair replays the same
// sequence on any platform (Bun, browser main thread, Web Worker).

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

/** FNV-1a 32-bit hash of a string; used to fold stream names into the seed. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Any string or number becomes a 32-bit master seed (stable, printable). */
export function normaliseSeed(seed: string | number): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) return Math.floor(seed) >>> 0;
  const s = String(seed).trim();
  if (/^-?\d+$/.test(s)) return Number(s) >>> 0;
  return hash32(s);
}

export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  readonly name: string;

  constructor(seed: number, name = 'main') {
    const sm = splitmix32((seed ^ hash32(name)) >>> 0);
    this.s0 = sm();
    this.s1 = sm();
    this.s2 = sm();
    this.s3 = sm();
    // xoshiro must never be in the all-zero state.
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
    this.name = name;
  }

  /** Uniform in [0, 1). */
  next(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = this.s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Uniform in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  bernoulli(p: number): boolean {
    return this.next() < p;
  }

  /** Standard normal via Box-Muller (one value per call, no caching so the
   *  sequence stays replayable regardless of call interleaving). */
  normal(mu = 0, sigma = 1): number {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Normal clipped to [lo, hi]. */
  clippedNormal(mu: number, sigma: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, this.normal(mu, sigma)));
  }

  /** Exponential with the given rate (mean 1/rate). */
  exponential(rate: number): number {
    let u = 0;
    while (u === 0) u = this.next();
    return -Math.log(u) / rate;
  }

  /** Poisson count via Knuth for small means, normal approximation above 50. */
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda > 50) return Math.max(0, Math.round(this.normal(lambda, Math.sqrt(lambda))));
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > L);
    return k - 1;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  /** Weighted pick over [value, weight] pairs. */
  weighted<T>(pairs: ReadonlyArray<readonly [T, number]>): T {
    let total = 0;
    for (const [, w] of pairs) total += Math.max(0, w);
    if (total <= 0) return pairs[pairs.length - 1][0];
    let r = this.next() * total;
    for (const [v, w] of pairs) {
      r -= Math.max(0, w);
      if (r <= 0) return v;
    }
    return pairs[pairs.length - 1][0];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Snapshot of the internal state so a run can be resumed exactly. */
  state(): [number, number, number, number] {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  restore(st: [number, number, number, number]): void {
    [this.s0, this.s1, this.s2, this.s3] = st;
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** A bundle of named streams sharing one master seed. */
export class RngStreams {
  readonly seed: number;
  private streams = new Map<string, Rng>();
  constructor(seed: string | number) {
    this.seed = normaliseSeed(seed);
  }
  stream(name: string): Rng {
    let r = this.streams.get(name);
    if (!r) {
      r = new Rng(this.seed, name);
      this.streams.set(name, r);
    }
    return r;
  }
  names(): string[] {
    return [...this.streams.keys()];
  }
}
