// Climate presets and a daily weather generator. Temperatures follow a
// seasonal sinusoid with autocorrelated noise; rain days follow the
// preset's monthly rain-day probability; storms, heat waves and cold snaps
// are tagged so health (flu season, heat stress) and behaviour (indoor
// days, cancelled sport) can react.
//
// Highveld numbers are the long-run Johannesburg climate normals (SAWS /
// WMO 1991-2020): summer rainfall, dry cold winters. Western Cape is the
// Mediterranean opposite (winter rain). KZN coast is humid subtropical.
// "temperate-north" is a generic north-European profile for comparison.

import type { ClimateId } from './params';
import type { Rng } from './rng';
import { seasonFor, type Hemisphere } from './time';
import type { Weather, WeatherCondition, WeatherOverride } from './types';

export interface ClimatePreset {
  id: ClimateId;
  label: string;
  hemisphere: Hemisphere;
  latitude: number;
  /** Mean daily max by month (Jan..Dec), °C. */
  tmax: number[];
  tmin: number[];
  /** Probability a given day has measurable rain, by month. */
  rainDayP: number[];
  /** Mean rain on a rain day (mm), by month. */
  rainMm: number[];
  /** Probability a rain day is a thunderstorm. */
  stormShare: number;
  snowPossible: boolean;
}

export const CLIMATES: ClimatePreset[] = [
  {
    id: 'highveld',
    label: 'Highveld (Johannesburg)',
    hemisphere: 'south',
    latitude: -26.2,
    tmax: [26, 25, 24, 22, 19, 16, 17, 20, 23, 24, 25, 26],
    tmin: [15, 14, 13, 10, 6, 4, 4, 6, 9, 12, 13, 14],
    rainDayP: [0.45, 0.4, 0.33, 0.2, 0.08, 0.04, 0.03, 0.05, 0.12, 0.28, 0.4, 0.42],
    rainMm: [9, 8, 8, 7, 5, 4, 3, 4, 5, 7, 8, 9],
    stormShare: 0.45,
    snowPossible: false,
  },
  {
    id: 'western-cape',
    label: 'Western Cape (Stellenbosch)',
    hemisphere: 'south',
    latitude: -33.9,
    tmax: [28, 28, 26, 23, 20, 18, 17, 18, 20, 22, 25, 27],
    tmin: [16, 16, 14, 12, 9, 8, 7, 7, 9, 11, 13, 15],
    rainDayP: [0.12, 0.12, 0.18, 0.28, 0.4, 0.45, 0.45, 0.42, 0.32, 0.25, 0.18, 0.14],
    rainMm: [5, 5, 6, 8, 10, 12, 12, 11, 8, 7, 6, 5],
    stormShare: 0.1,
    snowPossible: false,
  },
  {
    id: 'kzn-coast',
    label: 'KZN coast (Durban)',
    hemisphere: 'south',
    latitude: -29.9,
    tmax: [28, 28, 28, 26, 25, 23, 23, 23, 23, 24, 25, 27],
    tmin: [21, 21, 20, 17, 14, 11, 11, 13, 15, 17, 18, 20],
    rainDayP: [0.42, 0.4, 0.4, 0.3, 0.2, 0.12, 0.12, 0.18, 0.28, 0.35, 0.4, 0.42],
    rainMm: [10, 10, 10, 8, 6, 5, 5, 6, 7, 8, 9, 10],
    stormShare: 0.3,
    snowPossible: false,
  },
  {
    id: 'temperate-north',
    label: 'Temperate north (generic)',
    hemisphere: 'north',
    latitude: 51.5,
    tmax: [7, 8, 11, 14, 18, 21, 23, 23, 20, 15, 10, 7],
    tmin: [2, 2, 3, 5, 8, 11, 13, 13, 11, 8, 4, 2],
    rainDayP: [0.4, 0.35, 0.35, 0.33, 0.3, 0.3, 0.28, 0.3, 0.3, 0.38, 0.4, 0.4],
    rainMm: [5, 5, 5, 5, 6, 6, 7, 7, 6, 6, 6, 5],
    stormShare: 0.12,
    snowPossible: true,
  },
];

export function climateById(id: ClimateId): ClimatePreset {
  return CLIMATES.find((c) => c.id === id) ?? CLIMATES[0];
}

export interface WeatherState {
  /** Autocorrelated temperature anomaly (°C). */
  anomaly: number;
  /** Days remaining in a heat wave / cold snap. */
  spell: number;
  spellKind: 'heat' | 'cold' | null;
  /** Wind direction as a sixteenth of the compass (0 = N, clockwise); it wanders a point or two a day. */
  windDir: number;
}

export function initialWeatherState(): WeatherState {
  return { anomaly: 0, spell: 0, spellKind: null, windDir: 12 };
}

