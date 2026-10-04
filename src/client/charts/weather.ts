// The weather chart: a daily record read like a forecast — the sky for each
// day and its minimum–maximum, wind speed with an arrow showing where the wind
// blows and a colour band for its strength, rain as a filled area, and a
// slider to move through the year.

import type { WeatherLogEntry } from '../../sim/types';
import type { ChartTheme } from './theme';
import { baseOption } from './theme';

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const SKY: Record<string, string> = { clear: '☀️', cloudy: '☁️', rain: '🌧️', storm: '⛈️', fog: '🌫️', snow: '🌨️', heatwave: '🌞', 'cold-snap': '🥶' };
const DAY = 86_400_000;
const ARROW = 16;

type Api = { value: (dim: number) => number | string; coord: (v: Array<number | string>) => number[]; style: (extra: Record<string, unknown>) => Record<string, unknown> };

export function weatherOption(th: ChartTheme, log: WeatherLogEntry[], startMs: number, windowDays = 28): Record<string, unknown> {
  const b = baseOption(th);
  const t = (e: WeatherLogEntry) => startMs + e.day * DAY;
  const rows = log.map((e) => [t(e), e.windKmh, DIRS[e.windDir] ?? 'W', e.rainMm]);
  const skies = log.map((e) => [t(e), 0, SKY[e.condition] ?? '☀️', e.tempMin, e.tempMax]);
  const byTime = new Map<number, WeatherLogEntry>(log.map((e) => [t(e), e]));
  const dayPx = (api: Api, time: number) => api.coord([time + DAY, 0])[0] - api.coord([time, 0])[0];
  // Wind arrows point where the wind blows: the compass point it comes from, turned through 180°.
  const renderArrow = (_p: unknown, api: Api) => {
    const time = Number(api.value(0));
    if (dayPx(api, time) < 9) return null;
    const pt = api.coord([time, api.value(1)]);
    const from = DIRS.indexOf(String(api.value(2)));
    const rotation = Math.PI / 2 - (((from < 0 ? 12 : from) + 8) % 16) * (Math.PI / 8);
    return { type: 'path', shape: { pathData: 'M31 16l-15-15v9h-26v12h26v9z', x: -ARROW / 2, y: -ARROW / 2, width: ARROW, height: ARROW }, rotation, x: pt[0], y: pt[1], style: api.style({ stroke: th.fg2, lineWidth: 1 }) };
  };
  // The sky of the day, with its minimum and maximum, along the top; hidden when the days are too close to read.
  const renderSky = (_p: unknown, api: Api) => {
    const time = Number(api.value(0));
    const px = dayPx(api, time);
    if (px < 17) return null;
    const x = api.coord([time + DAY / 2, 0])[0];
    const children: Array<Record<string, unknown>> = [{ type: 'text', x, y: 30, style: { text: String(api.value(2)), font: `${px < 28 ? 15 : 20}px sans-serif`, textAlign: 'center', textVerticalAlign: 'middle' } }];
    if (px >= 40) children.push({ type: 'text', x, y: 56, style: { text: `${Math.round(Number(api.value(3)))}–${Math.round(Number(api.value(4)))}°`, font: `10.5px ${th.font}`, fill: th.fg2, textAlign: 'center', textVerticalAlign: 'middle' } });
    return { type: 'group', children };
  };
  const start = log.length > windowDays ? Math.max(0, 100 - (windowDays / log.length) * 100) : 0;
  const rain = th.categorical[0];
  return {
    ...b,
    grid: { left: 44, right: 44, top: 84, bottom: 104, containLabel: true },
    legend: { show: false },
    tooltip: {
      ...(b.tooltip as object),
      trigger: 'axis',
      formatter: (params: Array<{ value: Array<number | string> }>) => {
        const time = Number(params[0]?.value[0]);
        const e = byTime.get(time);
        if (!e) return '';
        const d = new Date(time);
        const when = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        return [`<b>${when}</b> ${SKY[e.condition] ?? ''} ${e.condition}`, `high ${e.tempMax.toFixed(1)}°C · low ${e.tempMin.toFixed(1)}°C`, `rain ${e.rainMm} mm`, `wind ${e.windKmh} km/h from the ${DIRS[e.windDir] ?? 'W'}`].join('<br/>');
      },
    },
    xAxis: { ...(b.xAxis as object), type: 'time', maxInterval: DAY, axisLabel: { color: th.muted, fontSize: 10, formatter: '{d} {MMM}', hideOverlap: true }, splitLine: { show: true, lineStyle: { color: th.grid } } },
    yAxis: [
      { ...(b.yAxis as object), type: 'value', name: 'Wind (km/h)', nameLocation: 'middle', nameGap: 34, nameTextStyle: { color: th.fg2, fontSize: 10.5 }, axisLabel: { color: th.muted, fontSize: 10 }, min: 0 },
      { ...(b.yAxis as object), type: 'value', name: 'Rain (mm)', nameLocation: 'middle', nameGap: 34, nameTextStyle: { color: rain, fontSize: 10.5 }, axisLabel: { color: rain, fontSize: 10 }, splitLine: { show: false }, min: 0, max: (v: { max: number }) => Math.max(10, Math.ceil(v.max * 1.6)) },
      { type: 'value', show: false, min: 0, max: 1 },
    ],
    visualMap: {
      type: 'piecewise',
      orient: 'horizontal',
      left: 'center',
      bottom: 6,
      seriesIndex: 1,
      dimension: 1,
      itemWidth: 14,
      itemHeight: 10,
      textStyle: { color: th.fg2, fontSize: 10.5, fontFamily: th.font },
      pieces: [
        { gte: 30, color: th.categorical[4], label: 'strong wind (≥ 30 km/h)' },
        { gte: 15, lt: 30, color: th.categorical[1], label: 'moderate (15–30 km/h)' },
        { lt: 15, color: th.categorical[2], label: 'light (< 15 km/h)' },
      ],
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, minSpan: 3, start, end: 100 },
      { type: 'slider', xAxisIndex: 0, minSpan: 3, start, end: 100, bottom: 36, height: 20, borderColor: th.grid, moveHandleSize: 8, brushSelect: false, backgroundColor: 'transparent', fillerColor: th.dark ? 'rgba(241,236,223,0.08)' : 'rgba(24,23,21,0.06)', dataBackground: { lineStyle: { color: th.grid }, areaStyle: { color: th.grid } }, handleStyle: { color: th.surface, borderColor: th.muted }, textStyle: { color: th.muted, fontSize: 10 }, labelFormatter: (_v: number, s: string) => s.slice(0, 10) },
    ],
    series: [
      {
        type: 'line',
        name: 'rain',
        yAxisIndex: 1,
        showSymbol: false,
        symbolSize: 8,
        emphasis: { scale: false },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: rain }, { offset: 0.5, color: `${rain}b3` }, { offset: 1, color: `${rain}00` }] } },
        lineStyle: { color: rain, width: 1.5 },
        itemStyle: { color: rain },
        encode: { x: 0, y: 3 },
        data: rows,
        z: 2,
      },
      { type: 'custom', name: 'wind', renderItem: renderArrow, encode: { x: 0, y: 1 }, data: rows, z: 10 },
      { type: 'line', name: 'wind speed', symbol: 'none', encode: { x: 0, y: 1 }, lineStyle: { color: th.muted, type: 'dotted', width: 1 }, data: rows, z: 1 },
      { type: 'custom', name: 'sky', renderItem: renderSky, data: skies, yAxisIndex: 2, z: 11, tooltip: { show: false } },
    ],
  };
}
