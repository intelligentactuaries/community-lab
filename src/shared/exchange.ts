// Community Lab's data contract: the shapes of what leaves the province (its
// exports and experiment results) and of what may be put to it from outside
// (a parameter patch, a mortality basis, timed shocks, an experiment). One
// module, read by the browser bundle, the Bun server and its workers alike,
// so no two ends of a wire can disagree about a shape.
//
// The format is the open `scelo.exchange/1`: files Community Lab writes are
// plain tables with a data dictionary and their provenance (seed, basis
// hash, what was changed from the defaults, the simulated span), and
// synthetic experience carries the TRUE basis it was generated on, the
// answer key a fitted table can be scored against. Scelo IDE reads the same
// format, so an export can go straight into its pipeline, but nothing here
// needs Scelo: the format is a file layout, not a dependency.
//
//   exports       CommunityExport: tables (name, columns, rows of number /
//                 string / null) + provenance + optional true basis
//   inputs        ParamPatch, MortalityOverride, Shock (validated against
//                 the engine's own ranges before anything is rebuilt)
//   experiments   ExperimentSpec -> ExperimentResult: paired Monte Carlo,
//                 every arm on the baseline's seeds (common random numbers),
//                 per-metric distributions and paired effects with 95%
//                 intervals
//
// No imports, and nothing here throws: every parser returns the value or a
// list of reasons.

export const EXCHANGE_SCHEMA = "scelo.exchange/1" as const;
export const EXCHANGE_VERSION = 1;

export type ExchangeApp = "scelo" | "community-lab" | "swarm";
export type ExchangeCell = number | string | null;
export type ExchangeRow = Record<string, ExchangeCell>;

/** Where a payload came from — enough to reproduce it. */
export interface Provenance {
  app: ExchangeApp;
  appVersion: string;
  /** ISO-8601 time the payload was made. */
  createdAt: string;
  /** The simulated calendar span the data covers (ISO dates). */
  span?: { from: string; to: string };
  seed?: string;
  /** Number of seeds pooled (Monte Carlo exports). */
  seeds?: number;
  /** Community Lab's fingerprint of the full parameter set (seed included). */
  basisHash?: string;
  /** The same without the seed and cosmetic fields: equal for every seed of one basis. */
  assumptionsHash?: string;
  /** Human label for the scenario. */
  scenario?: string;
  /** Parameters that differ from the app's defaults. */
  changed?: Record<string, unknown>;
  notes?: string[];
}

export interface ExchangeColumn {
  name: string;
  /** Plain-language meaning. */
  description: string;
  unit?: string;
}

/** A table on its way out: a plain dataset (name, columns, rows) plus a data dictionary. */
export interface ExchangeTable {
  /** Dataset name, and the file stem when it is saved. */
  name: string;
  title: string;
  description: string;
  columns: ExchangeColumn[];
  rows: ExchangeRow[];
}

/** One-year death probabilities by age and sex. */
export interface QxBySex {
  ages: number[];
  M: number[];
  F: number[];
}

/** The basis synthetic data was generated on — the answer key for a fit. */
export interface TrueBasis {
  label: string;
  source: string;
  /** Calendar year the table applies to. */
  baseYear: number;
  /** Annual improvement applied after baseYear: q(x, t) = q(x)·(1 − r)^(t − baseYear). */
  improvement: number;
  qx: QxBySex;
  /** What else moves one person's risk around the table (it averages out within each age band). */
  individualRisk?: string[];
}

export type ExportKind = "experience" | "person-years" | "model-points" | "macro" | "experiment" | "population";

/** What Community Lab exports: one or more tables with their provenance. */
export interface CommunityExport {
  schema: typeof EXCHANGE_SCHEMA;
  kind: "community.export";
  id: string;
  exportKind: ExportKind;
  title: string;
  /** One paragraph: what this is and what to do with it. */
  summary: string;
  provenance: Provenance;
  /** The first table is the primary dataset; the rest travel with it. */
  tables: ExchangeTable[];
  truth?: TrueBasis;
  headline?: Array<{ label: string; value: string }>;
}