export function generateWeather(rng: Rng, climate: ClimatePreset, month: number, day: number, st: WeatherState): Weather {
  const mi = month - 1;
  // AR(1) anomaly with sd ≈ 3°C
  st.anomaly = 0.7 * st.anomaly + rng.normal(0, 2.2);
  if (st.spell > 0) {
    st.spell--;
    if (st.spell === 0) st.spellKind = null;
  } else if (rng.bernoulli(0.012)) {
    st.spell = 2 + rng.int(4);
    st.spellKind = rng.bernoulli(0.55) ? 'heat' : 'cold';
  }
  let tmax = climate.tmax[mi] + st.anomaly;
  let tmin = climate.tmin[mi] + st.anomaly * 0.8;
  if (st.spellKind === 'heat') {
    tmax += 6;
    tmin += 4;
  } else if (st.spellKind === 'cold') {
    tmax -= 6;
    tmin -= 6;
  }
  const rainDay = rng.bernoulli(climate.rainDayP[mi]);
  let rainMm = rainDay ? Math.max(0.5, rng.exponential(1 / climate.rainMm[mi])) : 0;
  let condition: WeatherCondition = 'clear';
  if (rainDay) {
    condition = rng.bernoulli(climate.stormShare) ? 'storm' : 'rain';
    if (condition === 'storm') rainMm *= 2.2;
    tmax -= 3;
  } else if (rng.bernoulli(0.25)) condition = 'cloudy';
  if (!rainDay && st.spellKind === 'heat' && tmax >= 32) condition = 'heatwave';
  if (!rainDay && st.spellKind === 'cold' && tmin <= 2) condition = 'cold-snap';
  if (climate.snowPossible && rainDay && tmax <= 2) condition = 'snow';
  if (!rainDay && condition === 'clear' && rng.bernoulli(0.05) && tmin < 8) condition = 'fog';
  const windKmh = Math.max(2, rng.normal(condition === 'storm' ? 35 : 14, 6));
  // The wind backs or veers a point most days; storms and cold fronts come round from the south-west.
  if (condition === 'storm' || condition === 'cold-snap') st.windDir = 10 + rng.int(3) - 1;
  else if (rng.bernoulli(0.5)) st.windDir = (st.windDir + (rng.bernoulli(0.5) ? 1 : 15)) % 16;
  return {
    day,
    season: seasonFor(month, climate.hemisphere),
    tempMin: Math.round(tmin * 10) / 10,
    tempMax: Math.round(tmax * 10) / 10,
    rainMm: Math.round(rainMm * 10) / 10,
    condition,
    windKmh: Math.round(windKmh),
    windDir: st.windDir,
  };
}

/** Apply an operator's forced weather over the generated day. The season is
 *  NOT overridden: it stays derived from the calendar month, so the seasonal
 *  analytics keep meaning what they say. */
export function applyWeatherOverride(w: Weather, o: WeatherOverride): Weather {
  return {
    ...w,
    condition: o.condition,
    tempMax: o.tempMax,
    tempMin: Math.min(o.tempMin, o.tempMax),
    rainMm: o.rainMm,
    windKmh: o.windKmh,
  };
}

/** Weather that reads naturally for a chosen condition, seeded from today's. */
export function weatherPresetFor(condition: WeatherCondition, base: Weather): Omit<WeatherOverride, 'hold' | 'setDay'> {
  const mid = (base.tempMax + base.tempMin) / 2;
  switch (condition) {
    case 'storm':
      return { condition, tempMax: Math.round(mid - 1), tempMin: Math.round(mid - 6), rainMm: 28, windKmh: 42 };
    case 'rain':
      return { condition, tempMax: Math.round(mid), tempMin: Math.round(mid - 5), rainMm: 9, windKmh: 16 };
    case 'snow':
      return { condition, tempMax: 1, tempMin: -3, rainMm: 6, windKmh: 14 };
    case 'heatwave':
      return { condition, tempMax: 38, tempMin: 24, rainMm: 0, windKmh: 8 };
    case 'cold-snap':
      return { condition, tempMax: 6, tempMin: -2, rainMm: 0, windKmh: 18 };
    case 'fog':
      return { condition, tempMax: Math.round(mid - 2), tempMin: Math.round(mid - 7), rainMm: 0, windKmh: 5 };
    case 'cloudy':
      return { condition, tempMax: Math.round(mid + 1), tempMin: Math.round(mid - 5), rainMm: 0, windKmh: 12 };
    default:
      return { condition: 'clear', tempMax: Math.round(mid + 4), tempMin: Math.round(mid - 4), rainMm: 0, windKmh: 10 };
  }
}

/** Temperature at a minute of the day (sinusoid between min at 05:00 and max at 15:00). */
export function tempAt(w: Weather, minuteOfDay: number): number {
  const t = (minuteOfDay - 300) / 1440; // 0 at 05:00
  const phase = Math.cos(2 * Math.PI * (t - 10 / 24 / 1)); // peak 10h after 05:00 → 15:00
  const mid = (w.tempMax + w.tempMin) / 2;
  const amp = (w.tempMax - w.tempMin) / 2;
  return mid + amp * phase;
}

export function isOutdoorFriendly(w: Weather): boolean {
  return w.condition !== 'rain' && w.condition !== 'storm' && w.condition !== 'snow' && w.condition !== 'heatwave' && w.condition !== 'cold-snap';
}
