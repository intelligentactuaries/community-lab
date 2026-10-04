// Getting about the 3D view the way Unreal Engine's editor viewport does: its
// numbers, its button-by-button drags, its flight (acceleration and damping),
// its lens keys, and the joystick's dead zone.
import { describe, expect, test } from 'bun:test';
import { Controls, Flight, NAV_DEFAULTS, UE, applyDrag, applyWheelDolly, axesFor, distanceFactor, dragModeFor, speedAfterNotch, stickAxis, wheelNotches, type ControlHooks, type NavPrefs } from '../src/client/lib/controls';
import { FOV, FOV_MAX, MAX_ZOOM_3D, distFor, flyPose, pitchFor, setFly } from '../src/client/render3d/view3d';

const H = 900;
const cam = (zoom: number, yaw = 0, tilt = 0) => ({ x: 400, y: 300, zoom, tx: 400, ty: 300, tzoom: zoom, yaw, tilt });
/** Unreal's settings, without the distance scaling (so a pixel is a centimetre). */
const plain: NavPrefs = { ...NAV_DEFAULTS, distanceScaled: false };

describe('Unreal’s numbers', () => {
  test('the defaults are the engine’s: 0.2° a pixel, speed 1, scroll speed 5 (96 cm a notch), WASD with a button held', () => {
    expect(NAV_DEFAULTS.mouseSensitivity).toBe(0.2);
    expect(NAV_DEFAULTS.cameraSpeed).toBe(1);
    expect(NAV_DEFAULTS.scrollSpeed).toBe(5);
    expect(NAV_DEFAULTS.flight).toBe('rmb');
    expect(UE.SCROLL_TABLE[NAV_DEFAULTS.scrollSpeed - 1] * UE.SCROLL_CM).toBe(96);
    expect(UE.MOVE_ACCEL).toBe(20000);
    expect(UE.MOVE_DAMPING).toBe(10);
    expect(UE.DEAD_ZONE).toBe(0.2);
  });

  test('a wheel notch with a button held steps the speed by a tenth, within the engine’s range', () => {
    expect(speedAfterNotch(1, 1)).toBeCloseTo(1.1, 9);
    expect(speedAfterNotch(1, -1)).toBeCloseTo(0.9, 9);
    expect(speedAfterNotch(UE.SPEED_MAX, 1)).toBe(UE.SPEED_MAX);
    expect(speedAfterNotch(UE.SPEED_MIN, -1)).toBe(UE.SPEED_MIN);
  });

  test('a mouse notch is one notch on Windows and on Linux; a trackpad’s steps add up', () => {
    expect(wheelNotches(100)).toBe(1);
    expect(wheelNotches(53)).toBe(1);
    expect(wheelNotches(-120)).toBe(-1);
    expect(wheelNotches(10)).toBeCloseTo(0.1, 9);
    expect(wheelNotches(3, 1)).toBe(1);
    expect(wheelNotches(1, 2)).toBe(1);
  });

  test('the stick’s dead zone, rescaled so a full push still reaches one', () => {
    expect(stickAxis(0.1)).toBe(0);
    expect(stickAxis(-0.2)).toBe(0);
    expect(stickAxis(0.6)).toBeCloseTo(0.5, 9);
    expect(stickAxis(1)).toBe(1);
    expect(stickAxis(-1)).toBe(-1);
    expect(stickAxis(undefined)).toBe(0);
  });

  test('the buttons pick the drag: right looks, left moves and turns, middle pans, both slide; Alt orbits, dollies, pans', () => {
    expect(dragModeFor(2, false)).toBe('look');
    expect(dragModeFor(1, false)).toBe('moveTurn');
    expect(dragModeFor(4, false)).toBe('pan');
    expect(dragModeFor(3, false)).toBe('panWorld');
    expect(dragModeFor(0, false)).toBeNull();
    expect(dragModeFor(1, true)).toBe('orbit');
    expect(dragModeFor(2, true)).toBe('orbitDolly');
    expect(dragModeFor(5, true)).toBe('orbitDolly');
    expect(dragModeFor(4, true)).toBe('orbitPan');
  });

  test('distance-scaled speed: a hundredth of the distance in metres, capped', () => {
    expect(distanceFactor(10, true)).toBeCloseTo(1, 9);
    expect(distanceFactor(2.5, true)).toBeCloseTo(0.25, 9);
    expect(distanceFactor(1e6, true)).toBe(UE.DISTANCE_MAX);
    expect(distanceFactor(500, false)).toBe(1);
  });
});

