// The actuarial workbench inside the analytics drawer: the theory of interest
// on the province's own rates, life contingencies on the scenario's table,
// the burial society priced and diagnosed, its risk theory and solvency, the
// projections, retirement and the state's grant, and the standards that
// govern each figure. Every section values at one rate, chosen here.

import { useMemo } from 'react';
import { commutation, type Commutation } from '../../../sim/actuarial/life';
import { rateSet, realRate, type RateSet } from '../../../sim/actuarial/interest';
import { ratesFor } from '../../../sim/finance/bank';
import { MAX_AGE, improvedQx } from '../../../sim/mortality';
import { DAYS_PER_YEAR } from '../../../sim/time';
import { CardGrid } from '../../charts/helpers';
import { store, useStore } from '../../lib/simStore';
import { InterestSection } from './InterestSection';
import { LifeSection } from './LifeSection';
import { OverviewSection } from './OverviewSection';
import { ProjectionSection } from './ProjectionSection';
import { RetirementSection } from './RetirementSection';
import { RiskSection } from './RiskSection';
import { SchemeSection } from './SchemeSection';
import { StandardsSection } from './StandardsSection';

export const ACTUARIAL_SECTIONS: Array<{ id: string; label: string; hint: string }> = [
  { id: 'overview', label: 'Overview', hint: 'The actuarial control cycle, the notation and the headline figures' },
  { id: 'interest', label: 'Interest', hint: 'The theory of interest: i, v, d, δ, annuities-certain, timelines, loans' },
  { id: 'life', label: 'Life contingencies', hint: 'The life table, μₓ, commutation functions, Aₓ, äₓ, net premiums and reserves' },
  { id: 'scheme', label: 'Pricing', hint: 'The burial society priced on the basis: natural and level premiums, loadings, loss ratios, IFRS 17' },
  { id: 'risk', label: 'Risk & solvency', hint: 'The surplus process, the adjustment coefficient, Lundberg, a simulated fan, the SCR' },
  { id: 'projection', label: 'Projections', hint: 'A cohort-component projection of the province, mortality improvement, dependency' },
  { id: 'retirement', label: 'Retirement & grants', hint: 'A worker’s fund and pension, the two pots, the old-age grant liability' },
  { id: 'standards', label: 'Standards', hint: 'SAM, IFRS 17, IAS 19, the ISAPs, ASSA’s SAPs and APNs, the Acts' },
];

export type RateKey = 'tbill' | 'repo' | 'prime' | 'deposit' | 'real' | 'custom';

/** The valuation basis every section shares: the rate, today's table (with its improvement) and the commutation functions at that rate. */
export interface Valuation {
  key: RateKey;
  i: number;
  label: string;
  r: RateSet;
  inflation: number;
  target: number;
  /** The real rate at i (Fisher). */
  real: number;
  rates: { tbill: number; repo: number; prime: number; deposit: number };
  qx: { M: number[]; F: number[] };
  cm: { M: Commutation; F: Commutation };
  yearsElapsed: number;
  improvement: number;
  cpiF: number;
  /** True once the books have closed a month (the rates are the economy's own; before that, the scenario's). */
  ready: boolean;
}

