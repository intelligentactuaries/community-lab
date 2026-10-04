// The simulation engine: builds a world from a parameter basis and advances
// it in either MICRO mode (minute-level movement, conversations and animated
// incidents) or MACRO mode (day steps only, positions sampled from the daily
// plans — the time-lapse). Both modes run the same day-step pipeline, so the
// demographic, health and economic outcomes do not depend on the viewing
// speed; only the animation fidelity does.
//
// Process overview and scheduling (ODD §3) — every simulated day at 00:00:
//   1 weather   2 ageing & life-course transitions   3 illness   4 mortality
//   5 pregnancy & births   6 (1st of month) nuptiality, migration, economy,
//   snapshot   7 (anniversary) yearly summary   8 social dynamics & disputes
//   9 security: intruders, court, road accidents   10 gatherings (funerals,
//   weddings)   11 exposure bookkeeping   12 daily plans

import { MAX_EVENTS_KEPT, type Ctx } from './ctx';
import { alivePeople } from './ctx';
import { ageDayStep, die, gatheringsDayStep, migrationMonthStep, mortalityDayStep, nuptialityMonthStep, pregnancyDayStep } from './demography';
import { economyMonthStep } from './economy';
import { emptyFinance, initFinance } from './finance';
import { ASFR_SHAPE_LATE, ASFR_SHAPE_SA, scaledAsfr } from './fertility';
import { healthDayStep } from './health';
import { buildQxTable, presetById } from './mortality';
import { macroPlace, microStep } from './movement';
import { basisHash, mergeParams, type ScenarioParams } from './params';
import { refreshCouncil, populateCommunity } from './population';
import { RngStreams } from './rng';
import { activeShocks, forceRatios, monthsSinceStart, suppliedTable } from './shocks';
import { buildAllPlans, childcarePass } from './schedule';
import { applyCourtAttendance, courtDayStep, intruderMinute, resolveIntrudersMacro, roadAccidentDayStep, scheduleIntruders } from './security';
import { recordChurchAttendance, socialDayStep, socialMinute } from './social';
import { initStats, logWeather, monthlySnapshot, statsDayStep, yearlySummary } from './stats';
import { FLIGHTS } from './transit';
import { MINUTES_PER_DAY, calendarForDay, parseStartDate } from './time';
import type { SimEvent, World } from './types';
import { applyWeatherOverride, climateById, generateWeather, initialWeatherState } from './weather';
import { WORLD_H, WORLD_W, buildBuildings, buildRoadGraph, clearPathCache, type RoadGraph } from './world';

const ID_PREFIX: Record<keyof World['nextIds'], string> = {
  person: 'p',
  household: 'h',
  event: 'e',
  conversation: 'c',
  intruder: 'x',
  incident: 'i',
  court: 'k',
  illness: 'l',
  vehicle: 'v',
};

export class Simulation {
  readonly params: ScenarioParams;
  readonly world: World;
  readonly ctx: Ctx;
  readonly roads: RoadGraph;
  private readonly startMs: number;
  private yearOpening: { births: number; deaths: number; marriages: number; population: number };
  private startCal: { year: number; month: number; day: number };
  /** Animate (true) or time-lapse (false). */
  micro = true;
  /** Listeners for day boundaries (UI refresh hooks). */
  onDay: Array<(sim: Simulation) => void> = [];

