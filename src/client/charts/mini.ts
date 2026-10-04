// Minimal charts for card summaries. A card that collapses its chart (or its
// table) shows the shape of the data here: hairline chrome, no legend box or
// axis titles (the card's title and the key under the plot carry identity),
// the latest values on the marks, and each entity in the colour its full chart
// gives it. The full chart or table still opens in the lightbox.
import type { ChartTheme } from './theme';
import { baseOption } from './theme';

type Opt = Record<string, unknown>;
type Fmt = (v: number) => string;

const plain: Fmt = (v) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

/** Tooltip glass from the shared scaffolding, confined to the small canvas. */
function tip(th: ChartTheme, extra: Opt): Opt {
  return { ...(baseOption(th).tooltip as Opt), confine: true, ...extra };
}

/** A tooltip row: a short stroke of the series colour, the value first, the name after. */
function row(color: string, value: string, name: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
  return `<span style="display:inline-block;width:10px;height:2px;border-radius:1px;background:${color};vertical-align:middle;margin-right:6px"></span><b>${esc(value)}</b> <span style="opacity:.7">${esc(name)}</span>`;
}

/** The de-emphasis grey for folded tails ("other") and context marks: a fill, never text. */
export function quiet(th: ChartTheme): string {
  return th.dark ? '#5A534B' : '#BDB6A8';
}

function base(th: ChartTheme): Opt {
  return { backgroundColor: 'transparent', animation: false, textStyle: { fontFamily: th.font, color: th.fg2, fontSize: 10 } };
}

function lastIndex(data: Array<number | null>): number {
  for (let i = data.length - 1; i >= 0; i--) if (data[i] !== null && Number.isFinite(data[i] as number)) return i;
  return -1;
}

/** Rough width of a label at 10.5px (for the room end labels need). */
const textW = (s: string) => s.length * 6.2 + 10;

function bounds(vals: number[], zero: boolean): { min: number; max: number } {
  const v = vals.filter((x) => Number.isFinite(x));
  if (!v.length) return { min: 0, max: 1 };
  let lo = Math.min(...v);
  const hi = Math.max(...v);
  if (zero) lo = Math.min(0, lo);
  const span = hi - lo || Math.abs(hi) * 0.1 || 1;
  return { min: zero && lo >= 0 ? 0 : lo - span * 0.1, max: hi + span * 0.14 };
}

// ─── Trend: one to three lines over time ─────────────────────────────────────

export interface TrendSeries {
  name: string;
  data: Array<number | null>;
  color: string;
  /** A reference path (potential output, import parity): dashed and thinner. */
  dashed?: boolean;
  /** A 10% wash under the line (the one series the card is about). */
  area?: boolean;
  /** The latest value at the line's end, with an end dot. */
  label?: boolean;
}

export interface TrendOpts {
  fmt?: Fmt;
  /** Horizontal references (a target, a legal minimum), dashed and labelled. */
  refs?: Array<{ y: number; label?: string }>;
  /** Vertical markers at a category index (today on a schedule). */
  marks?: Array<{ at: number; label: string }>;
  /** Start the value axis at zero (amounts); otherwise it reads from where the data are. */
  zero?: boolean;
  /** Only the last n points. */
  last?: number;
  step?: boolean;
}

