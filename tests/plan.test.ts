// The Community Builder's worlds: the plan → atlas derivation reproduces the
// province exactly; built worlds run, keep sound books and degrade gracefully
// where they lack a place; the checks catch what would break a run; the edits
// do what they say; and runs stay deterministic when worlds share a process.

import { describe, expect, test } from 'bun:test';
import { activeAtlas } from '../src/sim/atlas';
import { alivePeople } from '../src/sim/ctx';
import { Simulation } from '../src/sim/engine';
import { auditBooks, verifyChain } from '../src/sim/finance/accounts';
import { provinceAtlas } from '../src/sim/layout/province';
import { ASSETS, assetSize } from '../src/sim/plan/assets';
import { atlasFor, deriveAtlas, materialise } from '../src/sim/plan/derive';
import { addSettlement, duplicateBuildings, moveBuildings, newBuilding, removeBuildings, snapToRoad, turnBuilding } from '../src/sim/plan/edit';
import { canonicalJson, planHash } from '../src/sim/plan/hash';
import { DATASET_COLUMNS, readWorld, worldFilename, worldSceText } from '../src/sim/plan/sce';
import { street } from '../src/sim/plan/prefabs';
import { provincePlan, provincePlanHash } from '../src/sim/plan/province';
import { blankPlan, masakhanePlan } from '../src/sim/plan/templates';
import type { PlanBuilding, WorldPlan } from '../src/sim/plan/types';
import { validatePlan } from '../src/sim/plan/validate';
import { DEFAULT_PARAMS, basisHash, mergeParams } from '../src/sim/params';
import { hash32 } from '../src/sim/rng';
import { ESSENTIAL_POSTS } from '../src/sim/institutions';
import { bareStreet, twoTowns } from './fixtures/worlds';

const h = (o: unknown) => hash32(JSON.stringify(o));

describe('the province as a plan', () => {
  test('deriving the province plan gives back the built-in atlas, table for table and building for building', () => {
    const a = provinceAtlas();
    const d = deriveAtlas(provincePlan());
    for (const k of Object.keys(a) as Array<keyof typeof a>) {
      if (['id', 'name', 'region', 'plan', 'hash', 'buildings'].includes(k)) continue;
      expect(JSON.stringify(d[k])).toBe(JSON.stringify(a[k]));
    }
    expect(JSON.stringify(d.buildings())).toBe(JSON.stringify(a.buildings()));
  });

  test('the unaltered province plan is recognised and runs as the built-in province', () => {
    expect(atlasFor(provincePlan())).toBe(provinceAtlas());
    expect(planHash(provincePlan())).toBe(provincePlanHash());
    const a = new Simulation({ seed: 'plan-p' });
    const b = new Simulation({ seed: 'plan-p', plan: provincePlan() });
    expect(b.world.basisHash).toBe(a.world.basisHash);
    a.runDays(40);
    b.runDays(40);
    expect(h(b.world.people)).toBe(h(a.world.people));
    expect(h(b.world.finance.ledgers.journal.entries)).toBe(h(a.world.finance.ledgers.journal.entries));
  });

  test('an edited copy of the province runs through the derived path to the same world (only its opening line differs)', () => {
    const plan = provincePlan();
    plan.description = 'the province, re-derived';
    plan.name = 'Ebenezer';
    const a = new Simulation({ seed: 'plan-d' });
    const b = new Simulation({ seed: 'plan-d', plan });
    expect(b.atlas).not.toBe(provinceAtlas());
    a.runDays(60);
    b.runDays(60);
    for (const k of ['people', 'households', 'vehicles', 'council', 'roles', 'stats', 'insurance'] as const) expect(h(b.world[k])).toBe(h(a.world[k]));
    expect(h(b.world.finance.ledgers.journal.entries)).toBe(h(a.world.finance.ledgers.journal.entries));
    // Only the opening event (it names the world and its basis) differs.
    const ea = a.world.events.map((e) => e.text);
    const eb = b.world.events.map((e) => e.text);
    expect(eb.length).toBe(ea.length);
    const differ = ea.map((t, i) => (t === eb[i] ? -1 : i)).filter((i) => i >= 0);
    expect(differ.length).toBe(1);
    expect(eb[differ[0]]).toContain('Basis');
  });

  test('the basis hash of the default scenario is the one it always was', () => {
    // The formula before worlds existed: every parameter, sorted, JSON-encoded.
    const P = mergeParams({});
    const keys = Object.keys(P).sort();
    const canon = keys.map((k) => `${k}=${JSON.stringify((P as unknown as Record<string, unknown>)[k])}`).join('|');
    const old = (hash32(canon).toString(16).padStart(8, '0') + hash32(canon + '#2').toString(16).padStart(8, '0')).slice(0, 12);
    expect(basisHash(P)).toBe(old);
    expect(new Simulation({}).world.basisHash).toBe(old);
  });
});