describe('the camera’s axes', () => {
  test('looking north and straight down: forward is down, up on screen is north, right is east', () => {
    const a = axesFor(0, 90);
    expect(a.fwd[1]).toBeCloseTo(-1, 9);
    expect(a.up[2]).toBeCloseTo(-1, 9);
    expect(a.right[0]).toBeCloseTo(1, 9);
    expect(a.hfwd[2]).toBeCloseTo(-1, 9);
  });
  test('looking east along the horizon: forward is east, up is up', () => {
    const a = axesFor(Math.PI / 2, 0);
    expect(a.fwd[0]).toBeCloseTo(1, 9);
    expect(a.fwd[1]).toBeCloseTo(0, 9);
    expect(a.up[1]).toBeCloseTo(1, 9);
    expect(a.right[2]).toBeCloseTo(1, 9);
  });
});

describe('the drags, Unreal’s way (a pixel a centimetre at speed 1)', () => {
  test('the right button looks about: the heading turns 0.2° a pixel and the eye stays put', () => {
    const c = cam(100, 0.3, 0);
    const before = flyPose(c, H);
    applyDrag(c, H, 'look', 100, 0, plain);
    const after = flyPose(c, H);
    expect(after.yaw - before.yaw).toBeCloseTo((20 * Math.PI) / 180, 5);
    for (let i = 0; i < 3; i++) expect(after.eye[i]).toBeCloseTo(before.eye[i], 3);
    expect(after.pitch).toBeCloseTo(before.pitch, 5);
  });

  test('the mouse up looks up (the elevation drops 0.2° a pixel); inverted, down', () => {
    const c = cam(100, 0, 0);
    const p0 = flyPose(c, H).pitch;
    applyDrag(c, H, 'look', 0, 50, plain);
    expect(flyPose(c, H).pitch).toBeCloseTo(p0 - 10, 5);
    const d = cam(100, 0, 0);
    applyDrag(d, H, 'look', 0, 50, { ...plain, invertMouseY: true });
    expect(flyPose(d, H).pitch).toBeCloseTo(p0 + 10, 5);
  });

  test('the left button moves along the ground (a metre for a hundred pixels) and turns', () => {
    const c = cam(100, 0, 0);
    const before = flyPose(c, H);
    applyDrag(c, H, 'moveTurn', 0, 100, plain);
    const after = flyPose(c, H);
    // Looking north: a metre north (−z), no climb.
    expect(after.eye[2] - before.eye[2]).toBeCloseTo(-1, 3);
    expect(after.eye[1]).toBeCloseTo(before.eye[1], 3);
    expect(after.pitch).toBeCloseTo(before.pitch, 5);
    expect(c.x).toBeCloseTo(400, 3);
    expect(c.y).toBeCloseTo(299, 3);
    applyDrag(c, H, 'moveTurn', 50, 0, plain);
    expect(flyPose(c, H).yaw - after.yaw).toBeCloseTo((10 * Math.PI) / 180, 5);
  });

  test('the middle button, and left and right together, slide sideways and straight up in the world; Alt and the middle track across the view', () => {
    const c = cam(100, 0, 0);
    const before = flyPose(c, H);
    applyDrag(c, H, 'pan', 100, 0, plain);
    let after = flyPose(c, H);
    expect(after.eye[0] - before.eye[0]).toBeCloseTo(1, 3);
    expect(after.eye[1]).toBeCloseTo(before.eye[1], 3);
    // The mouse up: the camera straight up, whatever the view's elevation.
    applyDrag(c, H, 'pan', 0, 100, plain);
    const after2 = flyPose(c, H);
    expect(after2.eye[1] - after.eye[1]).toBeCloseTo(1, 3);
    expect(after2.eye[0]).toBeCloseTo(after.eye[0], 3);
    expect(after2.eye[2]).toBeCloseTo(after.eye[2], 3);
    expect(after2.pitch).toBeCloseTo(after.pitch, 5);
    applyDrag(c, H, 'panWorld', 0, 100, plain);
    after = flyPose(c, H);
    expect(after.eye[1] - after2.eye[1]).toBeCloseTo(1, 3);
    expect(after.eye[0]).toBeCloseTo(after2.eye[0], 3);
    expect(after.eye[2]).toBeCloseTo(after2.eye[2], 3);
    // Inverted, the middle button's pan goes the other way; both buttons' slide does not.
    const inv: NavPrefs = { ...plain, invertMiddlePan: true };
    applyDrag(c, H, 'pan', 0, 100, inv);
    expect(flyPose(c, H).eye[1] - after.eye[1]).toBeCloseTo(-1, 3);
    applyDrag(c, H, 'panWorld', 0, 100, inv);
    expect(flyPose(c, H).eye[1] - after.eye[1]).toBeCloseTo(0, 3);
    // Alt and the middle button: across the view, the camera's own up.
    const o = cam(100, 0, 0);
    const b0 = flyPose(o, H);
    const up = axesFor(0, b0.pitch).up;
    applyDrag(o, H, 'orbitPan', 0, 100, plain);
    const a0 = flyPose(o, H);
    for (let i = 0; i < 3; i++) expect(a0.eye[i] - b0.eye[i]).toBeCloseTo(up[i], 3);
  });

  test('Alt and the right button dolly toward the look-at point, never past it; Alt and the left orbit it', () => {
    const c = cam(100, 0.4, 0);
    const d0 = flyPose(c, H).dist;
    applyDrag(c, H, 'orbitDolly', 100, 0, plain);
    expect(flyPose(c, H).dist).toBeCloseTo(d0 - 1, 3);
    expect(c.x).toBe(400);
    expect(c.y).toBe(300);
    applyDrag(c, H, 'orbitDolly', 1e6, 0, plain);
    expect(c.zoom).toBe(MAX_ZOOM_3D);
    const o = cam(100, 0, 0);
    const e0 = flyPose(o, H).eye;
    applyDrag(o, H, 'orbit', 100, 0, plain);
    expect(o.yaw).toBeCloseTo((20 * Math.PI) / 180, 6);
    expect(o.x).toBe(400);
    // The eye swung round the look-at point.
    expect(flyPose(o, H).eye[0]).not.toBeCloseTo(e0[0], 1);
  });

  test('with the distance scaling on, a drag grows with the distance to what the camera looks at', () => {
    const c = cam(100, 0, 0);
    const before = flyPose(c, H);
    applyDrag(c, H, 'pan', 100, 0, NAV_DEFAULTS);
    expect(flyPose(c, H).eye[0] - before.eye[0]).toBeCloseTo(distanceFactor(before.dist, true), 3);
  });

  test('following someone, looking about orbits them', () => {
    const c = cam(100, 0, 0);
    applyDrag(c, H, 'look', 100, 0, plain, true);
    expect(c.x).toBe(400);
    expect(c.y).toBe(300);
    expect(c.yaw).toBeCloseTo((20 * Math.PI) / 180, 6);
  });

  test('the wheel dollies 96 cm a notch toward the look-at point, the ground under the cursor kept under it', () => {
    const c = cam(100, 0.2, 0);
    const before = flyPose(c, H);
    applyWheelDolly(c, H, 1, plain);
    // It is the zoom's target that moves (the camera eases to it): a notch closer, the tilt and the map point as they were.
    expect(c.zoom).toBe(100);
    expect(distFor(c.tzoom, H)).toBeCloseTo(before.dist - 0.96, 3);
    expect(c.x).toBe(400);
    expect(c.y).toBe(300);
    expect(c.tilt).toBe(0);
    // Toward the ground under the cursor (ten metres east, in view): the look-at point closes the notch's share of the way to it...
    const g = { x: 410, y: 300 };
    const z0 = c.tzoom;
    applyWheelDolly(c, H, 1, plain, g);
    expect(c.tx).toBeCloseTo(410 + (400 - 410) * (z0 / c.tzoom), 6);
    expect(c.tx).toBeGreaterThan(400);
    expect(c.ty).toBe(300);
    // ...and scrolling the other way backs out again, away from it.
    applyWheelDolly(c, H, -2, plain, g);
    expect(distFor(c.tzoom, H)).toBeCloseTo(before.dist, 3);
    expect(c.tx).toBeLessThan(400);
    // A point off near the horizon is not chased.
    const far = cam(100, 0, 0);
    applyWheelDolly(far, H, 1, plain, { x: 400 + before.dist * 5, y: 300 });
    expect(far.tx).toBe(400);
  });

  test('coming in from the handover, the wheel swings the view down from straight above to the street', () => {
    const c = cam(7, 0, 0);
    expect(flyPose(c, H).pitch).toBe(90);
    let last = 90;
    for (let i = 0; i < 12; i++) {
      applyWheelDolly(c, H, 1, NAV_DEFAULTS);
      c.zoom = c.tzoom;
      const pitch = flyPose(c, H).pitch;
      expect(pitch).toBeLessThanOrEqual(last);
      last = pitch;
    }
    expect(c.zoom).toBeGreaterThan(14);
    expect(last).toBeLessThan(15);
    // Back out, and it lifts to straight above again for the map (a notch out is a little longer than one in:
    // the distance-scaled step grows as the distance does, so it takes a notch or two more).
    for (let i = 0; i < 30 && c.zoom > 7; i++) {
      applyWheelDolly(c, H, -1, NAV_DEFAULTS);
      c.zoom = c.tzoom;
      expect(flyPose(c, H).pitch).toBeGreaterThanOrEqual(last);
      last = flyPose(c, H).pitch;
    }
    expect(c.zoom).toBeLessThanOrEqual(7);
    expect(flyPose(c, H).pitch).toBe(90);
  });

  test('turned up to the sky there is no ground to close on: the wheel dollies along the view, the elevation held', () => {
    const s = cam(100, 0, 0);
    setFly(s, H, flyPose(s, H).eye, 0, -30);
    const e0 = flyPose(s, H).eye;
    applyWheelDolly(s, H, 1, plain);
    const e1 = flyPose(s, H).eye;
    const f = axesFor(0, -30).fwd;
    for (let i = 0; i < 3; i++) expect(e1[i] - e0[i]).toBeCloseTo(0.96 * f[i], 3);
    expect(flyPose(s, H).pitch).toBeCloseTo(-30, 4);
  });
});

