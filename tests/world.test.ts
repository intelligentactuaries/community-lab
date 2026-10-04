import { describe, expect, test } from 'bun:test';
import { Simulation } from '../src/sim/engine';
import { alivePeople } from '../src/sim/ctx';
import { BUS_LINES, CITIES, COMMUNITIES, COMMUNITY, EXITS, STATIONS, TAXI_RANK_IDS, TRACK, buildBuildings, buildRoadGraph, clearPathCache, communityAt, landmark, nearestRoadPoint, roadDistance, roadPath, trackPoint } from '../src/sim/world';
import { TAXI_MIN_DISTANCE } from '../src/sim/movement';

describe('the region', () => {
  clearPathCache();
  const b = buildBuildings();
  const g = buildRoadGraph(b);
  test('three cities and the centre, every building in its settlement, every settlement in its city', () => {
    expect(CITIES.filter((c) => c.kind === 'city').length).toBe(3);
    for (const id in b) {
      const x = b[id];
      const c = COMMUNITY[x.community];
      expect(communityAt(x.x + x.w / 2, x.y + x.h / 2)).toBe(x.community);
      const city = CITIES.find((k) => k.id === c.city)!;
      expect(c.x >= city.x && c.y >= city.y && c.x + c.w <= city.x + city.w && c.y + c.h <= city.y + city.h).toBe(true);
    }
  });
  test('the road network is one connected graph: every building reaches every exit, and no two streets overlap a building', () => {
    for (const e of EXITS) expect(g.nodes[e.node]).toBeDefined();
    const ids = Object.keys(b);
    for (const id of ids) {
      expect(nearestRoadPoint(b[id].entrance.x, b[id].entrance.y).d).toBeLessThanOrEqual(40);
      for (const e of EXITS) expect(roadPath(g, b[id].roadNode, e.node)).not.toBeNull();
    }
  });
  test('the cities are a drive apart, direct and via the centre', () => {
    const km = (a: string, c: string) => roadDistance(g, b[a].roadNode, b[c].roadNode) / 1000;
    expect(km('church', 'nh-library')).toBeGreaterThan(2.5);
    expect(km('church', 'it-church')).toBeGreaterThan(2.5);
    expect(km('nh-school', 'it-school')).toBeGreaterThan(2.5);
    // and the centre sits between them
    for (const home of ['house1', 'house111', 'house201']) {
      expect(km(home, 'mall')).toBeLessThan(km('church', 'it-church'));
      expect(km(home, 'hospital')).toBeGreaterThan(TAXI_MIN_DISTANCE / 1000);
    }
  });
  test('every settlement has what it needs, and only the church-going cities have churches', () => {
    for (const c of COMMUNITIES) {
      for (const k of ['shop', 'bank', 'park', 'busstop', 'school', 'clinic', 'police', 'court', 'council', 'medical', 'cemetery', 'hall', 'taxi', 'workshop', 'office', 'farm'] as const) expect(b[landmark(c.id, k)]).toBeDefined();
      const church = landmark(c.id, 'church');
      const city = CITIES.find((k) => k.id === c.city)!;
      if (c.tier === 'civic') continue;
      expect(church !== null).toBe(city.religious);
    }
    for (const id of TAXI_RANK_IDS) expect(b[id]).toBeDefined();
  });
});

describe('the centre in use', () => {
  test('taxis run, the mall and the park draw from every city, and the hospital takes referrals', () => {
    const sim = new Simulation({ seed: 'region' });
    const w = sim.world;
    sim.setMicro(true);
    // A Saturday, so the mall, the match and the taxis are all in play.
    while (sim.ctx.cal.weekday !== 6) sim.runDays(1);
    sim.setMicro(true);
    const cities = new Set<string>();
    let rides = 0;
    let atCentre = 0;
    for (let m = 0; m < 1200; m++) {
      sim.advance(1);
      if (m % 60 === 0) {
        for (const p of alivePeople(w)) {
          const at = p.loc.buildingId;
          if (at && COMMUNITY[w.buildings[at].community].city === 'unity') {
            atCentre++;
            cities.add(COMMUNITY[w.buildings[w.households[p.householdId].houseId].community].city);
          }
        }
      }
      rides = w.stats.taxiRides;
    }
    expect(atCentre).toBeGreaterThan(20);
    expect(cities.size).toBe(3);
    expect(rides).toBeGreaterThan(5);
    // Over a few years the central hospital takes the theatre cases.
    sim.runDays(365 * 3);
    expect(w.stats.surgeries).toBeGreaterThan(3);
    expect(w.stats.hospitalisations).toBeGreaterThanOrEqual(w.stats.surgeries);
  }, 60_000);
});

