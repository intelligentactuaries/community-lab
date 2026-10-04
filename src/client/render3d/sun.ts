// Where the sun stands: elevation and azimuth for a latitude, a day of the
// year and a minute of the day, as a unit vector in the scene's axes (x east,
// y up, z south). In the southern hemisphere the noon sun stands in the north.

export interface Sun {
  /** Unit vector toward the sun. */
  x: number;
  y: number;
  z: number;
  /** Degrees above the horizon (negative at night). */
  elevation: number;
}

export function sunPosition(latitude: number, dayOfYear: number, minuteOfDay: number): Sun {
  const rad = Math.PI / 180;
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81)) * rad;
  const lat = latitude * rad;
  const H = ((minuteOfDay - 720) / 4) * rad;
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  // Azimuth from north, clockwise (east = 90 degrees).
  const az = Math.atan2(-Math.sin(H) * Math.cos(decl), Math.cos(lat) * Math.sin(decl) - Math.sin(lat) * Math.cos(decl) * Math.cos(H));
  const x = Math.sin(az) * Math.cos(el);
  const y = Math.sin(el);
  const z = -Math.cos(az) * Math.cos(el);
  const n = Math.hypot(x, y, z) || 1;
  return { x: x / n, y: y / n, z: z / n, elevation: el / rad };
}
