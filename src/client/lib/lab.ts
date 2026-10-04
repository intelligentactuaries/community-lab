// The policy & stress lab's state: the experiment being drafted (from a
// template, from an experiment file in the workspace, or from inputs put to
// the lab as an arm), the job running on the server's worker pool, and its
// result.

import type { Audience, ExperimentArm, ExperimentResult, ExperimentSpec, ParamPatch } from '../../shared/exchange';
import { useSyncExternalStore } from 'react';
import { changedFromDefaults } from '../../sim/patch';
import { TEMPLATES, TEMPLATE_BY_ID } from '../../shared/templates';
import { store } from './simStore';

export interface LabDraft {
  templateId: string | null;
  title: string;
  question: string;
  audience: Audience | null;
  arms: ExperimentArm[];
  seeds: number;
  years: number;
  /** Start every arm from the province's current basis (its changed parameters), not the defaults. */
  fromProvince: boolean;
  /** Where the draft came from when it was not a template (a workspace file, a supplied basis). */
  from: string | null;
  focus: string[];
}

export interface LabJob {
  id: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  done: number;
  total: number;
  startedAt: number;
  error?: string;
  warnings: string[];
}

interface LabState {
  draft: LabDraft;
  job: LabJob | null;
  result: ExperimentResult | null;
  /** An experiment opened from a file keeps the file's base (its basis and shocks), which the draft cannot show. */
  specOverride: ExperimentSpec | null;
  recent: Array<{ id: string; created_at: number; title: string }>;
}

/** What to lead with for a supplied basis or stress, and for an experiment of no template. */
const BASIS_FOCUS = ['ae', 'deaths_per_1000', 'e0', 'scheme_reserve', 'loss_ratio'];
const DEFAULT_FOCUS = ['deaths_per_1000', 'e0', 'poverty', 'scheme_reserve', 'fiscal_balance'];

const first = TEMPLATES[0];
let state: LabState = {
  draft: { templateId: first.id, ...first.build(10), question: first.question, audience: first.audience, seeds: 8, years: 10, fromProvince: false, from: null, focus: first.focus },
  job: null,
  result: null,
  specOverride: null,
  recent: [],
};
const listeners = new Set<() => void>();
function set(patch: Partial<LabState>): void {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

async function jget<T>(path: string): Promise<T> {
  const r = await fetch(path);
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `${path} ${r.status}`);
  return j;
}
async function jpost<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = (await r.json()) as T & { error?: string; details?: string[] };
  if (!r.ok) throw new Error([j.error ?? `${url} ${r.status}`, ...(j.details ?? [])].join(': '));
  return j;
}

let poll: ReturnType<typeof setInterval> | null = null;

