// Getting about the scene the way Unreal Engine's editor viewport does, with
// Unreal's own numbers (read from the engine: Engine/Config/
// BaseEditorPerProjectUserSettings.ini, LevelEditorViewportSettings,
// EditorViewportClient.cpp and CameraController.cpp), applied every frame.
//
// In the 3D view (a perspective viewport):
//   right button + drag      look about (0.2° a pixel)
//   left button + drag       move forward and back along the ground, and turn
//   middle button + drag     slide sideways and straight up and down (pan)
//   left + right + drag      the same
//   Alt + left / middle / right   orbit round, track across (the camera's own
//                            right and up), or dolly toward what the camera
//                            looks at (Ctrl does the same, for desktops whose
//                            window manager takes Alt-drags)
//   wheel                    dolly in and out toward what the camera looks at,
//                            the ground under the cursor kept under it as on
//                            the map; the elevation follows the scene's own
//                            curve, so coming in from the handover swings the
//                            view down to the street (view3d.ts); with a
//                            button held it sets the camera speed instead
//                            (×1.1 a notch)
//   with a button held: W A S D fly (where the camera looks), E / Q up and down,
//   R / F up and down the camera's own way, C / Z zoom the lens in and out (it
//   springs back when the button is released)
//   without a button: the arrow keys, Page Up / Page Down and the numpad
//   (8 2 4 6, 9 7, + −, 1 3) do the same; Home levels the view, north up
// Flight has Unreal's weight: acceleration and damping rather than an instant
// speed, and everything scales with the distance to what the camera looks at
// (Unreal's distance-scaled camera speed, on by default here since the scene
// spans a province).
//
// On the flat map the buttons do what they do in an orthographic viewport:
// any button drags the map, the wheel zooms about the cursor; W A S D and the
// arrows pan, + / − zoom.
//
// A game controller follows the editor's joystick controls: the left stick
// moves, the right stick looks (stick up looks down, as Unreal has it; a
// setting inverts it), the triggers go down and up, the bumpers widen and
// narrow the lens, the d-pad steps the move and turn multipliers; the face
// buttons are this app's own: A picks whoever is at the centre, B backs out,
// X follows, Y switches the 3D view, Start plays or pauses, View shows the
// legend, a stick click levels the view north-up.
import type { Camera } from './camera';
import { MIN_ZOOM, getMaxZoom } from './camera';
import { FOV, FOV_MAX, FOV_MIN, MAX_ZOOM_3D, PITCH_MIN, PITCH_UP, distFor, effectiveYaw, flyPose, orbitBy, setFly, wrapAngle, zoomFor } from '../render3d/view3d';

/** Unreal's constants, as the engine has them. */
export const UE = {
  /** Degrees of turn per pixel of mouse travel (LevelEditorViewportSettings MouseSensitivty = .2; 0.01–1). */
  MOUSE_SENSITIVITY: 0.2,
  /** The camera speed (CameraSpeedSettings.CurrentSpeed 1.0): its absolute range and the toolbar slider's. */
  SPEED_MIN: 0.00001,
  SPEED_MAX: 10000,
  SLIDER_MIN: 0.33,
  SLIDER_MAX: 32,
  /** A wheel notch with a button held: speed × 1.1 up, × 0.9 down (Delta = Speed * 0.1). */
  SPEED_NOTCH: 0.1,
  /** GetCameraSpeed(MouseScrollCameraSpeed): the table the wheel's dolly draws on, × 32 cm a notch. */
  SCROLL_TABLE: [0.033, 0.1, 0.33, 1, 3, 8, 16, 32],
  SCROLL_CM: 32,
  /** FEditorCameraController: flight acceleration (cm/s²) and damping (/s, at most 0.75 a frame). */
  MOVE_ACCEL: 20000,
  MOVE_DAMPING: 10,
  DAMPING_CAP: 0.75,
  /** Joystick look: acceleration (°/s²) and damping. */
  ROT_ACCEL: 1600,
  ROT_DAMPING: 12,
  /** The lens: acceleration (°/s²), damping, and the rate it springs back at (/s). */
  FOV_ACCEL: 1200,
  FOV_DAMPING: 10,
  FOV_RECOIL: 10,
  /** A press that travels less than this (px) is a click, not a drag (MOUSE_CLICK_DRAG_DELTA). */
  DRAG_PX: 4,
  /** The joystick's dead zone, rescaled so a full push still reaches 1. */
  DEAD_ZONE: 0.2,
  /** Distance-scaled speed: translations × min(distance / 1000 cm, 1000). */
  DISTANCE_CM: 1000,
  DISTANCE_MAX: 1000,
  /** The d-pad's steps and ranges for the joystick's move and turn multipliers. */
  MULT_STEP: 0.25,
  MOVE_MULT: [0.25, 5] as const,
  TURN_MULT: [0.25, 3] as const,
  /** Unreal is in centimetres; the scene is in metres. */
  CM: 0.01,
} as const;