export function miniTrend(th: ChartTheme, x: string[], series: TrendSeries[], o: TrendOpts = {}): Opt {
  const fmt = o.fmt ?? plain;
  const from = o.last ? Math.max(0, x.length - o.last) : 0;
  const xs = x.slice(from);
  const ss = series.map((s) => ({ ...s, data: s.data.slice(from) }));
  const vals = ss.flatMap((s) => s.data.filter((v): v is number => v !== null));
  for (const r of o.refs ?? []) vals.push(r.y);
  const { min, max } = bounds(vals, !!o.zero);
  const room = Math.max(4, ...ss.filter((s) => s.label).map((s) => {
    const i = lastIndex(s.data);
    return i < 0 ? 0 : textW(fmt(s.data[i] as number));
  }));
  const refLine = (o.refs?.length || o.marks?.length)
    ? {
        silent: true,
        symbol: 'none',
        lineStyle: { color: th.muted, width: 1, type: 'dashed' },
        label: { color: th.muted, fontSize: 9, position: 'insideStartTop' },
        data: [
          ...(o.refs ?? []).map((r) => ({ yAxis: r.y, label: { show: !!r.label, formatter: r.label ?? '' } })),
          ...(o.marks ?? []).map((m) => ({ xAxis: Math.max(0, m.at - from), label: { show: true, formatter: m.label, position: 'insideEndTop' } })),
        ],
      }
    : undefined;
  return {
    ...base(th),
    grid: { left: 2, right: room, top: 10, bottom: 4, containLabel: false },
    tooltip: tip(th, {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: th.muted, width: 1 } },
      formatter: (ps: Array<{ axisValue: string; color: string; value: number | { value: number }; seriesName: string }>) =>
        `${ps[0]?.axisValue ?? ''}<br/>${ps.filter((p) => p.value !== null && p.value !== undefined).map((p) => row(p.color, fmt(typeof p.value === 'object' ? p.value.value : p.value), p.seriesName)).join('<br/>')}`,
    }),
    xAxis: { type: 'category', data: xs, show: false, boundaryGap: false },
    yAxis: { type: 'value', show: false, min, max },
    series: ss.map((s, i) => {
      const li = lastIndex(s.data);
      return {
        type: 'line',
        name: s.name,
        step: o.step ? 'end' : undefined,
        data: s.data.map((v, j) => (j === li && s.label ? { value: v, symbol: 'circle', symbolSize: 8, itemStyle: { color: s.color, borderColor: th.surface, borderWidth: 2 } } : v)),
        symbol: 'none',
        showSymbol: true,
        connectNulls: true,
        color: s.color,
        lineStyle: { width: s.dashed ? 1.4 : 2, color: s.color, type: s.dashed ? 'dashed' : 'solid', cap: 'round', join: 'round' },
        areaStyle: s.area ? { color: s.color, opacity: 0.1 } : undefined,
        endLabel: s.label ? { show: true, formatter: (p: { value: number | { value: number } }) => fmt(typeof p.value === 'object' ? p.value.value : p.value), color: th.fg, fontSize: 10.5, fontWeight: 500, distance: 6 } : undefined,
        labelLayout: { moveOverlap: 'shiftY' },
        emphasis: { disabled: true },
        markLine: i === 0 ? refLine : undefined,
        z: s.label ? 3 : 2,
      };
    }),
  };
}

// ─── Rows: small multiples of sparklines, each on its own scale ──────────────

export interface SparkRow {
  name: string;
  data: Array<number | null>;
  color: string;
  fmt: Fmt;
  refs?: Array<{ y: number; label?: string }>;
  /** Clip very large values (a capital ratio far above its floor) so the floor stays visible. */
  cap?: number;
}

