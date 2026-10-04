// Community Lab before the swarm's council. An experiment's result becomes
// the evidence the council weighs (a Markdown brief: the question, the
// method, every effect with its interval, the caveats), and the province's
// own residents become the society that reacts to it — their ages, incomes,
// schooling, work, settlements, faith and temperaments, mapped into the
// swarm's society-agent shape (apps/swarm SocietyAgent) — instead of a
// population sampled from national averages.

import type { CouncilEvidence, ExperimentResult, SocietyAgentSeed } from '@scelo/core/exchange';
import { alivePeople } from '../sim/ctx';
import { communityOfPerson } from '../sim/population';
import type { JobId, Person, World } from '../sim/types';
import { CITY, COMMUNITY, cityOf } from '../sim/world';

const SELF_EMPLOYED: ReadonlySet<JobId> = new Set(['shopkeeper', 'farmer', 'attorney', 'taxidriver', 'ehailer']);
const INFORMAL: ReadonlySet<JobId> = new Set(['vendor', 'farmhand', 'domestic', 'homemaker']);
const HERITAGE: Record<string, string> = { nguni: 'Nguni', sotho: 'Sotho', tsonga: 'Tsonga', afrikaner: 'Afrikaner', english: 'English-speaking white', indian: 'Indian', coloured: 'Coloured' };

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function employmentOf(p: Person): SocietyAgentSeed['employment'] {
  if (p.job === 'child') return 'child';
  if (p.job === 'student') return 'student';
  if (p.job === 'retired') return 'retired';
  if (p.job === 'unemployed') return 'unemployed';
  if (SELF_EMPLOYED.has(p.job)) return 'self-employed';
  if (INFORMAL.has(p.job)) return 'informal';
  return 'employed';
}

function educationOf(p: Person): SocietyAgentSeed['education'] {
  if (p.education === 'postgrad') return 'postgrad';
  if (p.education === 'tertiary') return 'tertiary';
  if (p.education === 'secondary' || p.education === 'matric') return 'secondary';
  return 'primary';
}

/**
 * Up to `n` adult residents (16 and over, the swarm's floor), spread across the province by taking every k-th
 * person in a stable order, in the swarm's society-agent shape. Income bands are household income per head,
 * ranked into fifths across the province.
 */
export function residentsAsSociety(world: World, n = 200): SocietyAgentSeed[] {
  const adults = alivePeople(world)
    .filter((p) => p.age >= 16)
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  const perHead = (p: Person) => {
    const hh = world.households[p.householdId];
    return hh && hh.memberIds.length ? hh.monthlyIncome / hh.memberIds.length : 0;
  };
  const ranked = [...adults].map(perHead).sort((a, b) => a - b);
  const bandOf = (v: number): SocietyAgentSeed['incomeBand'] => {
    const q = ranked.length ? ranked.findIndex((x) => x >= v) / ranked.length : 0;
    return q < 0.2 ? 'low' : q < 0.4 ? 'lower-mid' : q < 0.6 ? 'mid' : q < 0.8 ? 'upper-mid' : 'high';
  };
  const step = Math.max(1, adults.length / n);
  const out: SocietyAgentSeed[] = [];
  for (let i = 0; i < adults.length && out.length < n; i += step) {
    const p = adults[Math.floor(i)];
    const com = communityOfPerson(world, p);
    const city = cityOf(com);
    const b = p.big5;
    const edu = educationOf(p);
    const faith = p.faith >= 0.7 ? 'devout Christian' : p.faith >= 0.4 ? 'churchgoing Christian' : 'secular';
    out.push({
      id: `ul-${p.id}`,
      age: p.age,
      sex: p.sex,
      incomeBand: bandOf(perHead(p)),
      education: edu,
      region: city === 'ithemba' ? 'periurban' : 'urban',
      employment: employmentOf(p),
      riskTolerance: Math.round(clamp01(0.5 + 0.35 * (b.O - 0.5) - 0.35 * (b.N - 0.5) + 0.2 * (b.E - 0.5)) * 100) / 100,
      financialLiteracy: Math.round(clamp01({ primary: 0.25, secondary: 0.45, tertiary: 0.7, postgrad: 0.85 }[edu] + 0.2 * (b.C - 0.5)) * 100) / 100,
      culture: `${HERITAGE[p.heritage ?? ''] ?? 'South African'}, ${faith}, ${COMMUNITY[com]?.name ?? com} in ${CITY[city]?.name ?? city}, Unity Province, South Africa`,
    });
  }
  return out;
}

