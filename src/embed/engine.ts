// The engine as a self-contained browser module, for pages outside the IDE
// (the Intelligent Actuaries website's live province): the real Simulation,
// nothing of the IDE's interface. ./worker.ts runs it off the page's thread;
// scripts/build-embed.ts builds both into dist-embed/.

import { alivePeople } from '../sim/ctx';
import { Simulation } from '../sim/engine';
import { indicators } from '../sim/experiment';
import { DEFAULT_PARAMS, type ScenarioParams } from '../sim/params';
import { calendarForDay } from '../sim/time';

export { DEFAULT_PARAMS };
export type { ScenarioParams };

export interface StaticLayout {
  width: number;
  height: number;
  buildings: Array<{ id: string; kind: string; name: string; x: number; y: number; w: number; h: number; community: string | null }>;
  roads: Array<{ ax: number; ay: number; bx: number; by: number; width: number }>;
}

export interface Snapshot {
  minute: number;
  minuteOfDay: number;
  day: number;
  date: string;
  weekday: number;
  /** x, y and flags per resident on foot (flags: 1 female, 2 under 18, 4 unwell, 8 at a gathering). */
  positions: Float32Array;
  population: number;
  births: number;
  deaths: number;
  marriages: number;
  basisHash: string;
  seed: string;
  weather: string;
}

export function createProvince(params?: Partial<ScenarioParams>) {
  const sim = new Simulation(params);
  const layout = (): StaticLayout => {
    const w = sim.world;
    const nodes = w.roads.nodes;
    return {
      width: w.meta.widthM,
      height: w.meta.heightM,
      buildings: Object.values(w.buildings).map((b) => ({ id: b.id, kind: b.kind, name: b.name, x: b.x, y: b.y, w: b.w, h: b.h, community: b.community ?? null })),
      roads: w.roads.edges.flatMap((e) => {
        const a = nodes[e.a];
        const b = nodes[e.b];
        return a && b ? [{ ax: a.x, ay: a.y, bx: b.x, by: b.y, width: e.width }] : [];
      }),
    };
  };
  const snapshot = (): Snapshot => {
    const w = sim.world;
    const alive = alivePeople(w);
    const onFoot = alive.filter((p) => !p.inVehicleId && !p.away);
    const pos = new Float32Array(onFoot.length * 3);
    onFoot.forEach((p, i) => {
      pos[i * 3] = p.loc.x;
      pos[i * 3 + 1] = p.loc.y;
      pos[i * 3 + 2] = (p.sex === 'F' ? 1 : 0) | (p.age < 18 ? 2 : 0) | (p.health.state !== 'healthy' ? 4 : 0);
    });
    const cal = calendarForDay(sim.ctx.startMs, w.day);
    return {
      minute: w.minute,
      minuteOfDay: w.minuteOfDay,
      day: w.day,
      date: cal.isoDate,
      weekday: cal.weekday,
      positions: pos,
      population: alive.length,
      births: w.stats.births,
      deaths: w.stats.deaths,
      marriages: w.stats.marriages,
      basisHash: w.basisHash,
      seed: sim.params.seed,
      weather: w.weather.condition,
    };
  };
  return {
    sim,
    layout,
    snapshot,
    advance: (minutes: number) => sim.advance(minutes),
    runDays: (days: number) => sim.runDays(days),
    jumpToMinute: (minute: number) => sim.jumpToMinute(minute),
    indicators: () => indicators(sim),
  };
}