export type FlightControl = 'rmb' | 'always' | 'never';

/** The viewport settings a user can change (Unreal's, with Unreal's defaults except where noted). */
export interface NavPrefs {
  /** The camera speed (the wheel with a button held, or the slider). */
  cameraSpeed: number;
  /** MouseScrollCameraSpeed, 1–8: how far a wheel notch dollies. */
  scrollSpeed: number;
  mouseSensitivity: number;
  invertMouseY: boolean;
  invertOrbitY: boolean;
  invertMiddlePan: boolean;
  invertDollyY: boolean;
  /** Unreal's is off; on here, because the scene runs from a face to a province. */
  distanceScaled: boolean;
  /** WASD fly only with a mouse button held (Unreal's default), always, or never. */
  flight: FlightControl;
  /** The right stick: Unreal's editor looks down when the stick goes up; this flips it. */
  invertStickY: boolean;
}

export const NAV_DEFAULTS: NavPrefs = {
  cameraSpeed: 1,
  scrollSpeed: 5,
  mouseSensitivity: UE.MOUSE_SENSITIVITY,
  invertMouseY: false,
  invertOrbitY: false,
  invertMiddlePan: false,
  invertDollyY: false,
  distanceScaled: true,
  flight: 'rmb',
  invertStickY: false,
};

const LS_NAV = 'community-lab:nav:v1';

function loadNav(): Partial<NavPrefs> {
  try {
    if (typeof localStorage === 'undefined') return {};
    return JSON.parse(localStorage.getItem(LS_NAV) ?? '{}') as Partial<NavPrefs>;
  } catch {
    return {};
  }
}

/** The settings in force (persisted in this browser). */
export const navPrefs: NavPrefs = { ...NAV_DEFAULTS, ...loadNav() };

export function setNavPref<K extends keyof NavPrefs>(k: K, v: NavPrefs[K]): void {
  navPrefs[k] = v;
  if (k === 'cameraSpeed') navPrefs.cameraSpeed = clampSpeed(navPrefs.cameraSpeed);
  if (k === 'scrollSpeed') navPrefs.scrollSpeed = Math.max(1, Math.min(8, Math.round(navPrefs.scrollSpeed)));
  if (k === 'mouseSensitivity') navPrefs.mouseSensitivity = Math.max(0.01, Math.min(1, navPrefs.mouseSensitivity));
  saveNav();
}

export function resetNavPrefs(): void {
  Object.assign(navPrefs, NAV_DEFAULTS);
  saveNav();
}

function saveNav(): void {
  try {
    localStorage.setItem(LS_NAV, JSON.stringify(navPrefs));
  } catch {
    /* no storage */
  }
}

export function clampSpeed(s: number): number {
  return Math.max(UE.SPEED_MIN, Math.min(UE.SPEED_MAX, s));
}

/** The camera speed after a wheel notch with a button held (dir +1 faster, −1 slower). */
export function speedAfterNotch(speed: number, dir: number): number {
  return clampSpeed(speed * (1 + Math.sign(dir) * UE.SPEED_NOTCH));
}

/** Unreal's distance-scaled camera speed: how translations scale with the distance to the look-at point (metres). */
export function distanceFactor(dist: number, on = navPrefs.distanceScaled): number {
  return on ? Math.min((dist / UE.DISTANCE_CM) / UE.CM, UE.DISTANCE_MAX) : 1;
}

/**
 * Wheel notches from a wheel event: a mouse notch (Chrome gives 100 on Windows, 53 on Linux; Firefox counts 3
 * lines) is one, whatever its size, as Unreal treats every scroll event as one notch; a trackpad's small steps
 * add up to one over about a hundred pixels, so a swipe is not a hundred notches.
 */
export function wheelNotches(deltaY: number, deltaMode = 0): number {
  if (deltaMode === 1) return deltaY / 3;
  if (deltaMode === 2) return Math.sign(deltaY);
  return Math.abs(deltaY) >= 40 ? Math.sign(deltaY) : deltaY / 100;
}

/** A stick axis with Unreal's dead zone, rescaled so it still reaches 1. */
export function stickAxis(v: number | undefined): number {
  const a = v ?? 0;
  if (Math.abs(a) <= UE.DEAD_ZONE) return 0;
  return (Math.sign(a) * (Math.abs(a) - UE.DEAD_ZONE)) / (1 - UE.DEAD_ZONE);
}

/** The camera's axes for a heading (radians clockwise from north) and elevation (degrees below the horizon). */
export function axesFor(yaw: number, pitchDeg: number): { fwd: V3; hfwd: V3; right: V3; up: V3 } {
  const p = (pitchDeg * Math.PI) / 180;
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  return {
    fwd: [sy * Math.cos(p), -Math.sin(p), -cy * Math.cos(p)],
    hfwd: [sy, 0, -cy],
    right: [cy, 0, sy],
    up: [sy * Math.sin(p), Math.cos(p), -cy * Math.sin(p)],
  };
}
type V3 = [number, number, number];

