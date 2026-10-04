import { describe, expect, test } from 'bun:test';
import { Rng, RngStreams } from '../src/sim/rng';
import { MORTALITY_PRESETS, buildQxTable, lifeExpectancy, lifeTable } from '../src/sim/mortality';
import { CHURCH_IDS, RESIDENTIAL, buildBuildings, buildRoadGraph, cityOf, clearPathCache, landmark, residentialOf, roadPath } from '../src/sim/world';
import { Simulation } from '../src/sim/engine';
import { alivePeople } from '../src/sim/ctx';
import { scaledAsfr, ASFR_SHAPE_SA, tfrOf } from '../src/sim/fertility';
import { easterSunday, holidayFor } from '../src/sim/schedule';

describe('rng', () => {
  test('same seed + stream replays the same sequence', () => {
    const a = new Rng(42, 'mortality');
    const b = new Rng(42, 'mortality');
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  test('different streams are independent', () => {
    const s = new RngStreams('seed');
    const x = s.stream('a').next();
    const y = s.stream('b').next();
    expect(x).not.toBe(y);
  });
  test('normal has the right moments', () => {
    const r = new Rng(7);
    let s = 0;
    let s2 = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const v = r.normal(2, 3);
      s += v;
      s2 += v * v;
    }
    const mean = s / n;
    const sd = Math.sqrt(s2 / n - mean * mean);
    expect(Math.abs(mean - 2)).toBeLessThan(0.1);
    expect(Math.abs(sd - 3)).toBeLessThan(0.1);
  });
});

describe('mortality', () => {
  test('presets reproduce their published life expectancies', () => {
    const sa = buildQxTable(MORTALITY_PRESETS.find((p) => p.id === 'sa-2024')!);
    expect(lifeExpectancy(sa.M)).toBeCloseTo(63.6, 0);
    expect(lifeExpectancy(sa.F)).toBeCloseTo(69.2, 0);
    const ag = buildQxTable(MORTALITY_PRESETS.find((p) => p.id === 'agincourt-2005-07')!);
    // Paper: 52.2 / 59.4 — the grouped→single conversion lands within ~4 years.
    expect(Math.abs(lifeExpectancy(ag.M) - 52.2)).toBeLessThan(4);
    expect(Math.abs(lifeExpectancy(ag.F) - 59.4)).toBeLessThan(4);
  });
  test('life table is monotone', () => {
    const t = buildQxTable(MORTALITY_PRESETS[0]);
    const lt = lifeTable(t.M);
    for (let i = 1; i < lt.length; i++) expect(lt[i].lx).toBeLessThanOrEqual(lt[i - 1].lx);
    expect(lt[lt.length - 1].lx).toBeGreaterThanOrEqual(0);
  });
});

describe('fertility', () => {
  test('scaling hits the target TFR', () => {
    expect(tfrOf(scaledAsfr(ASFR_SHAPE_SA, 2.41))).toBeCloseTo(2.41, 5);
  });
});

describe('calendar', () => {
  test('easter 2026 is April 5', () => {
    expect(easterSunday(2026)).toEqual({ month: 4, day: 5 });
    expect(holidayFor(2026, 4, 3)).toBe('Good Friday');
    expect(holidayFor(2026, 12, 25)).toBe('Christmas Day');
  });
});

describe('world', () => {
  test('every building in the region is reachable by road from the Ebenezer bus stop', () => {
    clearPathCache();
    const b = buildBuildings();
    const g = buildRoadGraph(b);
    for (const id in b) {
      const p = roadPath(g, b.busstop.roadNode, b[id].roadNode);
      expect(p).not.toBeNull();
    }
  });
  test('houses have beds and a yard', () => {
    const b = buildBuildings();
    const houses = Object.values(b).filter((x) => x.kind === 'house');
    expect(houses.length).toBe(124); // 40 Emmaus + 40 Newhaven + 44 Ithemba
    for (const h of houses) {
      expect(h.rooms.some((r) => r.kind === 'bedroom' && r.spots.length >= 2)).toBe(true);
      expect(h.rooms.some((r) => r.kind === 'yard')).toBe(true);
    }
  });
});

describe('engine', () => {
  test("builds the region's households with the essential roles", () => {
    const sim = new Simulation({ seed: 'test-1' });
    const w = sim.world;
    expect(Object.keys(w.households).length).toBe(100); // 32 Emmaus + 32 Newhaven + 36 Ithemba
    const coms = new Set(Object.values(w.households).map((h) => w.buildings[h.houseId]?.community));
    for (const c of RESIDENTIAL) expect(coms.has(c)).toBe(true);
    // six congregations, each with its own pastor — and none in the secular city
    for (const id of CHURCH_IDS) expect(w.roles.pastorByChurch[id]).not.toBeNull();
    expect(CHURCH_IDS.length).toBe(6);
    expect(Object.values(w.buildings).some((b) => b.kind === 'church' && cityOf(b.community) === 'newhaven')).toBe(false);
    // three councils: six elected seats + health each, spread across the city's settlements
    expect(w.council.length).toBe(21);
    for (const city of ['emmaus', 'newhaven', 'ithemba'] as const) {
      const elected = w.council.filter((s) => s.city === city && s.role !== 'health' && s.personId);
      const seatComs = elected.map((s) => s.community);
      for (const c of residentialOf(city)) expect(seatComs).toContain(c);
      for (const c of residentialOf(city)) expect(seatComs.filter((x) => x === c).length).toBeLessThanOrEqual(3);
      expect(w.council.find((s) => s.city === city && s.role === 'health')?.personId).toBe(w.roles.dmoByCity[city]);
      expect(w.roles.magistrateByCourt[landmark(residentialOf(city)[0], 'court')]).not.toBeNull();
      expect(w.roles.doctorByClinic[landmark(residentialOf(city)[0], 'clinic')]).not.toBeNull();
    }
    // the centre is staffed from every city
    expect(w.roles.surgeonIds.length).toBe(2);
    expect(w.roles.doctorByClinic.hospital).not.toBeNull();
    expect(w.roles.policeByStation['un-police'].length).toBeGreaterThan(0);
    expect(alivePeople(w).some((p) => p.job === 'centralbanker')).toBe(true);
    expect(alivePeople(w).some((p) => p.job === 'civilservant' && p.workplaceId === 'govt')).toBe(true);
    // the secular city keeps a low faith; the others a high one
    const faithOf = (city: string) => alivePeople(w).filter((p) => cityOf(w.buildings[w.households[p.householdId].houseId].community) === city).reduce((s, p, _, a) => s + p.faith / a.length, 0);
    expect(faithOf('newhaven')).toBeLessThan(0.2);
    expect(faithOf('ithemba')).toBeGreaterThan(0.8);
    expect(faithOf('emmaus')).toBeGreaterThan(0.8);
    // taxis at every rank, a patrol car at every station, ambulances at every base, two buses a line, two trains, two planes
    expect(Object.values(w.vehicles).filter((v) => v.kind === 'taxi').length).toBe(16);
    expect(Object.values(w.vehicles).filter((v) => v.kind === 'police').length).toBe(4);
    expect(Object.values(w.vehicles).filter((v) => v.kind === 'ambulance').length).toBe(6);
    expect(Object.values(w.vehicles).filter((v) => v.kind === 'bus').length).toBe(8);
    expect(Object.values(w.vehicles).filter((v) => v.kind === 'train').length).toBe(2);
    expect(Object.values(w.vehicles).filter((v) => v.kind === 'plane').length).toBe(2);
    expect(alivePeople(w).filter((p) => p.job === 'pilot').length).toBe(2);
    expect(alivePeople(w).filter((p) => p.job === 'busdriver').length).toBeGreaterThanOrEqual(4);
    // the estates run to a car per driver
    const hebron = Object.values(w.households).filter((h) => w.buildings[h.houseId]?.community === 'hebron');
    expect(hebron.some((h) => h.extraVehicleIds.length > 0)).toBe(true);
    expect(w.roles.pastorId).not.toBeNull();
    expect(w.roles.doctorId).not.toBeNull();
    expect(w.roles.policeIds.length).toBeGreaterThan(0);
    expect(w.roles.magistrateId).not.toBeNull();
    expect(alivePeople(w).length).toBeGreaterThan(250);
  });
  test('is deterministic for a given seed', () => {
    const a = new Simulation({ seed: 'det' });
    const b = new Simulation({ seed: 'det' });
    a.runDays(200);
    b.runDays(200);
    expect(a.world.stats).toEqual(b.world.stats);
    expect(Object.keys(a.world.people).length).toBe(Object.keys(b.world.people).length);
    // (Two 200-day runs: a few seconds, more on a busy machine.)
  }, 60_000);
  test('a different seed gives a different community', () => {
    const a = new Simulation({ seed: 'one' });
    const b = new Simulation({ seed: 'two' });
    const na = alivePeople(a.world).map((p) => p.firstName).join();
    const nb = alivePeople(b.world).map((p) => p.firstName).join();
    expect(na).not.toBe(nb);
  });
  test('runs three years without throwing and keeps books consistent', () => {
    // a long integration run: well over the default five seconds
    const sim = new Simulation({ seed: 'three-years' });
    sim.runDays(3 * 365);
    const w = sim.world;
    const alive = alivePeople(w).length;
    const born = w.stats.births;
    const dead = w.stats.deaths;
    // every alive person belongs to a live household containing them
    for (const p of alivePeople(w)) {
      const hh = w.households[p.householdId];
      expect(hh).toBeDefined();
      expect(hh.memberIds).toContain(p.id);
      expect(hh.dissolvedDay).toBeNull();
    }
    // exposures roughly equal person-years
    const py = w.stats.exposures.reduce((s, r) => s + r.exposureM + r.exposureF, 0);
    expect(py).toBeGreaterThan(alive * 2);
    expect(dead + alive + w.stats.emigrations).toBeGreaterThanOrEqual(born);
  }, 30_000);
  test('micro mode moves people through their day', () => {
    const sim = new Simulation({ seed: 'micro' });
    sim.setMicro(true);
    let moved = 0;
    for (let m = 0; m < 600; m++) {
      sim.advance(1);
      if (alivePeople(sim.world).some((p) => p.path.length > 0)) moved++;
    }
    expect(moved).toBeGreaterThan(50);
    expect(sim.world.minuteOfDay).toBe(600);
  });
});
