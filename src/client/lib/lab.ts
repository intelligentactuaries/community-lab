// The policy & stress lab's state: the experiment being drafted (from a
// template, or from a directive Scelo sent), the job running on the server's
// worker pool, its result, and the council's verdict when one was asked for.

import type { Audience, ExperimentArm, ExperimentResult, ExperimentSpec, ParamPatch } from '@scelo/core/exchange';
import { useSyncExternalStore } from 'react';
import { changedFromDefaults } from '../../sim/patch';
import { TEMPLATES, TEMPLATE_BY_ID } from '../../shared/templates';
import { evidenceFor, residentsAsSociety } from '../../shared/council';
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
  /** Set when the draft came from Scelo (a fitted basis, a stress). */
  fromScelo: string | null;
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

export interface CouncilState {
  status: 'running' | 'done' | 'error';
  runId: string | null;
  message: string;
  summary: { trust: number; distrust: number; uncertain: number; risks: string[]; society: string | null } | null;
}

interface LabState {
  draft: LabDraft;
  job: LabJob | null;
  result: ExperimentResult | null;
  council: CouncilState | null;
  recent: Array<{ id: string; created_at: number; title: string }>;
}

/** What to lead with for a basis or stress from Scelo, and for an experiment of no template. */
const BASIS_FOCUS = ['ae', 'deaths_per_1000', 'e0', 'scheme_reserve', 'loss_ratio'];
const DEFAULT_FOCUS = ['deaths_per_1000', 'e0', 'poverty', 'scheme_reserve', 'fiscal_balance'];

const first = TEMPLATES[0];
let state: LabState = {
  draft: { templateId: first.id, ...first.build(10), question: first.question, audience: first.audience, seeds: 8, years: 10, fromProvince: false, fromScelo: null, focus: first.focus },
  job: null,
  result: null,
  council: null,
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
    set({ draft: { ...state.draft, templateId: id, ...t.build(years), question: t.question, audience: t.audience, fromScelo: null, focus: t.focus } });
  },
  /** A draft from outside (a Scelo directive): one arm, compared with the province as it is. */
  prefill(d: { title: string; question: string; arms: ExperimentArm[]; fromScelo: string }): void {
    set({ draft: { ...state.draft, templateId: null, title: d.title, question: d.question, audience: 'actuarial', arms: d.arms, fromProvince: true, fromScelo: d.fromScelo, focus: BASIS_FOCUS } });
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
      set({ job, result: null, council: null });
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
          fromScelo: null,
          focus: template?.focus ?? (spec.arms.some((a) => a.mortality || a.shocks?.length) ? BASIS_FOCUS : DEFAULT_FOCUS),
        }
      : null;
    set({ job: j, result: j.result, council: null, ...(draft ? { draft } : {}) });
  },
  async refreshRecent(): Promise<void> {
    try {
      const r = await jget<{ saved: LabState['recent'] }>('/api/experiments');
      set({ recent: r.saved });
    } catch {
      /* offline */
    }
  },
  /** Put the result before the swarm's council, with the province's residents as its society. */
  async askCouncil(swarmApi: string): Promise<void> {
    const r = state.result;
    if (!r) return;
    const evidence = evidenceFor(r, state.draft.focus);
    const society = residentsAsSociety(store.sim.world, 120);
    set({ council: { status: 'running', runId: null, message: 'Convening the council…', summary: null } });
    try {
      const scenario = `Unity Province (Community Lab): ${r.spec.title}. ${r.spec.question ?? ''} Weigh the simulated evidence attached and say whether it supports acting on it.`;
      const start = await jpost<{ runId: string }>(`${swarmApi}/api/run`, { scenario, subset: 24, societySize: society.length, wmtrEnabled: false, evidence, societyAgents: society, origin: { app: 'community-lab', ref: r.id } });
      set({ council: { status: 'running', runId: start.runId, message: `Deliberating (run ${start.runId}): 24 council members, then ${society.length} of the province's residents.`, summary: null } });
      const deadline = Date.now() + 45 * 60_000;
      while (Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 3000));
        const run = await jget<{ status: string; error?: string; summary?: { supportPct: number; opposePct: number; abstainPct: number; topRisks?: Array<{ label?: string; text?: string }> }; societySummary?: { headline?: string; summary?: string } }>(`${swarmApi}/api/run/${start.runId}`);
        if (run.status === 'failed') throw new Error(run.error ?? 'the council run failed');
        if (run.status === 'complete' && run.summary) {
          const s = run.summary;
          set({
            council: {
              status: 'done',
              runId: start.runId,
              message: 'The council has deliberated.',
              summary: {
                trust: s.supportPct,
                distrust: s.opposePct,
                uncertain: s.abstainPct,
                risks: (s.topRisks ?? []).slice(0, 3).map((x) => x.label ?? x.text ?? '').filter(Boolean),
                society: run.societySummary?.headline ?? run.societySummary?.summary ?? null,
              },
            },
          });
          return;
        }
      }
      throw new Error('the council did not finish within 45 minutes');
    } catch (e) {
      set({ council: { status: 'error', runId: state.council?.runId ?? null, message: e instanceof Error ? e.message : String(e), summary: null } });
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
