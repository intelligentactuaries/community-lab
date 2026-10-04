// The experiment lab's chart: each arm's effect on each indicator as a change
// relative to the baseline's mean, with its 95% interval, against a dashed
// zero. Relative, so a rand figure and a share can sit on one axis; the
// tooltip gives the effect in its own unit.

import { baseOption, type ChartTheme } from './theme';

export interface ForestRow {
  label: string;
  /** Relative effect (arm − baseline) / |baseline|, and its interval, in percent. */
  est: number;
  lo: number;
  hi: number;
  color: string;
  /** The effect in its own unit, for the tooltip. */
  tip: string;
}

export function forestOption(th: ChartTheme, rows: ForestRow[]): Record<string, unknown> {
  const finite = rows.flatMap((r) => [r.est, r.lo, r.hi]).filter(Number.isFinite);
  const reach = Math.max(1, ...finite.map(Math.abs)) * 1.15;
  const fmt = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v) >= 10 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(1)}%`;
  return {
    ...baseOption(th),
    grid: { left: 6, right: 18, top: 10, bottom: 22, containLabel: true },
    tooltip: {
      ...(baseOption(th).tooltip as Record<string, unknown>),
      trigger: 'item',
      formatter: (p: { dataIndex: number }) => {
        const r = rows[p.dataIndex];
        return r ? `${r.label}<br/>${r.tip}<br/><span style="color:${th.muted}">${fmt(r.est)} of the baseline (95% ${fmt(r.lo)} to ${fmt(r.hi)})</span>` : '';
      },
    },
    xAxis: {
      type: 'value',
      min: -reach,
      max: reach,
      axisLine: { show: true, lineStyle: { color: th.grid } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { color: th.muted, fontSize: 9, formatter: fmt },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: rows.map((r) => r.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: th.fg2, fontSize: 10.5, width: 190, overflow: 'truncate' },
    },
    series: [
      {
        type: 'custom',
        silent: true,
        renderItem: (_params: unknown, api: { value: (i: number) => number; coord: (v: [number, number]) => [number, number] }) => {
          const i = api.value(2);
          const a = api.coord([api.value(0), i]);
          const b = api.coord([api.value(1), i]);
          return { type: 'line', shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, style: { stroke: rows[i]?.color ?? th.muted, lineWidth: 3, opacity: 0.45 } };
        },
        encode: { x: [0, 1], y: 2 },
        data: rows.map((r, i) => [Number.isFinite(r.lo) ? r.lo : r.est, Number.isFinite(r.hi) ? r.hi : r.est, i]),
        z: 2,
      },
      {
        type: 'scatter',
        z: 4,
        symbolSize: 10,
        data: rows.map((r, i) => ({ value: [r.est, i], itemStyle: { color: r.color, borderColor: th.surface, borderWidth: 2 } })),
        markLine: { silent: true, symbol: 'none', lineStyle: { color: th.muted, width: 1, type: 'dashed' }, label: { show: false }, data: [{ xAxis: 0 }] },
      },
    ],
  };
}