export function miniRows(th: ChartTheme, x: string[], rows: SparkRow[], o: { last?: number } = {}): Opt {
  const from = o.last ? Math.max(0, x.length - o.last) : 0;
  const xs = x.slice(from);
  const n = Math.max(1, rows.length);
  const band = 100 / n;
  const rs = rows.map((r) => ({ ...r, data: r.data.slice(from).map((v) => (v === null ? null : r.cap !== undefined ? Math.min(v, r.cap) : v)) }));
  const room = Math.max(4, ...rs.map((r) => {
    const i = lastIndex(r.data);
    return i < 0 ? 0 : textW(r.fmt(rows[rs.indexOf(r)].data.slice(from)[i] as number));
  }));
  return {
    ...base(th),
    grid: rs.map((_, i) => ({ left: 2, right: room, top: `${i * band + band * 0.24}%`, height: `${band * 0.62}%` })),
    tooltip: tip(th, {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: th.muted, width: 1 }, link: [{ xAxisIndex: 'all' }] },
      formatter: (ps: Array<{ axisValue: string; color: string; dataIndex: number; seriesIndex: number; seriesName: string }>) =>
        `${ps[0]?.axisValue ?? ''}<br/>${ps.map((p) => {
          const r = rows[p.seriesIndex];
          const v = r?.data[from + p.dataIndex];
          return v === null || v === undefined ? '' : row(p.color, r.fmt(v), p.seriesName);
        }).filter(Boolean).join('<br/>')}`,
    }),
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    xAxis: rs.map((_, i) => ({ type: 'category', data: xs, show: false, boundaryGap: false, gridIndex: i })),
    yAxis: rs.map((r, i) => {
      const vals = r.data.filter((v): v is number => v !== null);
      for (const f of r.refs ?? []) vals.push(f.y);
      const { min, max } = bounds(vals, false);
      return {
        type: 'value',
        gridIndex: i,
        min,
        max,
        name: r.name,
        nameLocation: 'end',
        nameGap: 5,
        nameTextStyle: { color: th.muted, fontSize: 9.5, align: 'left', padding: [0, 0, 0, -2] },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
      };
    }),
    series: rs.map((r, i) => {
      const li = lastIndex(r.data);
      const full = rows[i].data.slice(from);
      return {
        type: 'line',
        name: r.name,
        xAxisIndex: i,
        yAxisIndex: i,
        data: r.data.map((v, j) => (j === li ? { value: v, symbol: 'circle', symbolSize: 7, itemStyle: { color: r.color, borderColor: th.surface, borderWidth: 2 } } : v)),
        symbol: 'none',
        showSymbol: true,
        connectNulls: true,
        color: r.color,
        lineStyle: { width: 1.8, color: r.color, cap: 'round', join: 'round' },
        areaStyle: { color: r.color, opacity: 0.08 },
        endLabel: { show: li >= 0, formatter: () => (li >= 0 ? r.fmt(full[li] as number) : ''), color: th.fg, fontSize: 10.5, fontWeight: 500, distance: 6 },
        emphasis: { disabled: true },
        markLine: r.refs?.length
          ? { silent: true, symbol: 'none', lineStyle: { color: th.muted, width: 1, type: 'dashed' }, label: { color: th.muted, fontSize: 9, position: 'insideStartTop' }, data: r.refs.map((f) => ({ yAxis: f.y, label: { show: !!f.label, formatter: f.label ?? '' } })) }
          : undefined,
      };
    }),
  };
}

// ─── Ranked bars: the largest few, the rest folded into "other" ──────────────

export function miniBars(th: ChartTheme, rows: Array<{ label: string; value: number; color?: string }>, o: { fmt?: Fmt; color?: string; top?: number; other?: string; sort?: boolean } = {}): Opt {
  const fmt = o.fmt ?? ((v: number) => Math.round(v).toLocaleString());
  const color = o.color ?? th.categorical[0];
  const sorted = o.sort === false ? rows : [...rows].sort((a, b) => b.value - a.value);
  const top = o.top ?? 5;
  const shown = sorted.slice(0, top);
  const rest = sorted.slice(top).reduce((s, r) => s + r.value, 0);
  if (rest > 0) shown.push({ label: o.other ?? `other (${sorted.length - top})`, value: rest, color: quiet(th) });
  const hi = Math.max(1, ...shown.map((r) => r.value));
  return {
    ...base(th),
    grid: { left: 2, right: 8, top: 2, bottom: 2, containLabel: true },
    tooltip: tip(th, { trigger: 'item', formatter: (p: { name: string; value: number; color: string }) => row(p.color, fmt(p.value), p.name) }),
    xAxis: { type: 'value', show: false, max: hi * 1.22 },
    yAxis: { type: 'category', inverse: true, data: shown.map((r) => r.label), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: th.fg2, fontSize: 10, width: 92, overflow: 'truncate', margin: 6 } },
    series: [{
      type: 'bar',
      data: shown.map((r) => ({ value: r.value, name: r.label, itemStyle: { color: r.color ?? color } })),
      barMaxWidth: 10,
      itemStyle: { borderRadius: [0, 3, 3, 0] },
      label: { show: true, position: 'right', distance: 4, formatter: (p: { value: number }) => fmt(p.value), color: th.fg2, fontSize: 10 },
      emphasis: { disabled: true },
    }],
  };
}

