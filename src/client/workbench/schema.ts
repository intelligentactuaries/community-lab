// JSON Schemas for the two file formats the workbench runs, so the editor
// completes every parameter, shows its range and meaning on hover, and marks
// a wrong one before anything runs. Generated from the engine itself: the
// defaults (sim/params.ts), the ranges and choices a patch accepts
// (sim/patch.ts), the mortality presets, and, for each parameter's meaning,
// the doc comment it carries in params.ts, read from the source at build time
// (the `?raw` import), so a description cannot drift from the code.

import paramsSource from '../../sim/params.ts?raw';
import { MAX_EXPERIMENT_ARMS, MAX_EXPERIMENT_SEEDS, MAX_EXPERIMENT_YEARS, MAX_SHOCKS } from '../../shared/exchange';
import { EXPERIMENT_SCHEMA_URI, PROVINCE_SCHEMA_URI } from '../../shared/files';
import { MORTALITY_PRESETS } from '../../sim/mortality';
import { DEFAULT_PARAMS } from '../../sim/params';
import { CHOICES, NOT_PATCHABLE, PARAM_RANGES, TIER_SHARES } from '../../sim/patch';

type Schema = Record<string, unknown>;

/** `field` → its doc comment, from one interface of params.ts. */
function docComments(src: string, iface: string): Record<string, string> {
  const start = src.indexOf(`export interface ${iface} {`);
  if (start < 0) return {};
  let depth = 0;
  let end = start;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  const body = src.slice(start, end);
  const out: Record<string, string> = {};
  const re = /\/\*\*([\s\S]*?)\*\/\s*\n\s*([A-Za-z0-9_]+)\??\s*:/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    out[m[2]] = m[1]
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      .filter(Boolean)
      .join(' ');
  }
  return out;
}

const DOCS = docComments(paramsSource, 'ScenarioParams');
const TIER_DOCS = docComments(paramsSource, 'CommunityProfile');

const PRESET_DOC = `One of: ${MORTALITY_PRESETS.map((p) => `${p.id} (${p.label})`).join('; ')}.`;

function paramProperties(): Record<string, Schema> {
  const props: Record<string, Schema> = {};
  for (const [k, def] of Object.entries(DEFAULT_PARAMS)) {
    if (NOT_PATCHABLE.has(k) && k !== 'tiers') continue;
    const doc = DOCS[k] ?? '';
    const key = k as keyof typeof DEFAULT_PARAMS;
    if (k === 'tiers') {
      const tierProps: Record<string, Schema> = {};
      for (const share of TIER_SHARES) tierProps[share] = { type: 'number', minimum: 0, maximum: 1, description: TIER_DOCS[share] ?? share };
      props.tiers = {
        type: 'object',
        description: 'Shares of a settlement tier, by tier: e.g. { "low-income": { "funeralCoverShare": 1 } }.',
        properties: Object.fromEntries(Object.keys(DEFAULT_PARAMS.tiers).map((t) => [t, { type: 'object', properties: tierProps, additionalProperties: false }])),
        additionalProperties: false,
      };
      continue;
    }
    if (k === 'educationMix') {
      props[k] = {
        type: 'object',
        description: `${doc} The six shares are normalised to sum to 1.`,
        properties: Object.fromEntries(Object.keys(DEFAULT_PARAMS.educationMix).map((e) => [e, { type: 'number', minimum: 0, maximum: 1 }])),
        additionalProperties: false,
      };
      continue;
    }
    if (typeof def === 'number') {
      const r = PARAM_RANGES[key];
      props[k] = { type: 'number', ...(r ? { minimum: r[0], maximum: r[1] } : {}), default: def, description: `${doc}${r ? ` Range ${r[0]} to ${r[1]}.` : ''} Default ${def}.`.trim() };
    } else if (typeof def === 'boolean') {
      props[k] = { type: 'boolean', default: def, description: `${doc} Default ${def}.`.trim() };
    } else if (typeof def === 'string') {
      const choices = CHOICES[key];
      props[k] = {
        type: 'string',
        ...(choices ? { enum: [...choices] } : {}),
        ...(k === 'startDate' ? { pattern: '^\\d{4}-\\d{2}-\\d{2}$' } : {}),
        default: def,
        description: `${k === 'mortalityPreset' ? `${doc} ${PRESET_DOC}` : doc} Default "${def}".`.trim(),
      };
    }
  }
  return props;
}

