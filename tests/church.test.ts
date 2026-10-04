import { describe, expect, test } from 'bun:test';
import { Simulation } from '../src/sim/engine';
import { alivePeople } from '../src/sim/ctx';
import { applyWeatherOverride, weatherPresetFor } from '../src/sim/weather';

describe('the congregation', () => {
  test('the pastor is a man at initialisation', () => {
    for (const seed of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']) {
      const sim = new Simulation({ seed });
      const id = sim.world.roles.pastorId;
      expect(id).not.toBeNull();
      expect(sim.world.people[id!].sex).toBe('M');
    }
  });

  test(
    'the pastorate stays male through succession',
    () => {
      for (const seed of ['c1', 'c2']) {
        const sim = new Simulation({ seed });
        const seen = new Set<string>();
        sim.onDay.push((s) => {
          const pid = s.world.roles.pastorId;
          if (pid) seen.add(s.world.people[pid].sex);
        });
        sim.runDays(365 * 15);
        expect([...seen]).toEqual(['M']);
      }
    },
    // Thirty years of simulation: about 2 minutes on a quiet machine, over 3 on a busy one.
    360_000,
  );

  test('the pastor preaches without a gap, and the congregation mingles afterwards', () => {
    const sim = new Simulation({ seed: 'sunday' });
    const w = sim.world;
    const pastor = w.people[w.roles.pastorId!];
    sim.setMicro(true);
    let preached = 0;
    let gaps = 0;
    let bestTalking = 0;
    let atFellowship = 0;
    for (let m = 0; m < 720; m++) {
      sim.advance(1);
      if (pastor.plan[pastor.planIdx]?.kind === 'church' && pastor.loc.buildingId === 'church') {
        preached++;
        const c = pastor.conversationId ? w.conversations[pastor.conversationId] : null;
        const last = c?.lines[c.lines.length - 1];
        // The renderer shows a bubble while the last line — preached or sung —
        // is under 2.5 minutes old.
        const singing = c?.hymn ? w.minute - c.hymn.lineMinute <= 2.5 : false;
        if (c?.topic !== 'sermon' || (!singing && (!last || w.minute - last.minute > 2.5))) gaps++;
      }
      const fell = alivePeople(w).filter((p) => p.plan[p.planIdx]?.kind === 'fellowship');
      if (fell.length) {
        atFellowship = Math.max(atFellowship, fell.length);
        bestTalking = Math.max(bestTalking, fell.filter((p) => p.conversationId).length);
      }
    }
    expect(preached).toBeGreaterThan(60);
    expect(gaps).toBe(0);
    expect(atFellowship).toBeGreaterThan(10);
    expect(bestTalking / atFellowship).toBeGreaterThan(0.75);
  });

  test('the whole congregation sings the hymns, bar a few', () => {
    const sim = new Simulation({ seed: 'sunday' });
    const w = sim.world;
    const pastor = w.people[w.roles.pastorId!];
    sim.setMicro(true);
    let hymnMinutes = 0;
    let fullestPews = 0;
    let worstShare = 1;
    let sawSilent = false;
    const seenHymns = new Set<number>();
    for (let m = 0; m < 720; m++) {
      sim.advance(1);
      const c = pastor.conversationId ? w.conversations[pastor.conversationId] : null;
      const h = c?.topic === 'sermon' ? c.hymn : null;
      if (!h) continue;
      seenHymns.add(h.number);
      const inPews = h.singerIds.length + h.silentIds.length;
      // Never a solo: the pastor sings, and so does the room around him.
      expect(inPews).toBeGreaterThanOrEqual(8);
      expect(h.singerIds).toContain(pastor.id);
      fullestPews = Math.max(fullestPews, inPews);
      worstShare = Math.min(worstShare, h.singerIds.length / inPews);
      if (h.silentIds.length) sawSilent = true;
      hymnMinutes++;
    }
    // Several hymns in a morning, sung by a full church — never less than seven in ten of it, never all of it.
    expect(seenHymns.size).toBeGreaterThan(2);
    expect(hymnMinutes).toBeGreaterThan(20);
    expect(fullestPews).toBeGreaterThan(30);
    expect(worstShare).toBeGreaterThanOrEqual(0.7);
    expect(worstShare).toBeLessThan(1);
    expect(sawSilent).toBe(true);
    expect(w.stats.hymnsSung).toBeGreaterThan(2);
  });

  test('every pastor is at the pulpit for the whole evening service, and the congregation comes at six', () => {
    const sim = new Simulation({ seed: 'evensong' });
    const w = sim.world;
    sim.setMicro(true);
    sim.jumpToMinute(1040);
    let checked = 0;
    let crowd = 0;
    for (let m = 1040; m < 1148; m++) {
      sim.advance(1);
      if (w.minuteOfDay < 1075) continue;
      for (const [ch, pid] of Object.entries(w.roles.pastorByChurch)) {
        if (!pid) continue;
        const pulpit = w.buildings[ch].rooms.flatMap((r) => r.spots).find((sp) => sp.kind === 'pulpit')!;
        expect(w.people[pid].loc.spotId).toBe(pulpit.id);
        checked++;
      }
      if (w.minuteOfDay === 1095) crowd = alivePeople(w).filter((p) => p.plan[p.planIdx]?.kind === 'church' && p.loc.roomId?.endsWith('-nave')).length;
    }
    expect(checked).toBeGreaterThan(300);
    expect(crowd).toBeGreaterThan(30);
  }, 60_000);

  test('the pastor conducts a funeral or a wedding at his church from the pulpit, by name', () => {
    const sim = new Simulation({ seed: 'rites' });
    const w = sim.world;
    let g: (typeof w.scheduledGatherings)[number] | undefined;
    for (let d = 0; d < 500 && !g; d++) {
      sim.runDays(1);
      g = w.scheduledGatherings.find((x) => x.day === w.day + 1 && x.kind !== 'celebration' && w.buildings[x.buildingId]?.kind === 'church');
    }
    expect(g).toBeDefined();
    sim.runDays(1);
    const pastor = w.people[w.roles.pastorByChurch[g!.buildingId]!];
    const pulpit = w.buildings[g!.buildingId].rooms.flatMap((r) => r.spots).find((sp) => sp.kind === 'pulpit')!;
    sim.setMicro(true);
    sim.jumpToMinute(w.day * 1440 + g!.start - 30);
    const said = new Set<string>();
    for (let m = 0; m < 60; m++) {
      sim.advance(1);
      const c = pastor.conversationId ? w.conversations[pastor.conversationId] : null;
      for (const l of c?.lines ?? []) said.add(l.text);
      if (m < 25) continue;
      expect(pastor.plan[pastor.planIdx]?.role).toBe('lead');
      expect(pastor.loc.spotId).toBe(pulpit.id);
      expect(c?.tone).toBe(g!.kind === 'funeral' ? 'grief' : 'joy');
    }
    // The order of service names the one who has died, or the groom and the bride.
    const who = g!.label.replace(/^(funeral|wedding) of /, '').split(' & ');
    expect([...said].some((l) => who.every((n) => l.includes(n)))).toBe(true);
  }, 120_000);

  test('almost everyone is at the Sunday service', () => {
    const sim = new Simulation({ seed: 'attendance' });
    sim.runDays(365 * 2);
    const weeks = sim.world.stats.weeklyChurch;
    expect(weeks.length).toBeGreaterThan(80);
    const mean = weeks.reduce((s, c) => s + c.attendance / Math.max(1, c.population), 0) / weeks.length;
    expect(mean).toBeGreaterThan(0.85);
  }, 30_000);
});

