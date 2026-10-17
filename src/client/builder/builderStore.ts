// The Community Builder's state: the plan being drawn, the tool in hand, what
// is selected, the builder's own camera, undo and redo, and the checks. Every
// edit goes through `commit`, which keeps the previous plan for undo (plans are
// never mutated, so the history shares everything an edit did not touch),
// lays the buildings out for the canvas and re-runs the checks a moment later.

import { useSyncExternalStore } from 'react';
import type { Facing } from '../../sim/layout/builders';
import { materialise } from '../../sim/plan/derive';
import type { Selection } from '../../sim/plan/edit';
import { planHash } from '../../sim/plan/hash';
import { readWorld, SCE_MIME, worldFilename, worldSceText } from '../../sim/plan/sce';
import { provincePlanHash } from '../../sim/plan/province';
import { TEMPLATES } from '../../sim/plan/templates';
import type { WorldPlan } from '../../sim/plan/types';
import { planStats, validatePlan, type Issue, type PlanStats } from '../../sim/plan/validate';
import type { Building } from '../../sim/types';
import { MIN_ZOOM, type Camera } from '../lib/camera';
import { store } from '../lib/simStore';

export type Tool = 'select' | 'pan' | 'place' | 'road' | 'street' | 'settlement' | 'city' | 'track' | 'erase' | 'prefab';
export type PrefabId = 'village' | 'civic' | 'airfield';

export interface SavedPlanInfo {
  id: string;
  name: string;
  /** Its .sce file in the lab's worlds folder (data/worlds/). */
  file: string;
  updated_at: number;
  bytes: number;
  summary: Record<string, unknown>;
}

const LS_DRAFT = 'community-lab:builder-draft:v1';
const LS_PREFS = 'community-lab:builder-prefs:v1';
const MAX_UNDO = 200;
/** The builder's own zoom range: wider than the map's, out to a whole large world and in to the furniture. */
const B_MIN_ZOOM = MIN_ZOOM * 0.5;
const B_MAX_ZOOM = 40;

interface Prefs {
  snap?: boolean;
  grid?: number;
  layers?: Partial<BuilderStore['layers']>;
}

function loadPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(LS_PREFS) ?? '{}') as Prefs;
  } catch {
    return {};
  }
}

class BuilderStore {
  /** Build mode is showing (the simulation waits, paused). */
  active = false;
  plan: WorldPlan | null = null;
  /** The plan's buildings laid out (rooms, doors), for the canvas and the checks. */
  built: Record<string, Building> = {};
  issues: Issue[] = [];
  stats: PlanStats | null = null;
  /** The plan's fingerprint when it was last saved ('' = never saved). */
  savedHash = '';
  saving = false;
  tool: Tool = 'select';
  /** The asset being placed, its door's side (null: toward the nearest road) and its options. */
  placing: { asset: string; facing: Facing | null; options: Record<string, string | number | boolean> } | null = null;
  prefab: PrefabId = 'village';
  street: { tier: 'small' | 'standard' | 'large'; sides: 'both' | 'left' | 'right' } = { tier: 'standard', sides: 'both' };
  roadWidth = 7;
  selection: Selection[] = [];
  /** Hovered thing on the canvas (for the status line and highlights). */
  hover: Selection | null = null;
  camera: Camera = { x: 800, y: 600, zoom: 0.5, tx: 800, ty: 600, tzoom: 0.5 };
  viewport = { w: 800, h: 600 };
  snap = true;
  /** Snap step in metres. */
  grid = 2;
  layers = { zones: true, labels: true, interiors: true, grid: true, issues: true };
  /** The plans dialog (new / open) and the run confirmation. */
  dialog: 'plans' | null = null;
  /** The right-hand panel's tab. */
  propsTab: 'inspect' | 'checks' | 'world' = 'inspect';
  notice: { text: string; tone: 'info' | 'error' | 'ok'; at: number } | null = null;
  savedPlans: SavedPlanInfo[] = [];
  private undoStack: WorldPlan[] = [];
  private redoStack: WorldPlan[] = [];
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  private version = 0;
  private listeners = new Set<() => void>();