/**
 * Unreal's flight simulation (FEditorCameraController): impulses become acceleration, velocity is damped each
 * frame, and the lens has the same weight and springs back when let go. Positions are in metres.
 */
export class Flight {
  /** Velocity in the scene (m/s). */
  v: V3 = [0, 0, 0];
  /** Joystick look velocity (°/s): heading and elevation. */
  rot: [number, number] = [0, 0];
  fovV = 0;

  /**
   * A frame: the impulses (each −1..1: forward, right, up the camera's own way, straight up; heading and
   * elevation; lens wider), the camera's axes, the speed and the distance factor. Returns the move (m),
   * the turn (°) and the lens change (°, wider positive) for this frame.
   */
  step(dt: number, imp: { fwd: number; right: number; localUp: number; worldUp: number; yaw: number; pitch: number; fov: number }, axes: ReturnType<typeof axesFor>, speed: number, scale: number, fov: number, recoil: boolean): { move: V3; yaw: number; pitch: number; fov: number } {
    const damp = Math.min(UE.MOVE_DAMPING * dt, UE.DAMPING_CAP);
    const a = UE.MOVE_ACCEL * UE.CM * speed;
    for (let i = 0; i < 3; i++) {
      const impulse = imp.fwd * axes.fwd[i] + imp.right * axes.right[i] + imp.localUp * axes.up[i] + imp.worldUp * (i === 1 ? 1 : 0);
      this.v[i] += impulse * a * dt;
      this.v[i] -= this.v[i] * damp;
      if (Math.abs(this.v[i]) < 1e-6) this.v[i] = 0;
    }
    const move: V3 = [this.v[0] * dt * scale, this.v[1] * dt * scale, this.v[2] * dt * scale];
    const rdamp = Math.min(UE.ROT_DAMPING * dt, UE.DAMPING_CAP);
    this.rot[0] += imp.yaw * UE.ROT_ACCEL * dt;
    this.rot[1] += imp.pitch * UE.ROT_ACCEL * dt;
    this.rot[0] -= this.rot[0] * rdamp;
    this.rot[1] -= this.rot[1] * rdamp;
    if (Math.abs(this.rot[0]) < 1e-4) this.rot[0] = 0;
    if (Math.abs(this.rot[1]) < 1e-4) this.rot[1] = 0;
    let dfov = 0;
    if (imp.fov !== 0 || !recoil) {
      this.fovV += imp.fov * UE.FOV_ACCEL * dt;
      this.fovV -= this.fovV * Math.min(UE.FOV_DAMPING * dt, UE.DAMPING_CAP);
      if (Math.abs(this.fovV) < 1e-4) this.fovV = 0;
      dfov = this.fovV * dt;
    } else {
      // Let go, the lens springs back to the scene's own.
      this.fovV = 0;
      const d = FOV - fov;
      dfov = Math.abs(d) > 0.1 ? d * Math.min(1, dt * UE.FOV_RECOIL) : d;
    }
    return { move, yaw: this.rot[0] * dt, pitch: this.rot[1] * dt, fov: dfov };
  }

  stop(): void {
    this.v = [0, 0, 0];
    this.rot = [0, 0];
    this.fovV = 0;
  }
}

/** What a drag does, by the buttons held (and Alt or Ctrl for the orbit modes). */
export type DragMode = 'look' | 'moveTurn' | 'pan' | 'panWorld' | 'orbit' | 'orbitPan' | 'orbitDolly';

export function dragModeFor(buttons: number, orbit: boolean): DragMode | null {
  const L = (buttons & 1) !== 0;
  const R = (buttons & 2) !== 0;
  const M = (buttons & 4) !== 0;
  if (orbit) {
    if (R || (L && M)) return 'orbitDolly';
    if (M) return 'orbitPan';
    if (L) return 'orbit';
    return null;
  }
  if (L && R) return 'panWorld';
  if (M) return 'pan';
  if (R) return 'look';
  if (L) return 'moveTurn';
  return null;
}

/**
 * Apply a drag of dx, dyUp pixels (dyUp positive when the mouse moves up, as Unreal counts it) to the camera,
 * the Unreal way for the mode. Following someone, looking about orbits them instead of turning the eye.
 */
