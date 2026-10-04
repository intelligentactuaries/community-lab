// The actuarial workbench: the theory of interest, life contingencies on the
// scenario's table, the society's pricing and risk theory, and the
// projections — checked against the textbook identities.
import { describe, expect, test } from 'bun:test';
import { accumulate, accumulatedValue, annuityCertain, duration, loanSchedule, presentValue, pv, rateSet, realRate, savingsPath, yieldRate } from '../src/sim/actuarial/interest';
import { commutation, epv, expectations, forceOfMortality, monthlyQ, naturalVsLevel, netPremiums, reservePath, tpx } from '../src/sim/actuarial/life';
import { bands, countsFromPeople, grantLiability, projectPopulation, retirementProjection } from '../src/sim/actuarial/projection';
import { lossRatios, premiumForRuinTarget, riskTheory, simulateSurplus } from '../src/sim/actuarial/scheme';
import { ASFR_SHAPE_SA, scaledAsfr } from '../src/sim/fertility';
import { MORTALITY_PRESETS, buildQxTable, lifeExpectancy } from '../src/sim/mortality';

const table = buildQxTable(MORTALITY_PRESETS.find((p) => p.id === 'sa-2024')!);

describe('the theory of interest', () => {
  test('the rates that describe one i agree: v = 1/(1+i), d = iv, δ = ln(1+i), i⁽¹²⁾ from the monthly rate', () => {
    const r = rateSet(0.08);
    expect(r.v).toBeCloseTo(1 / 1.08, 12);
    expect(r.d).toBeCloseTo(0.08 * r.v, 12);
    expect(r.delta).toBeCloseTo(Math.log(1.08), 12);
    expect(Math.pow(1 + r.i12 / 12, 12) - 1).toBeCloseTo(0.08, 12);
    expect(Math.pow(1 - r.d12 / 12, -12) - 1).toBeCloseTo(0.08, 12);
  });

  test('annuities-certain: äₙ| = (1+i)·aₙ|, sₙ| = (1+i)ⁿ·aₙ|, (Ia)ₙ| = (äₙ| − n·vⁿ)/i, and n at i = 0', () => {
    const i = 0.06;
    const n = 10;
    const a = annuityCertain(i, n);
    expect(a.a).toBeCloseTo((1 - Math.pow(1.06, -10)) / 0.06, 10);
    expect(a.aDue).toBeCloseTo(a.a * 1.06, 10);
    expect(a.s).toBeCloseTo(a.a * Math.pow(1.06, 10), 10);
    expect(a.sDue).toBeCloseTo(a.aDue * Math.pow(1.06, 10), 10);
    expect(a.Ia).toBeCloseTo((a.aDue - 10 * Math.pow(1.06, -10)) / 0.06, 10);
    // Monthly payments of a twelfth are worth a little more than yearly ones in arrear, continuous ones more still.
    expect(a.a12).toBeGreaterThan(a.a);
    expect(a.aBar).toBeGreaterThan(a.a12);
    expect(a.aBar).toBeLessThan(a.aDue);
    const z = annuityCertain(0, 7);
    expect(z.a).toBe(7);
    expect(z.s).toBe(7);
  });

  test('accumulation and discount are inverses; Fisher gives the real rate', () => {
    expect(pv(accumulate(1000, 0.07, 5), 0.07, 5)).toBeCloseTo(1000, 9);
    expect(realRate(0.1, 0.05)).toBeCloseTo(1.1 / 1.05 - 1, 12);
  });

  test('the equation of value: a loan of 1,000 repaid by ten level instalments yields the rate it was priced at', () => {
    const sched = loanSchedule(1000, 0.05, 10);
    expect(sched.rows).toHaveLength(10);
    expect(sched.rows[9].closing).toBeCloseTo(0, 6);
    expect(sched.instalment).toBeCloseTo(1000 / annuityCertain(0.05, 10).a, 9);
    const flows = [{ t: 0, amount: -1000 }, ...sched.rows.map((r) => ({ t: r.k, amount: r.instalment }))];
    expect(presentValue(flows, 0.05)).toBeCloseTo(0, 6);
    expect(yieldRate(flows)).toBeCloseTo(0.05, 6);
    expect(accumulatedValue(flows, 0.05, 10)).toBeCloseTo(0, 5);
    expect(yieldRate([{ t: 0, amount: 100 }, { t: 1, amount: 50 }])).toBeNull();
  });

  test('duration of a single payment at t is t (Macaulay); modified is t/(1+i)', () => {
    const d = duration([{ t: 7, amount: 500 }], 0.04);
    expect(d.macaulay).toBeCloseTo(7, 9);
    expect(d.modified).toBeCloseTo(7 / 1.04, 9);
  });

  test('a regular saving accumulates to sₙ| of its yearly amount when the return and the growth are zero, and more with a return', () => {
    const flat = savingsPath(1200, 0, 0, 5);
    expect(flat[4].fund).toBeCloseTo(6000, 6);
    const grown = savingsPath(1200, 0, 0.1, 5);
    expect(grown[4].fund).toBeGreaterThan(6000);
    expect(grown[4].fund).toBeLessThan(1200 * annuityCertain(0.1, 5).sDue);
  });
});