describe('the mouse on the viewport (the Controls class)', () => {
  const hooks = (): ControlHooks => ({ in3d: () => true, groundAt: () => ({ x: 405, y: 300 }), following: () => false, pickCentre: () => undefined, back: () => undefined, follow: () => undefined, toggle3d: () => undefined, toggleRun: () => undefined, toggleLegend: () => undefined, took: () => undefined, say: () => undefined });
  /** A viewport with no pointer capture and no pointer lock of its own, at the window's corner. */
  const el = { getBoundingClientRect: () => ({ left: 0, top: 0 }) } as unknown as HTMLElement;
  const ev = (o: Partial<PointerEvent>): PointerEvent => ({ pointerType: 'mouse', altKey: false, ctrlKey: false, pointerId: 1, movementX: 0, movementY: 0, buttons: 0, button: 0, ...o }) as PointerEvent;

  test('with the pointer locked the browser freezes the position: the look still turns from the movement it reports', () => {
    const c = new Controls(hooks());
    const camera = cam(100, 0, 0);
    expect(c.press(ev({ buttons: 2, clientX: 300, clientY: 200 }), el)).toBe(true);
    // The lock engages before the mouse has moved: every event's position is the press's from now on.
    c.lockChanged(true);
    c.move(ev({ buttons: 2, clientX: 300, clientY: 200, movementX: 1 }));
    for (let i = 0; i < 10; i++) c.move(ev({ buttons: 2, clientX: 300, clientY: 200, movementX: 10 }));
    c.frame(camera, H, 1 / 60);
    // A hundred pixels: twenty degrees, Unreal's 0.2° a pixel (the first event after the lock is the jump, skipped).
    expect(flyPose(camera, H).yaw).toBeCloseTo((20 * Math.PI) / 180, 5);
    expect(c.release(ev({ buttons: 0, button: 2, clientX: 300, clientY: 200 }))).toBe(false);
    expect(c.dragging).toBe(false);
    c.dispose();
  });

  test('a press that hardly travels is a click, locked or not; four pixels make it a drag', () => {
    const c = new Controls(hooks());
    expect(c.press(ev({ buttons: 1, clientX: 10, clientY: 10 }), el)).toBe(true);
    c.lockChanged(true);
    c.move(ev({ buttons: 1, clientX: 10, clientY: 10, movementX: 1, movementY: 1 }));
    c.move(ev({ buttons: 1, clientX: 10, clientY: 10, movementX: 1, movementY: 1 }));
    expect(c.release(ev({ buttons: 0, button: 0, clientX: 10, clientY: 10 }))).toBe(true);
    expect(c.press(ev({ buttons: 1, clientX: 10, clientY: 10 }), el)).toBe(true);
    c.move(ev({ buttons: 1, clientX: 13, clientY: 10 }));
    c.move(ev({ buttons: 1, clientX: 15, clientY: 10 }));
    expect(c.release(ev({ buttons: 0, button: 0, clientX: 15, clientY: 10 }))).toBe(false);
    c.dispose();
  });

  test('the wheel over the viewport dollies toward the ground under the cursor; with a button held it sets the speed', () => {
    const c = new Controls(hooks());
    const camera = cam(100, 0, 0);
    expect(c.wheel({ deltaY: -100, deltaMode: 0, clientX: 600, clientY: 300 } as WheelEvent, el)).toBe(true);
    c.frame(camera, H, 1 / 60);
    expect(camera.tzoom).toBeGreaterThan(100);
    expect(camera.tx).toBeGreaterThan(400);
    expect(camera.ty).toBe(300);
    const speed = NAV_DEFAULTS.cameraSpeed;
    c.press(ev({ buttons: 2, clientX: 300, clientY: 200 }), el);
    c.wheel({ deltaY: -100, deltaMode: 0, clientX: 600, clientY: 300 } as WheelEvent, el);
    const z = camera.tzoom;
    c.frame(camera, H, 1 / 60);
    expect(camera.tzoom).toBe(z);
    c.release(ev({ buttons: 0, button: 2, clientX: 300, clientY: 200 }));
    c.dispose();
    const { navPrefs, setNavPref } = require('../src/client/lib/controls') as typeof import('../src/client/lib/controls');
    expect(navPrefs.cameraSpeed).toBeCloseTo(speed * 1.1, 9);
    setNavPref('cameraSpeed', speed);
  });
});