/** A mortality basis for Community Lab to live under. */
export interface MortalityOverride {
  /** What it is: "Lee–Carter on unity-mortality-experience" */
  label: string;
  /** Where it came from: "fitted in R, lifecontingencies 1.3 · 2026-10-03" */
  source: string;
  ages: number[];
  /** By sex, or pooled — a pooled table keeps Community Lab's own sex differential around it. */
  qx: { M: number[]; F: number[] } | { pooled: number[] };
  /** Calendar year the table applies to; Community Lab's improvement runs on from there. */
  year?: number;
}

/** A timed shock. Months count from the start of the simulation (0 = the first month). */
export type Shock =
  | {
      kind: "mortality";
      label?: string;
      fromMonth: number;
      months: number;
      /** Multiplies every death hazard (table, illness, maternal) in the window. */
      factor: number;
      minAge?: number;
      maxAge?: number;
    }
  | {
      kind: "repo";
      label?: string;
      fromMonth: number;
      months: number;
      /** Added to the rate the Monetary Policy Committee sets, in basis points. */
      bp: number;
    }
  | {
      kind: "oil";
      label?: string;
      fromMonth: number;
      months: number;
      /** Multiplies the Brent crude price (and through it pump prices, fares and inflation). */
      factor: number;
    };

export type ParamValue = number | string | boolean | { [key: string]: ParamValue };
/** Parameter changes, keyed by Community Lab's ScenarioParams field names. */
export type ParamPatch = Record<string, ParamValue>;

/** From outside → Community Lab: rebuild the province on this (a basis, parameter values, timed shocks). */
export interface CommunityDirective {
  schema: typeof EXCHANGE_SCHEMA;
  kind: "community.directive";
  id: string;
  label: string;
  from: Provenance;
  params?: ParamPatch;
  mortality?: MortalityOverride;
  shocks?: Shock[];
  /** Where Community Lab should land: the province, or its experiment lab with this as an arm. */
  open?: "province" | "experiment";
}

// ─── experiments ──────────────────────────────────────────────────────────

export interface ExperimentArm {
  /** Short id ("grant-up"); "baseline" is reserved. */
  id: string;
  label: string;
  params?: ParamPatch;
  mortality?: MortalityOverride;
  shocks?: Shock[];
}

export type Audience = "actuarial" | "government" | "social";

export interface ExperimentSpec {
  title: string;
  /** The question the comparison answers, in the asker's words. */
  question?: string;
  audience?: Audience;
  /** The province every arm starts from (a patch on Community Lab's defaults)… */
  base?: ParamPatch;
  /** …living on this basis, unless an arm brings its own (a province already living on a supplied basis). */
  baseMortality?: MortalityOverride;
  /** …under these shocks, before an arm's own. */
  baseShocks?: Shock[];
  /** Compared with the baseline: the base with no further change. */
  arms: ExperimentArm[];
  seeds: number;
  years: number;
  from?: Provenance;
}

export type MetricGroup = "demography" | "health" | "insurance" | "economy" | "fiscal" | "equity" | "justice";

export interface MetricDef {
  id: string;
  label: string;
  unit: string;
  /** Which direction is an improvement (for "better in k of n seeds"). */
  better: "higher" | "lower" | "neutral";
  group: MetricGroup;
  description: string;
}

export interface Distribution {
  mean: number;
  sd: number;
  p5: number;
  p50: number;
  p95: number;
  n: number;
}

/** Arm − baseline on the same seeds. */
export interface PairedEffect {
  mean: number;
  /** 95% interval for the mean difference (Student t on the paired differences). */
  lo: number;
  hi: number;
  n: number;
  /** Share of seeds in which the arm did better than the baseline; null for a neutral metric. */
  better: number | null;
}

