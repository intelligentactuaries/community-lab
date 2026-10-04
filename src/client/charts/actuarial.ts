// The actuarial workbench's own diagrams on the shared EChart wrapper: a
// cash-flow timeline (the financial-mathematics picture of payments on a
// line of time, their present value at 0 and accumulated value at the end),
// a surplus fan (the quantiles of a simulated process), the natural-versus-
// level premium diagram, the ruin-versus-capital curve, a pyramid now and
// projected, and a two-axis line chart for functions of different size.

import type { CashFlow } from '../../sim/actuarial/interest';
import { textbookOption, type Curve, type Marker, type Pt } from './econ';
import { legendTop } from './helpers';
import type { ChartTheme } from './theme';
import { baseOption } from './theme';

/** Money on a label, compact. */
export function money(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1e9) return `${s}R${(a / 1e9).toFixed(2)}bn`;
  if (a >= 1e6) return `${s}R${(a / 1e6).toFixed(2)}m`;
  if (a >= 1e4) return `${s}R${Math.round(a / 1e3)}k`;
  if (a >= 1e3) return `${s}R${(a / 1e3).toFixed(1)}k`;
  return `${s}R${Math.round(a)}`;
}

export interface TimelineOpts {
  /** The label of a period on the axis (a year, a month). */
  unit: string;
  /** The present value at time 0 and the accumulated value at the end, drawn as markers. */
  pv?: number;
  av?: number;
  /** Which period the accumulated value is read at (default: the last flow). */
  end?: number;
  fmt?: (v: number) => string;
}

/**
 * The timeline: periods along the axis, a bar per payment (up for money
 * received, down for money paid), the present value of them all at 0 and
 * their accumulated value at the end.
 */
export function timelineOption(th: ChartTheme, flows: CashFlow[], o: TimelineOpts): Record<string, unknown> {
  const b = baseOption(th);
  const fmt = o.fmt ?? money;
  const last = o.end ?? Math.max(0, ...flows.map((f) => f.t));
  const n = Math.ceil(last);
  const cats: string[] = [];
  for (let t = 0; t <= n; t++) cats.push(String(t));
  const inflow = new Array<number | null>(n + 1).fill(null);
  const outflow = new Array<number | null>(n + 1).fill(null);
  const names = new Array<string>(n + 1).fill('');
  for (const f of flows) {
    const k = Math.round(f.t);
    if (k < 0 || k > n) continue;
    if (f.amount >= 0) inflow[k] = (inflow[k] ?? 0) + f.amount;
    else outflow[k] = (outflow[k] ?? 0) + f.amount;
    if (f.label) names[k] = f.label;
  }
  // The present value stands at 0 and the accumulated value at the end as bars of their own, beside the
  // payments they are worth, so the axis takes them in and the eye compares them with a payment.
  const pvBar = new Array<number | null>(n + 1).fill(null);
  const avBar = new Array<number | null>(n + 1).fill(null);
  if (o.pv !== undefined) pvBar[0] = o.pv;
  if (o.av !== undefined) avBar[n] = o.av;
  const legendNames = ['received', 'paid', ...(o.pv !== undefined ? ['PV at 0'] : []), ...(o.av !== undefined ? [`AV at ${n}`] : [])];
  const valueLabel = { show: true, position: 'top', color: th.fg, fontSize: 10, fontWeight: 600, fontFamily: th.font, formatter: (p: { value: number | null }) => (p.value === null || p.value === undefined ? '' : fmt(p.value)) };
  return {
    ...b,
    grid: { left: 10, right: 20, top: legendTop(legendNames) + 6, bottom: 28, containLabel: true },
    legend: { ...(b.legend as object), show: true, left: 0, right: 'auto', data: legendNames },
    tooltip: { ...(b.tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: th.grid } }, formatter: (ps: Array<{ dataIndex: number; seriesName: string; value: number | null }>) => `${o.unit} ${ps[0].dataIndex}${names[ps[0].dataIndex] ? ` · ${names[ps[0].dataIndex]}` : ''}<br/>${ps.filter((p) => p.value !== null && p.value !== undefined).map((p) => `${p.seriesName}: ${fmt(p.value as number)}`).join('<br/>')}` },
    xAxis: { ...(b.xAxis as object), type: 'category', data: cats, name: o.unit, nameLocation: 'middle', nameGap: 18, nameTextStyle: { color: th.fg2, fontSize: 10.5 }, axisLine: { show: true, symbol: ['none', 'arrow'], symbolSize: [7, 10], lineStyle: { color: th.fg2 } }, axisLabel: { color: th.muted, fontSize: 10, hideOverlap: true } },
    yAxis: { ...(b.yAxis as object), type: 'value', axisLabel: { color: th.muted, fontSize: 10, formatter: fmt } },
    series: [
      { name: 'received', type: 'bar', stack: 'flow', data: inflow, barMaxWidth: 16, itemStyle: { color: th.categorical[2], borderRadius: [3, 3, 0, 0] } },
      { name: 'paid', type: 'bar', stack: 'flow', data: outflow, barMaxWidth: 16, itemStyle: { color: th.categorical[4], borderRadius: [0, 0, 3, 3] }, markLine: { silent: true, symbol: 'none', lineStyle: { color: th.fg2, width: 1.2 }, label: { show: false }, data: [{ yAxis: 0 }] } },
      ...(o.pv !== undefined ? [{ name: 'PV at 0', type: 'bar', data: pvBar, barMaxWidth: 16, itemStyle: { color: th.categorical[3], opacity: 0.75, borderRadius: [3, 3, 0, 0] }, label: valueLabel }] : []),
      ...(o.av !== undefined ? [{ name: `AV at ${n}`, type: 'bar', data: avBar, barMaxWidth: 16, itemStyle: { color: th.categorical[0], opacity: 0.75, borderRadius: [3, 3, 0, 0] }, label: valueLabel }] : []),
    ],
  };
}

