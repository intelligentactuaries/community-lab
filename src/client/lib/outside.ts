// Inputs from outside the province: a parameter patch, a mortality basis fitted
// elsewhere, timed shocks. They arrive from a file in the workbench (a
// scenario or a basis), from a mortality table imported as CSV, or from the
// lab; each is checked against the engine's own ranges (sim/patch.ts) and the
// exchange's validators before the province is rebuilt on it, and whatever
// does not fit is named rather than dropped silently.

import { type MortalityOverride, type ParamPatch, type Shock } from '../../shared/exchange';
import { checkInputs } from '../../shared/mortalityCsv';
export { checkInputs, mortalityFromCsv } from '../../shared/mortalityCsv';
import { applyPatch } from '../../sim/patch';
import type { ScenarioParams } from '../../sim/params';
import { shockLabel } from '../../sim/shocks';
import { lab } from './lab';
import { store } from './simStore';

export interface OutsideInputs {
  /** What it is, in a few words ("SAM mortality stress", "Lee–Carter fitted in R"). */
  label: string;
  /** Where it came from ("scenarios/pandemic.province.json"). */
  from: string;
  /** A seed to rebuild on (scenario files carry one). */
  seed?: string;
  params?: ParamPatch;
  mortality?: MortalityOverride;
  shocks?: Shock[];
  /** Rebuild the province on it (default), or put it in the lab as an arm beside the province as it is. */
  open?: 'province' | 'experiment';
  /**
   * What the patch is applied to: the province as it is (the default, as an imported table wants: same scenario,
   * new basis), or the defaults, as a province file is read (its basis is what differs from the defaults, and a
   * file without a seed has the default one), so the same file always builds the same province.
   */
  over?: 'current' | 'defaults';
}

export interface AppliedInputs {
  ok: boolean;
  message: string;
  applied: string[];
  rejected: string[];
}

/** Rebuild the province on the inputs, or put them in the lab as an arm. */
export function applyInputs(x: OutsideInputs): AppliedInputs {
  const errors = checkInputs(x);
  if (errors.length) return { ok: false, message: `Not applied: ${errors.join('; ')}`, applied: [], rejected: errors };
  if (x.open === 'experiment') {
    lab.prefill({
      title: x.label,
      question: `Does ${x.label} change the province, and by how much?`,
      arms: [{ id: 'supplied', label: x.label, params: x.params, mortality: x.mortality, shocks: x.shocks }],
      from: x.from,
    });
    store.openDrawer('lab');
    return { ok: true, message: 'Put in the policy lab as an arm beside the province as it is; run it there.', applied: [], rejected: [] };
  }
  const { params, applied, rejected } = applyPatch(x.over === 'defaults' ? {} : store.params, x.params);
  const next: Partial<ScenarioParams> = { ...params };
  if (x.seed) next.seed = x.seed;
  if (x.mortality) next.mortalityOverride = x.mortality;
  else delete next.mortalityOverride;
  if (x.shocks?.length) next.shocks = x.shocks;
  else delete next.shocks;
  store.rebuild(next);
  const parts = [
    x.seed ? `seed "${x.seed}"` : null,
    x.mortality ? `the basis "${x.mortality.label}"` : null,
    applied.length ? `${applied.length} parameter${applied.length === 1 ? '' : 's'} (${applied.join(', ')})` : null,
    x.shocks?.length ? `shocks: ${x.shocks.map(shockLabel).join('; ')}` : null,
  ].filter(Boolean);
  const message = `Rebuilt the province on ${parts.join(', ') || 'the defaults'}${rejected.length ? `. Left out: ${rejected.join('; ')}` : ''}.`;
  return { ok: true, message, applied, rejected };
}

/** Back to the preset table and no shocks (the parameters stay as they are). */
export function clearOutsideInputs(): void {
  const { mortalityOverride: _m, shocks: _s, ...rest } = store.params;
  store.rebuild(rest);
}