export interface ArmResult {
  id: string;
  label: string;
  metrics: Record<string, Distribution>;
  /** null for the baseline itself. */
  effects: Record<string, PairedEffect> | null;
}

export interface ExperimentResult {
  schema: typeof EXCHANGE_SCHEMA;
  kind: "community.experiment";
  id: string;
  spec: ExperimentSpec;
  metrics: MetricDef[];
  /** arms[0] is the baseline. */
  arms: ArmResult[];
  /** One row per seed × arm: `seed`, `arm`, then one column per metric. */
  rows: ExchangeRow[];
  provenance: Provenance;
  elapsedMs: number;
}

// ─── limits ──────────────────────────────────────────────────────────────

/** The most rows one exported table carries (Scelo's import cap, so an export always fits it). */
export const MAX_EXCHANGE_ROWS = 250_000;
export const MAX_EXCHANGE_COLUMNS = 200;
export const MAX_EXPERIMENT_SEEDS = 64;
export const MAX_EXPERIMENT_YEARS = 40;
export const MAX_EXPERIMENT_ARMS = 6;
export const MAX_SHOCKS = 12;
/**
 * The most simulated province-years one job may ask for: seeds × years × runs per seed (an experiment's baseline
 * and arms; 1 for a pooled export). A province-year is a few seconds of one core, so this keeps the longest job to
 * about ten minutes on a laptop's worker pool — 16 seeds × 10 years × 5 arms, or 64 seeds × 12 years.
 */
export const MAX_SEED_YEARS = 800;

/** Province-years a job costs, for the budget above. */
export function seedYears(seeds: number, years: number, runsPerSeed = 1): number {
  return seeds * years * runsPerSeed;
}

// ─── validation ──────────────────────────────────────────────────────────
//
// Everything that crosses a frame or a socket is checked here before anyone
// acts on it: a message is untrusted until it parses. Each parser returns the
// value or a list of reasons, never throws.

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown, max = 2_000): x is string => typeof x === "string" && x.length <= max;
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function checkProvenance(x: unknown, where: string, errors: string[]): void {
  if (!isObj(x)) {
    errors.push(`${where}: provenance missing`);
    return;
  }
  if (x.app !== "scelo" && x.app !== "community-lab" && x.app !== "swarm") errors.push(`${where}.app: unknown app`);
  if (!isStr(x.appVersion, 64)) errors.push(`${where}.appVersion: not a string`);
  if (!isStr(x.createdAt, 64)) errors.push(`${where}.createdAt: not a string`);
}

function checkTable(t: unknown, where: string, errors: string[]): void {
  if (!isObj(t)) {
    errors.push(`${where}: not an object`);
    return;
  }
  if (!isStr(t.name, 200) || !t.name) errors.push(`${where}.name: missing`);
  if (!isStr(t.title, 400)) errors.push(`${where}.title: missing`);
  if (!isStr(t.description, 8_000)) errors.push(`${where}.description: missing`);
  if (!Array.isArray(t.columns) || t.columns.length === 0) {
    errors.push(`${where}.columns: missing`);
    return;
  }
  if (t.columns.length > MAX_EXCHANGE_COLUMNS) errors.push(`${where}.columns: more than ${MAX_EXCHANGE_COLUMNS}`);
  const names = new Set<string>();
  for (const c of t.columns) {
    if (!isObj(c) || !isStr(c.name, 200) || !c.name) {
      errors.push(`${where}.columns: a column without a name`);
      return;
    }
    if (names.has(c.name)) errors.push(`${where}.columns: duplicate "${c.name}"`);
    names.add(c.name);
  }
  if (!Array.isArray(t.rows)) {
    errors.push(`${where}.rows: missing`);
    return;
  }
  if (t.rows.length > MAX_EXCHANGE_ROWS) errors.push(`${where}.rows: more than ${MAX_EXCHANGE_ROWS}`);
  // Every cell of every row: a number (finite), a string or null — nothing else
  // is written out. Stop at the first bad row; the message names it.
  for (let i = 0; i < t.rows.length; i++) {
    const r = t.rows[i];
    if (!isObj(r)) {
      errors.push(`${where}.rows[${i}]: not an object`);
      return;
    }
    for (const k in r) {
      const v = r[k];
      if (v === null || (typeof v === "string" && v.length <= 10_000) || isNum(v)) continue;
      errors.push(`${where}.rows[${i}].${k}: not a number, string or null`);
      return;
    }
  }
}