describe('life contingencies on the scenario table', () => {
  const cm = commutation(table.M, 0.05);

  test('the commutation functions are the table discounted: Dₓ = vˣlₓ, Nₓ sums them, and D falls with age', () => {
    expect(cm.D[0]).toBeCloseTo(100_000, 6);
    expect(cm.D[30]).toBeCloseTo(Math.pow(1.05, -30) * cm.l[30], 6);
    expect(cm.N[30]).toBeCloseTo(cm.D.slice(30).reduce((s, v) => s + v, 0), 4);
    expect(cm.M[30]).toBeCloseTo(cm.C.slice(30).reduce((s, v) => s + v, 0), 4);
    for (let x = 1; x < cm.D.length; x++) expect(cm.D[x]).toBeLessThan(cm.D[x - 1]);
  });

  test('the identity Aₓ = 1 − d·äₓ holds, and the endowment assurance is term plus pure endowment', () => {
    const d = rateSet(0.05).d;
    for (const x of [20, 40, 60, 80]) {
      const e = epv(cm, x, 20);
      expect(e.Ax).toBeCloseTo(1 - d * e.axDue, 9);
      expect(e.Axn).toBeCloseTo(e.A1xn + e.nEx, 12);
      expect(e.A1xn).toBeLessThan(e.Ax);
      expect(e.axnDue).toBeLessThan(e.axDue);
      expect(e.ax).toBeCloseTo(e.axDue - 1, 12);
      // Woolhouse: monthly annuities-due are worth a little less than yearly ones.
      expect(e.ax12Due).toBeLessThan(e.axDue);
      expect(e.ax12Due).toBeGreaterThan(e.axDue - 0.5);
    }
  });

  test('assurances rise with age, annuities fall, and the net premium is their ratio', () => {
    const e40 = epv(cm, 40, 25);
    const e60 = epv(cm, 60, 25);
    expect(e60.Ax).toBeGreaterThan(e40.Ax);
    expect(e60.axDue).toBeLessThan(e40.axDue);
    const P = netPremiums(cm, 40, 25);
    expect(P.wholeLife).toBeCloseTo(e40.Ax / e40.axDue, 12);
    expect(P.term).toBeCloseTo(e40.A1xn / e40.axnDue, 12);
    expect(P.endowment).toBeGreaterThan(P.term);
    expect(P.wholeLife).toBeGreaterThan(P.term);
    expect(P.termMonthly * 12).toBeGreaterThan(P.term);
  });

  test('net premium reserves start at zero, build up, and reach the sum assured at an endowment’s maturity', () => {
    const term = reservePath(cm, 35, 30, 'term');
    expect(term[0].V).toBeCloseTo(0, 9);
    expect(term[30].V).toBeCloseTo(0, 9);
    expect(Math.max(...term.map((r) => r.V))).toBeGreaterThan(0.005);
    const endow = reservePath(cm, 35, 30, 'endowment');
    expect(endow[0].V).toBeCloseTo(0, 9);
    expect(endow[30].V).toBeCloseTo(1, 9);
    for (let t = 1; t <= 30; t++) expect(endow[t].V).toBeGreaterThan(endow[t - 1].V);
    const whole = reservePath(cm, 35, 30, 'wholeLife');
    expect(whole[0].V).toBeCloseTo(0, 9);
    expect(whole[whole.length - 1].V).toBeGreaterThan(0.9);
  });

  test('the natural premium climbs past the level premium, which the reserve pays for', () => {
    const { natural, level, reserve } = naturalVsLevel(cm, 30, 35);
    expect(natural[0][1]).toBeLessThan(level);
    expect(natural[natural.length - 1][1]).toBeGreaterThan(level);
    expect(reserve[0][1]).toBeCloseTo(0, 9);
    expect(reserve[Math.floor(reserve.length / 2)][1]).toBeGreaterThan(0);
  });

  test('survival, the force of mortality and the expectations agree with the table', () => {
    expect(tpx(table.M, 30, 10)).toBeCloseTo(cm.l[40] / cm.l[30], 9);
    expect(tpx(table.M, 30, 0)).toBe(1);
    const mu = forceOfMortality(table.M);
    expect(mu[40]).toBeCloseTo(-Math.log(1 - table.M[40]), 12);
    const ex = expectations(table.M);
    expect(ex[0].complete).toBeCloseTo(lifeExpectancy(table.M), 9);
    expect(ex[0].curtate).toBeLessThan(ex[0].complete);
    expect(ex[0].curtate).toBeGreaterThan(ex[0].complete - 1);
    expect(monthlyQ(0.012)).toBeCloseTo(1 - Math.pow(0.988, 1 / 12), 12);
    expect(1 - Math.pow(1 - monthlyQ(0.012), 12)).toBeCloseTo(0.012, 12);
  });
});

