// A plan's fingerprint: the same world always hashes the same, whatever order
// its keys were written in, so a run's basis hash says which world it ran.

import { hash32 } from '../rng';
import type { WorldPlan } from './types';

/** JSON with object keys sorted (arrays keep their order: it is meaningful). */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(',')}}`;
}

/**
 * Twelve hex digits over everything that shapes the world. The bookkeeping in
 * `meta` and the storage `id` are left out: the same world saved twice, or made
 * twice from a template, is the same world.
 */
export function planHash(plan: WorldPlan): string {
  const { meta: _meta, id: _id, ...rest } = plan;
  void _meta;
  void _id;
  const canon = canonicalJson(rest);
  const h1 = hash32(canon);
  const h2 = hash32(canon + '#2');
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12);
}
