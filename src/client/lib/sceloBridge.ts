// The link to Scelo when Community Lab runs inside it — the frame in Scelo
// IDE's Community Lab view, or the web build's. The protocol is the Scelo
// exchange (@scelo/core/exchange):
//
//   this frame → Scelo   community:hello on load; community:export (a table
//                        for Soft Data, or files for the workspace);
//                        community:applied after a directive; community:fact;
//                        community:open (show a swarm run, or a pipeline stage)
//   Scelo → this frame   scelo:welcome (the swarm's address, whether a
//                        workspace is open); scelo:directive (a basis, a
//                        policy, shocks: rebuild on it, or compare it in the lab)
//
// Messages go only to the embedding window's own origin, and are taken only
// from it: Scelo IDE (scelo://app) or a page on this machine's loopback. On a
// page of its own (no parent), Community Lab still offers every export as a
// download.

import {
  type CommunityDirective,
  type CommunityExport,
  EXCHANGE_SCHEMA,
  type FromCommunity,
  parseToCommunity,
} from '@scelo/core/exchange';
import { useSyncExternalStore } from 'react';
import { applyPatch } from '../../sim/patch';
import type { ScenarioParams } from '../../sim/params';
import { shockLabel } from '../../sim/shocks';
import { APP_VERSION } from '../../shared/sceloExport';
import { lab } from './lab';
import { store } from './simStore';

const ALLOWED = /^(scelo:\/\/app|http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?)$/;

export interface AppliedDirective {
  id: string;
  label: string;
  from: string;
  at: number;
  ok: boolean;
  message: string;
  how: 'province' | 'experiment';
}

interface BridgeState {
  /** Inside another window at all. */
  embedded: boolean;
  /** The embedding window answered the hello: it speaks the exchange. */
  connected: boolean;
  host: string | null;
  swarmApi: string | null;
  canSaveToWorkspace: boolean;
  /** Directives received, newest first. */
  received: AppliedDirective[];
}

let state: BridgeState = { embedded: typeof window !== 'undefined' && window.parent !== window, connected: false, host: null, swarmApi: null, canSaveToWorkspace: false, received: [] };
const listeners = new Set<() => void>();
const set = (patch: Partial<BridgeState>) => {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
};

/** The embedding window's origin, if it is one we talk to. location.ancestorOrigins names it in Chromium (and
 *  so in Electron); the referrer is the fallback elsewhere. */
function parentOrigin(): string | null {
  if (typeof window === 'undefined' || window.parent === window) return null;
  const ao = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  let o: string | null = ao && ao.length ? ao[0] : null;
  if (!o && document.referrer) {
    try {
      o = new URL(document.referrer).origin;
    } catch {
      o = null;
    }
  }
  return o && ALLOWED.test(o) ? o : null;
}

function post(msg: FromCommunity): boolean {
  const origin = parentOrigin();
  if (!origin) return false;
  window.parent.postMessage(msg, origin);
  return true;
}

export const bridge = {
  get state(): BridgeState {
    return state;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Send an export to Scelo: its first table becomes the Soft Data dataset, or every table becomes files in the
   *  open workspace. False when there is no Scelo to send to (offer the download instead). */
  send(e: CommunityExport, to: 'soft-data' | 'workspace'): boolean {
    return state.connected && post({ type: 'community:export', export: e, to });
  },
  fact(id: string, label: string, detail?: string): void {
    if (state.connected) post({ type: 'community:fact', fact: { id, label, detail } });
  },
  openSwarm(runId?: string): boolean {
    return state.connected && post({ type: 'community:open', to: 'swarm', runId });
  },
  openScelo(stage?: 'soft' | 'tools' | 'hard'): boolean {
    return state.connected && post({ type: 'community:open', to: 'scelo', stage });
  },
};

export function useBridge(): BridgeState {
  return useSyncExternalStore(bridge.subscribe, () => state, () => state);
}

/** Apply a directive: rebuild the province on it, or put it in the lab beside the province as it is. */
export function applyDirective(d: CommunityDirective): AppliedDirective {
  const how = d.open === 'experiment' ? 'experiment' : 'province';
  const from = `${d.from.app}${d.from.scenario ? ` · ${d.from.scenario}` : ''}`;
  if (how === 'experiment') {
    lab.prefill({
      title: d.label,
      question: `Does ${d.label} change the province, and by how much?`,
      arms: [{ id: 'scelo', label: d.label, params: d.params, mortality: d.mortality, shocks: d.shocks }],
      fromScelo: from,
    });
    store.openDrawer('lab');
    return { id: d.id, label: d.label, from, at: Date.now(), ok: true, message: `Put in the policy lab as an arm beside the province as it is; run it there.`, how };
  }
  const { params, applied, rejected } = applyPatch(store.params, d.params);
  const next: Partial<ScenarioParams> = { ...params };
  if (d.mortality) next.mortalityOverride = d.mortality;
  if (d.shocks) next.shocks = d.shocks;
  store.rebuild(next);
  store.openDrawer('scelo');
  const parts = [
    d.mortality ? `the basis "${d.mortality.label}"` : null,
    applied.length ? `${applied.length} parameter${applied.length === 1 ? '' : 's'} (${applied.join(', ')})` : null,
    d.shocks?.length ? `shocks: ${d.shocks.map(shockLabel).join('; ')}` : null,
  ].filter(Boolean);
  const message = `Rebuilt the province on ${parts.join(', ') || 'no change'}${rejected.length ? `. Left out: ${rejected.join('; ')}` : ''}.`;
  return { id: d.id, label: d.label, from, at: Date.now(), ok: true, message, how };
}

/** Back to the preset table and no shocks (the parameters stay as they are). */
export function clearOutsideInputs(): void {
  const { mortalityOverride: _m, shocks: _s, ...rest } = store.params;
  store.rebuild(rest);
}

/** Start listening, and say hello to the embedding window (again a few times, in case it was still loading). */
export function initSceloBridge(): void {
  if (!state.embedded) return;
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window.parent || e.origin !== parentOrigin()) return;
    const p = parseToCommunity(e.data);
    if (!p.ok) return;
    const m = p.value;
    if (m.type === 'scelo:welcome') {
      set({ connected: true, host: m.app, swarmApi: m.swarmApi, canSaveToWorkspace: m.canSaveToWorkspace });
      return;
    }
    // Scelo re-sends what it has not heard back about (a reload in between): the same id is applied once.
    const seen = state.received.find((r) => r.id === m.directive.id);
    if (seen) {
      post({ type: 'community:applied', directiveId: seen.id, ok: seen.ok, message: seen.message });
      return;
    }
    let result: AppliedDirective;
    try {
      result = applyDirective(m.directive);
    } catch (err) {
      result = { id: m.directive.id, label: m.directive.label, from: m.directive.from.app, at: Date.now(), ok: false, message: err instanceof Error ? err.message : String(err), how: 'province' };
    }
    set({ received: [result, ...state.received].slice(0, 12) });
    post({ type: 'community:applied', directiveId: result.id, ok: result.ok, message: result.message });
  });
  let tries = 0;
  const hello = () => {
    if (state.connected || tries++ > 8) return;
    post({ type: 'community:hello', schema: EXCHANGE_SCHEMA, app: 'community-lab', version: APP_VERSION });
    setTimeout(hello, 600 * tries);
  };
  hello();
}