  constructor() {
    const p = loadPrefs();
    if (typeof p.snap === 'boolean') this.snap = p.snap;
    if (typeof p.grid === 'number') this.grid = p.grid;
    if (p.layers) this.layers = { ...this.layers, ...p.layers };
  }

  // ── subscription ──
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = (): number => this.version;
  bump(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  get dirty(): boolean {
    return !!this.plan && planHash(this.plan) !== this.savedHash;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  say(text: string, tone: 'info' | 'error' | 'ok' = 'info'): void {
    const n = { text, tone, at: performance.now() };
    this.notice = n;
    this.bump();
    setTimeout(() => {
      if (this.notice === n) {
        this.notice = null;
        this.bump();
      }
    }, tone === 'error' ? 7000 : 4000);
  }

  // ── entering and leaving ──

  /** Open the builder: on a plan, else the draft left last time, else the running world (the province as a plan). */
  enter(plan?: WorldPlan): void {
    store.pause();
    this.active = true;
    if (plan) this.load(plan, '');
    else if (!this.plan) {
      const draft = this.loadDraft();
      if (draft) this.load(draft.plan, draft.savedHash);
      else this.dialog = 'plans';
    }
    this.refreshSaved();
    this.bump();
    store.bump();
  }

  /** Back to the simulation, the world it was running unchanged. */
  leave(): void {
    this.active = false;
    this.dialog = null;
    this.bump();
    store.bump();
  }

  /** Start drawing a plan (fresh history). */
  load(plan: WorldPlan, savedHash: string): void {
    this.plan = plan;
    this.savedHash = savedHash;
    this.undoStack = [];
    this.redoStack = [];
    this.selection = [];
    this.tool = 'select';
    this.placing = null;
    this.relayout(true);
    this.fit();
    this.bump();
  }

  newFromTemplate(id: string): void {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    this.load(t.make(), '');
    this.dialog = null;
    this.saveDraft();
    this.bump();
  }

  // ── editing ──

  /** Apply an edit: the old plan goes on the undo stack, the canvas and checks follow. */
  commit(next: WorldPlan, opts: { select?: Selection[] } = {}): void {
    if (!this.plan || next === this.plan) return;
    this.undoStack.push(this.plan);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.plan = next;
    if (opts.select) this.selection = opts.select;
    this.pruneSelection();
    this.relayout(false);
    this.scheduleDraft();
    this.bump();
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev || !this.plan) return;
    this.redoStack.push(this.plan);
    this.plan = prev;
    this.pruneSelection();
    this.relayout(false);
    this.scheduleDraft();
    this.bump();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next || !this.plan) return;
    this.undoStack.push(this.plan);
    this.plan = next;
    this.pruneSelection();
    this.relayout(false);
    this.scheduleDraft();
    this.bump();
  }

  private pruneSelection(): void {
    const p = this.plan;
    if (!p) return;
    this.selection = this.selection.filter((s) => {
      if (s.kind === 'building') return p.buildings.some((b) => b.id === s.id);
      if (s.kind === 'road') return s.index < p.roads.length;
      if (s.kind === 'settlement') return p.settlements.some((x) => x.id === s.id);
      if (s.kind === 'city') return p.cities.some((x) => x.id === s.id);
      return (p.track?.length ?? 0) > s.index;
    });
  }

