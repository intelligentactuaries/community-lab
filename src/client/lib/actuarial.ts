// The society's headline figures for the stats strip: what it charges against
// the pure risk premium of the lives it covers, on the basis.
import { insuredLives, schemePricing, type SchemeBasis } from '../../sim/actuarial/scheme';
import type { Simulation } from '../../sim/engine';
import { DAYS_PER_YEAR } from '../../sim/time';

export function schemeBasisOf(sim: Simulation): SchemeBasis {
  const P = sim.params;
  const F = sim.world.finance;
  return { funeralBenefit: P.funeralBenefit, lifeCoverSum: P.lifeCoverSum, funeralPremium: P.funeralPremium, lifeCoverPremium: P.lifeCoverPremium, cpiF: F && F.macro.months.length ? F.macro.cpi / 100 : 1, adminShare: 0.02, lifeAges: [18, 65] };
}

export function schemeHeadline(sim: Simulation): { lives: number; charged: number; net: number; loading: number | null; expectedClaimsYear: number } {
  const basis = schemeBasisOf(sim);
  const years = sim.world.day / DAYS_PER_YEAR;
  const lives = insuredLives(sim.world, sim.ctx.qx, basis, sim.params.mortalityImprovement, years);
  const pr = schemePricing(sim.world, lives, sim.ctx.qx, basis, sim.params.mortalityImprovement, years);
  return { lives: pr.lives, charged: pr.chargedMonthly, net: pr.netMonthly, loading: pr.loading, expectedClaimsYear: 12 * pr.lambda };
}