export interface FanBands {
  p5: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p95: number[];
}

/** A fan: the 5–95 and 25–75 bands of a simulated path around its median, a ruin line at zero, and the actual history before it. */
export function fanOption(th: ChartTheme, x: string[], fan: FanBands, o: { history?: Array<number | null>; fmt?: (v: number) => string; name?: string; refs?: Array<{ y: number; label: string }> } = {}): Record<string, unknown> {
  const b = baseOption(th);
  const fmt = o.fmt ?? money;
  const color = th.categorical[0];
  const diff = (hi: number[], lo: number[]) => hi.map((v, i) => v - lo[i]);
  const names = [o.history ? 'so far' : '', 'median', '25–75%', '5–95%'].filter(Boolean);
  const refs = [{ y: 0, label: 'ruin' }, ...(o.refs ?? [])];
  return {
    ...b,
    grid: { left: 10, right: 40, top: legendTop(names) + 4, bottom: 24, containLabel: true },
    legend: { ...(b.legend as object), show: true, left: 0, right: 'auto', data: names },
    tooltip: {
      ...(b.tooltip as object),
      trigger: 'axis',
      formatter: (ps: Array<{ dataIndex: number }>) => {
        const i = ps[0].dataIndex;
        const rows = [`p95 ${fmt(fan.p95[i])}`, `p75 ${fmt(fan.p75[i])}`, `median ${fmt(fan.p50[i])}`, `p25 ${fmt(fan.p25[i])}`, `p5 ${fmt(fan.p5[i])}`];
        if (o.history && o.history[i] !== null && o.history[i] !== undefined) rows.unshift(`actual ${fmt(o.history[i] as number)}`);
        return `${x[i]}<br/>${rows.join('<br/>')}`;
      },
    },
    xAxis: { ...(b.xAxis as object), type: 'category', data: x, boundaryGap: false, axisLabel: { color: th.muted, fontSize: 10, hideOverlap: true } },
    yAxis: { ...(b.yAxis as object), type: 'value', axisLabel: { color: th.muted, fontSize: 10, formatter: fmt } },
    series: [
      { name: 'p5 base', type: 'line', data: fan.p5, stack: 'outer', showSymbol: false, lineStyle: { opacity: 0 }, silent: true, tooltip: { show: false }, emphasis: { disabled: true } },
      { name: '5–95%', type: 'line', data: diff(fan.p95, fan.p5), stack: 'outer', showSymbol: false, lineStyle: { opacity: 0 }, areaStyle: { color, opacity: 0.12 }, silent: true, emphasis: { disabled: true }, color },
      { name: 'p25 base', type: 'line', data: fan.p25, stack: 'inner', showSymbol: false, lineStyle: { opacity: 0 }, silent: true, tooltip: { show: false }, emphasis: { disabled: true } },
      { name: '25–75%', type: 'line', data: diff(fan.p75, fan.p25), stack: 'inner', showSymbol: false, lineStyle: { opacity: 0 }, areaStyle: { color, opacity: 0.22 }, silent: true, emphasis: { disabled: true }, color },
      { name: 'median', type: 'line', data: fan.p50, showSymbol: false, lineStyle: { width: 2, color }, color, markLine: { silent: true, symbol: 'none', lineStyle: { color: th.status.serious, type: 'dashed' }, label: { color: th.muted, fontSize: 9.5, formatter: (p: { name: string }) => p.name }, data: refs.map((r) => ({ yAxis: r.y, name: r.label })) } },
      ...(o.history ? [{ name: 'so far', type: 'line', data: o.history, showSymbol: false, lineStyle: { width: 2, color: th.fg }, color: th.fg }] : []),
    ],
  };
}