  /** Lay the buildings out now; the checks follow a moment later (they take longer on a big world). */
  private relayout(now: boolean): void {
    if (!this.plan) return;
    try {
      this.built = materialise(this.plan);
    } catch (e) {
      this.say(`Could not lay out the plan: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
    this.stats = planStats(this.plan);
    if (this.checkTimer) clearTimeout(this.checkTimer);
    const run = () => {
      this.checkTimer = null;
      if (!this.plan) return;
      this.issues = validatePlan(this.plan, this.built);
      this.bump();
    };
    if (now) run();
    else this.checkTimer = setTimeout(run, 160);
  }

  // ── tools and selection ──

  setTool(t: Tool): void {
    this.tool = t;
    if (t !== 'place') this.placing = null;
    this.bump();
  }

  /** Take an asset from the library to place it. */
  arm(asset: string, options: Record<string, string | number | boolean> = {}): void {
    this.placing = { asset, facing: null, options };
    this.tool = 'place';
    this.bump();
  }

  armPrefab(id: PrefabId): void {
    this.prefab = id;
    this.tool = 'prefab';
    this.placing = null;
    this.bump();
  }

  select(sel: Selection[], add = false): void {
    if (add) {
      const out = [...this.selection];
      for (const s of sel) {
        const i = out.findIndex((x) => sameSel(x, s));
        if (i >= 0) out.splice(i, 1);
        else out.push(s);
      }
      this.selection = out;
    } else this.selection = sel;
    this.bump();
  }

  isSelected(s: Selection): boolean {
    return this.selection.some((x) => sameSel(x, s));
  }

  setLayer(k: keyof BuilderStore['layers'], v: boolean): void {
    this.layers = { ...this.layers, [k]: v };
    this.savePrefs();
    this.bump();
  }

  setSnap(on: boolean, grid?: number): void {
    this.snap = on;
    if (grid) this.grid = grid;
    this.savePrefs();
    this.bump();
  }

  private savePrefs(): void {
    try {
      localStorage.setItem(LS_PREFS, JSON.stringify({ snap: this.snap, grid: this.grid, layers: this.layers } satisfies Prefs));
    } catch {
      /* private mode */
    }
  }

  /** Snap a coordinate to the grid (when snapping is on). */
  q(v: number): number {
    return this.snap ? Math.round(v / this.grid) * this.grid : Math.round(v);
  }

  // ── the camera ──

  setViewport(w: number, h: number): void {
    const first = this.viewport.w === 800 && this.viewport.h === 600;
    this.viewport = { w, h };
    if (first) this.fit();
  }

  /** Fit the whole world in view, clear of the tool rail (left) and the status line (bottom). */
  fit(): void {
    if (!this.plan) return;
    const { w, h } = this.viewport;
    const left = 64;
    const bottom = 52;
    const z = Math.max(B_MIN_ZOOM, Math.min((w - left - 28) / this.plan.size.w, (h - bottom - 36) / this.plan.size.h));
    // The world's middle sits in the middle of the free area.
    this.camera.tx = this.plan.size.w / 2 - (left - 28) / 2 / z;
    this.camera.ty = this.plan.size.h / 2 + (bottom - 36) / 2 / z;
    this.camera.tzoom = z;
  }

  /** Fly to a rectangle (an issue, a selection). */
  focus(x: number, y: number, w: number, h: number): void {
    const { w: vw, h: vh } = this.viewport;
    const z = Math.max(B_MIN_ZOOM, Math.min(B_MAX_ZOOM, Math.min(vw / (Math.max(w, 30) * 2.2), vh / (Math.max(h, 30) * 2.2))));
    this.camera.tx = x + w / 2;
    this.camera.ty = y + h / 2;
    this.camera.tzoom = z;
    this.bump();
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const cam = this.camera;
    const { w, h } = this.viewport;
    const bx = (sx - w / 2) / cam.zoom + cam.x;
    const by = (sy - h / 2) / cam.zoom + cam.y;
    cam.tzoom = Math.max(B_MIN_ZOOM, Math.min(B_MAX_ZOOM, cam.tzoom * factor));
    cam.zoom = cam.tzoom;
    cam.x = bx - (sx - w / 2) / cam.zoom;
    cam.y = by - (sy - h / 2) / cam.zoom;
    cam.tx = cam.x;
    cam.ty = cam.y;
  }

  // ── saving ──

  private loadDraft(): { plan: WorldPlan; savedHash: string } | null {
    try {
      const raw = localStorage.getItem(LS_DRAFT);
      if (!raw) return null;
      const d = JSON.parse(raw) as { plan: WorldPlan; savedHash: string };
      return d?.plan?.format === 'community-lab.world/1' ? d : null;
    } catch {
      return null;
    }
  }

  private scheduleDraft(): void {
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => this.saveDraft(), 900);
  }

  /** Keep the work in the browser so a reload loses nothing. */
  saveDraft(): void {
    if (!this.plan) return;
    try {
      localStorage.setItem(LS_DRAFT, JSON.stringify({ plan: this.plan, savedHash: this.savedHash }));
    } catch {
      /* quota: the server copy is the record */
    }
  }

  async refreshSaved(): Promise<void> {
    try {
      const r = await fetch('/api/plans');
      if (!r.ok) return;
      this.savedPlans = ((await r.json()) as { plans: SavedPlanInfo[] }).plans;
      this.bump();
    } catch {
      /* the server is away: drafts still keep the work */
    }
  }

  /** Save to the lab: the world's .sce file in data/worlds/ (its id is its key). */
  async save(): Promise<boolean> {
    if (!this.plan) return false;
    this.saving = true;
    this.bump();
    try {
      const r = await fetch(`/api/plans/${encodeURIComponent(this.plan.id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.plan) });
      if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? `save failed (${r.status})`);
      const saved = (await r.json()) as SavedPlanInfo;
      this.savedHash = planHash(this.plan);
      this.saveDraft();
      this.say(`Saved ${this.plan.name} as data/worlds/${saved.file}.`, 'ok');
      this.refreshSaved();
      return true;
    } catch (e) {
      this.say(`Not saved: ${e instanceof Error ? e.message : String(e)}. The draft is kept in this browser.`, 'error');
      return false;
    } finally {
      this.saving = false;
      this.bump();
    }
  }

  async openSaved(id: string): Promise<void> {
    try {
      const r = await fetch(`/api/plans/${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error(`could not open (${r.status})`);
      const plan = (await r.json()) as WorldPlan;
      this.load(plan, planHash(plan));
      this.dialog = null;
      this.saveDraft();
      this.bump();
    } catch (e) {
      this.say(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  async deleteSaved(id: string): Promise<void> {
    await fetch(`/api/plans/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
    this.refreshSaved();
  }

  /** The world as a .sce file to keep or share (it opens in Scelo too, as a table of its buildings). */
  exportFile(): void {
    if (!this.plan) return;
    const blob = new Blob([worldSceText(this.plan, new Date().toISOString())], { type: SCE_MIME });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = worldFilename(this.plan);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    this.say(`Downloaded ${a.download}.`, 'ok');
  }

  /** Open a .sce file (or a bare world). */
  async importFile(file: File): Promise<void> {
    try {
      const { plan } = readWorld(await file.text());
      this.load(plan, '');
      this.dialog = null;
      this.saveDraft();
      this.say(`Opened ${plan.name} from ${file.name}.`, 'ok');
    } catch (e) {
      this.say(`Could not open ${file.name}: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }

  // ── running ──

  /** Run the plan: the simulation rebuilds on it from day 0 (with the scenario's assumptions), and the builder steps aside. */
  run(): boolean {
    if (!this.plan) return false;
    const errors = validatePlan(this.plan, this.built).filter((i) => i.level === 'error');
    if (errors.length) {
      this.issues = validatePlan(this.plan, this.built);
      this.propsTab = 'checks';
      this.say(`${errors.length === 1 ? 'One thing stops' : `${errors.length} things stop`} this world from running: see the checks.`, 'error');
      return false;
    }
    try {
      // The unaltered province runs as the built-in province.
      const plan = planHash(this.plan) === provincePlanHash() ? null : this.plan;
      store.rebuild({ ...store.params, plan });
    } catch (e) {
      this.say(e instanceof Error ? e.message : String(e), 'error');
      return false;
    }
    this.saveDraft();
    this.leave();
    store.say(`Running ${this.plan.name} from ${store.params.startDate}.`);
    return true;
  }
}

export function sameSel(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'road' || a.kind === 'track') return a.index === (b as { index: number }).index;
  return a.id === (b as { id: string }).id;
}

export const builder = new BuilderStore();

export function useBuilder(): BuilderStore {
  useSyncExternalStore(builder.subscribe, builder.getVersion, builder.getVersion);
  return builder;
}
