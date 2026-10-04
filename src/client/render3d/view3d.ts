// When the map becomes a scene. Past the bare-floor zoom the flat plan fades
// into a 3D view seen from straight above, registered pixel for pixel with the
// 2D map at the handover; the moment the scene has the picture the camera
// swings down from straight above to a low, near-horizontal view of the street
// (the horizon in the top of the frame), and from there coming closer only
// brings it nearer, down to eye level, until at the closest zoom a face fills
// the screen.
//
// The camera is still the map's (a point on the ground, a zoom, a heading and
// a tilt); flying about the scene the Unreal way (see lib/controls.ts)
// moves the eye and the way it looks, and this file turns that back into the
// map camera, so everything that reads the map camera (the drill levels, the
// labels, who is near enough to draw) keeps working.
import { MIN_ZOOM, type Camera } from '../lib/camera';

/** The 3D scene fades in over the flat map between these zooms (screen px per metre)... */
export const FADE_FROM = 5;
export const FADE_TO = 7;
/**
 * ...and once it has the picture the camera swings down from straight above to the low view, done by this zoom
 * (the user's own heading and tilt come in over the same band, so the swoop is never fought).
 */
export const SWOOP_TO = FADE_TO * 1.7;
/** From the low view the elevation settles to eye level by here; closer, the camera only comes nearer. A person fills a third of the screen. */
export const ZOOM_CLOSE = 240;
/** The closest zoom the 3D view allows (the flat map stops at 40): a face fills the screen. */
export const MAX_ZOOM_3D = 720;
/** Vertical field of view: long-lens and cinematic rather than wide and distorted. */
export const FOV = 30;
/** The field of view the Z / C keys can reach (Unreal's camera allows 5° to 170°; long lenses only, here). */
export const FOV_MIN = 10;
export const FOV_MAX = 90;

const PITCH_TOP = 90;
/**
 * The near-horizontal elevation the camera swings down to as the scene takes over: facing along the street
 * rather than down at it, the horizon a tenth of the way down the frame with the scene's own lens.
 */
export const PITCH_LOW = 12;
/** At the closest zoom the camera is at eye level, looking at faces rather than the tops of heads. */
export const PITCH_CLOSE = 10;
/** The ground the camera looks at is never nearer the horizon than this (degrees of elevation)... */
export const PITCH_MIN = 6;
/** ...but the view may turn up past it toward the sky, the eye staying put (negative: above the horizon). */
export const PITCH_UP = -80;