// ─── Columns: counts or amounts per period or band ───────────────────────────

export interface ColumnSeries {
  name: string;
  data: number[];
  color: string;
  stack?: string;
}

export function miniColumns(th: ChartTheme, cats: string[], series: ColumnSeries[], o: { fmt?: Fmt; signed?: boolean; negColor?: string; ends?: boolean; labelLast?: boolean; refs?: Array<{ x: number; label: string }> } = {}): Opt {
  const fmt = o.fmt ?? ((v: number) => Math.round(v).toLocaleString());
  const n = cats.length;
  const single = series.length === 1;
  const neg = o.negColor ?? th.categorical[1];
  return {
    ...base(th),
    grid: { left: 2, right: 2, top: o.labelLast ? 16 : 6, bottom: o.ends === false ? 2 : 16, containLabel: false },
    tooltip: tip(th, {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: th.grid, opacity: 0.5 } },
      formatter: (ps: Array<{ axisValue: string; color: string; value: number; seriesName: string }>) => `${ps[0]?.axisValue ?? ''}<br/>${ps.map((p) => row(p.color, fmt(p.value), p.seriesName)).join('<br/>')}`,
    }),
    xAxis: {
      type: 'category',
      data: cats,
      axisLine: { lineStyle: { color: th.grid } },
      axisTick: { show: false },
      axisLabel: { show: o.ends !== false, color: th.muted, fontSize: 9, interval: (i: number) => i === 0 || i === n - 1, margin: 5, alignMinLabel: 'left', alignMaxLabel: 'right' },
    },
    yAxis: { type: 'value', show: false, min: o.signed ? undefined : 0 },
    series: series.map((s) => ({
      type: 'bar',
      name: s.name,
      stack: s.stack,
      barMaxWidth: single ? 12 : 8,
      barGap: '15%',
      barCategoryGap: '30%',
      color: s.color,
      data: s.data.map((v, i) => ({
        value: v,
        itemStyle: { color: o.signed && v < 0 ? neg : s.color, borderRadius: s.stack ? 0 : v < 0 ? [0, 0, 2, 2] : [2, 2, 0, 0] },
        label: single && o.labelLast && i === n - 1 ? { show: true, position: v < 0 ? 'bottom' : 'top', formatter: fmt(v), color: th.fg, fontSize: 10, fontWeight: 500 } : undefined,
      })),
      emphasis: { disabled: true },
      markLine: o.refs?.length
        ? { silent: true, symbol: 'none', lineStyle: { color: th.muted, width: 1, type: 'dashed' }, label: { color: th.muted, fontSize: 9, position: 'end' }, data: o.refs.map((r) => ({ xAxis: r.x, label: { formatter: r.label } })) }
        : undefined,
    })),
  };
}

// ─── Build-up: one stacked column, each layer labelled beside it ────────────

