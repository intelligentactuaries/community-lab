// Mortality tables and outside inputs, checked the way the exchange checks
// them (./exchange.ts): shared by the province (client/lib/outside.ts), the
// workbench's runs and the script worker, none of which may pull in more than
// the engine and this.

import { type MortalityOverride, type ParamPatch, type Shock, parseDirective } from './exchange';

/** Validate inputs as the exchange would (types, ranges of the basis and the shocks); the reasons, or none. */
export function checkInputs(x: { label: string; from?: string; params?: ParamPatch; mortality?: MortalityOverride; shocks?: Shock[] }): string[] {
  if (x.params === undefined && x.mortality === undefined && x.shocks === undefined) return [];
  const p = parseDirective({ schema: 'scelo.exchange/1', kind: 'community.directive', id: 'check', label: x.label || 'inputs', from: { app: 'community-lab', appVersion: '0', createdAt: '' }, params: x.params, mortality: x.mortality, shocks: x.shocks });
  return p.ok ? [] : p.errors;
}

/**
 * A mortality table from CSV: an `age` column and q by sex (`qx_m`/`qx_f`, `m`/`f`, `male`/`female`) or pooled
 * (`qx`). Rates may be given as probabilities or per mille (`‰` in the header, or every value above 1). Returns the
 * basis, or the reasons it is not one.
 */
export function mortalityFromCsv(text: string, label: string, source: string): { ok: true; value: MortalityOverride } | { ok: false; errors: string[] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 3) return { ok: false, errors: ['a header row and at least two ages are needed'] };
  const split = (l: string) => l.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h === n || h.replace(/[\s_()‰]/g, '') === n.replace(/[\s_]/g, '')));
  const iAge = col('age', 'x');
  if (iAge < 0) return { ok: false, errors: ['no "age" column'] };
  const iM = col('qx_m', 'qxm', 'm', 'male', 'males', 'q_m');
  const iF = col('qx_f', 'qxf', 'f', 'female', 'females', 'q_f');
  const iP = col('qx', 'q', 'pooled', 'qx_pooled');
  if (!(iM >= 0 && iF >= 0) && iP < 0) return { ok: false, errors: ['columns qx_m and qx_f (or a pooled qx) are needed beside age'] };
  const perMille = head.some((h) => h.includes('‰') || h.includes('per1000') || h.includes('per_1000'));
  const ages: number[] = [];
  const M: number[] = [];
  const F: number[] = [];
  const P: number[] = [];
  for (let r = 1; r < lines.length; r++) {
    const c = split(lines[r]);
    const age = Number(c[iAge]);
    if (!Number.isFinite(age)) continue;
    ages.push(age);
    if (iM >= 0 && iF >= 0) {
      M.push(Number(c[iM]));
      F.push(Number(c[iF]));
    } else P.push(Number(c[iP]));
  }
  const all = [...M, ...F, ...P];
  if (all.some((q) => !Number.isFinite(q))) return { ok: false, errors: ['every rate must be a number'] };
  const scale = perMille || all.some((q) => q > 1) ? 1 / 1000 : 1;
  const qx = M.length ? { M: M.map((q) => q * scale), F: F.map((q) => q * scale) } : { pooled: P.map((q) => q * scale) };
  const value: MortalityOverride = { label, source, ages, qx };
  const errors = checkInputs({ label, mortality: value });
  return errors.length ? { ok: false, errors } : { ok: true, value };
}
