// The worlds saved from the Community Builder: a .sce file each (src/sim/plan/
// sce.ts) in data/worlds/ (COMMUNITY_DATA_DIR), named after the world. The
// world's id, inside the file, is its key: saving a world again replaces its
// file, under its new name if it was renamed. Anything else in the folder (a
// Scelo project dropped there, a half-written file) is left alone and not
// listed.

import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readWorld, slugify, worldSceText, SCE_EXTENSION } from '../sim/plan/sce';
import type { WorldPlan } from '../sim/plan/types';
import { validatePlan } from '../sim/plan/validate';

export interface SavedWorld {
  id: string;
  name: string;
  /** The file in the worlds folder. */
  file: string;
  updated_at: number;
  bytes: number;
  /** A few counts for the list (buildings, houses, cities, settlements, errors, where it began). */
  summary: Record<string, unknown>;
}

function folder(): string {
  const dir = join(process.env.COMMUNITY_DATA_DIR ?? join(process.cwd(), 'data'), 'worlds');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Read once per change of a file: its world's identity and counts. */
const seen = new Map<string, { mtimeMs: number; size: number; info: SavedWorld | null }>();

function summarise(plan: WorldPlan): Record<string, unknown> {
  const houses = plan.buildings.filter((b) => b.asset.startsWith('house')).length;
  const errors = validatePlan(plan).filter((i) => i.level === 'error').length;
  return { buildings: plan.buildings.length, houses, cities: plan.cities.length, settlements: plan.settlements.length, errors, origin: plan.meta?.origin ?? null };
}

/** Every world in the folder, newest first (where two files hold one world, the newer stands for it). */
function scan(): SavedWorld[] {
  const dir = folder();
  const files = readdirSync(dir).filter((f) => f.endsWith(SCE_EXTENSION));
  for (const f of [...seen.keys()]) if (!files.includes(f)) seen.delete(f);
  const byId = new Map<string, SavedWorld>();
  for (const file of files) {
    let st;
    try {
      st = statSync(join(dir, file));
    } catch {
      continue;
    }
    let s = seen.get(file);
    if (!s || s.mtimeMs !== st.mtimeMs || s.size !== st.size) {
      let info: SavedWorld | null = null;
      try {
        const { plan, savedAt } = readWorld(readFileSync(join(dir, file), 'utf8'));
        const at = savedAt ? Date.parse(savedAt) : NaN;
        if (plan.id) info = { id: plan.id, name: String(plan.name ?? plan.id), file, updated_at: Number.isFinite(at) ? at : st.mtimeMs, bytes: st.size, summary: summarise(plan) };
      } catch {
        /* not a world */
      }
      s = { mtimeMs: st.mtimeMs, size: st.size, info };
      seen.set(file, s);
    }
    const info = s.info;
    if (info && !(byId.get(info.id)?.updated_at! >= info.updated_at)) byId.set(info.id, info);
  }
  return [...byId.values()].sort((a, b) => b.updated_at - a.updated_at);
}

export function listWorlds(): SavedWorld[] {
  return scan().slice(0, 200);
}

export function getWorld(id: string): WorldPlan | null {
  const hit = scan().find((w) => w.id === id);
  if (!hit) return null;
  try {
    return readWorld(readFileSync(join(folder(), hit.file), 'utf8')).plan;
  } catch {
    return null;
  }
}

/** Save a world as its .sce file, written whole before it replaces the old one. */
export function putWorld(plan: WorldPlan, now = new Date()): SavedWorld {
  const dir = folder();
  const all = scan();
  const mine = all.find((w) => w.id === plan.id) ?? null;
  // Its own name, unless another world's file already has it.
  const stem = slugify(plan.name);
  const taken = new Set(readdirSync(dir).filter((f) => f !== mine?.file));
  let file = `${stem}${SCE_EXTENSION}`;
  for (let n = 2; taken.has(file); n++) file = `${stem}-${n}${SCE_EXTENSION}`;
  const text = worldSceText(plan, now.toISOString());
  const tmp = join(dir, `.${file}.${process.pid}.tmp`);
  writeFileSync(tmp, text);
  renameSync(tmp, join(dir, file));
  if (mine && mine.file !== file) {
    try {
      unlinkSync(join(dir, mine.file));
    } catch {
      /* already gone */
    }
  }
  const info: SavedWorld = { id: plan.id, name: String(plan.name ?? plan.id), file, updated_at: now.getTime(), bytes: Buffer.byteLength(text), summary: summarise(plan) };
  const st = statSync(join(dir, file));
  seen.set(file, { mtimeMs: st.mtimeMs, size: st.size, info });
  return info;
}

/** Delete a world's file (the one that stands for it in the list). */
export function deleteWorld(id: string): boolean {
  const hit = scan().find((w) => w.id === id);
  if (!hit) return false;
  try {
    unlinkSync(join(folder(), hit.file));
    seen.delete(hit.file);
    return true;
  } catch {
    return false;
  }
}
