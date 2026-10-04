// Financial mathematics — the theory of interest as the actuarial notation has
// it. Everything is a function of an effective annual rate i and a term n:
//
//   v = 1 / (1 + i)              the discount factor
//   d = 1 − v = i·v              the rate of discount (interest paid in advance)
//   δ = ln(1 + i)                the force of interest (continuous)
//   i⁽ᵐ⁾ = m·((1 + i)^(1/m) − 1) the nominal rate convertible m times a year
//   aₙ| = (1 − vⁿ) / i           an annuity-certain of 1 a year in arrear
//   äₙ| = (1 − vⁿ) / d           ...in advance
//   sₙ| = ((1 + i)ⁿ − 1) / i     the accumulation of the same payments
//   (Ia)ₙ| = (äₙ| − n·vⁿ) / i    an increasing annuity 1, 2, …, n
//
// Money is in rand; time in years unless a function says months. The
// province's rates come from its own economy (the Reserve Bank's repo rate,
// the Mutual Bank's deposit and lending rates, the treasury-bill rate) and
// its inflation from the CPI the books produce.

/** The rates that describe one effective annual rate i. */
export interface RateSet {
  i: number;
  v: number;
  d: number;
  delta: number;
  /** Nominal rates convertible monthly, i⁽¹²⁾ and d⁽¹²⁾. */
  i12: number;
  d12: number;
  /** The effective monthly rate, (1 + i)^(1/12) − 1. */
  monthly: number;
}

export function rateSet(i: number): RateSet {
  const v = 1 / (1 + i);
  const monthly = Math.pow(1 + i, 1 / 12) - 1;
  return {
    i,
    v,
    d: 1 - v,
    delta: Math.log(1 + i),
    i12: 12 * monthly,
    d12: 12 * (1 - Math.pow(v, 1 / 12)),
    monthly,
  };
}

/** Accumulation of an amount over t years at i: (1 + i)^t. */
export function accumulate(amount: number, i: number, t: number): number {
  return amount * Math.pow(1 + i, t);
}

/** Present value of an amount due in t years at i: v^t. */
export function pv(amount: number, i: number, t: number): number {
  return amount * Math.pow(1 + i, -t);
}

/** The annuity-certain values for a term of n years at i (n may be fractional; i may be 0). */
export interface AnnuityCertain {
  n: number;
  /** aₙ| in arrear, äₙ| in advance. */
  a: number;
  aDue: number;
  /** sₙ| and s̈ₙ|: the same payments accumulated to the end of the term. */
  s: number;
  sDue: number;
  /** (Ia)ₙ|: payments 1, 2, …, n in arrear. */
  Ia: number;
  /** a⁽¹²⁾ₙ|: monthly payments of 1/12 in arrear. */
  a12: number;
  /** āₙ|: paid continuously. */
  aBar: number;
}

export function annuityCertain(i: number, n: number): AnnuityCertain {
  if (n <= 0) return { n, a: 0, aDue: 0, s: 0, sDue: 0, Ia: 0, a12: 0, aBar: 0 };
  if (Math.abs(i) < 1e-12) return { n, a: n, aDue: n, s: n, sDue: n, Ia: (n * (n + 1)) / 2, a12: n, aBar: n };
  const r = rateSet(i);
  const vn = Math.pow(r.v, n);
  const a = (1 - vn) / i;
  const aDue = (1 - vn) / r.d;
  const acc = Math.pow(1 + i, n);
  return { n, a, aDue, s: (acc - 1) / i, sDue: (acc - 1) / r.d, Ia: (aDue - n * vn) / i, a12: (1 - vn) / r.i12, aBar: (1 - vn) / r.delta };
}

/** Fisher: the real rate r from a nominal i and inflation π, (1 + i) = (1 + r)(1 + π). */
export function realRate(i: number, inflation: number): number {
  return (1 + i) / (1 + inflation) - 1;
}

/** A dated cash flow: t in years from now, amount positive for money received. */
export interface CashFlow {
  t: number;
  amount: number;
  label?: string;
}

/** The equation of value: Σ CFₜ·vᵗ at rate i. */
export function presentValue(flows: CashFlow[], i: number): number {
  return flows.reduce((s, f) => s + f.amount * Math.pow(1 + i, -f.t), 0);
}

/** The accumulated value at time T of the flows before it: Σ CFₜ·(1 + i)^(T − t). */
export function accumulatedValue(flows: CashFlow[], i: number, T: number): number {
  return flows.filter((f) => f.t <= T).reduce((s, f) => s + f.amount * Math.pow(1 + i, T - f.t), 0);
}

/**
 * The yield (internal rate of return) that makes the equation of value balance,
 * by bisection on [−0.99, 10]; null when the flows never change sign or no
 * root lies in the range.
 */
export function yieldRate(flows: CashFlow[], lo = -0.99, hi = 10): number | null {
  const hasIn = flows.some((f) => f.amount > 0);
  const hasOut = flows.some((f) => f.amount < 0);
  if (!hasIn || !hasOut) return null;
  let fLo = presentValue(flows, lo);
  const fHi = presentValue(flows, hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || Math.sign(fLo) === Math.sign(fHi)) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const fMid = presentValue(flows, mid);
    if (Math.abs(fMid) < 1e-9 || hi - lo < 1e-12) return mid;
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid;
      fLo = fMid;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Macaulay and modified duration of a set of flows at rate i (the sensitivity of their value to the rate). */
export function duration(flows: CashFlow[], i: number): { macaulay: number; modified: number; pv: number } {
  const P = presentValue(flows, i);
  if (P === 0) return { macaulay: 0, modified: 0, pv: 0 };
  const mac = flows.reduce((s, f) => s + f.t * f.amount * Math.pow(1 + i, -f.t), 0) / P;
  return { macaulay: mac, modified: mac / (1 + i), pv: P };
}

/** One line of a loan schedule (level instalments, interest in arrear). */
export interface ScheduleRow {
  k: number;
  opening: number;
  interest: number;
  capital: number;
  instalment: number;
  closing: number;
}

/** A level-instalment loan of L over n periods at the period rate j: the instalment L / aₙ| and the schedule. */
export function loanSchedule(L: number, j: number, n: number): { instalment: number; rows: ScheduleRow[]; totalInterest: number } {
  const inst = j === 0 ? L / n : L / annuityCertain(j, n).a;
  const rows: ScheduleRow[] = [];
  let bal = L;
  let totalInterest = 0;
  for (let k = 1; k <= n; k++) {
    const interest = bal * j;
    const capital = Math.min(bal, inst - interest);
    const closing = Math.max(0, bal - capital);
    rows.push({ k, opening: bal, interest, capital, instalment: inst, closing });
    totalInterest += interest;
    bal = closing;
  }
  return { instalment: inst, rows, totalInterest };
}

/**
 * The accumulation of a regular saving: c a year (paid monthly in arrear,
 * growing at g a year) at a return of i for n years — the fund at the end,
 * and its path year by year. Contributions in year k are c(1 + g)^(k−1).
 */
export function savingsPath(c: number, g: number, i: number, n: number): Array<{ year: number; contribution: number; fund: number }> {
  const out: Array<{ year: number; contribution: number; fund: number }> = [];
  let fund = 0;
  const jm = Math.pow(1 + i, 1 / 12) - 1;
  for (let k = 1; k <= n; k++) {
    const yearly = c * Math.pow(1 + g, k - 1);
    const m = yearly / 12;
    for (let mo = 0; mo < 12; mo++) fund = fund * (1 + jm) + m;
    out.push({ year: k, contribution: yearly, fund });
  }
  return out;
}