describe('the flight (FEditorCameraController)', () => {
  const axes = axesFor(0, 0);
  const still = { fwd: 0, right: 0, localUp: 0, worldUp: 0, yaw: 0, pitch: 0, fov: 0 };

  test('holding forward reaches Unreal’s speed, 2000 cm/s less the frame’s damping, and stops within half a second', () => {
    const f = new Flight();
    const dt = 1 / 60;
    let moved = 0;
    for (let i = 0; i < 60; i++) moved += f.step(dt, { ...still, fwd: 1 }, axes, 1, 1, FOV, true).move[2];
    const v = Math.hypot(...f.v);
    expect(v).toBeGreaterThan(16.3);
    expect(v).toBeLessThan(17);
    // Looking north, the move is north.
    expect(moved).toBeLessThan(-14);
    for (let i = 0; i < 30; i++) f.step(dt, still, axes, 1, 1, FOV, true);
    expect(Math.hypot(...f.v)).toBeLessThan(0.2);
  });

  test('the speed and the distance factor scale the move', () => {
    const a = new Flight();
    const b = new Flight();
    let ma = 0;
    let mb = 0;
    for (let i = 0; i < 30; i++) {
      ma += a.step(1 / 60, { ...still, fwd: 1 }, axes, 1, 1, FOV, true).move[2];
      mb += b.step(1 / 60, { ...still, fwd: 1 }, axes, 2, 3, FOV, true).move[2];
    }
    expect(mb / ma).toBeCloseTo(6, 6);
  });

  test('Z widens the lens with weight, and it springs back to the scene’s own when let go', () => {
    const f = new Flight();
    let fov = FOV;
    for (let i = 0; i < 30; i++) fov = Math.min(FOV_MAX, fov + f.step(1 / 60, { ...still, fov: 1 }, axes, 1, 1, fov, false).fov);
    expect(fov).toBeGreaterThan(FOV + 10);
    for (let i = 0; i < 120; i++) fov += f.step(1 / 60, still, axes, 1, 1, fov, true).fov;
    expect(fov).toBeCloseTo(FOV, 1);
  });

  test('the stick turns with weight too: about a hundred degrees a second at full push', () => {
    const f = new Flight();
    let turned = 0;
    for (let i = 0; i < 120; i++) turned += f.step(1 / 60, { ...still, yaw: 1 }, axes, 1, 1, FOV, true).yaw;
    expect(turned).toBeGreaterThan(150);
    expect(turned).toBeLessThan(220);
  });
});

describe('the scene’s own elevation curve still holds under the flight', () => {
  test('a look-at point at the closest zoom sits at eye level', () => {
    expect(pitchFor(MAX_ZOOM_3D)).toBeLessThan(20);
  });
});
