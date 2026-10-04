// World (metres) ↔ screen (CSS px) with five semantic drill levels: the
// province, a city, a settlement, a house, a person.
import { WORLD_H, WORLD_W } from '../../sim/world';

export type Drill = 'province' | 'city' | 'community' | 'house' | 'person';

export interface Camera {
  /** World point at the screen centre. */
  x: number;
  y: number;
  /** Screen px per metre. */
  zoom: number;
  /** Animation targets. */
  tx: number;
  ty: number;
  tzoom: number;
  /** Second leg of a staged flight (fly-to arcs out, then swoops in). */
  flight?: { tx: number; ty: number; tzoom: number; promoteDist: number; promoteZoom: number } | null;
  /**
   * The 3D view's heading (radians, clockwise from north) and a tilt offset
   * (degrees) from the zoom's own pitch. Both fade out toward the handover, so
   * the scene is north-up and top-down where it meets the flat map.
   */
  yaw?: number;
  tilt?: number;
  /** The 3D view's vertical field of view (degrees; the Z / C keys change it), FOV when unset. */
  fov?: number;
}

export const MIN_ZOOM = 0.12;
/** The closest the flat map zooms; the 3D view goes closer (see setMaxZoom). */
export const MAX_ZOOM = 40;
let maxZoom = MAX_ZOOM;
/** The closest zoom allowed now: 40 px/m on the flat map, closer when the 3D view is on. */
export function setMaxZoom(z: number): void {
  maxZoom = z;
}
export function getMaxZoom(): number {
  return maxZoom;
}
/** Height the floating stats strip occludes at the bottom of the stage. */
export const HUD_BOTTOM = 72;

export function fitWorld(w: number, h: number): number {
  // Fit into the area the strip does not cover, so the province is never cut.
  return Math.max(MIN_ZOOM, Math.min((w - 24) / WORLD_W, (h - HUD_BOTTOM - 24) / WORLD_H));
}

export function makeCamera(w: number, h: number): Camera {
  const z = fitWorld(w, h);
  return { x: WORLD_W / 2, y: WORLD_H / 2, zoom: z, tx: WORLD_W / 2, ty: WORLD_H / 2, tzoom: z };
}

export function toScreen(cam: Camera, w: number, h: number, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - cam.x) * cam.zoom + w / 2, y: (wy - cam.y) * cam.zoom + h / 2 };
}

export function toWorld(cam: Camera, w: number, h: number, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - w / 2) / cam.zoom + cam.x, y: (sy - h / 2) / cam.zoom + cam.y };
}

/**
 * Which semantic level the current zoom implies. The inner levels are
 * absolute (interiors appear at 4 px/m, people are legible at 11); the city
 * level is relative to the province fit, since a city is a third of it across.
 */
export function drillFor(zoom: number, fit: number): Drill {
  if (zoom >= 11) return 'person';
  if (zoom >= 3.6) return 'house';
  if (zoom >= Math.max(fit * 4.5, 1.4)) return 'community';
  if (zoom >= fit * 1.9) return 'city';
  return 'province';
}

export function easeCamera(cam: Camera, dt: number): void {
  // A staged flight hands over to its second leg mid-arc, so the zoom-out and
  // the swoop-in read as one continuous motion.
  if (cam.flight) {
    const f = cam.flight;
    const remaining = Math.hypot(cam.tx - cam.x, cam.ty - cam.y);
    if (remaining <= f.promoteDist && cam.zoom <= f.promoteZoom) {
      cam.tx = f.tx;
      cam.ty = f.ty;
      cam.tzoom = f.tzoom;
      cam.flight = null;
    }
  }
  const k = 1 - Math.exp(-dt / 0.18);
  cam.x += (cam.tx - cam.x) * k;
  cam.y += (cam.ty - cam.y) * k;
  // zoom eases in log space so it feels linear
  const lz = Math.log(cam.zoom);
  const ltz = Math.log(cam.tzoom);
  cam.zoom = Math.exp(lz + (ltz - lz) * k);
}

export function zoomAt(cam: Camera, w: number, h: number, sx: number, sy: number, factor: number): void {
  cam.flight = null;
  const before = toWorld(cam, w, h, sx, sy);
  cam.tzoom = Math.max(MIN_ZOOM, Math.min(maxZoom, cam.tzoom * factor));
  cam.zoom = cam.tzoom;
  const after = toWorld(cam, w, h, sx, sy);
  cam.x += before.x - after.x;
  cam.y += before.y - after.y;
  cam.tx = cam.x;
  cam.ty = cam.y;
}

export function focusRect(cam: Camera, w: number, h: number, x: number, y: number, rw: number, rh: number, pad = 1.25): void {
  cam.flight = null;
  cam.tzoom = Math.max(MIN_ZOOM, Math.min(maxZoom, Math.min(w / (rw * pad), (h - HUD_BOTTOM) / (rh * pad))));
  cam.tx = x + rw / 2;
  cam.ty = y + rh / 2 + HUD_BOTTOM / 2 / cam.tzoom;
}

export function focusPoint(cam: Camera, x: number, y: number, zoom?: number): void {
  cam.flight = null;
  cam.tx = x;
  cam.ty = y;
  if (zoom) cam.tzoom = Math.max(MIN_ZOOM, Math.min(maxZoom, zoom));
}

/**
 * Fly the camera to a rectangle the way a map does: a short hop eases straight
 * there; a long one first arcs out to a view that holds both departure and
 * destination, then swoops in — promoted mid-arc so it feels like one motion.
 */
export function flyToRect(cam: Camera, w: number, h: number, x: number, y: number, rw: number, rh: number, pad = 1.12): void {
  cam.flight = null;
  const fzoom = Math.max(MIN_ZOOM, Math.min(maxZoom, Math.min(w / (rw * pad), (h - HUD_BOTTOM) / (rh * pad))));
  const ftx = x + rw / 2;
  const fty = y + rh / 2 + HUD_BOTTOM / 2 / fzoom;
  const d = Math.hypot(ftx - cam.x, fty - cam.y);
  const viewW = w / cam.zoom;
  if (d < 0.6 * viewW) {
    cam.tx = ftx;
    cam.ty = fty;
    cam.tzoom = fzoom;
    return;
  }
  // The overview leg: a box around where we are and where we are going.
  const halfW = (w / cam.zoom) / 2;
  const halfH = (h / cam.zoom) / 2;
  const bx0 = Math.min(cam.x - halfW, x);
  const bx1 = Math.max(cam.x + halfW, x + rw);
  const by0 = Math.min(cam.y - halfH, y);
  const by1 = Math.max(cam.y + halfH, y + rh);
  const izoom = Math.max(MIN_ZOOM, Math.min(cam.zoom, fzoom, Math.min(w / ((bx1 - bx0) * 1.15), h / ((by1 - by0) * 1.15))));
  const mx = (cam.x + ftx) / 2;
  const my = (cam.y + fty) / 2;
  cam.tx = mx;
  cam.ty = my;
  cam.tzoom = izoom;
  cam.flight = { tx: ftx, ty: fty, tzoom: fzoom, promoteDist: 0.42 * (d / 2), promoteZoom: izoom * 1.45 };
}
