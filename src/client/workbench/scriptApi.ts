// The script runtime's contract: the messages between the workbench and the
// worker a script runs in (./scriptWorker.ts), and the declarations the
// editor reads to complete and check a script (SCRIPT_API_DTS). The two are
// kept side by side so a global cannot exist in one and not the other.

import type { PlotSpec, Row } from './workspace';

export type ToScript = { type: 'run'; code: string; path: string };

export type FromScript =
  | { type: 'log'; level: 'log' | 'info' | 'warn' | 'error'; text: string }
  | { type: 'table'; rows: Row[]; columns: string[] }
  | { type: 'plot'; spec: PlotSpec }
  | { type: 'progress'; key: string; label: string; done: number; total: number; finished?: boolean }
  /** A job the script started on the worker pool, so Stop can cancel it. */
  | { type: 'job'; id: string; kind: 'experiment' | 'export' | 'batch' }
  /** The script wrote a file: the explorer refreshes. */
  | { type: 'wrote'; path: string }
  | { type: 'done'; ms: number }
  | { type: 'failed'; error: string; line: number | null; col: number | null; stack: string | null };

/** The lines the worker puts before a script's own (the async wrapper's header and "use strict"), so an error's line
 *  number can be reported as the script's. Measured, not assumed: see scriptWorker.ts's lineOffset(). */
export const SCRIPT_PRELUDE = '"use strict";\n';

