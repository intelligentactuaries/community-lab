// A guideway as a polyline: cumulative lengths, the distance along it of a
// point beside it, and the point and heading at a distance along it. The
// Hyperline uses these on whichever world is installed.

export type Polyline = ReadonlyArray<{ x: number; y: number }>;

/** Cumulative length at each vertex. */
export function cumulative(track: Polyline): number[] {
  const out: number[] = [];
  let l = 0;
  for (let i = 0; i < track.length; i++) {
    if (i > 0) l += Math.hypot(track[i].x - track[i - 1].x, track[i].y - track[i - 1].y);
    out.push(l);
  }
  return out;
}

/** Distance along the track of a point that lies on it (the nearest point is used, so a metre off the rail is fine). */
export function distanceAlong(track: Polyline, cum: readonly number[], x: number, y: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const u = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
    const px = a.x + u * dx;
    const py = a.y + u * dy;
    const d = Math.hypot(px - x, py - y);
    if (d < bd) {
      bd = d;
      best = cum[i - 1] + u * Math.sqrt(len2);
    }
  }
  return best;
}

/** The point and heading on the track at distance `s` from its first end. */
export function pointAlong(track: Polyline, cum: readonly number[], s: number): { x: number; y: number; heading: number } {
  if (!track.length) return { x: 0, y: 0, heading: 0 };
  const total = cum[cum.length - 1] ?? 0;
  const t = Math.max(0, Math.min(total, s));
  for (let i = 1; i < track.length; i++) {
    if (t <= cum[i] || i === track.length - 1) {
      const a = track[i - 1];
      const b = track[i];
      const seg = cum[i] - cum[i - 1];
      const u = seg > 0 ? (t - cum[i - 1]) / seg : 0;
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, heading: Math.atan2(b.y - a.y, b.x - a.x) };
    }
  }
  return { x: track[0].x, y: track[0].y, heading: 0 };
}