export function useValuation(): Valuation {
  const st = useStore();
  const sim = st.sim;
  const F = sim.world.finance;
  const ready = !!F && F.macro.months.length > 0;
  const P = sim.params;
  const rateKey = st.actuarialRate;
  const yearsElapsed = Math.floor((sim.world.day / DAYS_PER_YEAR) * 4) / 4;
  const presetId = sim.ctx.qx.presetId;
  const rates = ready ? { tbill: F.bank.rates.tbill, repo: F.macro.repo, prime: F.macro.prime, deposit: F.bank.rates.deposit } : { ...ratesFor(P.repoRate), repo: P.repoRate, prime: P.repoRate + 0.035 };
  const inflation = ready ? F.macro.inflYoY : P.inflationStart;
  const target = ready ? F.macro.target : P.inflationTarget;
  return useMemo(() => {
    let key: RateKey = 'tbill';
    let i = rates.tbill;
    let label = 'treasury bills';
    if (rateKey === 'repo') [key, i, label] = ['repo', rates.repo, 'the repo rate'];
    else if (rateKey === 'prime') [key, i, label] = ['prime', rates.prime, 'prime'];
    else if (rateKey === 'deposit') [key, i, label] = ['deposit', rates.deposit, 'the deposit rate'];
    else if (rateKey === 'real') [key, i, label] = ['real', realRate(rates.tbill, inflation), 'treasury bills less inflation'];
    else if (rateKey.startsWith('custom:')) [key, i, label] = ['custom', Math.max(-0.5, Math.min(1, Number(rateKey.slice(7)) || 0)), 'a rate of your own'];
    const table = (q: number[]) => q.map((v, x) => (x === MAX_AGE ? 1 : improvedQx(v, P.mortalityImprovement, yearsElapsed)));
    const qx = { M: table(sim.ctx.qx.M), F: table(sim.ctx.qx.F) };
    return {
      key,
      i,
      label,
      r: rateSet(i),
      inflation,
      target,
      real: realRate(i, inflation),
      rates,
      qx,
      cm: { M: commutation(qx.M, i), F: commutation(qx.F, i) },
      yearsElapsed,
      improvement: P.mortalityImprovement,
      cpiF: ready ? F.macro.cpi / 100 : 1,
      ready,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateKey, rates.tbill, rates.repo, rates.prime, rates.deposit, inflation, target, yearsElapsed, presetId, P.mortalityImprovement, ready, ready ? F.macro.cpi : 1]);
}

const p2 = (v: number) => `${(v * 100).toFixed(2)}%`;

/** The valuation rate: the province's own rates, or one typed in. */
function RatePicker({ V }: { V: Valuation }) {
  const st = useStore();
  const custom = st.actuarialRate.startsWith('custom:') ? Number(st.actuarialRate.slice(7)) * 100 : Math.round(V.i * 10000) / 100;
  const chip = (key: RateKey, label: string, value: number) => (
    <button key={key} className={`chip ${V.key === key ? 'on' : ''}`} onClick={() => store.setActuarial({ rate: key })} title={`Value everything at ${label}: ${p2(value)}`}>
      {label} {p2(value)}
    </button>
  );
  return (
    <div className="act-rates">
      <span>valuation rate i</span>
      {chip('tbill', 'T-bill', V.rates.tbill)}
      {chip('repo', 'repo', V.rates.repo)}
      {chip('prime', 'prime', V.rates.prime)}
      {chip('deposit', 'deposit', V.rates.deposit)}
      {chip('real', 'real', realRate(V.rates.tbill, V.inflation))}
      <label className="row" style={{ gap: 4 }}>
        <span className={V.key === 'custom' ? '' : 'muted'}>own</span>
        <input type="number" step={0.25} min={-50} max={100} value={Number.isFinite(custom) ? +custom.toFixed(2) : 0} onChange={(e) => store.setActuarial({ rate: `custom:${Number(e.target.value) / 100}` })} aria-label="Valuation rate, per cent" />
        <span>%</span>
      </label>
      <span className="muted">· v {V.r.v.toFixed(4)} · d {p2(V.r.d)} · δ {p2(V.r.delta)} · inflation {p2(V.inflation)} · real {p2(V.real)}</span>
    </div>
  );
}

export function ActuarialWorkspace() {
  const st = useStore();
  const V = useValuation();
  const section = ACTUARIAL_SECTIONS.some((s) => s.id === st.actuarialSection) ? st.actuarialSection : 'overview';
  return (
    <div className="fin">
      <div className="fin-rail" role="tablist">
        {ACTUARIAL_SECTIONS.map((s) => (
          <button key={s.id} role="tab" className={`tab ${section === s.id ? 'active' : ''}`} title={s.hint} onClick={() => store.setActuarial({ section: s.id })}>
            {s.label}
          </button>
        ))}
        <span className="grow" />
        <RatePicker V={V} />
      </div>
      <CardGrid className="fin-body scroll" full={st.drawerFull} deps={[section, st.sim.world.day, st.analyticsScope, st.actuarialRate]}>
        {section === 'overview' && <OverviewSection V={V} />}
        {section === 'interest' && <InterestSection V={V} />}
        {section === 'life' && <LifeSection V={V} />}
        {section === 'scheme' && <SchemeSection V={V} />}
        {section === 'risk' && <RiskSection V={V} />}
        {section === 'projection' && <ProjectionSection V={V} />}
        {section === 'retirement' && <RetirementSection V={V} />}
        {section === 'standards' && <StandardsSection />}
      </CardGrid>
    </div>
  );
}

/** An equation, set apart. */
export function Eq({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div className="eq">
      {children}
      {note && <span className="eq-note">{note}</span>}
    </div>
  );
}

/** A link into another section of the workbench. */
export function Go({ to, children }: { to: string; children: React.ReactNode }) {
  return <a onClick={() => store.setActuarial({ section: to })}>{children}</a>;
}