export function applyDrag(cam: Camera, h: number, mode: DragMode, dx: number, dyUp: number, prefs: NavPrefs, following = false): void {
  const s = prefs.mouseSensitivity;
  const P = flyPose(cam, h);
  const scale = prefs.cameraSpeed * UE.CM * distanceFactor(P.dist, prefs.distanceScaled);
  const ax = axesFor(P.yaw, P.pitch);
  const along = (out: V3, dir: V3, d: number) => {
    out[0] += dir[0] * d;
    out[1] += dir[1] * d;
    out[2] += dir[2] * d;
  };
  switch (mode) {
    case 'look': {
      const dp = -dyUp * s * (prefs.invertMouseY ? -1 : 1);
      if (following) orbitBy(cam, (dx * s * Math.PI) / 180, dp);
      else setFly(cam, h, P.eye, P.yaw + (dx * s * Math.PI) / 180, P.pitch + dp);
      return;
    }
    case 'moveTurn': {
      const eye: V3 = [...P.eye];
      along(eye, ax.hfwd, dyUp * scale);
      setFly(cam, h, eye, P.yaw + (dx * s * Math.PI) / 180, P.pitch);
      return;
    }
    case 'pan':
    case 'panWorld': {
      // Sideways, and straight up and down in the world, whatever the view's elevation (the engine's
      // ConvertMovementToDragRot): the middle button's pan, invertible, and both buttons' slide, the same.
      const eye: V3 = [...P.eye];
      const k = mode === 'pan' && prefs.invertMiddlePan ? -1 : 1;
      along(eye, ax.right, dx * scale * k);
      eye[1] += dyUp * scale * k;
      setFly(cam, h, eye, P.yaw, P.pitch);
      return;
    }
    case 'orbitPan': {
      // Maya's track: across the view, along the camera's own right and up, the look-at point carried along.
      const eye: V3 = [...P.eye];
      const k = prefs.invertMiddlePan ? -1 : 1;
      along(eye, ax.right, dx * scale * k);
      along(eye, ax.up, dyUp * scale * k);
      setFly(cam, h, eye, P.yaw, P.pitch);
      return;
    }
    case 'orbit':
      orbitBy(cam, (dx * s * Math.PI) / 180, -dyUp * s * (prefs.invertOrbitY ? -1 : 1));
      return;
    case 'orbitDolly': {
      // Toward what the camera looks at (never past it), dragging right or down; away, dragging left or up.
      const d = (prefs.invertDollyY ? dx + dyUp : dx - dyUp) * scale;
      dollyTo(cam, h, P.dist - Math.min(d, P.dist));
      return;
    }
  }
}

/** Set the distance to the look-at point (the eye stays on its ray), within the scene's zooms. */
function dollyTo(cam: Camera, h: number, dist: number): void {
  const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM_3D, zoomFor(Math.max(0.01, dist), h)));
  cam.zoom = cam.tzoom = z;
  cam.flight = null;
}

/**
 * The wheel's dolly: 32 cm × the scroll speed's table value a notch (96 cm at Unreal's default), toward what the
 * camera looks at. The eye stays on its ray to the look-at point and the elevation keeps following the scene's
 * own curve with the user's tilt on it (view3d.ts), so wheeling in from the handover swings the view down from
 * straight above to the street, and out again lifts it back to the map. The ground under the cursor (`toward`,
 * on the map) stays under it, as it does on the flat map: the look-at point closes the notch's share of the way
 * to it. The zoom eases (it is the target that moves), so quick notches read as one motion. Turned up above the
 * ground band there is no ground point to close on: the dolly is along the view, the elevation held.
 */
export function applyWheelDolly(cam: Camera, h: number, notches: number, prefs: NavPrefs, toward: { x: number; y: number } | null = null): void {
  const cm = UE.SCROLL_TABLE[Math.max(1, Math.min(8, Math.round(prefs.scrollSpeed))) - 1] * UE.SCROLL_CM;
  const P = flyPose(cam, h);
  if (P.pitch < PITCH_MIN) {
    const d = notches * cm * UE.CM * distanceFactor(P.dist, prefs.distanceScaled);
    const ax = axesFor(P.yaw, P.pitch);
    const eye: V3 = [P.eye[0] + ax.fwd[0] * d, P.eye[1] + ax.fwd[1] * d, P.eye[2] + ax.fwd[2] * d];
    // Coming closer than the scene's closest zoom, or through the ground, the eye stops.
    setFly(cam, h, eye, P.yaw, P.pitch);
    return;
  }
  // Measured from the zoom the camera is easing to, so notches in quick succession add up.
  const dist = distFor(cam.tzoom, h);
  const d = notches * cm * UE.CM * distanceFactor(dist, prefs.distanceScaled);
  const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM_3D, zoomFor(Math.max(0.01, dist - d), h)));
  if (toward && Math.hypot(toward.x - cam.tx, toward.y - cam.ty) <= dist * 3) {
    const k = cam.tzoom / z;
    cam.tx = toward.x + (cam.tx - toward.x) * k;
    cam.ty = toward.y + (cam.ty - toward.y) * k;
  }
  cam.tzoom = z;
  cam.flight = null;
}