  constructor(partial?: Partial<ScenarioParams>) {
    this.params = mergeParams(partial);
    const P = this.params;
    this.startMs = parseStartDate(P.startDate);
    const rng = new RngStreams(P.seed);
    const cal0 = calendarForDay(this.startMs, 0);
    this.startCal = { year: cal0.year, month: cal0.month, day: cal0.day };
    const preset = presetById(P.mortalityPreset);
    const calib = buildQxTable(preset);
    // A basis supplied from outside (Scelo) replaces the preset as the basis; the death channels stay calibrated
    // against the preset and are scaled by the ratio of forces of mortality (shocks.ts).
    const qx = P.mortalityOverride ? suppliedTable(P.mortalityOverride, calib, cal0.year, P.mortalityImprovement) : calib;
    const asfr = scaledAsfr(P.fertilityShape === 'late' ? ASFR_SHAPE_LATE : ASFR_SHAPE_SA, P.tfr);
    const climate = climateById(P.climate);
    clearPathCache();
    const buildings = buildBuildings();
    this.roads = buildRoadGraph(buildings);
    const world: World = {
      meta: { widthM: WORLD_W, heightM: WORLD_H, latitude: climate.latitude, hemisphere: climate.hemisphere, placeName: P.placeName },
      people: {},
      households: {},
      buildings,
      roads: { nodes: this.roads.nodes, edges: this.roads.edges },
      vehicles: {},
      conversations: {},
      intruders: {},
      incidents: {},
      courtCases: {},
      events: [],
      weather: { day: 0, season: 'summer', tempMin: 15, tempMax: 26, rainMm: 0, condition: 'clear', windKmh: 10, windDir: 12 },
      insurance: { reserve: P.schemeReserve, premiumsIn: 0, claimsOut: 0, claimCount: 0, policies: 0, surplusPath: [], ruined: false, ruinMonth: null },
      stats: initStats(),
      minute: 0,
      day: 0,
      minuteOfDay: 0,
      lastDayStep: -1,
      lastMonthStep: -1,
      lastYearStep: -1,
      nextIds: { person: 1, household: 1, event: 1, conversation: 1, intruder: 1, incident: 1, court: 1, illness: 1, vehicle: 1 },
      todayGatherings: [],
      scheduledGatherings: [],
      scheduledIntruders: [],
      todayHearings: [],
      graves: [],
      holiday: null,
      weatherOverride: null,
      finance: emptyFinance(P),
      roles: { pastorId: null, doctorId: null, dmoId: null, nurseIds: [], policeIds: [], magistrateId: null, teacherIds: [], pastorByChurch: {}, doctorByClinic: {}, dmoByCity: {}, magistrateByCourt: {}, policeByStation: {}, surgeonIds: [] },
      council: [],
      basisHash: basisHash(P),
    };
    this.world = world;
    const self = this;
    this.ctx = {
      world,
      params: P,
      rng,
      qx,
      qxCalib: calib,
      basisRatio: qx === calib ? null : forceRatios(qx, calib),
      shocks: activeShocks(P.shocks, 0),
      asfr,
      climate,
      weatherState: initialWeatherState(),
      roads: this.roads,
      startMs: this.startMs,
      cal: cal0,
      micro: true,
      emit(e) {
        const ev: SimEvent = { id: world.nextIds.event++, day: world.day, minute: Math.floor(world.minuteOfDay), ...e, personIds: e.personIds ?? [] };
        world.events.push(ev);
        if (world.events.length > MAX_EVENTS_KEPT + 500) world.events.splice(0, world.events.length - MAX_EVENTS_KEPT);
        return ev;
      },
      nextId(kind) {
        return `${ID_PREFIX[kind]}${world.nextIds[kind]++}`;
      },
      hooks: {
        onDeath(p, cause, source) {
          die(self.ctx, p, cause, source);
        },
      },
    };
    // ── Day 0 ──
    world.weather = generateWeather(rng.stream('weather'), climate, cal0.month, 0, this.ctx.weatherState);
    logWeather(world);
    populateCommunity(this.ctx);
    initFinance(this.ctx);
    economyMonthStep(this.ctx, 0);
    this.yearOpening = { births: 0, deaths: 0, marriages: 0, population: alivePeople(world).length };
    buildAllPlans(this.ctx);
    childcarePass(this.ctx);
    statsDayStep(this.ctx);
    scheduleIntruders(this.ctx);
    macroPlace(this.ctx);
    monthlySnapshot(this.ctx);
    world.lastDayStep = 0;
    this.ctx.emit({ kind: 'household', severity: 'info', text: `${P.regionName} Province: ${Object.keys(world.households).length} households, ${alivePeople(world).length} people across Emmaus, Newhaven and Ithemba, with Unity Centre, the airport and the Hyperline between them. Basis ${world.basisHash}, seed "${P.seed}".` });
  }

  setMicro(on: boolean): void {
    if (this.micro === on) return;
    this.micro = on;
    this.ctx.micro = on;
    if (on) {
      // Re-enter animation: everyone snaps to their current activity and walks from there.
      for (const p of alivePeople(this.world)) p.planIdx = -1;
      macroPlace(this.ctx);
      for (const p of alivePeople(this.world)) p.planIdx = -1;
    } else {
      for (const p of alivePeople(this.world)) {
        p.waitingFor = null;
        p.waitingLine = null;
        p.alightAt = null;
      }
      for (const id in this.world.intruders) delete this.world.intruders[id];
      for (const id in this.world.conversations) {
        const c = this.world.conversations[id];
        for (const pid of c.participantIds) {
          const p = this.world.people[pid];
          if (p && p.conversationId === id) p.conversationId = null;
        }
      }
      macroPlace(this.ctx);
    }
  }

