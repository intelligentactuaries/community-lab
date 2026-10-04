// Textbook economics diagrams on the shared EChart wrapper: labelled curves
// with arrowed axes, equilibrium points with guide lines, shift arrows and
// shaded surpluses — the way a lecture slide draws them, on live data.

import type { LabourSnapshot, MicroMonth, QuarterCurve } from '../../sim/finance/state';
import { adasCurves, lorenz, ols } from '../../sim/finance/macro';
import { consumerOptimum, marketCurves } from '../../sim/finance/micro';
import type { TaxTables } from '../../sim/finance/tax';
import { bracketTax, rebatesFor } from '../../sim/finance/tax';
import { legendTop } from './helpers';
import type { ChartTheme } from './theme';
import { baseOption } from './theme';

export type Pt = [number, number];

export interface Curve {
  name: string;
  points: Pt[];
  color: string;
  dashed?: boolean;
  width?: number;
  /** Shade between the curve and a horizontal line at `origin`. */
  area?: { origin: number; color: string; opacity?: number };
  /** Label at the end of the curve (default) or its start. */
  labelAt?: 'end' | 'start';
  faint?: boolean;
}

export interface Marker {
  name: string;
  x: number;
  y: number;
  color?: string;
  guides?: boolean;
  position?: 'top' | 'right' | 'left' | 'bottom' | 'insideTopLeft';
}

export interface Arrow {
  from: Pt;
  to: Pt;
  color?: string;
  label?: string;
}

export interface TextbookOpts {
  xLabel: string;
  yLabel: string;
  curves: Curve[];
  markers?: Marker[];
  arrows?: Arrow[];
  xFmt?: (v: number) => string;
  yFmt?: (v: number) => string;
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  /** Hide the recessive grid entirely (pure textbook look). */
  bare?: boolean;
  /** Identify curves by a legend instead of end labels (when several curves share an end point). */
  legend?: boolean;
}

function fmtDefault(v: number): string {
  return Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : v.toFixed(Math.abs(v) < 10 ? 2 : 0);
}

