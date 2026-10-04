// The Scelo exchange from Community Lab's side: patches from outside, shocks,
// a supplied basis, the experience rebuilt person by person, and exports that
// Scelo's own parser accepts. Short runs only — the statistical checks (a
// supplied basis moving total mortality, A/E against it) live in
// scripts/exchange-check.ts, which needs minutes on many cores.

import { describe, expect, test } from 'bun:test';
import { parseCommunityExport, parseExperimentSpec } from '../src/shared/exchange';
import { Simulation } from '../src/sim/engine';
import { experienceCells, modelPointRows, observedYears, personYearRows, trueBasis } from '../src/sim/experience';
import { METRICS, armParams, indicators, summariseExperiment, type ArmRun } from '../src/sim/experiment';
import { buildQxTable, presetById } from '../src/sim/mortality';
import { DEFAULT_PARAMS, assumptionsHash, basisHash, mergeParams } from '../src/sim/params';
import { applyPatch, changedFromDefaults } from '../src/sim/patch';
import { activeShocks, forceRatios, suppliedTable } from '../src/sim/shocks';
import { experienceExport, modelPointsExport, personYearsExport, provenanceFor } from '../src/shared/exports';
import { TEMPLATES } from '../src/shared/templates';

describe('patches from outside', () => {
  test('known fields in range are applied; the rest are named and left out', () => {
    const r = applyPatch({}, { oldAgeGrant: 2880, seed: 'mine', careQuality: 3, nonsense: 1, climate: 'mars', healthProfile: 'developed' });
    expect(r.params.oldAgeGrant).toBe(2880);
    expect(r.params.healthProfile).toBe('developed');
    expect(r.params.seed).toBeUndefined();
    expect(r.applied.sort()).toEqual(['healthProfile', 'oldAgeGrant']);
    expect(r.rejected.join(' ')).toContain('careQuality: between 0 and 1');
    expect(r.rejected.join(' ')).toContain('seed');
    expect(r.rejected.join(' ')).toContain('nonsense');
    expect(r.rejected.join(' ')).toContain('climate');
  });
  test('tier shares can be set; other tier fields cannot', () => {
    const r = applyPatch({}, { tiers: { working: { funeralCoverShare: 1, households: 99 } } });
    expect(r.params.tiers?.working.funeralCoverShare).toBe(1);
    expect(r.params.tiers?.working.households).toBe(DEFAULT_PARAMS.tiers.working.households);
    expect(r.rejected.join(' ')).toContain('tiers.working.households');
  });
  test('an education mix is renormalised to sum to one', () => {
    const r = applyPatch({}, { educationMix: { tertiary: 0.5, postgrad: 0.5 } });
    const m = r.params.educationMix!;
    expect(Object.values(m).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });
  test('every template builds a spec the exchange accepts, and every arm applies cleanly', () => {
    for (const t of TEMPLATES) {
      const spec = { ...t.build(10), seeds: 8, years: 10 };
      const p = parseExperimentSpec(spec);
      expect({ id: t.id, ok: p.ok }).toEqual({ id: t.id, ok: true });
      for (const a of spec.arms) expect({ id: t.id, rejected: armParams({}, a, 's').rejected }).toEqual({ id: t.id, rejected: [] });
      for (const f of t.focus) expect(METRICS.some((m) => m.id === f)).toBe(true);
    }
  });
});

describe('outside inputs leave a default world exactly as it was', () => {
  test('absent inputs do not enter the basis hash', () => {
    expect(basisHash(mergeParams({}))).toBe(basisHash(mergeParams({ shocks: [], mortalityOverride: undefined })));
  });
  test('the assumptions hash ignores the seed and the names, the basis hash does not', () => {
    const a = mergeParams({ seed: 'a', placeName: 'X' });
    const b = mergeParams({ seed: 'b' });
    expect(assumptionsHash(a)).toBe(assumptionsHash(b));
    expect(basisHash(a)).not.toBe(basisHash(b));
    expect(assumptionsHash(mergeParams({ oldAgeGrant: 3000 }))).not.toBe(assumptionsHash(b));
  });
  test('changedFromDefaults records only what moved', () => {
    expect(changedFromDefaults(mergeParams({ oldAgeGrant: 3000, seed: 'z' }))).toEqual({ oldAgeGrant: 3000 });
  });
});

describe('shocks', () => {
  test('a shock is in force from its first month for its length, and factors multiply', () => {
    const shocks = [
      { kind: 'mortality' as const, fromMonth: 12, months: 12, factor: 1.25 },
      { kind: 'mortality' as const, fromMonth: 12, months: 12, factor: 1.44, minAge: 60 },
      { kind: 'repo' as const, fromMonth: 0, months: 6, bp: 300 },
      { kind: 'oil' as const, fromMonth: 5, months: 2, factor: 1.8 },
    ];
    expect(activeShocks(shocks, 11).mortality).toHaveLength(0);
    expect(activeShocks(shocks, 12).mortality).toHaveLength(2);
    expect(activeShocks(shocks, 24).mortality).toHaveLength(0);
    expect(activeShocks(shocks, 5).repoBp).toBe(300);
    expect(activeShocks(shocks, 6).repoBp).toBe(0);
    expect(activeShocks(shocks, 6).oilFactor).toBe(1.8);
    expect(activeShocks(undefined, 3).labels).toEqual([]);
  });
  test('a rate stress sits on top of the committee and lifts cleanly', () => {
    const sim = new Simulation({ seed: 'repo-stress', shocks: [{ kind: 'repo', fromMonth: 1, months: 2, bp: 300 }] });
    const base = new Simulation({ seed: 'repo-stress' });
    sim.runDays(130);
    base.runDays(130);
    const a = sim.world.finance.macro.months;
    const b = base.world.finance.macro.months;
    // Month 1 and 2 stressed by 300 bp; month 0 and month 4 not (the committee's own path is unchanged by then
    // only if inflation has not moved it — so compare the stressed months exactly and the stress flag after).
    expect(Math.round((a[1].repo - b[1].repo) * 10_000)).toBe(300);
    expect(Math.round((a[0].repo - b[0].repo) * 10_000)).toBe(0);
    expect(sim.world.events.some((e) => e.text.startsWith('Stress applied: repo +300 bp'))).toBe(true);
    expect(sim.world.events.some((e) => e.text.startsWith('Stress lifted: repo +300 bp'))).toBe(true);
  }, 60_000);
});

describe('a supplied basis', () => {
  const calib = buildQxTable(presetById('sa-2024'));
  test('a pooled table keeps the preset\'s sex differential around it', () => {
    const ages = [20, 40, 60, 80];
    const pooled = ages.map((a) => (calib.M[a] + calib.F[a]) / 2);
    const t = suppliedTable({ label: 'pooled', source: 't', ages, qx: { pooled } }, calib, 2026, 0.01);
    for (const a of ages) {
      expect(t.M[a]).toBeCloseTo(calib.M[a], 10);
      expect(t.F[a]).toBeCloseTo(calib.F[a], 10);
    }
    // Between the given ages it is log-linear, beyond them it follows the preset's shape.
    expect(t.M[50]).toBeCloseTo(Math.sqrt(calib.M[40] * calib.M[60]), 10);
    expect(t.M[100]).toBeCloseTo(calib.M[100] * (calib.M[80] / calib.M[80]), 10);
    expect(t.M[110]).toBe(1);
  });
  test('the force ratio is μ_supplied / μ_preset, 1 when nothing changed', () => {
    const same = forceRatios(calib, calib);
    expect(same.M[50]).toBeCloseTo(1, 12);
    const ages = Array.from({ length: 110 }, (_, i) => i);
    const doubled = suppliedTable({ label: 'x2', source: 't', ages, qx: { M: ages.map((a) => calib.M[a] * 2), F: ages.map((a) => calib.F[a] * 2) } }, calib, 2026, 0);
    const r = forceRatios(doubled, calib);
    expect(r.M[40]).toBeCloseTo(Math.log(1 - 2 * calib.M[40]) / Math.log(1 - calib.M[40]), 10);
  });
  test('a table stated for an earlier year is carried forward with the improvement', () => {
    const ages = [0, 110];
    const t = suppliedTable({ label: 'y', source: 't', ages: [30, 31], qx: { M: [0.002, 0.002], F: [0.001, 0.001] }, year: 2016 }, calib, 2026, 0.01);
    expect(t.M[30]).toBeCloseTo(0.002 * 0.99 ** 10, 10);
    expect(ages).toHaveLength(2);
  });
  test('the province takes the supplied table as its basis', () => {
    const ages = Array.from({ length: 110 }, (_, i) => i);
    const sim = new Simulation({ seed: 'supplied', mortalityOverride: { label: 'Scelo fit', source: 'test', ages, qx: { M: ages.map((a) => calib.M[a] * 1.3), F: ages.map((a) => calib.F[a] * 1.3) } } });
    expect(sim.ctx.qx.label).toBe('Scelo fit');
    expect(sim.ctx.qxCalib.presetId).toBe('sa-2024');
    expect(sim.ctx.basisRatio).not.toBeNull();
    expect(trueBasis(sim).label).toBe('Scelo fit');
  });
});

describe('experience, rebuilt person by person', () => {
  const sim = new Simulation({ seed: 'experience' });
  sim.runDays(420);
  const st = sim.world.stats;
  const cells = experienceCells(sim, { partialYears: true });
  test('exposure, deaths and expected deaths reconcile with the engine\'s own bookkeeping', () => {
    const E = st.exposures.reduce((a, e) => a + e.exposureM + e.exposureF, 0);
    const X = st.exposures.reduce((a, e) => a + e.expectedM + e.expectedF, 0);
    expect(cells.reduce((a, c) => a + c.personYears, 0)).toBeCloseTo(E, 6);
    expect(cells.reduce((a, c) => a + c.expected, 0)).toBeCloseTo(X, 3);
    expect(cells.reduce((a, c) => a + c.deaths, 0)).toBe(st.deaths);
  });
  test('the person-year panel adds up to the same exposure and deaths', () => {
    const rows = personYearRows(sim);
    expect(rows.reduce((a, r) => a + r.personYears, 0)).toBeCloseTo(cells.reduce((a, c) => a + c.personYears, 0), 6);
    expect(rows.reduce((a, r) => a + r.deathEvent, 0)).toBe(st.deaths);
  });
  test('a year observed for less than half its days is left out by default', () => {
    const years = observedYears(sim);
    expect(years.has(2026)).toBe(true);
    expect(years.has(2027)).toBe(false); // 420 days from 4 Jan 2026 reaches late February 2027
    expect(experienceCells(sim).every((c) => c.year === 2026)).toBe(true);
  });
  test('the exports are ones Scelo\'s parser accepts, with the columns its detectors read', () => {
    const truth = trueBasis(sim);
    const prov = provenanceFor({ seed: 'experience' });
    const e = experienceExport(experienceCells(sim, { ageWidth: 5 }), { truth, provenance: prov, ageWidth: 5, group: null });
    const p = parseCommunityExport(e);
    expect(p.ok ? true : p.errors).toBe(true);
    expect(e.tables[0].columns.map((c) => c.name)).toEqual(expect.arrayContaining(['year', 'age', 'sex', 'deaths', 'person_years']));
    const py = personYearsExport(personYearRows(sim), { truth, provenance: prov });
    expect(parseCommunityExport(py).ok).toBe(true);
    // The panel's only 0/1 column is the outcome, and no cause rides along with it.
    const cols = py.tables[0].columns.map((c) => c.name);
    expect(cols).toContain('death_event');
    expect(cols).not.toContain('cause');
    const mp = modelPointsExport(modelPointRows(sim), { provenance: prov, asAt: '2027-02-28' });
    expect(parseCommunityExport(mp).ok).toBe(true);
    expect(mp.tables[0].columns.map((c) => c.name)).toEqual(expect.arrayContaining(['age_at_entry', 'sum_assured', 'policy_term', 'sex']));
  });
});

describe('experiments', () => {
  test('indicators cover every metric, finite where the run allows', () => {
    const sim = new Simulation({ seed: 'indicators' });
    sim.runDays(400);
    const m = indicators(sim);
    for (const def of METRICS) expect(def.id in m).toBe(true);
    expect(m.population).toBeGreaterThan(300);
    expect(m.grant_spend).toBeGreaterThan(0);
    expect(m.scheme_ruin === 0 || m.scheme_ruin === 1).toBe(true);
  }, 60_000);
  test("a province's own basis and shocks reach every arm; an arm's basis replaces it, its shocks add to them", () => {
    const basis = { label: 'Scelo fit', source: 't', ages: [0, 110], qx: { pooled: [0.01, 0.5] } };
    const own = { label: 'arm fit', source: 't', ages: [0, 110], qx: { pooled: [0.02, 0.6] } };
    const stress = { kind: 'repo' as const, fromMonth: 0, months: 12, bp: 100 };
    const spec = { base: { oldAgeGrant: 3000 }, baseMortality: basis, baseShocks: [stress] };
    const baseline = armParams(spec, null, 's').params;
    expect(baseline.mortalityOverride?.label).toBe('Scelo fit');
    expect(baseline.shocks).toEqual([stress]);
    const arm = armParams(spec, { id: 'a', label: 'a', mortality: own, shocks: [{ kind: 'oil', fromMonth: 6, months: 6, factor: 1.5 }] }, 's').params;
    expect(arm.mortalityOverride?.label).toBe('arm fit');
    expect(arm.shocks?.map((x) => x.kind)).toEqual(['repo', 'oil']);
    expect(arm.oldAgeGrant).toBe(3000);
  });
  test('the summary pairs arms with the baseline seed by seed', () => {
    const run = (arm: string, seed: string, x: number): ArmRun => ({ arm, seed, metrics: Object.fromEntries(METRICS.map((m) => [m.id, x])), ms: 1, basisHash: 'b', assumptionsHash: 'a' });
    const spec = { title: 't', seeds: 3, years: 1, arms: [{ id: 'up', label: 'up', params: { oldAgeGrant: 3000 } }] };
    const runs = [run('baseline', 'exp-1', 1), run('baseline', 'exp-2', 2), run('baseline', 'exp-3', 3), run('up', 'exp-1', 2), run('up', 'exp-2', 3), run('up', 'exp-3', 4)];
    const r = summariseExperiment('x1', spec, runs, 10, '0.1.0');
    expect(r.arms.map((a) => a.id)).toEqual(['baseline', 'up']);
    expect(r.arms[1].effects?.poverty.mean).toBe(1);
    expect(r.arms[1].effects?.poverty.better).toBe(0); // poverty is better lower; the arm raised it every time
    expect(r.rows).toHaveLength(6);
    expect(r.rows[0]).toMatchObject({ seed: 'exp-1', arm: 'baseline' });
  });
});
