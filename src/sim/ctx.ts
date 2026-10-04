// The context every submodel receives. Keeping it a plain object (not the
// engine class) means each submodel can be unit-tested with a hand-built
// world and a fixed seed.

import type { AsfrBand } from './fertility';
import type { QxTable } from './mortality';
import type { ScenarioParams } from './params';
import type { RngStreams } from './rng';
import type { ActiveShocks } from './shocks';
import type { CalendarDate } from './time';
import type { ClimatePreset, WeatherState } from './weather';
import type { RoadGraph } from './world';
import type { EventKind, EventSeverity, Person, SimEvent, World } from './types';

export interface Ctx {
  world: World;
  params: ScenarioParams;
  rng: RngStreams;
  /** The basis: the preset table, or a table supplied from outside (params.mortalityOverride). */
  qx: QxTable;
  /** The preset table the death channels are calibrated against (the same object as qx when nothing was supplied). */
  qxCalib: QxTable;
  /** μ_supplied / μ_preset by sex and age when a basis was supplied, else null (shocks.ts). */
  basisRatio: { M: Float64Array; F: Float64Array } | null;
  /** The shocks in force this month (shocks.ts). */
  shocks: ActiveShocks;
  asfr: AsfrBand[];
  climate: ClimatePreset;
  weatherState: WeatherState;
  /** Road graph with adjacency (rebuilt from world.roads at load). */
  roads: RoadGraph;
  /** Calendar epoch (ms since Unix epoch, UTC midnight of startDate). */
  startMs: number;
  /** Today's calendar. */
  cal: CalendarDate;
  /** Whether the run is animating (micro steps) or time-lapsing (day steps only). */
  micro: boolean;
  /** Log an event (id / day / minute filled in). */
  emit(e: {
    kind: EventKind;
    severity: EventSeverity;
    text: string;
    personIds?: string[];
    householdId?: string;
    buildingId?: string;
    x?: number;
    y?: number;
    data?: Record<string, unknown>;
  }): SimEvent;
  nextId(kind: keyof World['nextIds']): string;
  /** Callback hooks the engine wires (keeps submodels decoupled). */
  hooks: {
    onDeath(p: Person, cause: string, source?: 'table' | 'illness' | 'accident' | 'maternal'): void;
  };
}

export const MAX_EVENTS_KEPT = 4000;

export function fullName(p: Person): string {
  return `${p.firstName} ${p.surname}`;
}

export function alivePeople(world: World): Person[] {
  const out: Person[] = [];
  for (const id in world.people) {
    const p = world.people[id];
    if (p.alive && !p.emigrated) out.push(p);
  }
  return out;
}

export function householdMembers(world: World, householdId: string): Person[] {
  const hh = world.households[householdId];
  if (!hh) return [];
  return hh.memberIds.map((id) => world.people[id]).filter((p): p is Person => !!p && p.alive && !p.emigrated);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}