/** A labelled-curve diagram: arrowed axes, direct labels, equilibrium points and shift arrows. */
export function textbookOption(th: ChartTheme, o: TextbookOpts): Record<string, unknown> {
  const b = baseOption(th);
  const series: Array<Record<string, unknown>> = [];
  for (const c of o.curves) {
    // A curve with nothing inside the plotted range (supply far beyond demand, say) has nothing to draw;
    // reading its first point would throw and take the whole drawer down.
    if (!c.points.length) continue;
    const s: Record<string, unknown> = {
      type: 'line',
      name: c.name,
      data: c.points,
      showSymbol: false,
      smooth: 0.25,
      silent: false,
      z: 3,
      lineStyle: { width: c.width ?? (c.faint ? 1.4 : 2.2), type: c.dashed ? 'dashed' : 'solid', color: c.color, opacity: c.faint ? 0.55 : 1 },
      itemStyle: { color: c.color },
      emphasis: { disabled: true },
      endLabel: c.labelAt !== 'start' && !o.legend && (c.width ?? 1) >= 1 ? { show: true, formatter: c.name, color: c.color, fontWeight: 600, fontSize: 11, offset: [6, 0], fontFamily: th.font } : undefined,
      label: c.labelAt === 'start' ? { show: false } : undefined,
    };
    if (c.labelAt === 'start' && !o.legend) {
      // The start of a curve may be its left or right end: keep the label outside the curve.
      const startLeft = c.points[0][0] <= c.points[c.points.length - 1][0];
      s.markPoint = { symbol: 'circle', symbolSize: 1, silent: true, data: [{ coord: c.points[0], label: { show: true, formatter: c.name, color: c.color, fontWeight: 600, fontSize: 11, position: startLeft ? 'left' : 'right', fontFamily: th.font, opacity: c.faint ? 0.75 : 1 } }] };
    }
    if (c.area) s.areaStyle = { color: c.area.color, opacity: c.area.opacity ?? 0.14, origin: c.area.origin };
    series.push(s);
  }
  for (const m of o.markers ?? []) {
    const color = m.color ?? th.fg;
    if (m.guides) {
      series.push({ type: 'line', name: `${m.name} guide`, data: [[o.xMin ?? 0, m.y], [m.x, m.y], [m.x, o.yMin ?? 0]], showSymbol: false, silent: true, z: 2, lineStyle: { width: 1, type: 'dashed', color: th.muted, opacity: 0.8 }, emphasis: { disabled: true }, tooltip: { show: false } });
    }
    series.push({ type: 'scatter', name: m.name, data: [[m.x, m.y]], symbolSize: 10, z: 5, itemStyle: { color, borderColor: th.surface, borderWidth: 1.5 }, label: { show: true, formatter: m.name, position: m.position ?? 'top', color: th.fg, fontWeight: 700, fontSize: 12, fontFamily: th.font, distance: 6 }, emphasis: { disabled: true } });
  }
  for (const a of o.arrows ?? []) {
    const color = a.color ?? th.fg2;
    series.push({ type: 'line', name: a.label ?? 'shift', data: [a.from, a.to], showSymbol: true, symbol: ['none', 'arrow'], symbolSize: 9, silent: true, z: 4, lineStyle: { width: 1.6, color }, itemStyle: { color }, emphasis: { disabled: true }, endLabel: a.label ? { show: true, formatter: a.label, color, fontSize: 10.5, offset: [6, -6], fontFamily: th.font } : undefined, tooltip: { show: false } });
  }
  const axisBase = (name: string, atEnd: boolean) => ({
    type: 'value',
    name,
    nameLocation: atEnd ? 'end' : 'middle',
    nameGap: atEnd ? 12 : 26,
    nameTextStyle: { color: th.fg2, fontSize: 11, fontWeight: 600, fontFamily: th.font, align: atEnd ? 'left' : 'center', padding: atEnd ? [0, 0, 0, -6] : 0 },
    axisLine: { show: true, symbol: ['none', 'arrow'], symbolSize: [7, 10], lineStyle: { color: th.fg2, width: 1.2 } },
    axisTick: { show: !o.bare, lineStyle: { color: th.grid } },
    axisLabel: { color: th.muted, fontSize: 10, hideOverlap: true },
    splitLine: { show: !o.bare, lineStyle: { color: th.grid, opacity: 0.55 } },
    scale: false,
  });
  const xf = o.xFmt ?? fmtDefault;
  const yf = o.yFmt ?? fmtDefault;
  return {
    ...b,
    grid: { left: 14, right: o.legend ? 24 : 84, top: o.legend ? legendTop(o.curves.map((c) => c.name)) + 8 : 40, bottom: 34, containLabel: true },
    legend: o.legend ? { ...(b.legend as object), show: true, left: 0, right: 'auto', top: 0 } : { show: false },
    tooltip: { ...(b.tooltip as object), trigger: 'item', formatter: (p: { seriesName: string; value: Pt }) => `${p.seriesName}<br/>${o.xLabel}: ${xf(p.value[0])}<br/>${o.yLabel}: ${yf(p.value[1])}` },
    xAxis: { ...axisBase(o.xLabel, false), min: o.xMin ?? 0, max: o.xMax, axisLabel: { color: th.muted, fontSize: 10, formatter: xf, hideOverlap: true } },
    yAxis: { ...axisBase(o.yLabel, true), min: o.yMin ?? 0, max: o.yMax, axisLabel: { color: th.muted, fontSize: 10, formatter: yf, hideOverlap: true } },
    series,
  };
}