const fmt = (v: number, unit: string): string => {
  if (!Number.isFinite(v)) return 'n/a';
  if (unit === 'share') return `${(v * 100).toFixed(1)}%`;
  if (unit === 'R') return `${v < 0 ? '−' : ''}R${Math.round(Math.abs(v)).toLocaleString('en-GB')}`;
  if (Math.abs(v) >= 100) return Math.round(v).toLocaleString('en-GB');
  return v.toFixed(Math.abs(v) >= 10 ? 1 : 3);
};
const fmtDelta = (v: number, unit: string): string => (Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${fmt(Math.abs(v), unit)}` : 'n/a');

/** The experiment as the evidence a council weighs. */
export function evidenceFor(r: ExperimentResult, focus: string[] = []): CouncilEvidence {
  const spec = r.spec;
  const order = [...focus, ...r.metrics.map((m) => m.id).filter((id) => !focus.includes(id))];
  const lines: string[] = [];
  lines.push(`**Question.** ${spec.question ?? spec.title}`);
  lines.push('');
  lines.push(
    `**Method.** Community Lab, an agent-based microsimulation of Unity Province (South Africa): about 400 residents in 100 households across three cities, every person an agent, with published mortality and fertility bases, double-entry books, SARS tax, a mutual bank, a burial society and a central bank. Each arm below was run on the same ${spec.seeds} seeds as the baseline for ${spec.years} years (common random numbers), so each effect is a paired difference with a 95% interval across seeds.`,
  );
  lines.push('');
  lines.push('**Arms.**');
  for (const a of spec.arms) {
    const what = [a.params ? Object.entries(a.params).map(([k, v]) => `${k} = ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ') : null, a.mortality ? `mortality basis "${a.mortality.label}"` : null, a.shocks?.length ? a.shocks.map((s) => s.label ?? s.kind).join('; ') : null].filter(Boolean).join('; ');
    lines.push(`- ${a.label}: ${what}`);
  }
  for (const arm of r.arms.slice(1)) {
    lines.push('', `**Effects of "${arm.label}" against the baseline** (mean over seeds, 95% interval, seeds in which it did better):`, '', '| indicator | baseline | effect | 95% interval | better in |', '|---|---|---|---|---|');
    for (const id of order) {
      const m = r.metrics.find((x) => x.id === id);
      const e = arm.effects?.[id];
      if (!m || !e || !Number.isFinite(e.mean)) continue;
      const base = r.arms[0].metrics[id];
      lines.push(`| ${m.label} | ${fmt(base.mean, m.unit)} | ${fmtDelta(e.mean, m.unit)} | ${fmtDelta(e.lo, m.unit)} to ${fmtDelta(e.hi, m.unit)} | ${e.better === null ? '—' : `${Math.round(e.better * e.n)} of ${e.n}`} |`);
    }
  }
  lines.push('');
  lines.push(
    '**Caveats.** A synthetic province, not a real one: the intervals cover the simulation\'s own randomness, not doubt about its assumptions (every one is documented in Community Lab\'s basis). With a few hundred residents, small effects on rare events (deaths, ruin) need many seeds to separate from noise; an interval that spans zero is not evidence of no effect.',
  );
  return {
    title: spec.title,
    source: `Community Lab ${r.provenance.appVersion} · paired Monte Carlo, ${spec.seeds} seeds × ${spec.years} years${r.provenance.assumptionsHash ? ` · assumptions ${r.provenance.assumptionsHash}` : ''} · experiment ${r.id}`,
    markdown: lines.join('\n'),
  };
}