/** The natural (yearly renewable) premium against the level premium for the same cover: the gap early on is the reserve being built. */
export function naturalLevelOption(th: ChartTheme, natural: Pt[], level: number, sum: number, x0: number, n: number): Record<string, unknown> {
  const nat = natural.map(([age, p]) => [age, p * sum] as Pt);
  const lvl = level * sum;
  const curves: Curve[] = [
    { name: 'Natural premium v·qₓ·S', points: nat, color: th.categorical[4] },
    { name: 'Level premium P·S', points: [[x0, lvl], [x0 + n - 1, lvl]], color: th.categorical[0] },
    { name: 'Reserve built', points: nat.filter((p) => p[1] <= lvl), color: th.categorical[0], width: 0.1, area: { origin: lvl, color: th.categorical[0], opacity: 0.14 } },
    { name: 'Reserve drawn', points: nat.filter((p) => p[1] >= lvl), color: th.categorical[4], width: 0.1, area: { origin: lvl, color: th.categorical[4], opacity: 0.12 } },
  ];
  const cross = nat.find((p) => p[1] >= lvl);
  const markers: Marker[] = cross ? [{ name: 'crossover', x: cross[0], y: lvl, color: th.fg, guides: true, position: 'top' }] : [];
  return textbookOption(th, { xLabel: 'Age', yLabel: 'Premium a year (R)', curves, markers, xMin: x0, xMax: x0 + n, yMin: 0, yMax: Math.max(...nat.map((p) => p[1])) * 1.1, xFmt: (v) => `${Math.round(v)}`, yFmt: money });
}

/** ψ(u): the probability of ruin against the reserve, over one and ten years, with Lundberg's bound and today's reserve and the SCR marked. */
export function ruinCurveOption(th: ChartTheme, curve: Array<{ u: number; ruin1: number; ruin10: number }>, u: number, scr: number, lundberg: ((u: number) => number | null) | null): Record<string, unknown> {
  const uMax = curve[curve.length - 1]?.u ?? 1;
  const curves: Curve[] = [
    { name: 'ψ(u), 10 years', points: curve.map((c) => [c.u, c.ruin10] as Pt), color: th.categorical[4] },
    { name: 'ψ(u), 1 year', points: curve.map((c) => [c.u, c.ruin1] as Pt), color: th.categorical[1] },
  ];
  if (lundberg) {
    const pts: Pt[] = [];
    for (let k = 0; k <= 40; k++) {
      const uu = (uMax * k) / 40;
      const v = lundberg(uu);
      if (v !== null) pts.push([uu, v]);
    }
    curves.push({ name: 'Lundberg bound e^(−Ru)', points: pts, color: th.muted, dashed: true, width: 1.4 });
  }
  const at = (uu: number, key: 'ruin1' | 'ruin10') => {
    const c = curve.reduce((best, x) => (Math.abs(x.u - uu) < Math.abs(best.u - uu) ? x : best), curve[0]);
    return c ? c[key] : 0;
  };
  const markers: Marker[] = [{ name: 'reserve today', x: Math.min(u, uMax), y: at(u, 'ruin10'), color: th.fg, guides: true, position: 'top' }];
  if (scr > 0 && scr <= uMax) markers.push({ name: 'SCR (99.5%, 1 y)', x: scr, y: at(scr, 'ruin1'), color: th.categorical[3], guides: true, position: 'right' });
  const opt = textbookOption(th, { xLabel: 'Reserve u (R)', yLabel: 'Probability of ruin ψ(u)', curves, markers, legend: true, xMin: 0, xMax: uMax, yMin: 0, yMax: 1, xFmt: money, yFmt: (v) => `${Math.round(v * 100)}%` });
  // The legend names the curves only; the markers and their guides are labelled on the plot.
  (opt.legend as Record<string, unknown>).data = curves.map((c) => c.name);
  return opt;
}

