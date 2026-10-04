// Ready-made experiments: the questions each audience brings to a province,
// written as arms against the baseline. The experiment lab offers them, the
// server lists them (GET /api/exchange, GET /api/templates/:id) for scripts
// and other tools, the workbench writes them out as experiment files, and
// every number in them is a stated assumption a user can change before
// running.
//
// The stresses follow the standards they are named after where one exists
// (SAM's life underwriting module: mortality +15% on every age, a catastrophe
// of 1.5 additional deaths per 1,000 lives in a year); the policy arms change
// one lever each, so an effect has one cause.

import type { Audience, ExperimentSpec } from './exchange';
import { DEFAULT_PARAMS } from '../sim/params';

export interface ExperimentTemplate {
  id: string;
  audience: Audience;
  title: string;
  question: string;
  /** Indicators to lead with when the result is shown. */
  focus: string[];
  build(years: number): Pick<ExperimentSpec, 'title' | 'question' | 'audience' | 'arms'>;
}

const D = DEFAULT_PARAMS;
const pct = (x: number, by: number) => Math.round(x * (1 + by) * 100) / 100;

// A month of the province's deaths is about 0.08% of its lives (crude death rate near 10‰ a year), so a month at
// ×2.8 adds about 1.5 deaths per 1,000 lives: SAM's catastrophe stress, lived through.
const CATASTROPHE_FACTOR = 2.8;