export interface ControlHooks {
  /** True while the 3D view carries the picture (the viewport is perspective; else the flat map). */
  in3d: () => boolean;
  /** The map point under a screen point (CSS px, in the viewport) in the 3D view; null above the horizon. */
  groundAt: (sx: number, sy: number) => { x: number; y: number } | null;
  /** True while the camera follows someone (looking about then orbits them). */
  following: () => boolean;
  /** A: select what is at the centre of the view. */
  pickCentre: () => void;
  /** B: back out (stop following, deselect). */
  back: () => void;
  /** X: follow the selected person, or stop. */
  follow: () => void;
  toggle3d: () => void;
  toggleRun: () => void;
  toggleLegend: () => void;
  /** Any movement input: stop following and cancel a flight. */
  took: () => void;
  say: (text: string) => void;
}

/** True while a drag in the 3D view holds the flight keys (the app's own key bindings stand aside then). */
export const navState = { flying: false };

const FLAT_MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract']);
const FLY_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyQ', 'KeyR', 'KeyF', 'KeyC', 'KeyZ']);
const FREE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Numpad8', 'Numpad2', 'Numpad4', 'Numpad6', 'Numpad9', 'Numpad7', 'NumpadAdd', 'NumpadSubtract', 'Numpad1', 'Numpad3', 'Home']);

interface Drag {
  mode: DragMode;
  buttons: number;
  orbit: boolean;
  /** The pointer's last position (CSS px) and where the press was. */
  x: number;
  y: number;
  x0: number;
  y0: number;
  /** How far the pointer has travelled since the press (px), and whether that has made it a drag. */
  travel: number;
  moved: boolean;
  locked: boolean;
  /** The first movement after the pointer lock is a jump on some browsers: skip it. */
  skip: boolean;
}

export class Controls {
  private keys = new Set<string>();
  private tapped = new Set<string>();
  private mods = { shift: false, ctrl: false, alt: false, meta: false };
  private prev: boolean[] = [];
  private pad: string | null = null;
  private drag: Drag | null = null;
  /** Mouse travel since the last frame (px; dy up), applied with the frame. */
  private acc = { dx: 0, dy: 0 };
  private wheelAcc = 0;
  private flight = new Flight();
  private moveMult = 1;
  private turnMult = 1;
  private level = false;
  private el: HTMLElement | null = null;

