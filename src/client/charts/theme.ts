// Chart colours validated with the dataviz palette validator against the
// Scelo surfaces (#E8E4D8 light, #1B1815 dark): every adjacent pair clears
// the CVD and normal-vision floors. Categorical hues are assigned in fixed
// order by entity (never by rank); magnitude uses one hue; A/E uses a
// two-hue diverging pair around a neutral 1.0.
import { tokens } from '../lib/theme';

export interface ChartTheme {
  dark: boolean;
  fg: string;
  fg2: string;
  muted: string;
  grid: string;
  surface: string;
  categorical: string[];
  male: string;
  female: string;
  sequential: string[];
  diverging: { low: string; mid: string; high: string };
  status: { good: string; warning: string; serious: string };
  font: string;
}

export function chartTheme(): ChartTheme {
  const t = tokens();
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const categorical = dark ? ['#5C8BE0', '#D07A3A', '#3FA372', '#A07FE0', '#DA5C5C'] : ['#2F63D6', '#C2561F', '#1E8A5A', '#7A45D8', '#C93A3A'];
  return {
    dark,
    fg: t.fg,
    fg2: t.fg2,
    muted: t.muted,
    grid: t.grid,
    surface: t.bg,
    categorical,
    male: categorical[0],
    female: categorical[1],
    sequential: dark ? ['#2C4C3C', '#3A6E55', '#4A9070', '#63B38C', '#8AD1AC'] : ['#CFE3D6', '#9DC7B0', '#6AA98A', '#3E8A66', '#1E6A48'],
    diverging: { low: categorical[0], mid: dark ? '#6E675E' : '#9C9488', high: categorical[1] },
    status: { good: t.accent, warning: t.warn, serious: t.error },
    font: "'SN Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  };
}

/** Shared option scaffolding: recessive grid, themed text, tooltip glass. */
export function baseOption(th: ChartTheme): Record<string, unknown> {
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: th.font, color: th.fg2, fontSize: 11 },
    color: th.categorical,
    grid: { left: 10, right: 26, top: 32, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: th.muted, width: 1 } },
      backgroundColor: th.dark ? 'rgba(34,30,26,0.94)' : 'rgba(255,253,247,0.96)',
      borderColor: th.grid,
      textStyle: { color: th.fg, fontFamily: th.font, fontSize: 11 },
      extraCssText: 'box-shadow: 0 8px 28px rgba(24,23,21,0.14); border-radius: 8px;',
    },
    legend: { top: 0, right: 0, textStyle: { color: th.fg2, fontSize: 10.5 }, itemWidth: 12, itemHeight: 8, icon: 'roundRect' },
    xAxis: { axisLine: { lineStyle: { color: th.grid } }, axisTick: { show: false }, axisLabel: { color: th.muted, fontSize: 10, hideOverlap: true, margin: 8 }, splitLine: { show: false } },
    yAxis: { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: th.muted, fontSize: 10, hideOverlap: true, margin: 8 }, splitLine: { lineStyle: { color: th.grid } } },
  };
}