  /** Advance by `minutes` of simulated time. */
  advance(minutes: number): void {
    if (minutes <= 0) return;
    if (this.micro && minutes <= 180) this.advanceMicro(minutes);
    else this.advanceMacro(minutes);
  }

  private setClock(minute: number): void {
    const w = this.world;
    w.minute = minute;
    w.day = Math.floor(minute / MINUTES_PER_DAY);
    w.minuteOfDay = minute - w.day * MINUTES_PER_DAY;
  }

  private advanceMicro(minutes: number): void {
    let remaining = minutes;
    const w = this.world;
    while (remaining > 1e-9) {
      const frac = w.minute - Math.floor(w.minute);
      const toBoundary = frac > 1e-9 ? 1 - frac : 1;
      const step = Math.min(remaining, toBoundary);
      const before = Math.floor(w.minute);
      const next = w.minute + step;
      const crossesMinute = Math.floor(next + 1e-9) > before;
      if (crossesMinute && Math.floor(next + 1e-9) % MINUTES_PER_DAY === 0) {
        this.setClock(Math.floor(next + 1e-9));
        this.dayStep();
        remaining -= step;
        continue;
      }
      this.setClock(crossesMinute ? Math.floor(next + 1e-9) : next);
      microStep(this.ctx, step, crossesMinute);
      if (crossesMinute) {
        socialMinute(this.ctx);
        intruderMinute(this.ctx);
      }
      remaining -= step;
    }
  }

  private advanceMacro(minutes: number): void {
    const w = this.world;
    const target = w.minute + minutes;
    const targetDay = Math.floor(target / MINUTES_PER_DAY);
    // Whole days always run in time-lapse mode, exactly as runDays does, so a
    // jump sees the same world as day-by-day stepping (determinism guarantee).
    const wasMicro = this.micro;
    if (wasMicro && w.day < targetDay) this.setMicro(false);
    while (w.day < targetDay) {
      this.setClock((w.day + 1) * MINUTES_PER_DAY);
      this.dayStep();
    }
    if (wasMicro && !this.micro) this.setMicro(true);
    this.setClock(target);
    macroPlace(this.ctx);
    // Animation resumes after a jump: re-plan the current activity so everyone
    // walks to a proper, unclaimed spot instead of staying where the sampler put them.
    if (this.micro) for (const p of alivePeople(this.world)) p.planIdx = -1;
  }

  /**
   * Fast-forward to an absolute simulated minute. Time only runs forward: every
   * day in between is still simulated (in time-lapse), nothing is skipped.
   * Returns the number of days that were run.
   */
  jumpToMinute(target: number): number {
    const from = this.world.minute;
    if (target <= from) return 0;
    const days = Math.floor(target / MINUTES_PER_DAY) - this.world.day;
    this.advance(target - from);
    return Math.max(0, days);
  }

  /** Run whole years quickly (batch / headless). */
  runDays(days: number, onDay?: (day: number) => void): void {
    const wasMicro = this.micro;
    this.setMicro(false);
    for (let i = 0; i < days; i++) {
      this.setClock((this.world.day + 1) * MINUTES_PER_DAY);
      this.dayStep();
      onDay?.(this.world.day);
    }
    if (wasMicro) this.setMicro(true);
  }