  constructor(private hooks: ControlHooks) {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('gamepadconnected', this.onPad);
    window.addEventListener('gamepaddisconnected', this.onPadGone);
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onDown);
      window.removeEventListener('keyup', this.onUp);
      window.removeEventListener('blur', this.onBlur);
      window.removeEventListener('gamepadconnected', this.onPad);
      window.removeEventListener('gamepaddisconnected', this.onPadGone);
      document.removeEventListener('pointerlockchange', this.onLockChange);
    }
    this.endDrag();
  }

  /** True while a mouse button drags the 3D view (Unreal's "flight camera input mode"). */
  get dragging(): boolean {
    return !!this.drag;
  }

  // ── The mouse ──

  /**
   * A button pressed over the 3D view: the drag it begins. Returns false on the flat map (the map's own drag
   * applies). The left button alone waits for a few pixels of travel before it is a drag, so a click still picks.
   */
  press(e: PointerEvent, el: HTMLElement): boolean {
    if (!this.hooks.in3d() || e.pointerType === 'touch') return false;
    const orbit = e.altKey || e.ctrlKey;
    const mode = dragModeFor(e.buttons, orbit);
    if (!mode) return false;
    this.el = el;
    this.endDrag(false);
    this.drag = { mode, buttons: e.buttons, orbit, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, travel: 0, moved: false, locked: false, skip: false };
    this.acc.dx = this.acc.dy = 0;
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch {
      /* a pointer the browser does not know (a synthetic event): the drag still works within the window */
    }
    // Unreal hides the cursor at once when a look or a pan begins, and after a few pixels for a left drag.
    if (mode !== 'moveTurn' && mode !== 'orbit') this.lock();
    return true;
  }

  /**
   * The pointer moved with a button down: gathered for the frame. With the pointer locked (the cursor hidden)
   * the browser freezes the event's position and reports only the movement, so the travel that makes a press a
   * drag is counted from the deltas, never from where the pointer says it is.
   */
  move(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    // The buttons may have changed mid-drag (a second button pressed): Unreal re-reads them every tick.
    if (e.buttons !== d.buttons && e.buttons !== 0) {
      const mode = dragModeFor(e.buttons, d.orbit);
      if (mode) {
        d.mode = mode;
        d.buttons = e.buttons;
      }
    }
    let dx: number;
    let dy: number;
    if (d.locked) {
      if (d.skip) {
        d.skip = false;
        d.x = e.clientX;
        d.y = e.clientY;
        return;
      }
      dx = e.movementX;
      dy = e.movementY;
    } else {
      dx = e.clientX - d.x;
      dy = e.clientY - d.y;
    }
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.moved) {
      d.travel += Math.hypot(dx, dy);
      if (d.travel < UE.DRAG_PX) return;
      d.moved = true;
      this.hooks.took();
      if (!d.locked) this.lock();
    }
    this.acc.dx += dx;
    this.acc.dy -= dy;
  }

  /** The button released: true when the press was a click (no drag), so the map may pick what is under it. */
  release(e: PointerEvent): boolean {
    const d = this.drag;
    if (!d) return false;
    if (e.buttons !== 0) {
      // One of two buttons let go: the drag goes on in the other's mode.
      const mode = dragModeFor(e.buttons, d.orbit);
      if (mode) {
        d.mode = mode;
        d.buttons = e.buttons;
        return false;
      }
    }
    const click = !d.moved;
    this.endDrag();
    return click;
  }

  /**
   * The wheel over the 3D view: dolly toward the ground under the cursor, or (with a button held) the camera
   * speed. False on the flat map.
   */
  wheel(e: WheelEvent, el?: HTMLElement): boolean {
    if (!this.hooks.in3d()) return false;
    const n = wheelNotches(e.deltaY, e.deltaMode);
    if (this.drag && !this.mods.ctrl && !this.mods.shift && !this.mods.alt) {
      this.wheelAcc += n;
      while (Math.abs(this.wheelAcc) >= 1) {
        const dir = this.wheelAcc > 0 ? -1 : 1;
        this.wheelAcc -= Math.sign(this.wheelAcc);
        setNavPref('cameraSpeed', speedAfterNotch(navPrefs.cameraSpeed, dir));
      }
      this.hooks.say(`Camera speed ×${fmtSpeed(navPrefs.cameraSpeed)}`);
      return true;
    }
    // Scrolling up (deltaY negative) comes closer.
    this.wheelAcc = 0;
    this.pendingDolly -= n;
    if (el) {
      const r = el.getBoundingClientRect();
      this.dollyAt = this.hooks.groundAt(e.clientX - r.left, e.clientY - r.top);
    } else this.dollyAt = null;
    this.hooks.took();
    return true;
  }
  private pendingDolly = 0;
  /** The ground under the cursor at the last wheel notch, kept under it as the dolly applies. */
  private dollyAt: { x: number; y: number } | null = null;

  private lock(): void {
    const d = this.drag;
    const el = this.el;
    if (!d || !el || d.locked) return;
    try {
      const fn = el.requestPointerLock as ((o?: { unadjustedMovement: boolean }) => Promise<void> | void) | undefined;
      if (!fn) return;
      let r: Promise<void> | void;
      try {
        r = fn.call(el, { unadjustedMovement: true });
      } catch {
        r = fn.call(el);
      }
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
    } catch {
      /* no pointer lock: the deltas come from the pointer's position instead */
    }
  }

  private onLockChange = (): void => {
    this.lockChanged(!!document.pointerLockElement && document.pointerLockElement === this.el);
  };

  /** The pointer lock engaged (the cursor hidden, the deltas now the browser's movement) or ended. */
  lockChanged(locked: boolean): void {
    const d = this.drag;
    if (d) {
      d.locked = locked;
      if (locked) d.skip = true;
    }
  }

  private endDrag(unlock = true): void {
    this.drag = null;
    this.wheelAcc = 0;
    if (unlock && typeof document !== 'undefined' && document.pointerLockElement && document.pointerLockElement === this.el) {
      try {
        document.exitPointerLock();
      } catch {
        /* nothing to do */
      }
    }
  }

  // ── The keyboard ──

  private typing(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t?.isContentEditable;
  }

  private setMods(e: KeyboardEvent): void {
    this.mods.shift = e.shiftKey;
    this.mods.ctrl = e.ctrlKey;
    this.mods.alt = e.altKey;
    this.mods.meta = e.metaKey;
  }

  private onDown = (e: KeyboardEvent): void => {
    this.setMods(e);
    if (this.typing(e)) return;
    // Alt on its own would hand the browser's menu the focus (Chrome, Windows): here it is the orbit key.
    if (e.key === 'Alt' && this.hooks.in3d()) e.preventDefault();
    const code = e.code;
    if (!FLAT_MOVE.has(code) && !FLY_KEYS.has(code) && !FREE_KEYS.has(code)) return;
    if (code === 'Home') {
      if (!e.ctrlKey && !e.altKey && !e.metaKey) this.level = true;
      return;
    }
    this.keys.add(code);
    this.tapped.add(code);
    if (code.startsWith('Arrow') || code.startsWith('Page')) e.preventDefault();
  };

  private onUp = (e: KeyboardEvent): void => {
    this.setMods(e);
    if (e.key === 'Alt' && this.hooks.in3d() && !this.typing(e)) e.preventDefault();
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.tapped.clear();
    this.mods = { shift: false, ctrl: false, alt: false, meta: false };
    this.endDrag();
  };

  // ── The controller ──

  private onPad = (e: GamepadEvent): void => {
    this.pad = e.gamepad.id;
    this.hooks.say('Controller connected: left stick moves, right stick looks, triggers go down and up, bumpers zoom the lens, A picks, Start plays.');
  };

  private onPadGone = (e: GamepadEvent): void => {
    if (this.pad === e.gamepad.id) this.pad = null;
    this.hooks.say('Controller disconnected.');
  };

  /** True when the flight keys (W A S D, E Q, R F, C Z) fly right now. */
  private flightKeysLive(in3d: boolean): boolean {
    if (!in3d || navPrefs.flight === 'never') return false;
    const unmodified = !this.mods.shift && !this.mods.ctrl && !this.mods.alt && !this.mods.meta;
    if (!unmodified) return false;
    return navPrefs.flight === 'always' || (!!this.drag && !this.drag.orbit);
  }

  /** Apply this frame's input to the camera. */
  frame(cam: Camera, viewportH: number, dt: number): void {
    const k = this.keys;
    const tap = this.tapped;
    const has = (...codes: string[]) => codes.some((c) => k.has(c) || tap.has(c));
    const in3d = this.hooks.in3d();
    const unmodified = !this.mods.shift && !this.mods.ctrl && !this.mods.alt && !this.mods.meta;
    const flying = this.flightKeysLive(in3d);
    navState.flying = !!this.drag || flying;
    if (this.level) {
      this.level = false;
      cam.yaw = 0;
      cam.tilt = 0;
      cam.fov = FOV;
      this.flight.stop();
    }
    // ── The flat map: an orthographic viewport ──
    if (!in3d) {
      this.flight.stop();
      let fwd = (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0);
      let right = (has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0);
      let zoom = (has('Equal', 'NumpadAdd') ? 1 : 0) - (has('Minus', 'NumpadSubtract') ? 1 : 0);
      tap.clear();
      if (!unmodified) fwd = right = zoom = 0;
      const gp = this.gamepad();
      if (gp) {
        right += stickAxis(gp.axes[0]) + (gp.b(15) ? 1 : 0) - (gp.b(14) ? 1 : 0);
        fwd += -stickAxis(gp.axes[1]) + (gp.b(12) ? 1 : 0) - (gp.b(13) ? 1 : 0);
        zoom += Math.max(0, gp.v(7) - 0.05) - Math.max(0, gp.v(6) - 0.05);
        this.padButtons(gp, cam);
      }
      const len = Math.hypot(fwd, right);
      if (len > 1) {
        fwd /= len;
        right /= len;
      }
      if (fwd !== 0 || right !== 0 || zoom !== 0) this.hooks.took();
      if (fwd !== 0 || right !== 0) {
        // A little under a screen-height a second, whatever the zoom; north up.
        const speed = (viewportH / cam.zoom) * 0.85;
        cam.x += right * speed * dt;
        cam.y += -fwd * speed * dt;
        cam.tx = cam.x;
        cam.ty = cam.y;
      }
      if (zoom !== 0) {
        cam.tzoom = Math.max(MIN_ZOOM, Math.min(getMaxZoom(), cam.tzoom * Math.exp(zoom * dt * 1.1)));
        cam.zoom = cam.tzoom;
      }
      this.acc.dx = this.acc.dy = 0;
      this.pendingDolly = 0;
      return;
    }
    // ── The 3D view: a perspective viewport ──
    const following = this.hooks.following();
    // The mouse, as gathered since the last frame.
    const d = this.drag;
    if (d && (this.acc.dx !== 0 || this.acc.dy !== 0)) {
      applyDrag(cam, viewportH, d.mode, this.acc.dx, this.acc.dy, navPrefs, following);
      if (d.mode !== 'look') this.hooks.took();
    }
    this.acc.dx = this.acc.dy = 0;
    if (this.pendingDolly !== 0) {
      applyWheelDolly(cam, viewportH, this.pendingDolly, navPrefs, this.dollyAt);
      this.pendingDolly = 0;
      this.dollyAt = null;
    }
    // The keys and the controller: impulses for the flight.
    const imp = { fwd: 0, right: 0, localUp: 0, worldUp: 0, yaw: 0, pitch: 0, fov: 0 };
    if (flying) {
      imp.fwd += (has('KeyW') ? 1 : 0) - (has('KeyS') ? 1 : 0);
      imp.right += (has('KeyD') ? 1 : 0) - (has('KeyA') ? 1 : 0);
      imp.worldUp += (has('KeyE') ? 1 : 0) - (has('KeyQ') ? 1 : 0);
      imp.localUp += (has('KeyR') ? 1 : 0) - (has('KeyF') ? 1 : 0);
      // Z widens the lens (zooms out), C narrows it.
      imp.fov += (has('KeyZ') ? 1 : 0) - (has('KeyC') ? 1 : 0);
    }
    if (unmodified) {
      imp.fwd += (has('ArrowUp', 'Numpad8') ? 1 : 0) - (has('ArrowDown', 'Numpad2') ? 1 : 0);
      imp.right += (has('ArrowRight', 'Numpad6') ? 1 : 0) - (has('ArrowLeft', 'Numpad4') ? 1 : 0);
      imp.worldUp += (has('PageUp', 'Numpad9', 'NumpadAdd') ? 1 : 0) - (has('PageDown', 'Numpad7', 'NumpadSubtract') ? 1 : 0);
      imp.fov += (has('Numpad1') ? 1 : 0) - (has('Numpad3') ? 1 : 0);
    }
    tap.clear();
    const gp = this.gamepad();
    if (gp) {
      // The editor's joystick controls: sticks, triggers and bumpers, the d-pad for the multipliers.
      imp.right += stickAxis(gp.axes[0]) * this.moveMult;
      imp.fwd += -stickAxis(gp.axes[1]) * this.moveMult;
      imp.yaw += stickAxis(gp.axes[2]) * this.turnMult;
      // Stick up looks down, as Unreal's editor has it (the setting flips it).
      imp.pitch += -stickAxis(gp.axes[3]) * this.turnMult * (navPrefs.invertStickY ? -1 : 1);
      imp.worldUp += Math.max(0, gp.v(7) - 0.05) - Math.max(0, gp.v(6) - 0.05);
      // The left bumper widens the lens, the right narrows it.
      imp.fov += (gp.b(4) ? 1 : 0) - (gp.b(5) ? 1 : 0);
      this.padButtons(gp, cam);
    }
    const moving = imp.fwd !== 0 || imp.right !== 0 || imp.localUp !== 0 || imp.worldUp !== 0;
    if (moving || imp.yaw !== 0) this.hooks.took();
    const P = flyPose(cam, viewportH);
    const axes = axesFor(P.yaw, P.pitch);
    const scale = distanceFactor(P.dist);
    const step = this.flight.step(dt, imp, axes, navPrefs.cameraSpeed, scale, cam.fov ?? FOV, !this.drag);
    const stillMoving = step.move[0] !== 0 || step.move[1] !== 0 || step.move[2] !== 0;
    if (stillMoving || step.yaw !== 0 || step.pitch !== 0) {
      const eye: V3 = [P.eye[0] + step.move[0], P.eye[1] + step.move[1], P.eye[2] + step.move[2]];
      // The stick's pitch goes up as Unreal's does (the elevation down).
      const pitch = Math.max(PITCH_UP, Math.min(90, P.pitch - step.pitch));
      if (following && !stillMoving) orbitBy(cam, (step.yaw * Math.PI) / 180, -step.pitch);
      else setFly(cam, viewportH, eye, P.yaw + (step.yaw * Math.PI) / 180, pitch);
    }
    if (step.fov !== 0) cam.fov = Math.max(FOV_MIN, Math.min(FOV_MAX, (cam.fov ?? FOV) + step.fov));
  }

  /** The first connected controller, with helpers. */
  private gamepad(): { axes: readonly number[]; b: (i: number) => boolean; v: (i: number) => number; raw: Gamepad } | null {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(pads ?? []).find((p): p is Gamepad => !!p && p.connected);
    if (!gp) return null;
    return { axes: gp.axes, b: (i) => !!gp.buttons[i]?.pressed, v: (i) => gp.buttons[i]?.value ?? 0, raw: gp };
  }

  /** The buttons that act once per press: the app's own on the face buttons, the multipliers on the d-pad (3D). */
  private padButtons(gp: { b: (i: number) => boolean; raw: Gamepad }, cam: Camera): void {
    const edge = (i: number) => gp.b(i) && !this.prev[i];
    if (edge(0)) this.hooks.pickCentre();
    if (edge(1)) this.hooks.back();
    if (edge(2)) this.hooks.follow();
    if (edge(3)) this.hooks.toggle3d();
    if (edge(8)) this.hooks.toggleLegend();
    if (edge(9)) this.hooks.toggleRun();
    if (edge(10) || edge(11)) {
      cam.yaw = 0;
      cam.tilt = 0;
      cam.fov = FOV;
    }
    if (this.hooks.in3d()) {
      if (edge(12) || edge(13)) {
        this.moveMult = Math.max(UE.MOVE_MULT[0], Math.min(UE.MOVE_MULT[1], this.moveMult + (edge(12) ? UE.MULT_STEP : -UE.MULT_STEP)));
        this.hooks.say(`Controller move ×${this.moveMult.toFixed(2)}`);
      }
      if (edge(14) || edge(15)) {
        this.turnMult = Math.max(UE.TURN_MULT[0], Math.min(UE.TURN_MULT[1], this.turnMult + (edge(15) ? UE.MULT_STEP : -UE.MULT_STEP)));
        this.hooks.say(`Controller turn ×${this.turnMult.toFixed(2)}`);
      }
    }
    this.prev = gp.raw.buttons.map((x) => x.pressed);
  }
}

/** A camera speed for the eye: three figures at most. */
export function fmtSpeed(s: number): string {
  if (s >= 100) return s.toFixed(0);
  if (s >= 10) return s.toFixed(1);
  return s.toFixed(2);
}

export { effectiveYaw, wrapAngle };