function checkQx(ages: unknown, arrs: unknown[], where: string, errors: string[]): void {
  if (!Array.isArray(ages) || ages.length < 2 || ages.length > 131 || !ages.every(isNum)) {
    errors.push(`${where}.ages: 2 to 131 numeric ages expected`);
    return;
  }
  for (let i = 1; i < ages.length; i++) {
    if ((ages[i] as number) <= (ages[i - 1] as number)) {
      errors.push(`${where}.ages: not increasing`);
      return;
    }
  }
  for (const a of arrs) {
    if (!Array.isArray(a) || a.length !== ages.length) {
      errors.push(`${where}: one q per age expected`);
      return;
    }
    if (!a.every((q) => isNum(q) && q >= 0 && q <= 1)) {
      errors.push(`${where}: every q must lie in [0, 1]`);
      return;
    }
  }
}

function checkMortality(m: unknown, where: string, errors: string[]): void {
  if (!isObj(m)) {
    errors.push(`${where}: not an object`);
    return;
  }
  if (!isStr(m.label, 400) || !m.label) errors.push(`${where}.label: missing`);
  if (!isStr(m.source, 400)) errors.push(`${where}.source: missing`);
  if (m.year !== undefined && !(isNum(m.year) && m.year >= 1900 && m.year <= 2200)) errors.push(`${where}.year: out of range`);
  if (!isObj(m.qx)) {
    errors.push(`${where}.qx: missing`);
    return;
  }
  if ("pooled" in m.qx) checkQx(m.ages, [m.qx.pooled], `${where}.qx`, errors);
  else checkQx(m.ages, [m.qx.M, m.qx.F], `${where}.qx`, errors);
}

function checkShock(s: unknown, where: string, errors: string[]): void {
  if (!isObj(s)) {
    errors.push(`${where}: not an object`);
    return;
  }
  if (!(isNum(s.fromMonth) && s.fromMonth >= 0 && s.fromMonth <= MAX_EXPERIMENT_YEARS * 12)) errors.push(`${where}.fromMonth: out of range`);
  if (!(isNum(s.months) && s.months >= 1 && s.months <= MAX_EXPERIMENT_YEARS * 12)) errors.push(`${where}.months: 1 to ${MAX_EXPERIMENT_YEARS * 12}`);
  if (s.label !== undefined && !isStr(s.label, 200)) errors.push(`${where}.label: not a string`);
  switch (s.kind) {
    case "mortality":
      if (!(isNum(s.factor) && s.factor >= 0 && s.factor <= 20)) errors.push(`${where}.factor: 0 to 20`);
      if (s.minAge !== undefined && !(isNum(s.minAge) && s.minAge >= 0 && s.minAge <= 110)) errors.push(`${where}.minAge: 0 to 110`);
      if (s.maxAge !== undefined && !(isNum(s.maxAge) && s.maxAge >= 0 && s.maxAge <= 110)) errors.push(`${where}.maxAge: 0 to 110`);
      break;
    case "repo":
      if (!(isNum(s.bp) && Math.abs(s.bp) <= 2_000)) errors.push(`${where}.bp: within ±2,000`);
      break;
    case "oil":
      if (!(isNum(s.factor) && s.factor > 0 && s.factor <= 10)) errors.push(`${where}.factor: above 0, at most 10`);
      break;
    default:
      errors.push(`${where}.kind: unknown shock`);
  }
}