describe('a built world', () => {
  test('Masakhane passes its checks, staffs every post and keeps sound books for two years', () => {
    const plan = masakhanePlan();
    expect(validatePlan(plan).filter((i) => i.level !== 'note')).toEqual([]);
    const sim = new Simulation({ seed: 'masakhane-t', plan });
    const w = sim.world;
    expect(Object.keys(w.households).length).toBe(38);
    // Every post the community cannot leave empty has its holder at the start.
    const posts = ESSENTIAL_POSTS();
    expect(posts.length).toBeGreaterThan(20);
    const people = alivePeople(w);
    for (const p of posts) expect(people.some((q) => q.job === p.job && q.workplaceId === p.workplace)).toBe(true);
    // A pastor for each church, a doctor at the clinic, a full council.
    for (const id of activeAtlas().churchIds) expect(w.roles.pastorByChurch[id]).toBeTruthy();
    expect(Object.values(w.roles.doctorByClinic).filter(Boolean).length).toBeGreaterThan(0);
    expect(w.council.filter((s) => s.personId).length).toBe(7);
    sim.runDays(730);
    const L = w.finance.ledgers;
    expect(verifyChain(L).ok).toBe(true);
    expect(auditBooks(L)).toEqual([]);
    expect(JSON.stringify(w)).not.toMatch(/NaN|Infinity/);
    expect(w.stats.weeklyChurch.length).toBeGreaterThan(90);
    const att = w.stats.weeklyChurch.slice(-20).reduce((s, c) => s + c.attendance / Math.max(1, c.population), 0) / 20;
    expect(att).toBeGreaterThan(0.6);
    expect(alivePeople(w).length).toBeGreaterThan(100);
  });

  test('a bare street (houses and a spaza, nothing else) runs: no school, no clinic, no police, no church', () => {
    const plan = bareStreet();
    expect(validatePlan(plan).filter((i) => i.level === 'error')).toEqual([]);
    const sim = new Simulation({ seed: 'bare-t', plan });
    sim.setMicro(true);
    sim.advance(24 * 60 + 8 * 60);
    for (let i = 0; i < 120; i++) sim.advance(1);
    sim.runDays(365);
    const w = sim.world;
    expect(alivePeople(w).length).toBeGreaterThan(40);
    expect(verifyChain(w.finance.ledgers).ok).toBe(true);
    expect(auditBooks(w.finance.ledgers)).toEqual([]);
    expect(JSON.stringify(w)).not.toMatch(/NaN|Infinity/);
    // Nobody went to a school or a church that is not there.
    for (const p of alivePeople(w)) for (const a of p.plan) expect(w.buildings[a.buildingId]).toBeDefined();
  });

  test('two towns on a Hyperline, with a terminus and an airfield: the trains, buses and planes run', () => {
    const sim = new Simulation({ seed: 'towns-t', plan: twoTowns() });
    const w = sim.world;
    const kinds = Object.values(w.vehicles).reduce((a: Record<string, number>, v) => ((a[v.kind] = (a[v.kind] ?? 0) + 1), a), {});
    expect(kinds.train).toBe(2);
    expect(kinds.plane).toBe(2);
    expect(kinds.bus).toBeGreaterThanOrEqual(4);
    expect(sim.atlas.stations.length).toBe(3);
    expect(sim.atlas.runway).not.toBeNull();
    sim.setMicro(true);
    sim.advance(24 * 60 + 5 * 60);
    const odo = Object.fromEntries(Object.values(w.vehicles).map((v) => [v.id, v.odometerKm]));
    for (let i = 0; i < 5 * 60; i++) sim.advance(1);
    const moved = (kind: string) => Object.values(w.vehicles).some((v) => v.kind === kind && v.odometerKm > odo[v.id] + 0.05);
    expect(moved('train')).toBe(true);
    expect(moved('bus')).toBe(true);
    expect(w.stats.trainRides).toBeGreaterThan(0);
    sim.runDays(365);
    expect(verifyChain(w.finance.ledgers).ok).toBe(true);
    expect(JSON.stringify(w)).not.toMatch(/NaN|Infinity/);
    const tm = w.finance.transport.months[w.finance.transport.months.length - 1];
    expect(tm.air.landings).toBeGreaterThan(0);
    expect(tm.transit.trainKm).toBeGreaterThan(0);
  });

  test('a world without buses, trains or an airport books nothing for them', () => {
    const sim = new Simulation({ seed: 'bare-t2', plan: bareStreet() });
    sim.runDays(120);
    const tm = sim.world.finance.transport.months.at(-1)!;
    expect(tm.transit.busKm).toBe(0);
    expect(tm.transit.trainKm).toBe(0);
    expect(tm.air.landings).toBe(0);
    expect(sim.world.stats.flights).toBe(0);
  });

  test('a template comes out the same every time (but for its own id)', () => {
    const a = masakhanePlan();
    const b = masakhanePlan();
    expect(JSON.stringify(b.buildings)).toBe(JSON.stringify(a.buildings));
    expect(JSON.stringify(b.roads)).toBe(JSON.stringify(a.roads));
  });

  test('the same plan and seed give the same world, even with another world running in between', () => {
    const plan = masakhanePlan();
    const a = new Simulation({ seed: 'det-t', plan: structuredClone(plan) });
    a.runDays(100);
    const alone = h(a.world.people);
    const b = new Simulation({ seed: 'det-t', plan: structuredClone(plan) });
    const other = new Simulation({ seed: 'det-o', plan: bareStreet() });
    for (let i = 0; i < 10; i++) {
      b.runDays(10);
      other.runDays(7);
    }
    expect(h(b.world.people)).toBe(alone);
    const prov = new Simulation({ seed: 'det-p' });
    prov.runDays(5);
    expect(prov.atlas).toBe(provinceAtlas());
  });

  test("a settlement can depart from its tier's profile: its own unemployment, cars and cover", () => {
    const plan = masakhanePlan();
    const base = new Simulation({ seed: 'prof-t', plan: structuredClone(plan) });
    const own = structuredClone(plan);
    own.settlements = own.settlements.map((s) => (s.id === 'ubuntu' ? { ...s, profile: { unemployment: 0.75, carOwnership: 0, medicalAidShare: 1 } } : s));
    const sim = new Simulation({ seed: 'prof-t', plan: own });
    const inUbuntu = (w: typeof sim.world) => Object.values(w.households).filter((hh) => w.buildings[hh.houseId]?.community === 'ubuntu');
    const jobless = (w: typeof sim.world) => inUbuntu(w).flatMap((hh) => hh.memberIds.map((id) => w.people[id])).filter((p) => p.age >= 18 && p.age < 60 && p.job === 'unemployed').length;
    expect(jobless(sim.world)).toBeGreaterThan(jobless(base.world));
    expect(inUbuntu(sim.world).filter((hh) => hh.vehicleId).length).toBe(0);
    expect(inUbuntu(base.world).filter((hh) => hh.vehicleId).length).toBeGreaterThan(0);
    const medical = (w: typeof sim.world) => inUbuntu(w).filter((hh) => hh.insurance.medical).length;
    expect(medical(sim.world)).toBeGreaterThan(medical(base.world));
    expect(sim.atlas.communities.find((c) => c.id === 'ubuntu')!.profile).toEqual({ unemployment: 0.75, carOwnership: 0, medicalAidShare: 1 });
  });

  test('a plan is hashed by its content, not by the order its keys were written in', () => {
    const p = masakhanePlan();
    const shuffled = JSON.parse(canonicalJson(p)) as WorldPlan;
    expect(planHash(shuffled)).toBe(planHash(p));
    // The same world made twice (a fresh storage id, a fresh timestamp) is the same world; a moved church is not.
    expect(planHash(masakhanePlan())).toBe(planHash(p));
    expect(planHash({ ...p, buildings: p.buildings.map((b) => (b.asset === 'church' ? { ...b, x: b.x + 2 } : b)) })).not.toBe(planHash(p));
    const sim = new Simulation({ seed: 's', plan: p });
    expect(sim.world.basisHash).not.toBe(new Simulation({ seed: 's' }).world.basisHash);
  });
});