describe('the transport', () => {
  const b = buildBuildings();
  const g = buildRoadGraph(b);
  test('the Hyperline calls at five stations in line order, each beside the guideway, and runs through no building', () => {
    expect(STATIONS.length).toBe(5);
    expect(STATIONS.map((s) => s.name)).toEqual(['Emmaus', 'Unity Central', 'Ithemba', 'Airport', 'Newhaven']);
    let last = -1;
    for (const st of STATIONS) {
      const sb = b[st.id];
      expect(sb?.kind).toBe('station');
      const pt = trackPoint(st.t);
      expect(Math.hypot(pt.x - st.x, pt.y - st.y)).toBeLessThan(0.5);
      const gap = Math.max(sb.x - st.x, st.x - (sb.x + sb.w), sb.y - st.y, st.y - (sb.y + sb.h));
      expect(gap).toBeGreaterThan(1);
      expect(gap).toBeLessThanOrEqual(20);
      expect(st.t).toBeGreaterThan(last);
      last = st.t;
    }
    for (let i = 1; i < TRACK.length; i++) {
      const a = TRACK[i - 1];
      const c = TRACK[i];
      for (const id in b) {
        const x = b[id];
        const hor = a.y === c.y;
        const lo = hor ? Math.min(a.x, c.x) : Math.min(a.y, c.y);
        const hi = hor ? Math.max(a.x, c.x) : Math.max(a.y, c.y);
        const at = hor ? a.y : a.x;
        const crosses = hor ? at + 3 > x.y && at - 3 < x.y + x.h && hi > x.x && lo < x.x + x.w : at + 3 > x.x && at - 3 < x.x + x.w && hi > x.y && lo < x.y + x.h;
        expect(crosses, `the Hyperline runs through ${id}`).toBe(false);
      }
    }
    // every settlement is within a walk of a station
    for (const c of COMMUNITIES) {
      if (c.tier === 'civic') continue;
      const cx = c.x + c.w / 2;
      const cy = c.y + c.h / 2;
      const d = Math.min(...STATIONS.map((s) => Math.hypot(b[s.id].entrance.x - cx, b[s.id].entrance.y - cy)));
      expect(d, `${c.id} is ${d.toFixed(0)} m from the nearest station`).toBeLessThan(1000);
    }
  });
  test('every bus line is drivable stop to stop and ends at the terminus or the airport', () => {
    expect(BUS_LINES.length).toBe(4);
    for (const line of BUS_LINES) {
      for (let i = 0; i < line.stops.length; i++) {
        const s = b[line.stops[i]];
        expect(s, `${line.id}: ${line.stops[i]}`).toBeDefined();
        expect(s.kind === 'busstop' || s.kind === 'terminus').toBe(true);
        if (i) expect(roadPath(g, b[line.stops[i - 1]].roadNode, s.roadNode)).not.toBeNull();
      }
      expect(line.stops.includes('terminus')).toBe(true);
    }
  });
  test('the airport has a 1.6 km runway, a terminal with two stands, its own station and bus stop, and a road to the province', () => {
    expect(b['ap-runway'].h).toBeGreaterThanOrEqual(1600);
    expect(b['ap-terminal'].rooms.find((r) => r.name === 'Apron')?.spots.length).toBe(2);
    expect(b['st-airport'].kind).toBe('station');
    expect(b['ap-busstop'].kind).toBe('busstop');
    for (const e of EXITS) expect(roadPath(g, b['ap-terminal'].roadNode, e.node)).not.toBeNull();
    expect(CITIES.find((c) => c.id === 'airport')?.kind).toBe('airport');
    expect(communityAt(b['ap-runway'].x + 10, b['ap-runway'].y + 800)).toBe('airfield');
  });
});