function checkParams(p: unknown, where: string, errors: string[], depth = 0): void {
  if (!isObj(p)) {
    errors.push(`${where}: not an object`);
    return;
  }
  if (depth > 3) {
    errors.push(`${where}: nested too deep`);
    return;
  }
  for (const [k, v] of Object.entries(p)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") {
      errors.push(`${where}.${k}: not allowed`);
      continue;
    }
    if (isNum(v) || typeof v === "boolean" || isStr(v, 400)) continue;
    if (isObj(v)) checkParams(v, `${where}.${k}`, errors, depth + 1);
    else errors.push(`${where}.${k}: not a number, string, boolean or object`);
  }
}

export function parseCommunityExport(x: unknown): Parsed<CommunityExport> {
  const errors: string[] = [];
  if (!isObj(x)) return { ok: false, errors: ["export: not an object"] };
  if (x.schema !== EXCHANGE_SCHEMA) errors.push(`export.schema: expected ${EXCHANGE_SCHEMA}`);
  if (x.kind !== "community.export") errors.push("export.kind: expected community.export");
  if (!isStr(x.id, 200) || !x.id) errors.push("export.id: missing");
  if (!["experience", "person-years", "model-points", "macro", "experiment", "population"].includes(x.exportKind as string)) errors.push("export.exportKind: unknown");
  if (!isStr(x.title, 400)) errors.push("export.title: missing");
  if (!isStr(x.summary, 8_000)) errors.push("export.summary: missing");
  checkProvenance(x.provenance, "export.provenance", errors);
  if (!Array.isArray(x.tables) || x.tables.length === 0) errors.push("export.tables: at least one table");
  else x.tables.forEach((t, i) => checkTable(t, `export.tables[${i}]`, errors));
  if (x.truth !== undefined) {
    const t = x.truth;
    if (!isObj(t) || !isObj(t.qx)) errors.push("export.truth: malformed");
    else checkQx(t.qx.ages, [t.qx.M, t.qx.F], "export.truth.qx", errors);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: x as unknown as CommunityExport };
}

export function parseDirective(x: unknown): Parsed<CommunityDirective> {
  const errors: string[] = [];
  if (!isObj(x)) return { ok: false, errors: ["directive: not an object"] };
  if (x.schema !== EXCHANGE_SCHEMA) errors.push(`directive.schema: expected ${EXCHANGE_SCHEMA}`);
  if (x.kind !== "community.directive") errors.push("directive.kind: expected community.directive");
  if (!isStr(x.id, 200) || !x.id) errors.push("directive.id: missing");
  if (!isStr(x.label, 400) || !x.label) errors.push("directive.label: missing");
  checkProvenance(x.from, "directive.from", errors);
  if (x.params !== undefined) checkParams(x.params, "directive.params", errors);
  if (x.mortality !== undefined) checkMortality(x.mortality, "directive.mortality", errors);
  if (x.shocks !== undefined) {
    if (!Array.isArray(x.shocks) || x.shocks.length > MAX_SHOCKS) errors.push(`directive.shocks: at most ${MAX_SHOCKS}`);
    else x.shocks.forEach((s, i) => checkShock(s, `directive.shocks[${i}]`, errors));
  }
  if (x.open !== undefined && x.open !== "province" && x.open !== "experiment") errors.push("directive.open: province or experiment");
  if (x.params === undefined && x.mortality === undefined && x.shocks === undefined) errors.push("directive: nothing to apply");
  return errors.length ? { ok: false, errors } : { ok: true, value: x as unknown as CommunityDirective };
}