describe('the .sce file', () => {
  const at = '2026-10-15T08:00:00.000Z';

  test("a world saved as .sce is a Scelo project file that opens here as the same world", () => {
    const p = masakhanePlan();
    const doc = JSON.parse(worldSceText(p, at));
    // What every reader in the family checks first (Scelo's parseSce).
    expect(doc.format).toBe('scelo-project');
    expect(doc.version).toBe(1);
    expect(doc.app).toBe('Community Lab');
    expect(doc.savedAt).toBe(at);
    expect(doc.project).toMatchObject({ id: p.id, name: p.name });
    expect(typeof doc.project.createdAt).toBe('number');
    expect('dataset' in doc.session).toBe(true);
    for (const k of ['filters', 'selectedModels', 'modelWires', 'transformLog', 'events', 'tables']) expect(Array.isArray(doc.session[k])).toBe(true);
    // Scelo opens it as a table of the world's buildings.
    expect(doc.session.dataset.columns).toEqual(DATASET_COLUMNS);
    expect(doc.session.dataset.rows).toHaveLength(p.buildings.length);
    for (const r of doc.session.dataset.rows) expect(Object.keys(r).sort()).toEqual([...DATASET_COLUMNS].sort());
    const church = doc.session.dataset.rows.find((r: Record<string, unknown>) => r.asset === 'church');
    expect(church).toMatchObject({ settlement: 'Ubuntu', city: 'Masakhane', tier: 'middle' });
    // And this lab opens it as the world it was.
    const back = readWorld(JSON.stringify(doc));
    expect(planHash(back.plan)).toBe(planHash(p));
    expect(back.plan.id).toBe(p.id);
    expect(back).toMatchObject({ savedAt: at, app: 'Community Lab' });
  });

  test('a .sce from Scelo, a newer file, a bare world and a broken file are each told apart', () => {
    const scelo = { format: 'scelo-project', version: 1, app: 'Scelo', savedAt: at, project: { id: 'p1', name: 'Claims', createdAt: 0 }, session: { dataset: { name: 'claims.csv', columns: ['a'], rows: [{ a: 1 }] }, filters: [] } };
    expect(() => readWorld(JSON.stringify(scelo))).toThrow(/not a Community Lab world: open it in Scelo/);
    expect(() => readWorld(JSON.stringify({ ...JSON.parse(worldSceText(masakhanePlan(), at)), version: 2 }))).toThrow(/newer version/);
    expect(() => readWorld('{"format":"scelo-project","version":1,"world":{"format":"community-lab.world/9"}}')).toThrow(/newer Community Lab/);
    expect(() => readWorld('not json')).toThrow(/valid JSON/);
    expect(() => readWorld('{"hello":1}')).toThrow(/scelo-project header/);
    const bare = masakhanePlan();
    expect(planHash(readWorld(JSON.stringify(bare)).plan)).toBe(planHash(bare));
  });

  test('a world is saved under its own name, slugged as Scelo slugs a project', () => {
    expect(worldFilename({ name: 'Masakhane' })).toBe('masakhane.sce');
    expect(worldFilename({ name: 'Thembisa & Co (v2)' })).toBe('thembisa-co-v2.sce');
    expect(worldFilename({ name: '  ' })).toBe('world.sce');
  });
});