/** Supply and demand for local produce; with an earlier month both curves are drawn twice (D, S faint; D₁, S₁ solid) with their shifts and E → E₁. */
export function supplyDemandOption(th: ChartTheme, now: MicroMonth, then: MicroMonth | null): Record<string, unknown> {
  const red = th.categorical[4];
  const orange = th.categorical[1];
  const blue = th.categorical[0];
  const green = th.categorical[2];
  const cNow = marketCurves(now);
  const curves: Curve[] = [];
  const markers: Marker[] = [];
  const arrows: Arrow[] = [];
  const qD = (m: MicroMonth, p: number) => m.A * Math.pow(p, -m.eps);
  const qS = (m: MicroMonth, p: number) => m.S0 * m.yield * Math.pow(p, m.sigma);
  if (then) {
    const cBase = marketCurves(then);
    const qMax = Math.max(...cNow.demand.map((p) => p[0]), ...cBase.demand.map((p) => p[0]), now.quantity * 1.25, then.quantity * 1.25);
    const pMax = Math.max(...cNow.demand.map((p) => p[1]), ...cBase.demand.map((p) => p[1]), now.importParity * 1.25, then.importParity * 1.25);
    curves.push({ name: 'Demand', points: cBase.demand.filter((p) => p[0] <= qMax), color: red, faint: true, labelAt: 'start' });
    curves.push({ name: 'Supply', points: cBase.supply.filter((p) => p[0] <= qMax), color: blue, faint: true, labelAt: 'start' });
    curves.push({ name: 'Demand₁', points: cNow.demand.filter((p) => p[0] <= qMax), color: orange });
    curves.push({ name: 'Supply₁', points: cNow.supply.filter((p) => p[0] <= qMax), color: green });
    markers.push({ name: 'E', x: then.quantity, y: then.price, color: th.fg2, guides: true, position: 'left' });
    markers.push({ name: 'E₁', x: now.quantity, y: now.price, color: th.fg, guides: true, position: 'right' });
    // Supply shift: read at a price above both equilibria where the curves are apart.
    const pS = Math.max(then.price, now.price) * 1.18;
    if (Math.abs(qS(now, pS) - qS(then, pS)) > qMax * 0.02) arrows.push({ from: [qS(then, pS), pS], to: [qS(now, pS), pS], color: th.fg2, label: now.yield < then.yield ? 'poorer yield' : now.yield > then.yield ? 'better yield' : 'supply' });
    // Demand shift: read at a price below both equilibria (spending grows with incomes, falls with a poorer year).
    const pD = Math.min(then.price, now.price) * 0.7;
    if (Math.abs(qD(now, pD) - qD(then, pD)) > qMax * 0.02) arrows.push({ from: [qD(then, pD), pD], to: [qD(now, pD), pD], color: th.fg2, label: now.A > then.A ? 'more spending' : 'less spending' });
    curves.push({ name: 'Import parity', points: [[0, now.importParity], [qMax, now.importParity]], color: th.muted, dashed: true, width: 1.2 });
    return textbookOption(th, { xLabel: 'Quantity (produce units)', yLabel: 'Price (× base)', curves, markers, arrows, xMax: qMax, yMax: pMax, yFmt: (v) => v.toFixed(2), xFmt: (v) => `${Math.round(v / 1000)}k` });
  }
  const qMax = Math.max(...cNow.demand.map((p) => p[0]), now.quantity * 1.25);
  const pMax = Math.max(...cNow.demand.map((p) => p[1]), now.importParity * 1.25);
  // Surpluses: shade only up to the quantity traded (the area between each curve and the price line).
  curves.push({ name: 'Demand', points: cNow.demand.filter((p) => p[0] <= qMax), color: red });
  curves.push({ name: 'Supply', points: cNow.supply.filter((p) => p[0] <= qMax), color: blue });
  curves.push({ name: 'Consumer surplus', points: cNow.demand.filter((p) => p[0] <= now.quantity), color: red, width: 0.1, area: { origin: now.price, color: red, opacity: 0.14 } });
  curves.push({ name: 'Producer surplus', points: cNow.supply.filter((p) => p[0] <= now.quantity), color: blue, width: 0.1, area: { origin: now.price, color: blue, opacity: 0.14 } });
  markers.push({ name: 'E', x: now.quantity, y: now.price, color: th.fg, guides: true, position: 'right' });
  curves.push({ name: 'Import parity', points: [[0, now.importParity], [qMax, now.importParity]], color: th.muted, dashed: true, width: 1.2 });
  return textbookOption(th, { xLabel: 'Quantity (produce units)', yLabel: 'Price (× base)', curves, markers, arrows, xMax: qMax, yMax: pMax, yFmt: (v) => v.toFixed(2), xFmt: (v) => `${Math.round(v / 1000)}k` });
}