export function parseExperimentSpec(x: unknown): Parsed<ExperimentSpec> {
  const errors: string[] = [];
  if (!isObj(x)) return { ok: false, errors: ["spec: not an object"] };
  if (!isStr(x.title, 400) || !x.title) errors.push("spec.title: missing");
  if (x.question !== undefined && !isStr(x.question, 4_000)) errors.push("spec.question: not a string");
  if (x.audience !== undefined && !["actuarial", "government", "social"].includes(x.audience as string)) errors.push("spec.audience: unknown");
  if (x.base !== undefined) checkParams(x.base, "spec.base", errors);
  if (x.baseMortality !== undefined) checkMortality(x.baseMortality, "spec.baseMortality", errors);
  if (x.baseShocks !== undefined) {
    if (!Array.isArray(x.baseShocks) || x.baseShocks.length > MAX_SHOCKS) errors.push(`spec.baseShocks: at most ${MAX_SHOCKS}`);
    else x.baseShocks.forEach((s, i) => checkShock(s, `spec.baseShocks[${i}]`, errors));
  }
  if (!(isNum(x.seeds) && Number.isInteger(x.seeds) && x.seeds >= 2 && x.seeds <= MAX_EXPERIMENT_SEEDS)) errors.push(`spec.seeds: 2 to ${MAX_EXPERIMENT_SEEDS}`);
  if (!(isNum(x.years) && x.years >= 1 && x.years <= MAX_EXPERIMENT_YEARS)) errors.push(`spec.years: 1 to ${MAX_EXPERIMENT_YEARS}`);
  if (!Array.isArray(x.arms) || x.arms.length === 0 || x.arms.length > MAX_EXPERIMENT_ARMS) errors.push(`spec.arms: 1 to ${MAX_EXPERIMENT_ARMS}`);
  else {
    const ids = new Set<string>();
    x.arms.forEach((a, i) => {
      const w = `spec.arms[${i}]`;
      if (!isObj(a)) {
        errors.push(`${w}: not an object`);
        return;
      }
      if (!isStr(a.id, 64) || !/^[a-z0-9][a-z0-9-]*$/.test(a.id) || a.id === "baseline") errors.push(`${w}.id: lower-case words joined by hyphens, not "baseline"`);
      else if (ids.has(a.id)) errors.push(`${w}.id: duplicate`);
      else ids.add(a.id);
      if (!isStr(a.label, 200) || !a.label) errors.push(`${w}.label: missing`);
      if (a.params !== undefined) checkParams(a.params, `${w}.params`, errors);
      if (a.mortality !== undefined) checkMortality(a.mortality, `${w}.mortality`, errors);
      if (a.shocks !== undefined) {
        if (!Array.isArray(a.shocks) || a.shocks.length > MAX_SHOCKS) errors.push(`${w}.shocks: at most ${MAX_SHOCKS}`);
        else a.shocks.forEach((s, j) => checkShock(s, `${w}.shocks[${j}]`, errors));
      }
      if (a.params === undefined && a.mortality === undefined && a.shocks === undefined) errors.push(`${w}: changes nothing`);
    });
  }
  if (!errors.length) {
    const cost = seedYears(x.seeds as number, x.years as number, (x.arms as unknown[]).length + 1);
    if (cost > MAX_SEED_YEARS) errors.push(`spec: ${cost.toLocaleString("en-GB")} province-years (seeds × years × runs); at most ${MAX_SEED_YEARS} — fewer seeds, years or arms`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: x as unknown as ExperimentSpec };
}

// ─── conversions ─────────────────────────────────────────────────────────

/** RFC 4180 CSV of a table (header row first; numbers as JavaScript prints them). */
export function tableCsv(t: ExchangeTable): string {
  const cols = t.columns.map((c) => c.name);
  const cell = (v: ExchangeCell): string => {
    if (v === null) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map((c) => cell(c)).join(",")];
  for (const r of t.rows) lines.push(cols.map((c) => cell(r[c] ?? null)).join(","));
  return `${lines.join("\n")}\n`;
}

/** The README that travels with an export saved to disk: what it is, where it came from, every column. */
export function exportReadme(e: CommunityExport): string {
  const p = e.provenance;
  const out: string[] = [`# ${e.title}`, "", e.summary, "", "## Provenance", ""];
  out.push(`- Made by ${p.app} ${p.appVersion} on ${p.createdAt}`);
  if (p.span) out.push(`- Simulated span: ${p.span.from} to ${p.span.to}`);
  if (p.seed) out.push(`- Seed: \`${p.seed}\``);
  if (p.seeds) out.push(`- Seeds pooled: ${p.seeds}`);
  if (p.basisHash) out.push(`- Basis hash: \`${p.basisHash}\``);
  if (p.assumptionsHash) out.push(`- Assumptions hash (seed excluded): \`${p.assumptionsHash}\``);
  if (p.scenario) out.push(`- Scenario: ${p.scenario}`);
  if (p.changed && Object.keys(p.changed).length) out.push(`- Changed from the defaults: \`${JSON.stringify(p.changed)}\``);
  for (const n of p.notes ?? []) out.push(`- ${n}`);
  if (e.headline?.length) {
    out.push("", "## Headline", "");
    for (const h of e.headline) out.push(`- ${h.label}: ${h.value}`);
  }
  if (e.truth) {
    const t = e.truth;
    out.push(
      "",
      "## The true basis",
      "",
      `The data was generated on **${t.label}** (${t.source}), for ${t.baseYear} with ${(t.improvement * 100).toFixed(2)}% a year improvement after it. It is in \`truth.json\`: compare a fitted table with it.`,
    );
    for (const r of t.individualRisk ?? []) out.push(`- ${r}`);
  }
  for (const t of e.tables) {
    out.push("", `## ${t.title} (\`${t.name}.csv\`, ${t.rows.length.toLocaleString("en-GB")} rows)`, "", t.description, "", "| column | meaning | unit |", "|---|---|---|");
    for (const c of t.columns) out.push(`| \`${c.name}\` | ${c.description.replace(/\|/g, "\\|")} | ${c.unit ?? ""} |`);
  }
  return `${out.join("\n")}\n`;
}

// ─── statistics shared by the experiment engine and its readers ──────────

// Two-sided 97.5% Student t quantiles for 1–30 degrees of freedom.
const T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];