describe('the society’s risk theory', () => {
  // Fifty lives with R25,000 funeral cover, twenty of them with R100,000 life cover on top.
  const mix = [{ amount: 25_000, weight: 0.6, lives: 30 }, { amount: 125_000, weight: 0.4, lives: 20 }];
  const lambda = 0.08;
  const EX = 0.6 * 25_000 + 0.4 * 125_000;

  test('with a positive loading the adjustment coefficient solves λ(M(R) − 1) = cR and Lundberg bounds the approximation', () => {
    const c = lambda * EX * 1.3;
    const rt = riskTheory({ lambda, claimMix: mix, chargedMonthly: c, meanClaim: EX }, 0);
    expect(rt.EX).toBeCloseTo(EX, 6);
    expect(rt.theta).toBeCloseTo(0.3, 9);
    expect(rt.R).not.toBeNull();
    const R = rt.R!;
    const M = mix.reduce((s, m) => s + m.weight * Math.exp(R * m.amount), 0);
    expect(lambda * (M - 1)).toBeCloseTo(c * R, 6);
    expect(rt.lundberg(200_000)!).toBeCloseTo(Math.exp(-R * 200_000), 12);
    expect(rt.approx(200_000)!).toBeLessThanOrEqual(rt.lundberg(200_000)!);
    expect(rt.lundberg(0)).toBe(1);
  });

  test('without a positive loading there is no adjustment coefficient: ruin is certain in the long run', () => {
    const rt = riskTheory({ lambda, claimMix: mix, chargedMonthly: lambda * EX * 0.9, meanClaim: EX }, 0);
    expect(rt.theta!).toBeLessThan(0);
    expect(rt.R).toBeNull();
    expect(rt.lundberg(100_000)).toBeNull();
  });

  test('the simulated surplus: reproducible, fanning out, ruin rarer with more capital, and the SCR at the 99.5th percentile', () => {
    const c = lambda * EX * 1.2;
    const rt = { c, lambda };
    const a = simulateSurplus(200_000, rt, mix, 120, 400, 3);
    const b = simulateSurplus(200_000, rt, mix, 120, 400, 3);
    expect(a.p50).toEqual(b.p50);
    expect(a.p5[0]).toBe(200_000);
    expect(a.p95[120]).toBeGreaterThan(a.p5[120]);
    expect(a.p95[120] - a.p5[120]).toBeGreaterThan(a.p95[12] - a.p5[12]);
    expect(a.ruin1).toBeLessThanOrEqual(a.ruin5);
    expect(a.ruin5).toBeLessThanOrEqual(a.ruin10);
    expect(a.scr).toBeGreaterThan(0);
    expect(a.mcr[0]).toBeCloseTo(0.25 * a.scr, 9);
    for (let k = 1; k < a.curve.length; k++) {
      expect(a.curve[k].ruin10).toBeLessThanOrEqual(a.curve[k - 1].ruin10);
      expect(a.curve[k].ruin1).toBeLessThanOrEqual(a.curve[k].ruin10);
    }
    const rich = simulateSurplus(2_000_000, rt, mix, 120, 400, 3);
    expect(rich.ruin10).toBeLessThanOrEqual(a.ruin10);
    expect(rich.ruin10).toBeLessThan(0.05);
  });

  test('the premium for a ruin target rises as the target tightens, and is never below today’s', () => {
    const rt = riskTheory({ lambda, claimMix: mix, chargedMonthly: lambda * EX * 1.1, meanClaim: EX }, 0);
    const loose = premiumForRuinTarget(rt, mix, 200_000, 0.1)!;
    const tight = premiumForRuinTarget(rt, mix, 200_000, 0.01)!;
    expect(loose.multiplier).toBeGreaterThanOrEqual(1);
    expect(tight.multiplier).toBeGreaterThan(loose.multiplier);
    expect(tight.R).toBeCloseTo(-Math.log(0.01) / 200_000, 12);
    expect(premiumForRuinTarget(rt, mix, 0, 0.01)).toBeNull();
  });

  test('loss ratios by year from the surplus path', () => {
    const path = [];
    for (let m = 0; m < 24; m++) path.push({ month: m, reserve: 0, premiums: 1000, claims: m === 5 ? 6000 : 0 });
    const rows = lossRatios(path, 0.02);
    expect(rows).toHaveLength(2);
    expect(rows[0].lossRatio).toBeCloseTo(0.5, 9);
    expect(rows[0].combined).toBeCloseTo(0.52, 9);
    expect(rows[1].lossRatio).toBe(0);
  });
});