/** AD–AS for a quarter, optionally against an earlier quarter to show the shifts. */
export function adasOption(th: ChartTheme, q1: QuarterCurve, q0: QuarterCurve | null): Record<string, unknown> {
  const red = th.categorical[4];
  const blue = th.categorical[0];
  const green = th.categorical[2];
  const purple = th.categorical[3];
  const c1 = adasCurves(q1);
  const curves: Curve[] = [];
  const markers: Marker[] = [];
  const arrows: Arrow[] = [];
  const allY = [...c1.ad, ...c1.sras];
  let yMin = Math.min(...allY.map((p) => p[1]));
  let yMax = Math.max(...allY.map((p) => p[1]));
  let xMin = Math.min(...c1.ad.map((p) => p[0]));
  let xMax = Math.max(...c1.ad.map((p) => p[0]));
  if (q0) {
    const c0 = adasCurves(q0);
    yMin = Math.min(yMin, ...c0.ad.map((p) => p[1]), ...c0.sras.map((p) => p[1]));
    yMax = Math.max(yMax, ...c0.ad.map((p) => p[1]), ...c0.sras.map((p) => p[1]));
    xMin = Math.min(xMin, ...c0.ad.map((p) => p[0]));
    xMax = Math.max(xMax, ...c0.ad.map((p) => p[0]));
    curves.push({ name: 'AD', points: c0.ad, color: red, faint: true });
    curves.push({ name: 'SRAS', points: c0.sras, color: blue, faint: true });
    curves.push({ name: 'AD₁', points: c1.ad, color: green });
    curves.push({ name: 'SRAS₁', points: c1.sras, color: purple });
    curves.push({ name: 'LRAS', points: [[q1.Ystar, yMin], [q1.Ystar, yMax]], color: th.muted, dashed: true, width: 1.4 });
    markers.push({ name: 'E', x: q0.Y, y: q0.P, color: th.fg2, guides: true, position: 'left' });
    markers.push({ name: 'E₁', x: q1.Y, y: q1.P, color: th.fg, guides: true, position: 'right' });
    const mid = (q0.P + q1.P) / 2;
    const yOnAd = (q: QuarterCurve, p: number) => q.Y * (2 - p / q.P);
    arrows.push({ from: [yOnAd(q0, mid), mid], to: [yOnAd(q1, mid), mid], color: th.fg2, label: 'demand shift' });
  } else {
    curves.push({ name: 'AD', points: c1.ad, color: red });
    curves.push({ name: 'SRAS', points: c1.sras, color: blue });
    curves.push({ name: 'LRAS', points: [[q1.Ystar, yMin], [q1.Ystar, yMax]], color: th.muted, dashed: true, width: 1.4 });
    markers.push({ name: 'E', x: q1.Y, y: q1.P, color: th.fg, guides: true, position: 'right' });
  }
  const pad = (yMax - yMin) * 0.08;
  return textbookOption(th, { xLabel: 'Real output Y (R per quarter, base prices)', yLabel: 'Price level P (CPI)', curves, markers, arrows, xMin: Math.floor(xMin * 0.98), xMax: Math.ceil(xMax * 1.02), yMin: Math.floor(yMin - pad), yMax: Math.ceil(yMax + pad), xFmt: (v) => `R${(v / 1e6).toFixed(2)}m`, yFmt: (v) => v.toFixed(0) });
}