/** Student t 97.5% quantile (the 95% two-sided multiplier) for df degrees of freedom. */
export function t975(df: number): number {
  if (df < 1) return Number.NaN;
  if (df <= 30) return T975[Math.floor(df) - 1];
  // Beyond 30 the normal approximation with a first-order correction is within 0.1%.
  return 1.96 + 2.4 / df;
}

function quantileSorted(s: number[], q: number): number {
  if (!s.length) return Number.NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Mean, sd and the 5/50/95 percentiles of the finite values. */
export function distribution(values: number[]): Distribution {
  const v = values.filter(Number.isFinite);
  const n = v.length;
  if (!n) return { mean: Number.NaN, sd: Number.NaN, p5: Number.NaN, p50: Number.NaN, p95: Number.NaN, n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const s = [...v].sort((a, b) => a - b);
  return { mean, sd, p5: quantileSorted(s, 0.05), p50: quantileSorted(s, 0.5), p95: quantileSorted(s, 0.95), n };
}

/** Paired effect of an arm against the baseline, seed by seed (pairs with a non-finite side are dropped). */
export function pairedEffect(arm: number[], base: number[], better: MetricDef["better"]): PairedEffect {
  const d: number[] = [];
  let wins = 0;
  for (let i = 0; i < Math.min(arm.length, base.length); i++) {
    if (!Number.isFinite(arm[i]) || !Number.isFinite(base[i])) continue;
    const diff = arm[i] - base[i];
    d.push(diff);
    if ((better === "higher" && diff > 0) || (better === "lower" && diff < 0)) wins++;
  }
  const n = d.length;
  if (!n) return { mean: Number.NaN, lo: Number.NaN, hi: Number.NaN, n: 0, better: null };
  const mean = d.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const half = n > 1 ? t975(n - 1) * (sd / Math.sqrt(n)) : Number.NaN;
  return { mean, lo: mean - half, hi: mean + half, n, better: better === "neutral" ? null : wins / n };
}