describe('projections', () => {
  const asfr = scaledAsfr(ASFR_SHAPE_SA, 2.41);
  const people: Array<{ age: number; sex: 'M' | 'F' }> = [];
  for (let k = 0; k < 400; k++) people.push({ age: (k * 7) % 85, sex: k % 2 ? 'M' : 'F' });

  test('the cohort-component projection conserves people: next year’s total is this year’s plus births less deaths and emigrants', () => {
    const start = countsFromPeople(people);
    const r = projectPopulation(start, table, { yearsElapsed: 0, improvement: 0.01, asfr, maleShareAtBirth: 0.503, youthEmigrationHazard: 0.05, workingAge: [15, 65], years: 30 });
    expect(r.years).toHaveLength(31);
    expect(r.years[0].total).toBe(400);
    for (let t = 1; t <= 30; t++) {
      const y = r.years[t];
      const prev = r.years[t - 1];
      expect(y.total).toBeCloseTo(prev.total + y.births - y.deaths - y.emigrants, 6);
      expect(y.births).toBeGreaterThan(0);
      expect(y.deaths).toBeGreaterThan(0);
    }
    // Improvement lifts life expectancy over the projection.
    expect(r.years[30].e0M).toBeGreaterThan(r.years[0].e0M);
    expect(r.years[30].e0F).toBeGreaterThan(r.years[0].e0F);
    const py = bands(r.end);
    expect(py.bands).toHaveLength(17);
    expect(py.male.reduce((s, v) => s + v, 0) + py.female.reduce((s, v) => s + v, 0)).toBeCloseTo(r.years[30].total, 6);
  });

  test('a worker’s retirement fund: contributions accumulate, the two pots split a third and two thirds, and a fuller fund buys a bigger pension', () => {
    const base = { age: 30, salary: 20_000, contribution: 0.15, salaryGrowth: 0.05, returnRate: 0.09, inflation: 0.045, retirementAge: 65, i: 0.09, qx: table.M, savingsShare: 1 / 3 };
    const r = retirementProjection(base);
    expect(r.years).toBe(35);
    expect(r.path).toHaveLength(35);
    expect(r.fundAtRetirement).toBeGreaterThan(r.contributionsPaid);
    expect(r.savingsComponent).toBeCloseTo(r.fundAtRetirement / 3, 6);
    expect(r.retirementComponent).toBeCloseTo((2 * r.fundAtRetirement) / 3, 6);
    expect(r.pensionLevel).toBeCloseTo(r.retirementComponent / (12 * r.annuityFactor), 6);
    expect(r.pensionReal).toBeLessThan(r.pensionLevel);
    expect(r.replacementLevelAll).toBeGreaterThan(r.replacementLevel);
    expect(r.replacementLevel).toBeGreaterThan(0);
    const more = retirementProjection({ ...base, contribution: 0.25 });
    expect(more.replacementLevel).toBeGreaterThan(r.replacementLevel);
    const late = retirementProjection({ ...base, age: 64 });
    expect(late.years).toBe(1);
    expect(late.replacementLevel).toBeLessThan(r.replacementLevel);
  });

  test('the old-age grant liability: those past sixty are valued as immediate annuities, the rest deferred, and it grows as the rate falls', () => {
    const g = grantLiability(people, table, 0.01, 0, 0.09, 0.045, 2_400);
    expect(g.recipients).toBe(people.filter((p) => p.age >= 60).length);
    expect(g.annual).toBeCloseTo(12 * 2_400 * g.recipients, 6);
    expect(g.pvCurrent).toBeGreaterThan(g.annual);
    expect(g.pvDeferred).toBeGreaterThan(0);
    expect(g.pv).toBeCloseTo(g.pvCurrent + g.pvDeferred, 6);
    expect(g.byBand.reduce((s, b) => s + b.n, 0)).toBe(people.length);
    const cheap = grantLiability(people, table, 0.01, 0, 0.12, 0.045, 2_400);
    expect(cheap.pv).toBeLessThan(g.pv);
  });
});
