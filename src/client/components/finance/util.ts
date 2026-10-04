import type { FinanceState } from '../../../sim/finance/state';
import { calendarForDay, MONTHS } from '../../../sim/time';
import { store } from '../../lib/simStore';

export const R = (v: number, k = false): string => {
  if (!Number.isFinite(v)) return '—';
  if (k && Math.abs(v) >= 1_000_000_000) return `R${(v / 1_000_000_000).toFixed(2)}bn`;
  if (k && Math.abs(v) >= 10_000_000) return `R${(v / 1_000_000).toFixed(1)}m`;
  if (k && Math.abs(v) >= 1_000_000) return `R${(v / 1_000_000).toFixed(2)}m`;
  if (k && Math.abs(v) >= 10_000) return `R${Math.round(v / 1000).toLocaleString()}k`;
  return `${v < 0 ? '−' : ''}R${Math.round(Math.abs(v)).toLocaleString()}`;
};
export const pct = (v: number | null | undefined, d = 1): string => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`);

/** Calendar label of a month index (months since the scenario start). */
export function monthLabel(m: number): string {
  const c0 = calendarForDay(store.startMs, 0);
  const idx = c0.month - 1 + m;
  const y = c0.year + Math.floor(idx / 12);
  return `${MONTHS[((idx % 12) + 12) % 12]} ${y}`;
}

export function monthIso(m: number): string {
  const c0 = calendarForDay(store.startMs, 0);
  const idx = c0.month - 1 + m;
  const y = c0.year + Math.floor(idx / 12);
  return `${y}-${String((((idx % 12) + 12) % 12) + 1).padStart(2, '0')}`;
}

export function dayIso(day: number): string {
  return calendarForDay(store.startMs, day).isoDate;
}

export function entityName(F: FinanceState, id: string): string {
  return F.entities[id]?.name ?? F.ledgers.books[id]?.name ?? id;
}

export const SECTOR_LABEL: Record<string, string> = { households: 'Households', firms: 'Firms', church: 'Church', scheme: 'Burial society', bank: 'Mutual Bank', government: 'Government', row: 'Rest of the economy' };

export function sectorOf(F: FinanceState, id: string): string {
  return SECTOR_LABEL[F.entities[id]?.sector ?? (id.startsWith('hh:') ? 'households' : 'row')] ?? id;
}

/** Aggregate the last `months` months of inter-entity flows into sector-to-sector links. */
export function sectorFlows(F: FinanceState, months: number): Array<{ from: string; to: string; value: number }> {
  const agg: Record<string, number> = {};
  for (const row of F.flows.slice(-months)) {
    for (const key in row.cells) {
      const [from, to] = key.split('>');
      const a = sectorOf(F, from);
      const b = sectorOf(F, to);
      if (a === b) continue;
      agg[`${a}>${b}`] = (agg[`${a}>${b}`] ?? 0) + row.cells[key];
    }
  }
  return Object.entries(agg).map(([k, value]) => {
    const [from, to] = k.split('>');
    return { from, to, value };
  });
}
