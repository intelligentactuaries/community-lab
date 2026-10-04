// The single source of truth for the running simulation and the UI state
// around it. The renderer reads `store.sim.world` directly every frame; React
// subscribes to a coarse tick (4 Hz) plus immediate updates for UI actions.
import { useSyncExternalStore } from 'react';
import { Simulation } from '../../sim/engine';
import { DEFAULT_PARAMS, SPEED_PRESETS, type ScenarioParams } from '../../sim/params';
import { calendarForDay, parseStartDate, seasonFor, type CalendarDate, type Season } from '../../sim/time';
import { applyWeatherOverride } from '../../sim/weather';
import type { WeatherOverride } from '../../sim/types';
import { CITY, COMMUNITY, WORLD_H, WORLD_W, cityAt, communityAt } from '../../sim/world';
import type { CityId, CommunityId } from '../../sim/types';
import { HUD_BOTTOM, MAX_ZOOM, makeCamera, setMaxZoom, type Camera, type Drill, drillFor, fitWorld, focusPoint, focusRect } from './camera';
import { MAX_ZOOM_3D } from '../render3d/view3d';

export type Selection =
  | { kind: 'person'; id: string }
  | { kind: 'household'; id: string }
  | { kind: 'building'; id: string }
  | { kind: 'conversation'; id: string }
  | { kind: 'incident'; id: string }
  | null;

export type AnalyticsScope = { kind: 'all' } | { kind: 'city'; id: CityId } | { kind: 'community'; id: CommunityId } | { kind: 'household'; id: string } | { kind: 'person'; id: string };

export type AiMode = 'off' | 'on-demand' | 'auto';

const LS_PARAMS = 'community-lab:params:v1';
const LS_UI = 'community-lab:ui:v1';

function loadParams(): Partial<ScenarioParams> {
  try {
    return JSON.parse(localStorage.getItem(LS_PARAMS) ?? '{}') as Partial<ScenarioParams>;
  } catch {
    return {};
  }
}
interface UiPrefs {
  aiMode?: AiMode;
  sidebarOpen?: boolean;
  inspectorOpen?: boolean;
  legendOpen?: boolean;
  view3d?: boolean;
}

function loadUi(): UiPrefs {
  try {
    return JSON.parse(localStorage.getItem(LS_UI) ?? '{}') as UiPrefs;
  } catch {
    return {};
  }
}

class SimStore {
  sim: Simulation;
  params: ScenarioParams;
  running = false;
  speedId = 'x60';
  /** Custom time-lapse (simulated years per real minute); active when speedId === 'custom'. */
  customYrsPerMin: number | null = null;
  selection: Selection = null;
  followId: string | null = null;
  camera: Camera = makeCamera(800, 600);
  viewport = { w: 800, h: 600 };
  drill: Drill = 'province';
  aiMode: AiMode = 'on-demand';
  sidebarOpen = false;
  inspectorOpen = false;
  drawerTab: string | null = null;
  drawerFull = false;
  /** Who the analytics describe: the province, one city, one settlement, one household or one person. */
  analyticsScope: AnalyticsScope = { kind: 'all' };
  /** Finance workspace: which section and which entity's books are open. */
  financeSection = 'overview';
  financeEntity: string | null = null;
  financeAccount: string | null = null;
  /** Actuarial workbench: which section is open, and the valuation rate it values at ('tbill', 'repo', 'prime', 'deposit', 'real' or 'custom:0.08'). */
  actuarialSection = 'overview';
  actuarialRate = 'tbill';
  settingsOpen = false;
  helpOpen = false;
  legendOpen = false;
  /** Zooming past the bare floor turns the map into a 3D scene (render3d/). */
  view3d = true;
  /** A short notice shown over the map for a few seconds (a controller connected, and so on). */
  notice: { text: string; at: number } | null = null;
  /** Real-time factor actually achieved last second (for the HUD). */
  achieved = 0;
  /** True while a jump is running the intervening days. */
  jumping = false;
  sceneOpen = false;
  hover: { x: number; y: number; personId: string | null } = { x: 0, y: 0, personId: null };
  private version = 0;
  private listeners = new Set<() => void>();
  private lastTick = 0;
  startMs: number;