describe('the checks', () => {
  const codes = (p: WorldPlan) => validatePlan(p).filter((i) => i.level === 'error').map((i) => i.code);

  test("a settlement's own figures must be shares, a range of months and a schooling mix", () => {
    const base = masakhanePlan();
    const withProfile = (profile: object) => ({ ...base, settlements: base.settlements.map((s) => (s.id === 'ubuntu' ? { ...s, profile } : s)) }) as WorldPlan;
    expect(codes(withProfile({ unemployment: 0.4, savingsMonths: [1, 3] }))).toEqual([]);
    expect(codes(withProfile({ unemployment: 1.7 }))).toEqual(['bad-profile']);
    expect(codes(withProfile({ savingsMonths: [4, 2] }))).toEqual(['bad-profile']);
    expect(codes(withProfile({ educationMix: { none: 0.5, primary: 0.1, secondary: 0.1, matric: 0.1, tertiary: 0.1, postgrad: 0.4 } }))).toEqual(['bad-profile']);
  });

  test('an empty world says what it needs', () => {
    expect(codes(blankPlan()).sort()).toEqual(['no-homes', 'no-roads', 'no-shop']);
  });

  test('overlaps, unreachable doors, broken roads and strays off the map are errors', () => {
    const base = masakhanePlan();
    const church = base.buildings.find((b) => b.asset === 'church')!;
    expect(codes({ ...base, buildings: [...base.buildings, { ...church, id: 'church-copy', x: church.x + 10 }] })).toContain('overlap');
    expect(codes({ ...base, buildings: base.buildings.map((b) => (b.id === church.id ? { ...b, x: -20 } : b)) })).toContain('outside-world');
    expect(codes({ ...base, roads: [...base.roads, { name: 'Bent', x1: 10, y1: 10, x2: 50, y2: 60 }] })).toContain('diagonal-road');
    const far: PlanBuilding = { ...church, id: 'far-church', x: 1200, y: 1080, w: 104, h: 74 };
    const withFar = { ...base, buildings: [...base.buildings, far] };
    expect(codes(withFar)).toContain('no-road');
    // An island: a road of its own, not joined to the rest.
    const island = { ...withFar, roads: [...withFar.roads, { name: 'Island Road', x1: 1100, y1: 1140, x2: 1500, y2: 1140 }] };
    expect(codes(island)).toContain('disconnected');
    expect(codes({ ...base, buildings: base.buildings.map((b) => (b.id === church.id ? { ...b, asset: 'cathedral', raw: undefined } : b)) })).toContain('unknown-asset');
  });

  test('the engine will not run a world that fails its checks, and says why', () => {
    expect(() => new Simulation({ plan: blankPlan() })).toThrow(/cannot run yet: Place some houses/);
  });
});