export function miniStack(th: ChartTheme, parts: Array<{ name: string; value: number; color: string }>, o: { fmt?: Fmt } = {}): Opt {
  const fmt = o.fmt ?? plain;
  const ps = parts.filter((p) => p.value > 0);
  const total = ps.reduce((s, p) => s + p.value, 0) || 1;
  return {
    ...base(th),
    grid: { left: 6, right: '64%', top: 6, bottom: 4, containLabel: false },
    tooltip: tip(th, { trigger: 'item', formatter: (p: { seriesName: string; value: number; color: string }) => `${row(p.color, fmt(p.value), p.seriesName)}<br/><span style="opacity:.7">${Math.round((p.value / total) * 100)}% of ${fmt(total)}</span>` }),
    xAxis: { type: 'category', data: [''], show: false },
    yAxis: { type: 'value', show: false, max: total },
    series: ps.map((p, i) => ({
      type: 'bar',
      name: p.name,
      stack: 'build',
      barWidth: 30,
      data: [p.value],
      itemStyle: { color: p.color, borderColor: th.surface, borderWidth: 1, borderRadius: i === ps.length - 1 ? [3, 3, 0, 0] : 0 },
      label: {
        show: true,
        position: 'right',
        distance: 10,
        formatter: `{n|${p.name}}  {v|${fmt(p.value)}}`,
        rich: { n: { color: th.muted, fontSize: 10 }, v: { color: th.fg, fontSize: 10.5, fontWeight: 500 } },
      },
      labelLayout: { hideOverlap: true },
      emphasis: { disabled: true },
    })),
  };
}

// ─── Split bar: one or two horizontal part-to-whole bars ─────────────────────