export const TEMPLATES: ExperimentTemplate[] = [
  {
    id: 'sam-life-stresses',
    audience: 'actuarial',
    title: 'SAM life stresses on the burial society',
    question: 'Does the burial society survive the standard formula\'s life stresses, lived through rather than assumed?',
    focus: ['scheme_reserve', 'scheme_ruin', 'loss_ratio', 'ae'],
    build: (years) => ({
      title: 'SAM life stresses on the burial society',
      question: 'Does the burial society survive the standard formula\'s life stresses, lived through rather than assumed?',
      audience: 'actuarial',
      arms: [
        { id: 'mortality-15', label: 'Mortality +15% on every age', shocks: [{ kind: 'mortality', label: 'SAM mortality stress +15%', fromMonth: 0, months: years * 12, factor: 1.15 }] },
        { id: 'catastrophe', label: 'Catastrophe: +1.5‰ of lives in one month', shocks: [{ kind: 'mortality', label: 'SAM catastrophe month', fromMonth: 12, months: 1, factor: CATASTROPHE_FACTOR }] },
      ],
    }),
  },
  {
    id: 'pandemic-year',
    audience: 'actuarial',
    title: 'A pandemic year',
    question: 'What does a year of pandemic mortality, heaviest among the old, do to deaths, the society and the economy?',
    focus: ['deaths_per_1000', 'e0', 'scheme_reserve', 'loss_ratio'],
    build: () => ({
      title: 'A pandemic year',
      question: 'What does a year of pandemic mortality, heaviest among the old, do to deaths, the society and the economy?',
      audience: 'actuarial',
      arms: [
        {
          id: 'pandemic',
          label: 'Year two: ×1.25 all ages, ×1.8 at 60 and over',
          shocks: [
            { kind: 'mortality', label: 'Pandemic: all ages ×1.25', fromMonth: 12, months: 12, factor: 1.25 },
            { kind: 'mortality', label: 'Pandemic: 60 and over a further ×1.44', fromMonth: 12, months: 12, factor: 1.44, minAge: 60 },
          ],
        },
      ],
    }),
  },
  {
    id: 'premium-adequacy',
    audience: 'actuarial',
    title: 'Is the funeral premium adequate?',
    question: 'How do the society\'s reserve and its chance of ruin move if the premium is cut or raised by a fifth?',
    focus: ['scheme_reserve', 'scheme_ruin', 'loss_ratio', 'funeral_cover'],
    build: () => ({
      title: 'Is the funeral premium adequate?',
      question: 'How do the society\'s reserve and its chance of ruin move if the premium is cut or raised by a fifth?',
      audience: 'actuarial',
      arms: [
        { id: 'premium-down', label: `Premium −20% (R${pct(D.funeralPremium, -0.2)})`, params: { funeralPremium: pct(D.funeralPremium, -0.2) } },
        { id: 'premium-up', label: `Premium +20% (R${pct(D.funeralPremium, 0.2)})`, params: { funeralPremium: pct(D.funeralPremium, 0.2) } },
      ],
    }),
  },
  {
    id: 'rate-shock',
    audience: 'actuarial',
    title: 'A rate shock',
    question: 'What does 300 basis points on the repo rate for two years do to households, the bank and the society?',
    focus: ['household_debt', 'household_savings', 'unemployment', 'scheme_reserve'],
    build: () => ({
      title: 'A rate shock',
      question: 'What does 300 basis points on the repo rate for two years do to households, the bank and the society?',
      audience: 'actuarial',
      arms: [{ id: 'repo-300', label: 'Repo +300 bp in years two and three', shocks: [{ kind: 'repo', label: 'Rate stress +300 bp', fromMonth: 12, months: 24, bp: 300 }] }],
    }),
  },
  {
    id: 'old-age-grant',
    audience: 'government',
    title: 'Raise the old-age grant',
    question: 'What does a 20% higher older persons grant cost the fiscus, and what does it buy in poverty and health?',
    focus: ['grant_spend', 'poverty', 'gini', 'e0', 'fiscal_balance'],
    build: () => ({
      title: 'Raise the old-age grant',
      question: 'What does a 20% higher older persons grant cost the fiscus, and what does it buy in poverty and health?',
      audience: 'government',
      arms: [{ id: 'grant-up', label: `Old-age grant +20% (R${pct(D.oldAgeGrant, 0.2).toLocaleString('en-GB')})`, params: { oldAgeGrant: pct(D.oldAgeGrant, 0.2) } }],
    }),
  },
  {
    id: 'child-grant',
    audience: 'government',
    title: 'Raise the child support grant',
    question: 'What does a child support grant of R800 cost, and how far does it move child poverty and child deaths?',
    focus: ['grant_spend', 'poverty', 'u5mr', 'fiscal_balance'],
    build: () => ({
      title: 'Raise the child support grant',
      question: 'What does a child support grant of R800 cost, and how far does it move child poverty and child deaths?',
      audience: 'government',
      arms: [{ id: 'csg-800', label: 'Child support grant R800', params: { childGrant: 800 } }],
    }),
  },
  {
    id: 'minimum-wage',
    audience: 'government',
    title: 'Raise the minimum wage',
    question: 'Does a 15% higher national minimum wage lift incomes, or cost jobs?',
    focus: ['unemployment', 'poverty', 'gini', 'gdp_per_capita'],
    build: () => ({
      title: 'Raise the minimum wage',
      question: 'Does a 15% higher national minimum wage lift incomes, or cost jobs?',
      audience: 'government',
      arms: [{ id: 'nmw-15', label: `Minimum wage +15% (R${pct(D.minimumWageHourly, 0.15).toFixed(2)}/h)`, params: { minimumWageHourly: pct(D.minimumWageHourly, 0.15) } }],
    }),
  },
  {
    id: 'oil-shock',
    audience: 'government',
    title: 'An oil price shock',
    question: 'What does Brent at 1.8 times its path for a year do to prices, the repo rate, fares and household budgets?',
    focus: ['inflation', 'poverty', 'household_debt', 'gdp_per_capita'],
    build: () => ({
      title: 'An oil price shock',
      question: 'What does Brent at 1.8 times its path for a year do to prices, the repo rate, fares and household budgets?',
      audience: 'government',
      arms: [{ id: 'oil-18', label: 'Brent ×1.8 from month six for a year', shocks: [{ kind: 'oil', label: 'Oil shock ×1.8', fromMonth: 6, months: 12, factor: 1.8 }] }],
    }),
  },
  {
    id: 'funeral-cover-for-all',
    audience: 'social',
    title: 'Funeral cover for every household',
    question: 'If every household joined the burial society, does the pool hold, and what does it do to debt after a death?',
    focus: ['funeral_cover', 'scheme_reserve', 'scheme_ruin', 'household_debt'],
    build: () => ({
      title: 'Funeral cover for every household',
      question: 'If every household joined the burial society, does the pool hold, and what does it do to debt after a death?',
      audience: 'social',
      arms: [
        {
          id: 'cover-all',
          label: 'Every household covered from the start',
          params: {
            funeralCoverShare: 1,
            tiers: Object.fromEntries(Object.keys(D.tiers).map((t) => [t, { funeralCoverShare: 1 }])),
          },
        },
      ],
    }),
  },
  {
    id: 'better-clinics',
    audience: 'social',
    title: 'Better clinics',
    question: 'What do clinics with better care (quality 0.8 instead of 0.55) do to deaths, admissions and life expectancy?',
    focus: ['e0', 'deaths_per_1000', 'hospital_per_1000', 'u5mr'],
    build: () => ({
      title: 'Better clinics',
      question: 'What do clinics with better care (quality 0.8 instead of 0.55) do to deaths, admissions and life expectancy?',
      audience: 'social',
      arms: [{ id: 'care-08', label: 'Clinic care quality 0.8', params: { careQuality: 0.8 } }],
    }),
  },
  {
    id: 'medical-aid',
    audience: 'social',
    title: 'Medical aid for more households',
    question: 'If half of all households had medical aid, how do care-seeking, deaths and household budgets change?',
    focus: ['e0', 'hospital_per_1000', 'household_savings', 'poverty'],
    build: () => ({
      title: 'Medical aid for more households',
      question: 'If half of all households had medical aid, how do care-seeking, deaths and household budgets change?',
      audience: 'social',
      arms: [
        {
          id: 'medical-50',
          label: 'Medical aid for half of households',
          params: { medicalAidShare: 0.5, tiers: Object.fromEntries(Object.entries(D.tiers).map(([t, p]) => [t, { medicalAidShare: Math.max(0.5, p.medicalAidShare) }])) },
        },
      ],
    }),
  },
];

export const TEMPLATE_BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));
