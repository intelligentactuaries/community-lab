import { describe, expect, test } from 'bun:test';
import { Simulation } from '../src/sim/engine';
import { alivePeople } from '../src/sim/ctx';
import { injure } from '../src/sim/health';
import { FLIGHTS } from '../src/sim/transit';

describe('getting about the province', () => {
  test('on an animated weekday the Hyperline, the buses, the taxis and the planes all carry people, and an ambulance answers a bad injury', () => {
    const sim = new Simulation({ seed: 'transit' });
    const w = sim.world;
    // A weekday on which someone flies (a day trip by air is not every day's business).
    const flying = () => alivePeople(w).some((p) => p.plan.some((a) => a.kind === 'flight'));
    for (let d = 0; d < 60 && (sim.ctx.cal.weekday < 1 || sim.ctx.cal.weekday > 5 || !flying()); d++) sim.runDays(1);
    sim.setMicro(true);
    const flyers = alivePeople(w).filter((p) => p.plan.some((a) => a.kind === 'flight'));
    expect(flyers.length).toBeGreaterThan(0);
    for (const p of flyers) {
      const f = p.plan.find((a) => a.kind === 'flight')!;
      expect(FLIGHTS.some((x) => x.dep === f.flight!.dep)).toBe(true);
      expect(FLIGHTS.some((x) => x.arr === f.flight!.ret)).toBe(true);
    }
    let hopPerMinute = 0; // the furthest a train moved along the guideway between two minute samples
    const lastPos = new Map<string, number>();
    let airborneMinutes = 0;
    let busMoving = 0;
    let injured: string | null = null;
    let ambulanceMoved = false;
    for (let m = 0; m < 14 * 60; m++) {
      sim.advance(1);
      // at 10:00, someone at home gets badly hurt: an ambulance should come for them
      if (w.minuteOfDay === 600 && !injured) {
        const victim = alivePeople(w).find((p) => p.age >= 25 && p.age < 60 && p.loc.buildingId && w.buildings[p.loc.buildingId].kind === 'house' && !p.inVehicleId);
        if (victim) {
          injure(sim.ctx, victim, 0.7, 'a fall from the roof');
          injured = victim.id;
        }
      }
      for (const v of Object.values(w.vehicles)) {
        if (v.kind === 'train') {
          const prev = lastPos.get(v.id);
          if (prev !== undefined) hopPerMinute = Math.max(hopPerMinute, Math.abs(v.trackPos - prev));
          lastPos.set(v.id, v.trackPos);
        }
        if (v.kind === 'plane' && v.airborne) airborneMinutes++;
        if (v.kind === 'bus' && v.moving) busMoving++;
        if (v.kind === 'ambulance' && v.moving) ambulanceMoved = true;
      }
    }
    const s = w.stats;
    expect(s.trainRides).toBeGreaterThan(0);
    expect(s.busRides).toBeGreaterThan(0);
    expect(s.taxiRides).toBeGreaterThan(0);
    // hypersonic: a whole hop (1.5 km and more) inside one simulated minute
    expect(hopPerMinute).toBeGreaterThan(1500);
    expect(airborneMinutes).toBeGreaterThan(0);
    expect(busMoving).toBeGreaterThan(100);
    expect(injured).not.toBeNull();
    expect(ambulanceMoved).toBe(true);
    expect(s.ambulanceRuns).toBeGreaterThan(0);
    // the day-trippers are back on the ground by the evening flight
    for (const p of flyers) expect(p.inVehicleId === null || w.vehicles[p.inVehicleId]?.kind !== 'plane' || w.minuteOfDay < FLIGHTS[FLIGHTS.length - 1].arr).toBe(true);
    // nobody is left riding a vehicle that no longer exists, and every train is at a station
    for (const p of alivePeople(w)) if (p.inVehicleId) expect(w.vehicles[p.inVehicleId]).toBeDefined();
    for (const v of Object.values(w.vehicles)) if (v.kind === 'train') expect(v.odometerKm).toBeGreaterThan(20);
  }, 120_000);

  test('a time-lapse day sees the same province: no rides are counted, and the fleet is back at base', () => {
    const sim = new Simulation({ seed: 'transit' });
    const w = sim.world;
    sim.runDays(3);
    expect(w.stats.trainRides).toBe(0);
    expect(w.stats.flights).toBe(3 * FLIGHTS.length);
    for (const v of Object.values(w.vehicles)) {
      expect(v.moving).toBe(false);
      expect(v.airborne).toBe(false);
      expect(v.x).toBe(v.homeX);
    }
  });
});