export const SCRIPT_API_DTS = `
/** Basis parameters (ScenarioParams), only the ones you change: e.g. { tfr: 1.6, ageProfile: 'ageing' }. */
type Basis = Record<string, number | string | boolean | Record<string, unknown>>;

/** A mortality table to live on: by sex, or pooled. Ages ascending; q in [0, 1]. */
interface MortalityTable {
  label: string;
  source: string;
  ages: number[];
  qx: { M: number[]; F: number[] } | { pooled: number[] };
  year?: number;
}

/** A timed shock; months count from the start of the simulation. */
type Shock =
  | { kind: 'mortality'; label?: string; fromMonth: number; months: number; factor: number; minAge?: number; maxAge?: number }
  | { kind: 'repo'; label?: string; fromMonth: number; months: number; bp: number }
  | { kind: 'oil'; label?: string; fromMonth: number; months: number; factor: number };

interface ProvinceOptions {
  /** Same seed and basis, same province (default "agincourt-12"). */
  seed?: string;
  basis?: Basis;
  /** A CSV in the workspace (age, qx_m, qx_f) or a table. */
  mortality?: string | MortalityTable;
  shocks?: Shock[];
}

interface PersonRow {
  id: string; name: string; sex: 'M' | 'F'; age: number;
  city: string; settlement: string; tier: string; household: string;
  education: string; job: string; income: number; marital: string;
  health: string; conditions: string[]; heritage: string | null; born_here: boolean;
}

interface HouseholdRow {
  id: string; name: string; city: string; settlement: string; tier: string;
  members: number; income: number; expenses: number; savings: number; debt: number;
  poor: boolean; funeral_cover: boolean; life_cover: boolean; medical_aid: boolean;
}

interface ExperienceRow {
  year: number; age: number; age_width: number; sex: 'M' | 'F'; group: string | null;
  person_years: number; deaths: number; expected_deaths: number; qx_basis: number;
}

interface EventRow { day: number; date: string; kind: string; severity: string; text: string }

interface Province {
  /** Live whole days (time-lapse, the same day-step pipeline as the IDE's province): about four seconds a year. */
  run(o: { years?: number; days?: number }): Province;
  /** The current simulated date, YYYY-MM-DD. */
  readonly date: string;
  /** Simulated years elapsed. */
  readonly years: number;
  /** The full basis the province was built on. */
  readonly basis: Record<string, any>;
  /** Fingerprint of the basis, seed included. */
  readonly basisHash: string;
  /** The lab's indicators for the run so far (see METRICS for each definition). */
  indicators(): Record<string, number>;
  /** Residents alive and living in the province. */
  people(): PersonRow[];
  /** Households that still exist. */
  households(): HouseholdRow[];
  /** Deaths, person-years and expected deaths by calendar year, age and sex, rebuilt person by person. */
  experience(o?: { ageWidth?: number; group?: 'none' | 'city' | 'settlement' | 'tier' }): ExperienceRow[];
  /** The event ledger (the most recent few thousand), optionally of one kind ('birth', 'death', 'wedding', ...). */
  events(kind?: string): EventRow[];
  /** The engine's own state. Read it; changing it is undefined behaviour. */
  readonly world: any;
}

interface MetricDef { id: string; label: string; unit: string; better: 'higher' | 'lower' | 'neutral'; group: string; description: string }
interface Distribution { mean: number; sd: number; p5: number; p50: number; p95: number; n: number }
interface PairedEffect { mean: number; lo: number; hi: number; n: number; better: number | null }
interface ExperimentArm { id: string; label: string; params?: Basis; mortality?: MortalityTable; shocks?: Shock[] }
interface ExperimentSpec {
  title: string; question?: string; audience?: 'actuarial' | 'government' | 'social';
  base?: Basis; baseMortality?: MortalityTable; baseShocks?: Shock[];
  arms: ExperimentArm[]; seeds: number; years: number;
}
interface ExperimentResult {
  id: string; spec: ExperimentSpec; metrics: MetricDef[];
  /** arms[0] is the baseline. */
  arms: Array<{ id: string; label: string; metrics: Record<string, Distribution>; effects: Record<string, PairedEffect> | null }>;
  rows: Array<Record<string, number | string | null>>;
  elapsedMs: number;
}
interface BatchSummary {
  rows: Array<Record<string, number | string | boolean | null>>;
  years: number; seeds: number; basisHash: string;
  percentiles: Record<string, { p5: number; p25: number; p50: number; p75: number; p95: number; mean: number }>;
  ruinProbability: number; pooledAe: number | null; pooledFertilityAe: number | null;
}
interface PooledExperience {
  rows: Array<{ year: number; age: number; sex: 'M' | 'F'; person_years: number; deaths: number; expected_deaths: number; qx_basis: number } & Record<string, any>>;
  headline: Array<{ label: string; value: string }>;
  /** The true basis the experience was generated on: the answer key. */
  truth: { label: string; source: string; baseYear: number; improvement: number; qx: { ages: number[]; M: number[]; F: number[] } };
  provenance: Record<string, any>;
}

/** Build a province of the script's own, in the script's worker. */
declare function province(options?: ProvinceOptions): Promise<Province>;
/** A paired experiment on the worker pool: the baseline and every arm on the same seeds. */
declare function experiment(spec: ExperimentSpec): Promise<ExperimentResult>;
/** One of the lab's ready-made experiments, for \`years\` (sam-life-stresses, pandemic-year, premium-adequacy, rate-shock, old-age-grant, child-grant, minimum-wage, oil-shock, funeral-cover-for-all, better-clinics, medical-aid). */
declare function template(id: string, years?: number): ExperimentSpec;
/** Seeds of one basis on the worker pool: percentiles of the outcomes, the probability of ruin, pooled A/E. */
declare function monteCarlo(o: { basis?: Basis; seeds?: number; years?: number }): Promise<BatchSummary>;
/** Mortality experience pooled over seeds of one basis, on the worker pool. */
declare function pooledExperience(o: { basis?: Basis; seeds?: number; years?: number; ageWidth?: 1 | 5; group?: 'none' | 'city' | 'settlement' | 'tier' }): Promise<PooledExperience>;
/** A line in the Console. */
declare function print(...values: unknown[]): void;
/** A table in the Console (columns default to the rows' keys). */
declare function table(rows: object[], columns?: string[]): void;
/** A line chart in the Console. x may be numbers or labels; a null in a series is a gap. */
declare function plot(o: { x: Array<number | string>; series: Record<string, Array<number | null>>; title?: string; xLabel?: string; yLabel?: string; log?: boolean }): void;
/** RFC 4180 CSV of rows. */
declare function csv(rows: object[], columns?: string[]): string;
/** A text file of this workspace. */
declare function readFile(path: string): Promise<string>;
/** Write a text file into this workspace (folders are made as needed). */
declare function writeFile(path: string, text: string): Promise<void>;
/** The lab's indicators and how each is defined. */
declare const METRICS: MetricDef[];
/** The default basis. */
declare const DEFAULT_BASIS: Record<string, any>;
/** The lab's ready-made experiments. */
declare const TEMPLATES: Array<{ id: string; audience: string; title: string; question: string }>;
`;