export const lab = {
  get state(): LabState {
    return state;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  pickTemplate(id: string): void {
    const t = TEMPLATE_BY_ID.get(id);
    if (!t) return;
    const years = state.draft.years;
    set({ draft: { ...state.draft, templateId: id, ...t.build(years), question: t.question, audience: t.audience, from: null, focus: t.focus }, specOverride: null });
  },
  /** A draft from outside (inputs put to the lab): one arm, compared with the province as it is. */
  prefill(d: { title: string; question: string; arms: ExperimentArm[]; from: string }): void {
    set({ draft: { ...state.draft, templateId: null, title: d.title, question: d.question, audience: 'actuarial', arms: d.arms, fromProvince: true, from: d.from, focus: BASIS_FOCUS }, specOverride: null });
  },
  /** A whole experiment from a file (the workbench): shown as written, then run from the lab or the file. */
  open(spec: ExperimentSpec, from: string): void {
    const template = TEMPLATES.find((t) => t.title === spec.title);
    set({
      draft: {
        // The file's own arms, as written: no template rebuilds them when the horizon changes.
        templateId: null,
        title: spec.title,
        question: spec.question ?? '',
        audience: spec.audience ?? null,
        arms: spec.arms,
        seeds: spec.seeds,
        years: spec.years,
        fromProvince: !!spec.base || !!spec.baseMortality || !!spec.baseShocks,
        from,
        focus: template?.focus ?? (spec.arms.some((a) => a.mortality || a.shocks?.length) ? BASIS_FOCUS : DEFAULT_FOCUS),
      },
      specOverride: spec,
    });
  },
  setDraft(patch: Partial<LabDraft>): void {
    // Shocks run on months from the start: a template's whole-run stress follows the horizon when it changes.
    const next = { ...state.draft, ...patch };
    if (patch.years !== undefined && next.templateId) {
      const t = TEMPLATE_BY_ID.get(next.templateId);
      if (t) next.arms = t.build(next.years).arms;
    }
    set({ draft: next });
  },
  setArmParam(armId: string, key: string, value: number): void {
    set({ draft: { ...state.draft, arms: state.draft.arms.map((a) => (a.id === armId ? { ...a, params: { ...a.params, [key]: value } } : a)) } });
  },
  spec(): ExperimentSpec {
    const d = state.draft;
    if (state.specOverride) return { ...state.specOverride, title: d.title, question: d.question || undefined, audience: d.audience ?? undefined, arms: d.arms, seeds: d.seeds, years: d.years };
    // "From this province's basis" means all of it: its parameters, and the basis and shocks it lives under.
    const P = store.params;
    const base: ParamPatch | undefined = d.fromProvince ? (provinceBase() as ParamPatch) : undefined;
    const baseMortality = d.fromProvince ? P.mortalityOverride : undefined;
    const baseShocks = d.fromProvince && P.shocks?.length ? P.shocks : undefined;
    return { title: d.title, question: d.question || undefined, audience: d.audience ?? undefined, base, baseMortality, baseShocks, arms: d.arms, seeds: d.seeds, years: d.years };
  },
  async run(): Promise<void> {
    try {
      const job = await jpost<LabJob>('/api/experiments', lab.spec());
      set({ job, result: null });
      lab.watch(job.id);
    } catch (e) {
      set({ job: { id: '', status: 'error', done: 0, total: 0, startedAt: Date.now(), error: e instanceof Error ? e.message : String(e), warnings: [] } });
    }
  },
  watch(id: string): void {
    if (poll) clearInterval(poll);
    poll = setInterval(async () => {
      try {
        const j = await jget<LabJob & { result: ExperimentResult | null }>(`/api/experiments/${id}`);
        set({ job: j, result: j.result ?? state.result });
        if (j.status !== 'running') {
          if (poll) clearInterval(poll);
          poll = null;
          void lab.refreshRecent();
        }
      } catch {
        /* keep polling */
      }
    }, 1500);
  },
  async cancel(): Promise<void> {
    if (!state.job) return;
    await fetch(`/api/experiments/${state.job.id}`, { method: 'DELETE' });
    set({ job: { ...state.job, status: 'cancelled' } });
    if (poll) clearInterval(poll);
    poll = null;
  },
  /** Open a kept experiment: its result, and the draft it was run from, so what is shown is what was run. */
  async load(id: string): Promise<void> {
    const j = await jget<LabJob & { result: ExperimentResult | null }>(`/api/experiments/${id}`);
    const spec = j.result?.spec;
    const template = spec ? TEMPLATES.find((t) => t.title === spec.title) : undefined;
    const draft: LabDraft | null = spec
      ? {
          templateId: template?.id ?? null,
          title: spec.title,
          question: spec.question ?? '',
          audience: spec.audience ?? null,
          arms: spec.arms,
          seeds: spec.seeds,
          years: spec.years,
          fromProvince: !!spec.base || !!spec.baseMortality || !!spec.baseShocks,
          from: null,
          focus: template?.focus ?? (spec.arms.some((a) => a.mortality || a.shocks?.length) ? BASIS_FOCUS : DEFAULT_FOCUS),
        }
      : null;
    set({ job: j, result: j.result, specOverride: null, ...(draft ? { draft } : {}) });
  },
  async refreshRecent(): Promise<void> {
    try {
      const r = await jget<{ saved: LabState['recent'] }>('/api/experiments');
      set({ recent: r.saved });
    } catch {
      /* offline */
    }
  },
};

/** The province's own basis as a patch: what its parameters change from the defaults (the seed aside). */
export function provinceBase(): Record<string, unknown> {
  const { mortalityOverride: _m, shocks: _s, ...changed } = changedFromDefaults(store.params);
  return changed;
}

export function useLab(): LabState {
  return useSyncExternalStore(lab.subscribe, () => state, () => state);
}