  private dayStep(): void {
    const ctx = this.ctx;
    const w = this.world;
    const P = this.params;
    if (w.lastDayStep === w.day) return;
    w.lastDayStep = w.day;
    ctx.cal = calendarForDay(this.startMs, w.day);
    const cal = ctx.cal;
    // Shocks in force this month (a stress test's pandemic year, rate or oil shock); the ledger records each one
    // as it starts and as it lifts, as it does a forced sky.
    if (P.shocks) {
      const before = ctx.shocks.labels;
      ctx.shocks = activeShocks(P.shocks, monthsSinceStart(this.startCal.year, this.startCal.month, cal.year, cal.month));
      for (const l of ctx.shocks.labels) if (!before.includes(l)) ctx.emit({ kind: 'economy', severity: 'alert', text: `Stress applied: ${l}.` });
      for (const l of before) if (!ctx.shocks.labels.includes(l)) ctx.emit({ kind: 'economy', severity: 'info', text: `Stress lifted: ${l}.` });
    }
    // 1 weather
    const prev = w.weather;
    w.weather = generateWeather(ctx.rng.stream('weather'), ctx.climate, cal.month, w.day, ctx.weatherState);
    logWeather(w);
    w.finance.rainMonth += w.weather.rainMm;
    // A held intervention keeps overwriting the generated weather; a one-day
    // one lapses here, and the community goes back to its own climate.
    if (w.weatherOverride) {
      if (w.weatherOverride.hold) w.weather = applyWeatherOverride(w.weather, w.weatherOverride);
      else w.weatherOverride = null;
      logWeather(w);
    }
    if (w.weather.condition !== prev.condition && (w.weather.condition === 'storm' || w.weather.condition === 'heatwave' || w.weather.condition === 'cold-snap' || w.weather.condition === 'snow')) {
      ctx.emit({ kind: 'weather', severity: 'alert', text: w.weather.condition === 'storm' ? `Thunderstorm today (${w.weather.rainMm} mm, wind ${w.weather.windKmh} km/h).` : w.weather.condition === 'heatwave' ? `Heat wave: ${w.weather.tempMax}°C.` : w.weather.condition === 'cold-snap' ? `Cold snap: down to ${w.weather.tempMin}°C.` : 'Snow!' });
    }
    // Yesterday's leftovers (micro intruders that never spawned, e.g. after a mode switch)
    resolveIntrudersMacro(ctx);
    for (const id in w.intruders) delete w.intruders[id];
    // 2 ageing
    ageDayStep(ctx);
    // 3 health
    healthDayStep(ctx);
    // 4 mortality
    mortalityDayStep(ctx);
    // 5 fertility
    pregnancyDayStep(ctx);
    // 6 monthly
    if (cal.day === 1) {
      const monthIndex = (cal.year - calendarForDay(this.startMs, 0).year) * 12 + cal.month - 1;
      nuptialityMonthStep(ctx);
      migrationMonthStep(ctx);
      refreshCouncil(ctx);
      economyMonthStep(ctx, monthIndex);
      w.lastMonthStep = monthIndex;
    }
    // 7 yearly
    if (cal.month === this.startCal.month && cal.day === this.startCal.day && w.day > 0) {
      yearlySummary(ctx, cal.year - 1, this.yearOpening);
      this.yearOpening = { births: w.stats.births, deaths: w.stats.deaths, marriages: w.stats.marriages, population: alivePeople(w).length };
      w.lastYearStep = cal.year;
    }
    // 8 social
    socialDayStep(ctx);
    // The airline flies its timetable every day of the year.
    w.stats.flights += FLIGHTS.length;
    // 9 security
    scheduleIntruders(ctx);
    if (!this.micro) resolveIntrudersMacro(ctx);
    courtDayStep(ctx);
    roadAccidentDayStep(ctx);
    // 10 gatherings
    gatheringsDayStep(ctx);
    // 11 exposure
    statsDayStep(ctx);
    if (cal.day === 1) monthlySnapshot(ctx);
    // 12 plans
    buildAllPlans(ctx);
    applyCourtAttendance(ctx);
    childcarePass(ctx);
    if (cal.weekday === 0) recordChurchAttendance(ctx);
    if (w.holiday) ctx.emit({ kind: 'holiday', severity: 'joy', text: `${w.holiday}.` });
    // Lights: buildings lit when occupied after dark (rendering hint)
    for (const id in w.buildings) w.buildings[id].lit = false;
    // Micro re-entry after the plan rebuild
    if (this.micro) for (const p of alivePeople(w)) p.planIdx = -1;
    else macroPlace(ctx);
    for (const fn of this.onDay) fn(this);
    void P;
  }
}

/** Convenience for batch runs: build, run N years, return the world. */
export function runScenario(partial: Partial<ScenarioParams>, years: number, onYear?: (year: number, sim: Simulation) => void): Simulation {
  const sim = new Simulation(partial);
  const days = Math.round(years * 365.25);
  let lastYear = 0;
  sim.runDays(days, (d) => {
    const y = Math.floor(d / 365.25);
    if (y !== lastYear) {
      lastYear = y;
      onYear?.(y, sim);
    }
  });
  return sim;
}