function smooth(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

/** How much of the 3D scene shows (0 = the flat map only, 1 = the scene only). */
export function blend3d(zoom: number): number {
  return smooth((zoom - FADE_FROM) / (FADE_TO - FADE_FROM));
}

/** How much of the user's heading and tilt applies at a zoom: none at the handover, all by the end of the swoop. */
export function freeLook(zoom: number): number {
  return smooth((zoom - FADE_TO) / (SWOOP_TO - FADE_TO));
}

/** The heading the 3D camera actually uses (radians, clockwise from north). */
export function effectiveYaw(cam: Camera): number {
  return (cam.yaw ?? 0) * freeLook(cam.zoom);
}

/**
 * The camera's elevation above the horizon, in degrees, at a zoom (before the user's tilt): straight down up
 * to the handover, the swoop to the low view over the next band, then a gentle settling to eye level.
 */
export function pitchFor(zoom: number): number {
  if (zoom <= FADE_TO) return PITCH_TOP;
  const l = Math.log(zoom);
  if (zoom <= SWOOP_TO) return PITCH_TOP + (PITCH_LOW - PITCH_TOP) * smooth((l - Math.log(FADE_TO)) / (Math.log(SWOOP_TO) - Math.log(FADE_TO)));
  return PITCH_LOW + (PITCH_CLOSE - PITCH_LOW) * smooth((l - Math.log(SWOOP_TO)) / (Math.log(ZOOM_CLOSE) - Math.log(SWOOP_TO)));
}

/** The elevation the view actually has at a zoom with a tilt: the zoom's own, tilted, within what the scene allows. */
export function viewPitch(cam: Camera): number {
  return Math.max(PITCH_UP, Math.min(90, pitchFor(cam.zoom) + (cam.tilt ?? 0) * freeLook(cam.zoom)));
}

/** Close in, the camera looks at chest height so a person is framed, not their feet: the look-at point's height. */
export function liftFor(zoom: number): number {
  return smooth((Math.log(zoom) - Math.log(60)) / (Math.log(ZOOM_CLOSE) - Math.log(60)));
}

const HALF = Math.tan(((FOV / 2) * Math.PI) / 180);
/** Eye to look-at distance at a zoom (screen px per metre at the look-at point, for a viewport h px tall)... */
export function distFor(zoom: number, h: number): number {
  return h / zoom / (2 * HALF);
}
/** ...and the zoom at a distance. */
export function zoomFor(dist: number, h: number): number {
  return h / (dist * 2 * HALF);
}

export interface Pose {
  /** Eye and look-at point in scene coordinates (x east, y up, z south). */
  eye: [number, number, number];
  target: [number, number, number];
  /** The camera's up vector: north on screen, whatever the tilt. */
  up: [number, number, number];
  dist: number;
  /** The view's elevation, degrees: 90 straight down, negative above the horizon. */
  pitch: number;
  /** The vertical field of view, degrees (the lens the Z / C keys set, back to FOV at the handover). */
  fov: number;
}

/**
 * The 3D camera for a 2D camera. The distance is chosen so that the ground at
 * the screen centre has the same scale as the flat map (zoom px per metre), so
 * seen from straight above the two coincide; the camera then swings south of
 * its target and looks north, keeping north up on screen. Turned up past
 * PITCH_MIN the eye stays where the ground would have it and only the view
 * rises, so the map point the camera is "at" is still the ground before it.
 */
export function poseFor(cam: Camera, h: number): Pose {
  const free = freeLook(cam.zoom);
  const pitchDeg = viewPitch(cam);
  const pv = (pitchDeg * Math.PI) / 180;
  const pe = (Math.max(pitchDeg, PITCH_MIN) * Math.PI) / 180;
  const yaw = (cam.yaw ?? 0) * free;
  const dist = distFor(cam.zoom, h);
  const tx = cam.x;
  const tz = cam.y;
  const lift = liftFor(cam.zoom);
  // The way the camera looks, flattened onto the ground: north at heading 0, east at a quarter turn.
  const fx = Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const eye: [number, number, number] = [tx - fx * dist * Math.cos(pe), lift + dist * Math.sin(pe), tz - fz * dist * Math.cos(pe)];
  return {
    eye,
    // Looking along the view's own elevation from there (the look-at point itself unless turned up).
    target: [eye[0] + fx * dist * Math.cos(pv), eye[1] - dist * Math.sin(pv), eye[2] + fz * dist * Math.cos(pv)],
    up: [fx * Math.sin(pv), Math.cos(pv), fz * Math.sin(pv)],
    dist,
    pitch: pitchDeg,
    fov: FOV + ((cam.fov ?? FOV) - FOV) * free,
  };
}

/** The camera as a flight: where the eye is, and the heading (radians, clockwise from north) and elevation (degrees) it looks along. */
export function flyPose(cam: Camera, h: number): { eye: [number, number, number]; yaw: number; pitch: number; dist: number } {
  const p = poseFor(cam, h);
  return { eye: p.eye, yaw: effectiveYaw(cam), pitch: p.pitch, dist: p.dist };
}

/**
 * Put the eye at a point looking along a heading and elevation, as a map
 * camera: the ground point before it (at least PITCH_MIN below the horizon),
 * the zoom its distance implies, and the heading and tilt. The zoom is held
 * within the scene's range, so the eye cannot sink through the ground nor
 * climb out of the scene; the heading and tilt fade toward the handover as
 * they always do (the response is damped there, never wound up).
 */
export function setFly(cam: Camera, h: number, eye: [number, number, number], yaw: number, pitch: number): void {
  pitch = Math.max(PITCH_UP, Math.min(90, pitch));
  const pe = (Math.max(pitch, PITCH_MIN) * Math.PI) / 180;
  // The look-at point's height depends on the zoom (chest height close in): a few rounds settle both.
  let zoom = cam.zoom;
  for (let i = 0; i < 4; i++) {
    const dist = Math.max(0.05, (eye[1] - liftFor(zoom)) / Math.sin(pe));
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM_3D, zoomFor(dist, h)));
  }
  const dist = distFor(zoom, h);
  const fx = Math.sin(yaw);
  const fz = -Math.cos(yaw);
  cam.x = cam.tx = eye[0] + fx * dist * Math.cos(pe);
  cam.y = cam.ty = eye[2] + fz * dist * Math.cos(pe);
  cam.zoom = cam.tzoom = zoom;
  cam.flight = null;
  cam.yaw = wrapAngle(yaw);
  cam.tilt = pitch - pitchFor(zoom);
}

/** Turn the view about its look-at point (the eye swings round it): by a heading (radians) and an elevation (degrees). */
export function orbitBy(cam: Camera, dyaw: number, dpitch: number): void {
  cam.yaw = wrapAngle((cam.yaw ?? 0) + dyaw);
  const base = pitchFor(cam.zoom);
  cam.tilt = Math.max(PITCH_UP - base, Math.min(90 - base, (cam.tilt ?? 0) + dpitch));
}

/** An angle brought into (-π, π]. */
export function wrapAngle(a: number): number {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  else if (a <= -Math.PI) a += Math.PI * 2;
  return a;
}