/** A pyramid today (filled) and projected (outlined), for the same bands. */
export function pyramidPairOption(th: ChartTheme, bandsIn: string[], now: { male: number[]; female: number[] }, later: { male: number[]; female: number[] }, laterLabel: string): Record<string, unknown> {
  const b = baseOption(th);
  const names = ['men now', 'women now', `men ${laterLabel}`, `women ${laterLabel}`];
  return {
    ...b,
    grid: { left: 44, right: 14, top: legendTop(names), bottom: 24 },
    legend: { ...(b.legend as object), show: true, left: 0, right: 'auto' },
    tooltip: { ...(b.tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps: Array<{ name: string; value: number; seriesName: string }>) => `${ps[0].name}<br/>${ps.map((p) => `${p.seriesName}: ${Math.abs(p.value).toFixed(p.seriesName.includes('now') ? 0 : 1)}`).join('<br/>')}` },
    xAxis: { ...(b.xAxis as object), type: 'value', axisLabel: { color: th.muted, fontSize: 10, formatter: (v: number) => String(Math.abs(v)) } },
    yAxis: { ...(b.yAxis as object), type: 'category', data: bandsIn, axisLabel: { color: th.muted, fontSize: 10 } },
    series: [
      { name: names[0], type: 'bar', stack: 'now', data: now.male.map((v) => -v), barMaxWidth: 12, itemStyle: { color: th.male, opacity: 0.85 } },
      { name: names[1], type: 'bar', stack: 'now', data: now.female, barMaxWidth: 12, itemStyle: { color: th.female, opacity: 0.85 } },
      { name: names[2], type: 'bar', stack: 'later', barGap: '-100%', data: later.male.map((v) => -v), barMaxWidth: 12, itemStyle: { color: 'transparent', borderColor: th.male, borderWidth: 1.5 } },
      { name: names[3], type: 'bar', stack: 'later', barGap: '-100%', data: later.female, barMaxWidth: 12, itemStyle: { color: 'transparent', borderColor: th.female, borderWidth: 1.5 } },
    ],
  };
}

/** Two families of lines on two value axes (an assurance in [0, 1] beside an annuity in years, say). */
export function dualAxisOption(th: ChartTheme, x: string[], left: Array<{ name: string; data: number[]; color?: string; dashed?: boolean }>, right: Array<{ name: string; data: number[]; color?: string; dashed?: boolean }>, leftFmt: (v: number) => string, rightFmt: (v: number) => string, xInterval?: number): Record<string, unknown> {
  const b = baseOption(th);
  const names = [...left, ...right].map((s) => s.name);
  const mk = (s: { name: string; data: number[]; color?: string; dashed?: boolean }, i: number, axis: number) => ({ name: s.name, type: 'line', yAxisIndex: axis, data: s.data, showSymbol: false, lineStyle: { width: 2, type: s.dashed ? 'dashed' : 'solid' }, color: s.color ?? th.categorical[i % th.categorical.length] });
  return {
    ...b,
    grid: { left: 10, right: 10, top: legendTop(names), bottom: 8, containLabel: true },
    legend: { ...(b.legend as object), show: true, left: 0, right: 'auto' },
    xAxis: { ...(b.xAxis as object), type: 'category', data: x, boundaryGap: false, axisLabel: { color: th.muted, fontSize: 10, interval: xInterval ?? 'auto', hideOverlap: true } },
    yAxis: [
      { ...(b.yAxis as object), type: 'value', axisLabel: { color: th.muted, fontSize: 10, formatter: leftFmt } },
      { ...(b.yAxis as object), type: 'value', splitLine: { show: false }, axisLabel: { color: th.muted, fontSize: 10, formatter: rightFmt } },
    ],
    series: [...left.map((s, i) => mk(s, i, 0)), ...right.map((s, i) => mk(s, i + left.length, 1))],
  };
}

/** A step bar of a claim-size mix: each cover amount and the share of claims it makes up. */
export function claimMixOption(th: ChartTheme, mix: Array<{ amount: number; weight: number; lives: number }>): Record<string, unknown> {
  const b = baseOption(th);
  return {
    ...b,
    grid: { left: 10, right: 20, top: legendTop(['share of claims']), bottom: 8, containLabel: true },
    tooltip: { ...(b.tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: th.grid } }, formatter: (ps: Array<{ dataIndex: number }>) => { const m = mix[ps[0].dataIndex]; return `${money(m.amount)} on death<br/>${(m.weight * 100).toFixed(1)}% of claims · ${m.lives} lives`; } },
    xAxis: { ...(b.xAxis as object), type: 'category', data: mix.map((m) => money(m.amount)), axisLabel: { color: th.muted, fontSize: 10 } },
    yAxis: { ...(b.yAxis as object), type: 'value', axisLabel: { color: th.muted, fontSize: 10, formatter: (v: number) => `${Math.round(v * 100)}%` } },
    series: [{ name: 'share of claims', type: 'bar', data: mix.map((m) => m.weight), barMaxWidth: 34, itemStyle: { color: th.categorical[3], borderRadius: [3, 3, 0, 0] } }],
  };
}