/** Scatter with an OLS fit and the last points labelled (Phillips, Okun). */
export function fittedScatterOption(th: ChartTheme, pts: Array<{ x: number; y: number; label: string }>, xLabel: string, yLabel: string, fmt: (v: number) => string, colorIdx = 0): Record<string, unknown> {
  const b = baseOption(th);
  const fit = ols(pts.map((p) => p.x), pts.map((p) => p.y));
  const xs = pts.map((p) => p.x);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const color = th.categorical[colorIdx];
  const series: Array<Record<string, unknown>> = [
    { type: 'scatter', name: 'quarters', data: pts.map((p, i) => ({ value: [p.x, p.y], name: p.label, label: { show: i >= pts.length - 3, formatter: p.label, position: 'right', fontSize: 9.5, color: th.muted } })), symbolSize: 9, itemStyle: { color, opacity: 0.85, borderColor: th.surface, borderWidth: 1 } },
  ];
  if (fit) series.push({ type: 'line', name: `fit: slope ${fit.b.toFixed(2)}, R² ${fit.r2.toFixed(2)}`, data: [[lo, fit.a + fit.b * lo], [hi, fit.a + fit.b * hi]], showSymbol: false, color: th.categorical[4], lineStyle: { width: 1.6, type: 'dashed', color: th.categorical[4] }, silent: true });
  return {
    ...b,
    grid: { left: 10, right: 20, top: legendTop(['quarters', fit ? `fit: slope ${fit.b.toFixed(2)}, R² ${fit.r2.toFixed(2)}` : '']), bottom: 30, containLabel: true },
    legend: { ...(b.legend as object), show: true, left: 0, right: 'auto' },
    tooltip: { ...(b.tooltip as object), trigger: 'item', formatter: (p: { name: string; value: Pt }) => `${p.name}<br/>${xLabel}: ${fmt(p.value[0])}<br/>${yLabel}: ${fmt(p.value[1])}` },
    xAxis: { ...(b.xAxis as object), type: 'value', name: xLabel, nameLocation: 'middle', nameGap: 24, nameTextStyle: { color: th.fg2, fontSize: 10.5 }, axisLabel: { color: th.muted, fontSize: 10, formatter: fmt }, splitLine: { lineStyle: { color: th.grid } }, scale: true },
    yAxis: { ...(b.yAxis as object), type: 'value', name: yLabel, nameLocation: 'middle', nameGap: 34, nameTextStyle: { color: th.fg2, fontSize: 10.5 }, axisLabel: { color: th.muted, fontSize: 10, formatter: fmt }, scale: true },
    series,
  };
}

/** Lorenz curves (one per measure) against the line of equality, each labelled with its Gini coefficient. */
export function lorenzOption(th: ChartTheme, series: Array<{ name: string; values: number[]; gini: number }>): Record<string, unknown> {
  return textbookOption(th, {
    xLabel: 'Cumulative share of households',
    yLabel: 'Cumulative share',
    legend: true,
    curves: [
      { name: 'Equality', points: [[0, 0], [1, 1]], color: th.muted, dashed: true, width: 1.2 },
      ...series.map((s, i) => ({ name: `${s.name} (Gini ${s.gini.toFixed(2)})`, points: lorenz(s.values), color: th.categorical[i % th.categorical.length], area: i === 0 ? { origin: 0, color: th.categorical[0], opacity: 0.1 } : undefined })),
    ],
    xMax: 1,
    yMax: 1,
    xFmt: (v) => `${Math.round(v * 100)}%`,
    yFmt: (v) => `${Math.round(v * 100)}%`,
  });
}

/** Laffer curve: revenue against a uniform scaling of every marginal rate; today's schedule marked. */
export function lafferOption(th: ChartTheme, pts: Pt[], current: Pt): Record<string, unknown> {
  let peak = pts[0];
  for (const p of pts) if (p[1] > peak[1]) peak = p;
  return textbookOption(th, {
    xLabel: 'Tax rates as a multiple of today\'s schedule',
    yLabel: 'Personal income tax revenue (R per year)',
    curves: [{ name: 'Revenue', points: pts, color: th.categorical[3], area: { origin: 0, color: th.categorical[3], opacity: 0.08 } }],
    markers: [
      { name: 'today', x: current[0], y: current[1], color: th.fg, guides: true, position: 'top' },
      { name: 'peak', x: peak[0], y: peak[1], color: th.categorical[4], position: 'top' },
    ],
    xMax: pts[pts.length - 1][0],
    xFmt: (v) => `${v.toFixed(1)}×`,
    yFmt: (v) => `R${(v / 1e6).toFixed(2)}m`,
  });
}

/** The budget line, the indifference curve through the optimum (Cobb–Douglas) and the optimum itself. */
export function budgetCurves(income: number, foodPrice: number, alpha: number): { budget: Pt[]; ic: Pt[]; opt: ReturnType<typeof consumerOptimum>; fMax: number } {
  const opt = consumerOptimum(income, foodPrice, alpha);
  const fMax = income / foodPrice;
  const ic: Pt[] = [];
  for (let i = 1; i <= 40; i++) {
    const f = (fMax * 1.15 * i) / 40;
    const o = Math.pow(opt.utility / Math.pow(f, alpha), 1 / (1 - alpha));
    if (o <= income * 1.15) ic.push([f, o]);
  }
  return { budget: [[0, income], [fMax, 0]], ic, opt, fMax };
}