  constructor() {
    this.params = { ...DEFAULT_PARAMS, ...loadParams() };
    const ui = loadUi();
    if (ui.aiMode) this.aiMode = ui.aiMode;
    if (typeof ui.sidebarOpen === 'boolean') this.sidebarOpen = ui.sidebarOpen;
    if (typeof ui.inspectorOpen === 'boolean') this.inspectorOpen = ui.inspectorOpen;
    if (typeof ui.view3d === 'boolean') this.view3d = ui.view3d;
    setMaxZoom(this.view3d ? MAX_ZOOM_3D : MAX_ZOOM);
    this.sim = new Simulation(this.params);
    this.startMs = parseStartDate(this.params.startDate);
    this.applySpeed();
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
  /** Coarse tick from the animation loop (throttled to ~4 Hz). */
  maybeTick(now: number): void {
    if (now - this.lastTick > 250) {
      this.lastTick = now;
      this.bump();
    }
  }

  // ── time control ──
  get speed(): (typeof SPEED_PRESETS)[number] {
    if (this.speedId === 'custom' && this.customYrsPerMin) {
      const y = this.customYrsPerMin;
      return { id: 'custom', label: `${y} yrs/min`, minutesPerSecond: (y * 365.25 * 1440) / 60, hint: `${y} simulated years per real minute` };
    }
    return SPEED_PRESETS.find((s) => s.id === this.speedId) ?? SPEED_PRESETS[2];
  }
  setSpeed(id: string): void {
    this.speedId = id;
    this.applySpeed();
    this.bump();
  }
  setCustomSpeed(yearsPerMinute: number): void {
    this.customYrsPerMin = Math.max(0.01, Math.min(100_000, yearsPerMinute));
    this.speedId = 'custom';
    this.applySpeed();
    this.bump();
  }
  private applySpeed(): void {
    this.sim.setMicro(this.speed.minutesPerSecond <= 60);
  }
  play(): void {
    this.running = true;
    this.bump();
  }
  pause(): void {
    this.running = false;
    this.bump();
  }
  toggle(): void {
    this.running = !this.running;
    this.bump();
  }
  say(text: string): void {
    const notice = { text, at: performance.now() };
    this.notice = notice;
    this.bump();
    // Clear it even while paused (nothing else would redraw the map's chrome).
    setTimeout(() => {
      if (this.notice === notice) {
        this.notice = null;
        this.bump();
      }
    }, 5000);
  }
  /** One step slower or faster through the speed presets (a controller's shoulder buttons). */
  stepSpeed(dir: 1 | -1): void {
    const i = SPEED_PRESETS.findIndex((s) => s.id === this.speedId);
    const next = SPEED_PRESETS[Math.max(0, Math.min(SPEED_PRESETS.length - 1, (i < 0 ? 2 : i) + dir))];
    if (!next) return;
    this.setSpeed(next.id);
    this.say(`Speed: ${next.label} (${next.hint})`);
  }
  step(minutes: number): void {
    this.running = false;
    this.sim.advance(minutes);
    this.bump();
  }
  /** Called by the animation loop with real seconds elapsed. */
  advanceFrame(realDt: number): void {
    if (!this.running) return;
    const mins = this.speed.minutesPerSecond * Math.min(realDt, 0.1);
    this.sim.advance(mins);
  }

  // ── scenario ──
  rebuild(params: Partial<ScenarioParams>): void {
    this.params = { ...DEFAULT_PARAMS, ...params };
    try {
      localStorage.setItem(LS_PARAMS, JSON.stringify(this.params));
    } catch {
      /* ignore */
    }
    this.sim = new Simulation(this.params);
    this.startMs = parseStartDate(this.params.startDate);
    this.selection = null;
    this.followId = null;
    this.analyticsScope = { kind: 'all' };
    this.running = false;
    this.applySpeed();
    this.resetCamera();
    this.bump();
  }
  setAiMode(m: AiMode): void {
    this.aiMode = m;
    this.saveUi();
    this.bump();
  }

  private saveUi(): void {
    try {
      localStorage.setItem(
        LS_UI,
        JSON.stringify({ aiMode: this.aiMode, sidebarOpen: this.sidebarOpen, inspectorOpen: this.inspectorOpen, view3d: this.view3d } satisfies UiPrefs),
      );
    } catch {
      /* quota / private mode */
    }
  }

  // ── calendar helpers ──
  cal(): CalendarDate {
    return calendarForDay(this.startMs, this.sim.world.day);
  }

  // ── selection & camera ──
  select(sel: Selection, opts: { focus?: boolean; follow?: boolean } = {}): void {
    this.selection = sel;
    if (opts.follow !== undefined) this.followId = opts.follow && sel?.kind === 'person' ? sel.id : null;
    if (opts.focus && sel) this.focusSelection(sel);
    if (sel?.kind !== 'person') this.followId = null;
    this.bump();
  }
  focusSelection(sel: Selection): void {
    const w = this.sim.world;
    const { w: vw, h: vh } = this.viewport;
    if (!sel) return;
    if (sel.kind === 'person') {
      const p = w.people[sel.id];
      if (p) focusPoint(this.camera, p.loc.x, p.loc.y, Math.max(this.camera.tzoom, 14));
    } else if (sel.kind === 'household' || sel.kind === 'building') {
      const b = sel.kind === 'building' ? w.buildings[sel.id] : w.buildings[w.households[sel.id]?.houseId ?? ''];
      if (b) focusRect(this.camera, vw, vh, b.x, b.y, b.w, b.h, 1.3);
    } else if (sel.kind === 'conversation') {
      const c = w.conversations[sel.id];
      if (c) focusPoint(this.camera, c.x, c.y, Math.max(this.camera.tzoom, 16));
    } else if (sel.kind === 'incident') {
      const i = w.incidents[sel.id];
      if (i) focusPoint(this.camera, i.x, i.y, Math.max(this.camera.tzoom, 8));
    }
  }
  setViewport(w: number, h: number): void {
    const first = this.viewport.w === 800 && this.viewport.h === 600;
    this.viewport = { w, h };
    if (first) this.resetCamera();
  }
  resetCamera(): void {
    const z = fitWorld(this.viewport.w, this.viewport.h);
    this.camera.tx = WORLD_W / 2;
    // Centre the province in the space above the stats strip.
    this.camera.ty = WORLD_H / 2 + HUD_BOTTOM / 2 / z;
    this.camera.tzoom = z;
    this.followId = null;
  }
  drillOut(): void {
    const fit = fitWorld(this.viewport.w, this.viewport.h);
    const d = drillFor(this.camera.tzoom, fit);
    if (d === 'person') {
      // to the house of the selected / followed person
      const pid = this.followId ?? (this.selection?.kind === 'person' ? this.selection.id : null);
      const p = pid ? this.sim.world.people[pid] : null;
      const b = p?.loc.buildingId ? this.sim.world.buildings[p.loc.buildingId] : null;
      this.followId = null;
      if (b) focusRect(this.camera, this.viewport.w, this.viewport.h, b.x, b.y, b.w, b.h, 1.3);
      else this.resetCamera();
    } else if (d === 'house') {
      const cid = communityAt(this.camera.x, this.camera.y);
      if (cid) {
        const c = COMMUNITY[cid];
        focusRect(this.camera, this.viewport.w, this.viewport.h, c.x, c.y, c.w, c.h, 1.12);
      } else this.flyToCity();
    } else if (d === 'community') this.flyToCity();
    else this.resetCamera();
    this.bump();
  }
  /** Fit the city under the camera (or the province if it is over open country). */
  flyToCity(): void {
    const city = cityAt(this.camera.x, this.camera.y);
    if (city) {
      const c = CITY[city];
      focusRect(this.camera, this.viewport.w, this.viewport.h, c.x, c.y, c.w, c.h, 1.08);
    } else this.resetCamera();
  }
  updateDrill(): void {
    const fit = fitWorld(this.viewport.w, this.viewport.h);
    const d = drillFor(this.camera.zoom, fit);
    if (d !== this.drill) {
      this.drill = d;
      this.bump();
    }
  }
  setScene(v: boolean): void {
    this.sceneOpen = v;
    this.bump();
  }
  /** Open the finance workspace at a section, optionally on one entity's books. */
  openFinance(section: string, entity: string | null = null, account: string | null = null): void {
    this.financeSection = section;
    if (entity !== null) this.financeEntity = entity;
    if (account !== null) this.financeAccount = account;
    this.drawerTab = 'finance';
    this.bump();
  }

  setFinance(patch: { section?: string; entity?: string | null; account?: string | null }): void {
    if (patch.section !== undefined) this.financeSection = patch.section;
    if (patch.entity !== undefined) this.financeEntity = patch.entity;
    if (patch.account !== undefined) this.financeAccount = patch.account;
    this.bump();
  }

  /** Open the actuarial workbench at a section. */
  openActuarial(section: string): void {
    this.actuarialSection = section;
    this.drawerTab = 'actuarial';
    this.bump();
  }

  setActuarial(patch: { section?: string; rate?: string }): void {
    if (patch.section !== undefined) this.actuarialSection = patch.section;
    if (patch.rate !== undefined) this.actuarialRate = patch.rate;
    this.bump();
  }

  openDrawer(tab: string | null): void {
    this.drawerTab = tab;
    this.bump();
  }
  setScope(s: AnalyticsScope): void {
    this.analyticsScope = s;
    this.bump();
  }
  setDrawerFull(v: boolean): void {
    this.drawerFull = v;
    this.bump();
  }
  set<K extends 'sidebarOpen' | 'inspectorOpen' | 'settingsOpen' | 'helpOpen' | 'legendOpen' | 'view3d'>(k: K, v: boolean): void {
    this[k] = v;
    if (k === 'view3d') {
      setMaxZoom(v ? MAX_ZOOM_3D : MAX_ZOOM);
      this.camera.tzoom = Math.min(this.camera.tzoom, v ? MAX_ZOOM_3D : MAX_ZOOM);
    }
    if (k !== 'settingsOpen' && k !== 'helpOpen') this.saveUi();
    this.bump();
  }

  // ── Directing the scene: jump the clock, force the weather ──────────────

  /** Absolute simulated minute of a calendar date + time of day. */
  minuteOf(isoDate: string, minuteOfDay: number): number {
    const day = Math.round((parseStartDate(isoDate) - this.startMs) / 86_400_000);
    return day * 1440 + minuteOfDay;
  }

  /**
   * Fast-forward to a date and time. Every day in between is simulated, so
   * nothing is skipped; only the animation is. Returns null on success, or a
   * message explaining why the jump was refused.
   */
  jumpTo(isoDate: string, minuteOfDay: number): string | null {
    const target = this.minuteOf(isoDate, minuteOfDay);
    if (target <= this.sim.world.minute) return 'Time runs forward. To go back, rewind (which rebuilds the community from the same seed).';
    const days = Math.floor(target / 1440) - this.sim.world.day;
    if (days > 1100) return `That is ${Math.round(days / 365)} years ahead. Jump at most three years at a time, or use the time-lapse speeds.`;
    const wasRunning = this.running;
    this.running = false;
    this.jumping = true;
    this.bump();
    this.sim.jumpToMinute(target);
    this.jumping = false;
    this.running = wasRunning;
    this.bump();
    return null;
  }

  /** Jump forward by a number of minutes from now. */
  jumpBy(minutes: number): string | null {
    const target = this.sim.world.minute + minutes;
    const cal = calendarForDay(this.startMs, Math.floor(target / 1440));
    return this.jumpTo(cal.isoDate, Math.round(target % 1440));
  }

  /** The next occurrence of a weekday at a time of day (today counts if still ahead). */
  jumpToWeekday(weekday: number, minuteOfDay: number): string | null {
    const w = this.sim.world;
    const cal = this.cal();
    let ahead = (weekday - cal.weekday + 7) % 7;
    if (ahead === 0 && minuteOfDay <= w.minuteOfDay) ahead = 7;
    const target = calendarForDay(this.startMs, w.day + ahead);
    return this.jumpTo(target.isoDate, minuteOfDay);
  }

  /** Jump to the first day of the next occurrence of a season. */
  jumpToSeason(season: Season, minuteOfDay = 9 * 60): string | null {
    const hemi = this.sim.world.meta.hemisphere;
    const cal = this.cal();
    for (let i = 1; i <= 14; i++) {
      const month = ((cal.month - 1 + i) % 12) + 1;
      const year = cal.year + Math.floor((cal.month - 1 + i) / 12);
      if (seasonFor(month, hemi) !== season) continue;
      // The first month of that season only (so we land at its start).
      const prevMonth = month === 1 ? 12 : month - 1;
      if (seasonFor(prevMonth, hemi) === season) continue;
      return this.jumpTo(`${year}-${String(month).padStart(2, '0')}-01`, minuteOfDay);
    }
    return 'Could not find that season on the calendar.';
  }

  /** Force the weather. Recorded in the event ledger — it is an intervention. */
  forceWeather(o: Omit<WeatherOverride, 'setDay'>): void {
    const w = this.sim.world;
    const full: WeatherOverride = { ...o, setDay: w.day };
    w.weatherOverride = full;
    w.weather = applyWeatherOverride(w.weather, full);
    this.sim.ctx.emit({
      kind: 'weather',
      severity: 'alert',
      text: `Weather set to ${o.condition} (${o.tempMax}°C, ${o.rainMm} mm)${o.hold ? ' and held' : ' for today'} from the scene controls.`,
      data: { forced: true, ...o },
    });
    this.bump();
  }

  /** Hand the weather back to the climate generator. */
  releaseWeather(): void {
    const w = this.sim.world;
    if (!w.weatherOverride) return;
    w.weatherOverride = null;
    this.sim.ctx.emit({ kind: 'weather', severity: 'info', text: 'Weather released back to the climate model.' });
    this.bump();
  }
}

export const store = new SimStore();

export function useStore(): SimStore {
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  return store;
}
