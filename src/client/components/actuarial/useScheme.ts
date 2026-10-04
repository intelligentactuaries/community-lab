// The society on the basis, shared by the pricing, risk and overview sections:
// the lives it covers, their pure premiums, the classical risk theory of its
// surplus and a simulated ten-year fan, memoised on the month.
import { useMemo } from 'react';
import { insuredLives, lossRatios, premiumForRuinTarget, riskTheory, schemePricing, simulateSurplus, type InsuredLife, type RiskTheory, type SchemeBasis, type SchemePricing, type SurplusSimulation } from '../../../sim/actuarial/scheme';
import { schemeBasisOf } from '../../lib/actuarial';
import { useStore } from '../../lib/simStore';
import type { Valuation } from './ActuarialWorkspace';

export interface SchemeView {
  basis: SchemeBasis;
  lives: InsuredLife[];
  pricing: SchemePricing;
  rt: RiskTheory;
  sim: SurplusSimulation;
  /** The premium multiple that would hold Lundberg's bound at 1% at today's reserve. */
  fix: ReturnType<typeof premiumForRuinTarget>;
  lossRows: ReturnType<typeof lossRatios>;
  reserve: number;
  /** Months of expected claims the reserve covers. */
  reserveMonths: number | null;
  /** The standard-formula-flavoured life stresses on a year's claims: mortality +15%, catastrophe +1.5‰ of the sums at risk, combined at ρ = 0.25. */
  standard: { mortality: number; catastrophe: number; combined: number; sumsAtRisk: number };
}

export function useScheme(V: Valuation): SchemeView {
  const st = useStore();
  const sim = st.sim;
  const w = sim.world;
  const F = w.finance;
  const month = F ? F.month : Math.floor(w.day / 30.44);
  const reserve = w.insurance.reserve;
  return useMemo(() => {
    const basis = schemeBasisOf(sim);
    const lives = insuredLives(w, sim.ctx.qx, basis, V.improvement, V.yearsElapsed);
    const pricing = schemePricing(w, lives, sim.ctx.qx, basis, V.improvement, V.yearsElapsed);
    const rt = riskTheory(pricing, basis.adminShare);
    const s = simulateSurplus(Math.max(0, reserve), rt, pricing.claimMix, 120, 1000, 7);
    const fix = premiumForRuinTarget(rt, pricing.claimMix, reserve, 0.01);
    const lossRows = lossRatios(w.insurance.surplusPath, basis.adminShare);
    const sumsAtRisk = lives.reduce((a, l) => a + l.benefit, 0);
    const mortality = 0.15 * 12 * rt.expectedClaims;
    const catastrophe = 0.0015 * sumsAtRisk;
    return {
      basis,
      lives,
      pricing,
      rt,
      sim: s,
      fix,
      lossRows,
      reserve,
      reserveMonths: rt.expectedClaims > 0 ? reserve / rt.expectedClaims : null,
      standard: { mortality, catastrophe, combined: Math.sqrt(mortality * mortality + catastrophe * catastrophe + 2 * 0.25 * mortality * catastrophe), sumsAtRisk },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, month, V.improvement, V.yearsElapsed, V.cpiF, Math.round(reserve)]);
}
