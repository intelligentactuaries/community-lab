// The simulation calendar. Absolute time is an integer-valued number of
// MINUTES since the scenario start; days are 1440 minutes. All calendar
// arithmetic is done in UTC on the proleptic Gregorian calendar so a given
// (startDate, minute) pair resolves to the same date on every machine.

export const MINUTES_PER_DAY = 1440;
export const DAYS_PER_YEAR = 365.25;
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export type Season = 'summer' | 'autumn' | 'winter' | 'spring';
export type Hemisphere = 'south' | 'north';

export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  weekday: number; // 0 = Sunday
  dayOfYear: number; // 1-366
  isoDate: string; // YYYY-MM-DD
}

export function parseStartDate(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return Date.UTC(2026, 0, 1);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const MS_PER_DAY = 86_400_000;

export function calendarForDay(startMs: number, dayIndex: number): CalendarDate {
  const d = new Date(startMs + dayIndex * MS_PER_DAY);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const weekday = d.getUTCDay();
  const jan1 = Date.UTC(year, 0, 1);
  const dayOfYear = Math.floor((d.getTime() - jan1) / MS_PER_DAY) + 1;
  const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { year, month, day, weekday, dayOfYear, isoDate };
}

export function seasonFor(month: number, hemisphere: Hemisphere): Season {
  // Meteorological seasons. Southern hemisphere: Dec-Feb summer.
  const northern: Season[] = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
  const southern: Season[] = ['summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter', 'winter', 'winter', 'spring', 'spring', 'spring', 'summer'];
  return (hemisphere === 'south' ? southern : northern)[month - 1];
}

/**
 * Approximate sunrise / sunset (minutes after midnight, local solar time)
 * from latitude and day of year, using the standard solar declination
 * approximation. Good to ~15 minutes, which is all the lighting needs.
 */
export function daylight(latitudeDeg: number, dayOfYear: number): { sunrise: number; sunset: number } {
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81)) * (Math.PI / 180);
  const lat = latitudeDeg * (Math.PI / 180);
  let cosH = -Math.tan(lat) * Math.tan(decl);
  cosH = Math.max(-1, Math.min(1, cosH));
  const halfDayMin = (Math.acos(cosH) * (180 / Math.PI)) * 4; // 1 degree = 4 minutes
  return { sunrise: 720 - halfDayMin, sunset: 720 + halfDayMin };
}

/** Night darkness 0..1 (0 = full day, 1 = full night) with a 40-minute dawn/dusk ramp. */
export function nightDarkness(latitudeDeg: number, dayOfYear: number, minuteOfDay: number): number {
  const { sunrise, sunset } = daylight(latitudeDeg, dayOfYear);
  const dawn = 40;
  let dark = 0;
  if (minuteOfDay < sunrise - dawn || minuteOfDay > sunset + dawn) dark = 1;
  else if (minuteOfDay < sunrise + dawn) dark = 1 - (minuteOfDay - (sunrise - dawn)) / (2 * dawn);
  else if (minuteOfDay > sunset - dawn) dark = (minuteOfDay - (sunset - dawn)) / (2 * dawn);
  return Math.max(0, Math.min(1, dark));
}

export function fmtClock(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60) % 24;
  const m = Math.floor(minuteOfDay % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Whole years between two absolute day indices (birthday-accurate enough at day resolution). */
export function yearsBetween(fromDay: number, toDay: number): number {
  return Math.floor((toDay - fromDay) / DAYS_PER_YEAR);
}

export function exactYears(fromDay: number, toDay: number): number {
  return (toDay - fromDay) / DAYS_PER_YEAR;
}
