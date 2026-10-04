import { useMemo } from 'react';
import { MORTALITY_PRESETS } from '../../sim/mortality';
import { headline } from '../lib/analytics';
import { schemeHeadline } from '../lib/actuarial';
import { useLab } from '../lib/lab';
import { store, useStore } from '../lib/simStore';
import { pct as pc } from './finance/util';

/** Rands at tile width: one decimal in the millions, whole thousands below. */
const k = (v: number): string => (!Number.isFinite(v) ? '—' : Math.abs(v) >= 1e6 ? `R${(v / 1e6).toFixed(1)}m` : Math.abs(v) >= 1e4 ? `R${Math.round(v / 1e3)}k` : `R${Math.round(v).toLocaleString()}`);

/** A compound value reads as one figure and its counterpart: the separator recedes. */
function Value({ text }: { text: string }) {
  const parts = text.split(' · ');
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <i className="sep">·</i>}
          {p}
        </span>
      ))}
    </>
  );
}

function Tile(props: { tab: string; label: string; short?: string; value: string; unit?: string; sub?: string; tone?: 'warn' | 'err'; small?: boolean; compact?: boolean; section?: string; title: string }) {
  const { tab, label, short, value, unit, sub, tone, small, compact, section, title } = props;
  const st = useStore();
  const on =
    st.drawerTab === tab &&
    (!section ||
      st.financeSection === section ||
      (section === 'overview' && ['overview', 'micro', 'macro'].includes(st.financeSection)) ||
      (section === 'bank' && ['bank', 'books', 'society', 'tax', 'audit'].includes(st.financeSection)));
  return (
    <button
      type="button"
      className={`tile ${on ? 'on' : ''} ${compact ? 'compact' : ''}`}
      data-tone={tone}
      aria-pressed={on}
      title={title}
      onClick={() => (on ? store.openDrawer(null) : section ? store.openFinance(section) : store.openDrawer(tab))}
    >
      <span className="label">
        <span className="l">{label}</span>
        <span className="s">{short ?? label}</span>
      </span>
      <span className={`value ${small ? 'sm' : ''}`}>
        <Value text={value} />
        {unit && <small>{unit}</small>}
      </span>
      {sub && <span className="sub">{sub}</span>}
    </button>
  );
}