describe('building and editing', () => {
  test('every asset lays out at its own size and at its smallest, its door on the side it faces', () => {
    for (const a of ASSETS) {
      for (const facing of a.facings) {
        for (const size of [assetSize(a, { facing }), a.min]) {
          if (a.kind === 'house' && size === a.min) continue;
          const sz = a.kind === 'house' ? assetSize(a, { facing }) : size;
          const pb: PlanBuilding = { id: 'x', asset: a.id, name: a.label, settlement: 's', x: 400, y: 400, w: sz.w, h: sz.h, facing, ...(a.kind === 'house' ? { plot: 1 } : {}) };
          const b = materialise({ ...blankPlan(), buildings: [pb] }).x;
          expect(b).toBeDefined();
          expect(b.kind).toBe(a.kind);
          const e = b.entrance;
          const side = e.y === b.y ? 'N' : e.y === b.y + b.h ? 'S' : e.x === b.x ? 'W' : e.x === b.x + b.w ? 'E' : '?';
          if (a.id !== 'runway') expect(side).toBe(facing);
          // Rooms stay inside the footprint, but for the yards and squares laid out in front.
          for (const r of b.rooms) {
            if (r.kind === 'yard' && (r.y < b.y - 0.01 || r.y + r.h > b.y + b.h + 0.01 || r.x < b.x - 0.01 || r.x + r.w > b.x + b.w + 0.01)) continue;
            expect(r.x).toBeGreaterThanOrEqual(b.x - 0.01);
            expect(r.y).toBeGreaterThanOrEqual(b.y - 0.01);
            expect(r.x + r.w).toBeLessThanOrEqual(b.x + b.w + 0.01);
            expect(r.y + r.h).toBeLessThanOrEqual(b.y + b.h + 0.01);
          }
        }
      }
    }
  });

  test('a street of houses lines both sides, gates to the road, and nothing overlaps', () => {
    const p = street({ x1: 100, y1: 300, x2: 700, y2: 300, name: 'Test Street', tier: 'standard', sides: 'both', settlement: 'village', taken: new Set(), plotsUsed: new Set(), withRoad: true });
    expect(p.buildings.length).toBe(20);
    for (const b of p.buildings) expect(b.facing === 'S' ? b.y + b.h : b.y).toBe(b.facing === 'S' ? 285 : 315);
    const v = street({ x1: 500, y1: 100, x2: 500, y2: 700, name: 'Test Link', tier: 'small', sides: 'both', settlement: 'village', taken: new Set(), plotsUsed: new Set() });
    for (const b of v.buildings) expect(b.facing === 'E' || b.facing === 'W').toBe(true);
    const plan: WorldPlan = { ...blankPlan(), roads: [...p.roads, { name: 'Test Link', x1: 500, y1: 100, x2: 500, y2: 700 }], buildings: v.buildings };
    expect(validatePlan(plan).filter((i) => i.code === 'overlap')).toEqual([]);
    // East- and west-facing houses keep their rooms on the plot and their gate on the road side.
    const built = materialise(plan);
    for (const b of v.buildings) {
      const hb = built[b.id];
      expect(hb.entrance.x).toBe(b.facing === 'E' ? hb.x + hb.w : hb.x);
      for (const r of hb.rooms) {
        expect(r.x).toBeGreaterThanOrEqual(hb.x - 0.01);
        expect(r.x + r.w).toBeLessThanOrEqual(hb.x + hb.w + 0.01);
        expect(r.y).toBeGreaterThanOrEqual(hb.y - 0.01);
        expect(r.y + r.h).toBeLessThanOrEqual(hb.y + hb.h + 0.01);
      }
    }
  });

  test('a new building faces the nearest road and snaps its door to it', () => {
    const plan = masakhanePlan();
    const b = newBuilding(plan, 'clinic', 1450, 120);
    expect(b.facing).toBe('S'); // Protea Drive runs below
    const s = snapToRoad(plan, b, 120)!;
    expect(s.facing).toBe('S');
    expect(s.y + b.h).toBeCloseTo(240 - 7.5, 0);
  });

  test('turning a house turns its plot; moving into another zone moves it into that settlement', () => {
    const plan = masakhanePlan();
    const house = plan.buildings.find((b) => b.asset === 'house')!;
    const turned = turnBuilding(plan, house.id, 'E').buildings.find((b) => b.id === house.id)!;
    expect([turned.w, turned.h]).toEqual([house.h, house.w]);
    const hill = plan.settlements.find((s) => s.id === 'hillside')!;
    const moved = moveBuildings(plan, [house.id], hill.x + 300 - house.x, hill.y + 400 - house.y).buildings.find((b) => b.id === house.id)!;
    expect(moved.settlement).toBe('hillside');
  });

  test('removing a bus stop takes it off its line; duplicating gives fresh ids and plots; a new zone takes in what it covers', () => {
    const plan = { ...masakhanePlan(), busLines: [{ id: 'l', name: 'Line', stops: ['a', 'b', 'c'] }] };
    const withStops: WorldPlan = { ...plan, buildings: [...plan.buildings, ...['a', 'b', 'c'].map((id, i) => ({ id, asset: 'busstop', name: id, settlement: 'ubuntu', x: 100 + i * 40, y: 560, w: 30, h: 14, facing: 'S' as const }))] };
    expect(removeBuildings(withStops, ['b']).busLines![0].stops).toEqual(['a', 'c']);
    const house = plan.buildings.find((b) => b.asset === 'house')!;
    const dup = duplicateBuildings(plan, [house.id]);
    const copy = dup.plan.buildings.find((b) => b.id === dup.ids[0])!;
    expect(copy.id).not.toBe(house.id);
    expect(copy.plot).toBe(Math.max(...plan.buildings.map((b) => b.plot ?? 0)) + 1);
    const z = addSettlement(plan, { x: house.x - 5, y: house.y - 5, w: house.w + 10, h: house.h + 10 }, { name: 'Corner' });
    expect(z.plan.buildings.find((b) => b.id === house.id)!.settlement).toBe(z.id);
  });

  test('defaults: the scenario has no world of its own until one is built', () => {
    expect(DEFAULT_PARAMS.plan).toBeUndefined();
  });
});