export function miniSplit(th: ChartTheme, cats: string[], parts: Array<{ name: string; values: number[]; color: string }>, o: { fmt?: Fmt } = {}): Opt {
  const fmt = o.fmt ?? ((v: number) => Math.round(v).toLocaleString());
  const totals = cats.map((_, i) => parts.reduce((s, p) => s + Math.max(0, p.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const live = parts.filter((p) => p.values.some((v) => v > 0));
  return {
    ...base(th),
    grid: { left: 2, right: 4, top: 4, bottom: 4, containLabel: cats.some((c) => c) },
    tooltip: tip(th, { trigger: 'item', formatter: (p: { seriesName: string; value: number; color: string; dataIndex: number }) => `${row(p.color, fmt(p.value), p.seriesName)}<br/><span style="opacity:.7">${Math.round((p.value / (totals[p.dataIndex] || 1)) * 100)}%</span>` }),
    xAxis: { type: 'value', show: false, max },
    yAxis: { type: 'category', data: cats, inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: cats.some((c) => c), color: th.fg2, fontSize: 10, margin: 6 } },
    series: live.map((p, k) => ({
      type: 'bar',
      name: p.name,
      stack: 'split',
      barWidth: cats.length > 1 ? 12 : 16,
      data: p.values.map((v) => Math.max(0, v)),
      itemStyle: { color: p.color, borderColor: th.surface, borderWidth: 1, borderRadius: k === live.length - 1 ? [0, 3, 3, 0] : k === 0 ? [3, 0, 0, 3] : 0 },
      emphasis: { disabled: true },
    })),
  };
}

// ─── XY: curves and scatters on value axes, only their end ticks labelled ────

export interface XYSeries {
  name: string;
  data: Array<[number, number]>;
  color: string;
  kind?: 'line' | 'scatter';
  dashed?: boolean;
  area?: boolean;
  width?: number;
  step?: boolean;
  /** Scatter points drawn quietly (the cloud behind a fit). */
  faint?: boolean;
}

export interface XYPoint {
  x: number;
  y: number;
  label: string;
  color?: string;
  position?: 'top' | 'right' | 'left' | 'bottom';
}

export interface XYOpts {
  xFmt?: Fmt;
  yFmt?: Fmt;
  xLog?: boolean;
  yLog?: boolean;
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  points?: XYPoint[];
  refs?: Array<{ y: number; label?: string }>;
}

function valueAxis(th: ChartTheme, vals: number[], log: boolean, fmt: Fmt, lo: number | undefined, hi: number | undefined, vertical: boolean): Opt {
  const axis: Opt = {
    type: log ? 'log' : 'value',
    // Axes sit at the plot's edges (not through zero), so every card reads the same way.
    axisLine: { show: true, onZero: false, lineStyle: { color: th.grid } },
    axisTick: { show: false },
    splitLine: { show: false },
    // End labels turn inwards, so the two axes' labels never meet at the corner.
    axisLabel: { color: th.muted, fontSize: 9, formatter: fmt, showMinLabel: true, showMaxLabel: true, hideOverlap: true, margin: 4, ...(vertical ? { verticalAlignMinLabel: 'bottom', verticalAlignMaxLabel: 'top' } : { alignMinLabel: 'left', alignMaxLabel: 'right' }) },
  };
  if (log) {
    axis.logBase = 10;
    if (lo !== undefined) axis.min = lo;
    if (hi !== undefined) axis.max = hi;
    return axis;
  }
  const v = vals.filter((x) => Number.isFinite(x));
  const min = lo ?? (v.length ? Math.min(...v) : 0);
  const max = hi ?? (v.length ? Math.max(...v) : 1);
  const span = max - min || Math.abs(max) * 0.1 || 1;
  const a = lo ?? min - span * 0.06;
  const b = hi ?? max + span * 0.06;
  // Two ticks, at the ends: the reader gets the range, the tooltip the rest.
  return { ...axis, min: a, max: b, interval: b - a };
}

export function miniXY(th: ChartTheme, seriesIn: XYSeries[], o: XYOpts = {}): Opt {
  const xFmt = o.xFmt ?? plain;
  const yFmt = o.yFmt ?? plain;
  // A log axis cannot place zero or less (a household with no income): leave such points out rather than lose the axis.
  const onLog = (p: [number, number]) => (!o.xLog || p[0] > 0) && (!o.yLog || p[1] > 0);
  const series = seriesIn.map((s) => ({ ...s, data: s.data.filter(onLog) }));
  const xs = [...series.flatMap((s) => s.data.map((p) => p[0])), ...(o.points ?? []).map((p) => p.x)];
  const ys = [...series.flatMap((s) => s.data.map((p) => p[1])), ...(o.points ?? []).map((p) => p.y), ...(o.refs ?? []).map((r) => r.y)];
  const out: Array<Record<string, unknown>> = series.map((s) =>
    s.kind === 'scatter'
      ? { type: 'scatter', name: s.name, data: s.data, symbolSize: 7, itemStyle: { color: s.color, opacity: s.faint ? 0.45 : 0.85, borderColor: th.surface, borderWidth: 1 }, emphasis: { scale: 1.3 } }
      : { type: 'line', name: s.name, data: s.data, showSymbol: false, step: s.step ? 'end' : undefined, color: s.color, lineStyle: { width: s.width ?? (s.dashed ? 1.4 : 2), color: s.color, type: s.dashed ? 'dashed' : 'solid', cap: 'round', join: 'round' }, areaStyle: s.area ? { color: s.color, opacity: 0.1 } : undefined, emphasis: { disabled: true } },
  );
  if (o.points?.length) {
    out.push({
      type: 'scatter',
      name: 'marks',
      z: 5,
      data: o.points.map((p) => ({
        value: [p.x, p.y],
        name: p.label,
        itemStyle: { color: p.color ?? th.fg, borderColor: th.surface, borderWidth: 2 },
        label: { show: true, formatter: p.label, position: p.position ?? 'top', distance: 5, color: th.fg, fontSize: 10, fontWeight: 500 },
      })),
      symbolSize: 9,
      emphasis: { scale: 1.2 },
    });
  }
  if (o.refs?.length && out.length) {
    out[0].markLine = { silent: true, symbol: 'none', lineStyle: { color: th.muted, width: 1, type: 'dashed' }, label: { color: th.muted, fontSize: 9, position: 'insideStartTop' }, data: o.refs.map((r) => ({ yAxis: r.y, label: { show: !!r.label, formatter: r.label ?? '' } })) };
  }
  return {
    ...base(th),
    grid: { left: 2, right: 12, top: 12, bottom: 2, containLabel: true },
    tooltip: tip(th, {
      trigger: 'item',
      formatter: (p: { seriesName: string; name: string; value: [number, number]; color: string }) =>
        `${p.name && p.seriesName !== p.name ? `${p.name}<br/>` : ''}${row(p.color, `${xFmt(p.value[0])} · ${yFmt(p.value[1])}`, p.seriesName === 'marks' ? '' : p.seriesName)}`,
    }),
    xAxis: valueAxis(th, xs, !!o.xLog, xFmt, o.xMin, o.xMax, false),
    yAxis: valueAxis(th, ys, !!o.yLog, yFmt, o.yMin, o.yMax, true),
    series: out,
  };
}

// ─── Intervals: an estimate with its 95% interval against a reference ───────

export function miniRange(th: ChartTheme, rows: Array<{ label: string; est: number | null; lo: number | null; hi: number | null; color: string }>, o: { ref?: number; refLabel?: string; fmt?: Fmt } = {}): Opt {
  const fmt = o.fmt ?? ((v: number) => v.toFixed(2));
  const ref = o.ref ?? 1;
  const vals = rows.flatMap((r) => [r.est, r.lo, r.hi].filter((v): v is number => v !== null && Number.isFinite(v)));
  vals.push(ref);
  const lo = Math.max(0, Math.min(...vals));
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const min = Math.max(0, lo - span * 0.15);
  const max = hi + span * 0.15;
  const cats = rows.map((r) => r.label);
  return {
    ...base(th),
    grid: { left: 2, right: 14, top: 8, bottom: 16, containLabel: true },
    tooltip: tip(th, {
      trigger: 'item',
      formatter: (p: { dataIndex: number }) => {
        const r = rows[p.dataIndex];
        return r ? `${r.label}<br/>${row(r.color, r.est === null ? '—' : fmt(r.est), r.lo === null ? '' : `95% [${fmt(r.lo)}, ${fmt(r.hi ?? r.lo)}]`)}` : '';
      },
    }),
    xAxis: { type: 'value', min, max, interval: max - min, axisLine: { show: true, lineStyle: { color: th.grid } }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { color: th.muted, fontSize: 9, formatter: fmt, showMinLabel: true, showMaxLabel: true, margin: 4 } },
    yAxis: {
      type: 'category',
      data: cats,
      inverse: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        margin: 10,
        formatter: (_: string, i: number) => `{n|${rows[i]?.label ?? ''}}  {v|${rows[i]?.est === null || rows[i]?.est === undefined ? '—' : fmt(rows[i].est as number)}}`,
        rich: { n: { color: th.muted, fontSize: 10 }, v: { color: th.fg, fontSize: 10.5, fontWeight: 500 } },
      },
    },
    series: [
      { type: 'bar', stack: 'ci', silent: true, data: rows.map((r) => (r.lo === null ? 0 : r.lo)), itemStyle: { color: 'transparent' }, barWidth: 3, emphasis: { disabled: true } },
      { type: 'bar', stack: 'ci', data: rows.map((r) => (r.lo === null || r.hi === null ? 0 : r.hi - r.lo)), itemStyle: { color: th.muted, opacity: 0.55, borderRadius: 2 }, barWidth: 3, emphasis: { disabled: true } },
      {
        type: 'scatter',
        z: 4,
        data: rows.map((r, i) => (r.est === null ? { value: [null, i] } : { value: [r.est, i], itemStyle: { color: r.color, borderColor: th.surface, borderWidth: 2 } })),
        symbolSize: 10,
        markLine: { silent: true, symbol: 'none', lineStyle: { color: th.muted, width: 1, type: 'dashed' }, label: { formatter: o.refLabel ?? fmt(ref), color: th.muted, fontSize: 9, position: 'end' }, data: [{ xAxis: ref }] },
      },
    ],
  };
}