export function StatsStrip() {
  const st = useStore();
  const h = useMemo(() => headline(st.sim), [st.sim, st.sim.world.day, st.sim.world.stats.deaths, st.sim.world.stats.births]);
  const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
  const wx = st.sim.world.weather;
  const preset = MORTALITY_PRESETS.find((p) => p.id === st.params.mortalityPreset)?.id ?? st.params.mortalityPreset;
  const F = st.sim.world.finance;
  const fin = F?.macro.months[F.macro.months.length - 1];
  const nonCompliant = F ? Object.entries(F.tax.compliance).filter(([id, c]) => c.status !== 'compliant' && F.ledgers.books[id]?.closedMonth === null).length : 0;
  const act = useMemo(() => schemeHeadline(st.sim), [st.sim, st.sim.world.day]);
  const lab = useLab();
  return (
    <div className="strip" aria-label="Analytics">
      <Tile
        tab="population"
        label="Population"
        short="People"
        value={String(h.population)}
        unit={`in ${h.households} hh`}
        sub={`children ${h.children} · 65+ ${h.elderly}`}
        title={`Population: ${h.population} in ${h.households} households — ${h.children} children, ${h.elderly} aged 65 and over, dependency ratio ${h.dependency.toFixed(2)}\nClick for the detailed analytics`}
      />
      <Tile
        tab="population"
        label="Births · deaths"
        short="Born/died"
        value={`${h.births} · ${h.deaths}`}
        sub={`${h.ytdBirths} · ${h.ytdDeaths} this year`}
        title={`Since the start: ${h.births} births and ${h.deaths} deaths — this year ${h.ytdBirths} and ${h.ytdDeaths}\nClick for the detailed analytics`}
      />
      <Tile
        tab="mortality"
        label="Mortality A/E"
        short="A/E"
        value={h.ae === null ? '—' : h.ae.toFixed(2)}
        sub={`${h.deaths} vs ${h.expectedDeaths.toFixed(1)} expected`}
        tone={h.ae === null ? undefined : h.ae > 1.5 ? 'err' : h.ae < 0.6 ? 'warn' : undefined}
        title={`Actual against expected deaths: ${h.deaths} actual, ${h.expectedDeaths.toFixed(1)} expected on ${h.personYears.toFixed(0)} person-years of exposure\nClick for the detailed analytics`}
      />
      <Tile
        tab="mortality"
        label="Life expectancy"
        short="Life exp."
        value={`${h.e0M.toFixed(1)} · ${h.e0F.toFixed(1)}`}
        sub={h.xM !== null || h.xF !== null ? `exp. ${h.xM?.toFixed(1) ?? '—'} · ${h.xF?.toFixed(1) ?? '—'}` : 'basis, m · f'}
        title={`Life expectancy at birth on the basis: ${h.e0M.toFixed(1)} male, ${h.e0F.toFixed(1)} female${h.xM !== null || h.xF !== null ? ` — experience ${h.xM?.toFixed(1) ?? '—'} and ${h.xF?.toFixed(1) ?? '—'}` : ' — too few deaths to measure experience yet'}\nClick for the detailed analytics`}
      />
      <Tile
        tab="fertility"
        label="Fertility"
        value={h.tfrRealised > 0 ? h.tfrRealised.toFixed(2) : '—'}
        unit="TFR"
        sub={`births A/E ${h.birthsAe?.toFixed(2) ?? '—'}`}
        title={`Realised total fertility rate ${h.tfrRealised > 0 ? h.tfrRealised.toFixed(2) : 'not yet measurable'} against a basis of ${h.tfrBasis.toFixed(2)} — births A/E ${h.birthsAe?.toFixed(2) ?? '—'} (${h.births} against ${h.expectedBirths.toFixed(1)} expected)\nClick for the detailed analytics`}
      />
      <Tile
        tab="health"
        label="Health"
        value={String(h.ill)}
        unit="ill now"
        sub={`${h.inHospital} in the ward`}
        tone={h.ill > h.population * 0.15 ? 'warn' : undefined}
        title={`${h.ill} residents ill now, ${h.inHospital} in the clinic ward — ${st.sim.world.stats.illnesses} episodes since the start\nClick for the detailed analytics`}
      />
      <Tile
        tab="safety"
        label="Safety"
        value={String(h.incidents)}
        unit="incidents"
        sub={`${h.arrests} arrests · ${st.sim.world.stats.courtCases} cases`}
        title={`${h.incidents} incidents, ${h.arrests} arrests, ${st.sim.world.stats.courtCases} court cases and ${st.sim.world.stats.fights} fights since the start\nClick for the detailed analytics`}
      />
      <Tile
        tab="social"
        label="Marriages"
        value={String(h.marriages)}
        sub={`${h.divorces} div. · church ${pct(h.church)}`}
        title={`${h.marriages} marriages and ${h.divorces} divorces since the start — ${pct(h.church)} of residents at church last Sunday\nClick for the detailed analytics`}
      />
      <Tile
        tab="education"
        label="Schooling"
        short="School"
        value={`${h.atSchool} · ${h.homeschooled}`}
        sub="school · homeschool"
        title={`${h.atSchool} children at the school and ${h.homeschooled} homeschooled\nClick for attainment by age and sex`}
      />
      <Tile
        tab="finance"
        section="overview"
        label="Economy"
        value={fin ? k(fin.gdpNominal * 12) : pct(h.employment)}
        unit={fin ? 'GDP/yr' : 'employed'}
        sub={fin ? `CPI ${pc(fin.inflYoY)} · repo ${pc(fin.repo, 1)}` : `${h.employed} of ${h.adults} adults`}
        tone={fin && fin.inflYoY > 0.06 ? 'warn' : undefined}
        title={
          fin
            ? `GDP ${k(fin.gdpNominal * 12)} a year, inflation ${pc(fin.inflYoY)} against a 3% target, repo ${pc(fin.repo, 2)}, unemployment ${pc(fin.unemploymentRate)}, ${h.poor} households below the poverty line\nClick for the economy: micro, macro and the national accounts`
            : `Employment ${pct(h.employment)}: ${h.employed} of ${h.adults} working-age adults\nThe economy opens once the first month has closed`
        }
      />
      <Tile
        tab="finance"
        section="bank"
        label="Finance & tax"
        short="Finance"
        value={fin ? k(fin.deposits) : k(h.reserve)}
        unit={fin ? 'deposits' : 'scheme'}
        sub={h.ruined ? 'scheme insolvent' : nonCompliant ? 'SARS arrears' : fin ? `loans ${k(fin.loans)}` : `${h.claims} claims paid`}
        tone={h.ruined ? 'err' : nonCompliant ? 'warn' : undefined}
        title={
          fin
            ? `Mutual Bank deposits ${k(fin.deposits)}, loans ${k(fin.loans)}; tax revenue ${k(fin.taxRevenue)} a month; burial society reserve R${Math.round(h.reserve / 1000)}k${nonCompliant ? `; ${nonCompliant} taxpayer${nonCompliant > 1 ? 's' : ''} in arrears with SARS` : '; every taxpayer compliant'}\nClick for the books, the bank, SARS and the audit trail`
            : `Burial society reserve R${Math.round(h.reserve / 1000)}k, ${h.claims} claims paid\nThe books open once the first month has closed`
        }
      />
      <Tile
        tab="actuarial"
        label="Actuarial"
        short="Actuary"
        value={act.loading === null ? '—' : `${act.loading >= 0 ? '+' : '−'}${Math.round(Math.abs(act.loading) * 100)}%`}
        unit="loading"
        sub={act.loading === null ? 'no lives covered' : `${act.lives} lives · ${act.expectedClaimsYear.toFixed(1)} claims/yr exp.`}
        tone={act.loading !== null && act.loading < 0 ? 'err' : act.loading !== null && act.loading < 0.1 ? 'warn' : undefined}
        title={`The society's premiums against the pure risk premium on the basis: ${act.loading === null ? 'no lives covered' : `charged R${Math.round(act.charged).toLocaleString()} a month for expected claims of R${Math.round(act.net).toLocaleString()} (a loading of ${Math.round(act.loading * 100)}%), ${act.lives} lives covered, ${act.expectedClaimsYear.toFixed(1)} claims a year expected`}\nClick for the actuarial workbench: interest, life contingencies, pricing, risk theory and solvency, projections, retirement, standards`}
      />
      <Tile
        tab="lab"
        label="Policy lab"
        short="Lab"
        value={lab.job?.status === 'running' ? `${lab.job.done}/${lab.job.total}` : 'ask'}
        compact
        title="The policy & stress lab: compare a policy, a stress or a basis with the province as it is, every arm on the same seeds, with intervals: for actuaries, governments and social developers"
      />
      <Tile
        tab="weather"
        label="Weather"
        value={`${Math.round(wx.tempMax)}°C`}
        unit={wx.condition}
        sub={`${wx.season} · ${wx.rainMm} mm rain`}
        title={`${wx.condition}, high ${Math.round(wx.tempMax)}°C — ${wx.season}, ${wx.rainMm} mm of rain, wind ${wx.windKmh} km/h\nClick for the climate analytics`}
      />
      <Tile tab="montecarlo" label="Monte Carlo" value="run" compact title="Run N replications over Y years on the server and read the percentiles and the ruin probability" />
      <Tile
        tab="basis"
        label="Basis"
        value={`#${st.sim.world.basisHash.slice(0, 6)}`}
        small
        compact
        title={`Basis #${st.sim.world.basisHash} — mortality ${preset}, TFR ${st.params.tfr.toFixed(2)}, seed "${st.params.seed}"\nClick for the full basis and its provenance`}
      />
    </div>
  );
}
