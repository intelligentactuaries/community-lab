// A world saved as a .sce file: the project file of the Scelo family
// (Scelo IDE's apps/web projectFile.ts, the TUI's export/sce.ts). One JSON
// document behind Scelo's magic header and version:
//
//   format   "scelo-project", version 1, app "Community Lab", savedAt
//   project  { id, name, createdAt }: the world's identity
//   session  what Scelo restores: the world's buildings as its dataset, one row
//            each (nothing filtered, fitted or run)
//   world    what Community Lab opens: the plan itself (types.ts)
//
// So a world saved here opens in Scelo as data, and opens here as the world;
// every reader in the family ignores the keys it does not know. A .sce that
// Scelo saved holds a session but no world, and is refused with a word on
// where to open it.

import { ASSET } from './assets';
import { PLAN_FORMAT, type WorldPlan } from './types';

export const SCE_MAGIC = 'scelo-project';
export const SCE_VERSION = 1;
export const SCE_EXTENSION = '.sce';
/** Scelo's MIME type for the file, so the OS can associate .sce with the family. */
export const SCE_MIME = 'application/vnd.scelo.project+json';
export const SCE_APP = 'Community Lab';
/** The wiring contract Scelo's sessions are saved under (sceloContext.tsx WIRES_VERSION): with no models, nothing to migrate. */
const SCE_WIRES_VERSION = 3;

type Cell = string | number | null;

export interface SceWorldFile {
  format: typeof SCE_MAGIC;
  version: number;
  app: string;
  savedAt: string;
  project: { id: string; name: string; createdAt: number } | null;
  session: {
    dataset: { name: string; columns: string[]; rows: Array<Record<string, Cell>> } | null;
    filters: unknown[];
    selectedModels: unknown[];
    domain: null;
    pickSummary: null;
    picksDatasetName: null;
    modelWires: unknown[];
    wiresVersion: number;
    runs: Record<string, unknown>;
    derivedColumns: Record<string, string>;
    transformLog: string[];
    events: unknown[];
    tables: unknown[];
  };
  world: WorldPlan;
}

/** Lowercase, filesystem-safe and never empty (Scelo's slugify: keep a–z, 0–9, _ and -, the rest a hyphen, at most 60). */
export function slugify(raw: string, fallback = 'world'): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || fallback;
}

/** The file name a world is saved under: its name, slugged, ending in .sce. */
export function worldFilename(plan: Pick<WorldPlan, 'name'>): string {
  return `${slugify(plan.name)}${SCE_EXTENSION}`;
}

export const DATASET_COLUMNS = ['id', 'kind', 'asset', 'name', 'settlement', 'city', 'tier', 'x_m', 'y_m', 'width_m', 'depth_m', 'door', 'plot'];

/** The world's buildings as a table, the dataset Scelo opens: where each stands, what it is, and whose it is. */
export function buildingsDataset(plan: WorldPlan): NonNullable<SceWorldFile['session']['dataset']> {
  const settlement = new Map(plan.settlements.map((s) => [s.id, s]));
  const city = new Map(plan.cities.map((c) => [c.id, c]));
  const rows = plan.buildings.map((b) => {
    const s = settlement.get(b.settlement);
    return {
      id: b.id,
      kind: ASSET[b.asset]?.label ?? b.asset,
      asset: b.asset,
      name: b.name,
      settlement: s?.name ?? b.settlement,
      city: (s && city.get(s.city)?.name) ?? null,
      tier: s?.tier ?? null,
      x_m: b.x,
      y_m: b.y,
      width_m: b.w,
      depth_m: b.h,
      door: b.facing ?? null,
      plot: b.plot ?? null,
    };
  });
  return { name: `${plan.name} buildings`, columns: [...DATASET_COLUMNS], rows };
}

/** The .sce document for a world. `savedAt` is stamped by the caller (it has the clock). */
export function buildWorldSce(plan: WorldPlan, savedAt: string): SceWorldFile {
  const created = Date.parse(plan.meta?.createdAt ?? '');
  return {
    format: SCE_MAGIC,
    version: SCE_VERSION,
    app: SCE_APP,
    savedAt,
    project: { id: plan.id, name: plan.name, createdAt: Number.isFinite(created) ? created : Date.parse(savedAt) },
    session: {
      dataset: buildingsDataset(plan),
      filters: [],
      selectedModels: [],
      domain: null,
      pickSummary: null,
      picksDatasetName: null,
      modelWires: [],
      wiresVersion: SCE_WIRES_VERSION,
      runs: {},
      derivedColumns: {},
      transformLog: [],
      events: [],
      tables: [],
    },
    world: plan,
  };
}

/** The text of a world's .sce file (compact JSON, as every .sce is written). */
export function worldSceText(plan: WorldPlan, savedAt: string): string {
  return JSON.stringify(buildWorldSce(plan, savedAt));
}

export interface OpenedWorld {
  plan: WorldPlan;
  /** When the file was saved (null for a bare world). */
  savedAt: string | null;
  /** Which app of the family wrote it. */
  app: string | null;
}

/**
 * Read a world from a file's text: a .sce (the usual) or a bare world plan.
 * Throws an Error whose message can be shown as it is.
 */
export function readWorld(text: string): OpenedWorld {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("this file isn't valid JSON: it may be damaged, or not a .sce file");
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not a .sce file');
  const o = raw as Record<string, unknown>;
  if (o.format === PLAN_FORMAT) return { plan: checkWorld(o), savedAt: null, app: null };
  if (o.format !== SCE_MAGIC) throw new Error('not a .sce file: the scelo-project header is missing');
  if (typeof o.version !== 'number' || o.version > SCE_VERSION) {
    throw new Error(`this .sce was saved by a newer version (file v${String(o.version ?? '?')}; this lab reads up to v${SCE_VERSION})`);
  }
  const app = typeof o.app === 'string' ? o.app : null;
  if (o.world == null) throw new Error(`this .sce is a Scelo project${app && app !== SCE_APP ? ` saved by ${app}` : ''} (a dataset and its analysis), not a Community Lab world: open it in Scelo`);
  const plan = checkWorld(o.world);
  const project = o.project as { id?: unknown } | null | undefined;
  if (!plan.id && typeof project?.id === 'string') plan.id = project.id;
  return { plan, savedAt: typeof o.savedAt === 'string' ? o.savedAt : null, app };
}

function checkWorld(w: unknown): WorldPlan {
  const p = w as Partial<WorldPlan> | null;
  if (!p || typeof p !== 'object' || p.format !== PLAN_FORMAT) throw new Error(`the world in this file is not a ${PLAN_FORMAT} world (it may be from a newer Community Lab)`);
  if (!Array.isArray(p.buildings) || !Array.isArray(p.roads) || !Array.isArray(p.settlements) || !Array.isArray(p.cities)) throw new Error('the world in this file is damaged: its buildings, roads, settlements or cities are missing');
  return p as WorldPlan;
}