const definitions: Record<string, Schema> = {
  basis: { type: 'object', description: 'Scenario parameters that differ from the defaults.', properties: paramProperties(), additionalProperties: false },
  mortality: {
    type: 'object',
    description: 'A mortality table: by sex ({ "M": [...], "F": [...] }) or pooled ({ "pooled": [...] }), one q per age.',
    required: ['label', 'source', 'ages', 'qx'],
    properties: {
      label: { type: 'string' },
      source: { type: 'string' },
      ages: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 131 },
      qx: {
        oneOf: [
          { type: 'object', required: ['M', 'F'], properties: { M: { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 } }, F: { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 } } }, additionalProperties: false },
          { type: 'object', required: ['pooled'], properties: { pooled: { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 } } }, additionalProperties: false },
        ],
      },
      year: { type: 'number', minimum: 1900, maximum: 2200 },
    },
    additionalProperties: false,
  },
  shock: {
    type: 'object',
    description: 'A timed shock. Months count from the start of the simulation (0 is the first month).',
    required: ['kind', 'fromMonth', 'months'],
    properties: {
      kind: { enum: ['mortality', 'repo', 'oil'], description: 'mortality: multiplies every death hazard; repo: adds basis points to the rate the MPC sets; oil: multiplies the Brent price.' },
      label: { type: 'string' },
      fromMonth: { type: 'integer', minimum: 0, maximum: MAX_EXPERIMENT_YEARS * 12 },
      months: { type: 'integer', minimum: 1, maximum: MAX_EXPERIMENT_YEARS * 12 },
      factor: { type: 'number', minimum: 0, maximum: 20, description: 'mortality: 0 to 20; oil: above 0, at most 10.' },
      minAge: { type: 'number', minimum: 0, maximum: 110, description: 'mortality: the youngest age it applies to.' },
      maxAge: { type: 'number', minimum: 0, maximum: 110, description: 'mortality: the oldest age it applies to.' },
      bp: { type: 'number', minimum: -2000, maximum: 2000, description: 'repo: basis points added.' },
    },
    additionalProperties: false,
  },
};

export const PROVINCE_SCHEMA: Schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: PROVINCE_SCHEMA_URI,
  title: 'Community Lab province',
  description: 'A province to run: a seed, the basis (what differs from the defaults), and optionally a mortality table and timed shocks.',
  type: 'object',
  properties: {
    $schema: { type: 'string' },
    title: { type: 'string', description: 'What this province is, in a few words.' },
    notes: { type: 'string' },
    seed: { type: 'string', description: `Same seed, same province: the households, the weather and every draw the basis does not change. Default "${DEFAULT_PARAMS.seed}".` },
    basis: { $ref: '#/definitions/basis' },
    mortality: { anyOf: [{ type: 'string', description: 'A CSV in this workspace: age, qx_m, qx_f (or a pooled qx), as probabilities or per mille.' }, { $ref: '#/definitions/mortality' }, { type: 'null' }] },
    shocks: { type: 'array', items: { $ref: '#/definitions/shock' }, maxItems: MAX_SHOCKS },
  },
  additionalProperties: false,
  definitions,
};

export const EXPERIMENT_SCHEMA: Schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: EXPERIMENT_SCHEMA_URI,
  title: 'Community Lab experiment',
  description: 'A paired experiment: the baseline (base) and each arm run on the same seeds, so each effect is a paired difference with a 95% interval.',
  type: 'object',
  required: ['title', 'arms', 'seeds', 'years'],
  properties: {
    $schema: { type: 'string' },
    notes: { type: 'string' },
    title: { type: 'string' },
    question: { type: 'string', description: 'The question the comparison answers, in your words.' },
    audience: { enum: ['actuarial', 'government', 'social'] },
    base: { $ref: '#/definitions/basis', description: 'The province every arm starts from (the defaults when absent).' },
    baseMortality: { $ref: '#/definitions/mortality' },
    baseShocks: { type: 'array', items: { $ref: '#/definitions/shock' }, maxItems: MAX_SHOCKS },
    arms: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_EXPERIMENT_ARMS,
      items: {
        type: 'object',
        required: ['id', 'label'],
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$', description: 'Lower-case words joined by hyphens; not "baseline".' },
          label: { type: 'string' },
          params: { $ref: '#/definitions/basis' },
          mortality: { $ref: '#/definitions/mortality' },
          shocks: { type: 'array', items: { $ref: '#/definitions/shock' }, maxItems: MAX_SHOCKS },
        },
        additionalProperties: false,
      },
    },
    seeds: { type: 'integer', minimum: 2, maximum: MAX_EXPERIMENT_SEEDS, description: 'Seeds every arm runs on (common random numbers).' },
    years: { type: 'number', minimum: 1, maximum: MAX_EXPERIMENT_YEARS },
  },
  additionalProperties: false,
  definitions,
};