/** Budget line and the indifference curve through the consumer's optimum (Cobb–Douglas). */
export function budgetLineOption(th: ChartTheme, income: number, foodPrice: number, alpha: number): Record<string, unknown> {
  const { ic, opt, fMax } = budgetCurves(income, foodPrice, alpha);
  return textbookOption(th, {
    xLabel: 'Food (units)',
    yLabel: 'Other goods (R)',
    curves: [
      { name: 'Budget', points: [[0, income], [fMax, 0]], color: th.categorical[0] },
      { name: `U(F,O)`, points: ic, color: th.categorical[4] },
    ],
    markers: [{ name: 'optimum', x: opt.food, y: opt.other, color: th.fg, guides: true, position: 'right' }],
    xMax: fMax * 1.15,
    yMax: income * 1.15,
    xFmt: (v) => `${Math.round(v)}`,
    yFmt: (v) => `R${Math.round(v / 1000)}k`,
  });
}

/** Labour demand (positions worth at least w) and supply (people willing to work at w) over a wage grid. */
export function labourCurves(L: LabourSnapshot, n = 60): { demand: Pt[]; supply: Pt[]; lo: number; hi: number; nMax: number; atEquilibrium: number } {
  const lo = Math.min(...L.reservations, L.nmwMonthly) * 0.8;
  const hi = Math.max(...L.offers, L.nmwMonthly * 2) * 1.05;
  const demand: Pt[] = [];
  const supply: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const w = lo + ((hi - lo) * i) / n;
    demand.push([L.offers.filter((o) => o >= w).length, w]);
    supply.push([L.reservations.filter((r) => r <= w).length, w]);
  }
  const nMax = Math.max(L.offers.length, L.reservations.length) + 1;
  return { demand, supply, lo, hi, nMax, atEquilibrium: L.reservations.filter((r) => r <= L.equilibriumWage).length };
}

/** The labour market as step curves: positions worth at least w, people willing to work at w, the minimum-wage floor. */
export function labourOption(th: ChartTheme, L: LabourSnapshot): Record<string, unknown> {
  const { demand, supply, hi, nMax, atEquilibrium } = labourCurves(L);
  return textbookOption(th, {
    xLabel: 'Workers',
    yLabel: 'Monthly wage (R)',
    curves: [
      { name: 'Demand', points: demand, color: th.categorical[4] },
      { name: 'Supply', points: supply, color: th.categorical[0] },
      { name: 'Min. wage', points: [[0, L.nmwMonthly], [nMax, L.nmwMonthly]], color: th.categorical[1], dashed: true, width: 1.4 },
    ],
    markers: [
      { name: 'w*', x: atEquilibrium, y: L.equilibriumWage, color: th.fg, guides: true, position: 'right' },
      { name: 'employed', x: L.employed, y: L.medianWage, color: th.categorical[2], position: 'top' },
    ],
    xMax: nMax,
    yMax: hi,
    xFmt: (v) => `${Math.round(v)}`,
    yFmt: (v) => `R${Math.round(v / 1000)}k`,
  });
}