describe('scene controls', () => {
  test('a held weather override survives day steps and lapses when it is not held', () => {
    const sim = new Simulation({ seed: 'wx' });
    const w = sim.world;
    const held = { ...weatherPresetFor('heatwave', w.weather), hold: true, setDay: w.day };
    w.weatherOverride = held;
    w.weather = applyWeatherOverride(w.weather, held);
    sim.runDays(6);
    expect(w.weather.condition).toBe('heatwave');
    expect(w.weatherOverride).not.toBeNull();

    w.weatherOverride = { ...weatherPresetFor('snow', w.weather), hold: false, setDay: w.day };
    sim.runDays(1);
    expect(w.weatherOverride).toBeNull();
    expect(w.weather.condition).not.toBe('snow');
  });

  test('forcing the weather never rewrites the season', () => {
    const sim = new Simulation({ seed: 'wx2' });
    const w = sim.world;
    const before = w.weather.season;
    const o = { ...weatherPresetFor('snow', w.weather), hold: true, setDay: w.day };
    w.weather = applyWeatherOverride(w.weather, o);
    expect(w.weather.condition).toBe('snow');
    expect(w.weather.season).toBe(before);
  });

  test('jumping forward simulates every day in between', () => {
    const a = new Simulation({ seed: 'jump' });
    a.jumpToMinute(400 * 1440 + 600);
    const b = new Simulation({ seed: 'jump' });
    b.runDays(400);
    b.advance(600);
    expect(a.world.day).toBe(b.world.day);
    expect(a.world.stats.births).toBe(b.world.stats.births);
    expect(a.world.stats.deaths).toBe(b.world.stats.deaths);
    // ...and it refuses to run backwards
    expect(a.jumpToMinute(10)).toBe(0);
  }, 20_000);
});