/** Circular flow of income as a two-layer Sankey (payers on the left, payees on the right; Sankey must be acyclic). */
export function circularFlowOption(th: ChartTheme, links: Array<{ from: string; to: string; value: number }>): Record<string, unknown> {
  const b = baseOption(th);
  // The textbook shape: each sector once, on a circle, with directed arrows
  // payer → payee whose width follows the rand value. The dominant flows carry
  // their amounts; every arrow answers on hover.
  const ORDER = ['Households', 'Firms', 'Government', 'Mutual Bank', 'Church', 'Burial society', 'Rest of the economy'];
  const sectors = Array.from(new Set(links.flatMap((l) => [l.from, l.to]))).sort((x, y) => {
    const ix = ORDER.indexOf(x);
    const iy = ORDER.indexOf(y);
    return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy) || x.localeCompare(y);
  });
  const palette = [...th.categorical, ...th.sequential];
  const colorOf = (s: string) => palette[sectors.indexOf(s) % palette.length];
  const throughput: Record<string, number> = {};
  for (const l of links) {
    throughput[l.from] = (throughput[l.from] ?? 0) + l.value;
    throughput[l.to] = (throughput[l.to] ?? 0) + l.value;
  }
  const maxT = Math.max(1, ...Object.values(throughput));
  const pos = links.filter((l) => l.value > 0);
  const maxV = Math.max(1, ...pos.map((l) => l.value));
  return {
    ...b,
    tooltip: {
      ...(b.tooltip as object),
      trigger: 'item',
      formatter: (p: { dataType: string; data: { source?: string; target?: string; value?: number; name?: string } }) =>
        p.dataType === 'edge'
          ? `${p.data.source} → ${p.data.target}: R${Math.round(p.data.value ?? 0).toLocaleString()}`
          : `${p.data.name}: R${Math.round(throughput[p.data.name ?? ''] ?? 0).toLocaleString()} paid + received`,
    },
    legend: { show: false },
    series: [
      {
        type: 'graph',
        layout: 'circular',
        circular: { rotateLabel: false },
        left: 24,
        right: 24,
        top: 30,
        bottom: 26,
        symbol: 'circle',
        roam: false,
        label: { show: true, color: th.fg2, fontSize: 10.5, fontFamily: th.font },
        edgeSymbol: ['none', 'arrow'],
        emphasis: { focus: 'adjacency', lineStyle: { opacity: 0.9 } },
        data: sectors.map((name) => ({
          name,
          symbolSize: 12 + 26 * Math.sqrt((throughput[name] ?? 0) / maxT),
          itemStyle: { color: colorOf(name), borderColor: th.surface, borderWidth: 1.5 },
          label: { position: 'outside' },
        })),
        links: pos.map((l) => ({
          source: l.from,
          target: l.to,
          value: Math.round(l.value),
          lineStyle: { width: 1 + 13 * Math.sqrt(l.value / maxV), color: colorOf(l.from), opacity: 0.45, curveness: 0.22 },
          edgeSymbolSize: 5 + 7 * Math.sqrt(l.value / maxV),
          label: { show: false },
        })),
      },
    ],
  };
}

/** Effective tax rate by taxpayer against the statutory schedule (progressivity). */
export function progressivityOption(th: ChartTheme, T: TaxTables, people: Array<{ name: string; income: number; rate: number }>): Record<string, unknown> {
  const sched: Pt[] = [];
  const top = Math.max(1_000_000, ...people.map((p) => p.income)) * 1.05;
  for (let i = 1; i <= 60; i++) {
    const inc = (top * i) / 60;
    const tax = Math.max(0, bracketTax(inc, T.brackets) - rebatesFor(40, T));
    sched.push([inc, tax / inc]);
  }
  const b = baseOption(th);
  return {
    ...b,
    grid: { left: 10, right: 20, top: legendTop(['statutory schedule (under 65)', 'taxpayers (assessed)']), bottom: 30, containLabel: true },
    legend: { ...(b.legend as object), show: true, left: 0, right: 'auto' },
    tooltip: { ...(b.tooltip as object), trigger: 'item', formatter: (p: { name: string; value: Pt; seriesName: string }) => `${p.name || p.seriesName}<br/>income R${Math.round(p.value[0]).toLocaleString()} a year<br/>average rate ${(p.value[1] * 100).toFixed(1)}%` },
    xAxis: { ...(b.xAxis as object), type: 'value', name: 'Taxable income (R per year)', nameLocation: 'middle', nameGap: 24, nameTextStyle: { color: th.fg2, fontSize: 10.5 }, axisLabel: { color: th.muted, fontSize: 10, formatter: (v: number) => `R${Math.round(v / 1000)}k` }, splitLine: { lineStyle: { color: th.grid } }, max: top },
    yAxis: { ...(b.yAxis as object), type: 'value', name: 'Average rate', nameLocation: 'middle', nameGap: 34, nameTextStyle: { color: th.fg2, fontSize: 10.5 }, axisLabel: { color: th.muted, fontSize: 10, formatter: (v: number) => `${Math.round(v * 100)}%` }, max: 0.45 },
    series: [
      { type: 'line', name: 'statutory schedule (under 65)', data: sched, showSymbol: false, lineStyle: { width: 2, color: th.categorical[3] }, silent: true },
      { type: 'scatter', name: 'taxpayers (assessed)', data: people.map((p) => ({ name: p.name, value: [p.income, p.rate] })), symbolSize: 8, itemStyle: { color: th.categorical[1], borderColor: th.surface, borderWidth: 1 } },
    ],
  };
}
