// The 3D close-up view: the handover from the flat map, the camera's tilt, the
// sun's position, and the walls built from the room plans.
import { describe, expect, test } from 'bun:test';
import { sunPosition } from '../src/client/render3d/sun';
import { FADE_FROM, FADE_TO, FOV, MAX_ZOOM_3D, PITCH_CLOSE, PITCH_LOW, PITCH_MIN, PITCH_UP, SWOOP_TO, ZOOM_CLOSE, blend3d, flyPose, freeLook, liftFor, orbitBy, pitchFor, poseFor, setFly, viewPitch } from '../src/client/render3d/view3d';
import { wallLines, windowSpans } from '../src/client/render3d/walls';

const cam = (zoom: number) => ({ x: 400, y: 300, zoom, tx: 400, ty: 300, tzoom: zoom });

describe('handover from the flat map', () => {
  test('the scene fades in between the two zooms, and only there', () => {
    expect(blend3d(FADE_FROM - 0.5)).toBe(0);
    expect(blend3d(FADE_FROM)).toBe(0);
    expect(blend3d(FADE_TO)).toBe(1);
    expect(blend3d(FADE_TO + 20)).toBe(1);
    let last = 0;
    for (let z = FADE_FROM; z <= FADE_TO; z += 0.1) {
      const b = blend3d(z);
      expect(b).toBeGreaterThanOrEqual(last);
      last = b;
    }
  });

  test('at the handover the camera looks straight down, registered with the map', () => {
    const h = 900;
    for (const zoom of [FADE_FROM, 6, FADE_TO]) {
      const p = poseFor(cam(zoom), h);
      expect(p.pitch).toBe(90);
      // Straight above the look-at point...
      expect(p.eye[0]).toBeCloseTo(p.target[0], 6);
      expect(p.eye[2]).toBeCloseTo(p.target[2], 6);
      // ...at the distance where the ground at the centre has the map's scale (zoom px per metre).
      const visible = 2 * p.dist * Math.tan(((FOV / 2) * Math.PI) / 180);
      expect(h / visible).toBeCloseTo(zoom, 6);
      // North stays up on screen.
      expect(p.up[2]).toBeCloseTo(-1, 6);
    }
  });

  test('the moment the scene has the picture the camera swings down to the street, south of what it looks at', () => {
    expect(pitchFor(FADE_TO)).toBe(90);
    // The swing is done by the end of the next band, where the user's own heading and tilt have come in too...
    expect(pitchFor(SWOOP_TO)).toBeCloseTo(PITCH_LOW, 6);
    expect(freeLook(SWOOP_TO)).toBe(1);
    expect(pitchFor(9)).toBeLessThan(60);
    // ...to a view along the street rather than down at it: the horizon in the frame with the scene's own lens.
    expect(PITCH_LOW).toBeLessThan(FOV / 2);
    let last = 90;
    for (const zoom of [8, 9, 10, SWOOP_TO, 18, 40, 100, ZOOM_CLOSE]) {
      const pitch = pitchFor(zoom);
      expect(pitch).toBeLessThan(last);
      last = pitch;
      const p = poseFor(cam(zoom), 900);
      expect(p.eye[2]).toBeGreaterThan(p.target[2]);
      expect(p.eye[1]).toBeGreaterThan(p.target[1]);
    }
    // From there in it only comes nearer, settling to eye level.
    expect(pitchFor(MAX_ZOOM_3D)).toBe(PITCH_CLOSE);
    expect(PITCH_CLOSE).toBeGreaterThan(PITCH_MIN);
    expect(PITCH_CLOSE).toBeLessThan(PITCH_LOW);
  });
});

describe('the sun', () => {
  const LAT = -26.2; // the province, on the Highveld

  test('at the December solstice it stands almost overhead at noon', () => {
    const s = sunPosition(LAT, 355, 720);
    expect(s.elevation).toBeGreaterThan(85);
  });

  test('in June the noon sun is low and in the north (southern hemisphere)', () => {
    const s = sunPosition(LAT, 172, 720);
    expect(s.elevation).toBeGreaterThan(38);
    expect(s.elevation).toBeLessThan(43);
    expect(s.z).toBeLessThan(0); // north is -z
  });

  test('it rises in the east and sets in the west, and is down at midnight', () => {
    expect(sunPosition(LAT, 80, 8 * 60).x).toBeGreaterThan(0);
    expect(sunPosition(LAT, 80, 16 * 60).x).toBeLessThan(0);
    expect(sunPosition(LAT, 80, 0).elevation).toBeLessThan(-30);
  });
});

describe('walls from the room plans', () => {
  // Two rooms side by side (10 m and 6 m wide, 8 m deep), and a 16 m room across the back.
  const rooms = [
    { x: 0, y: 8, w: 10, h: 8 },
    { x: 10, y: 8, w: 6, h: 8 },
    { x: 0, y: 0, w: 16, h: 8 },
  ];
  const lines = wallLines(rooms);

  test('a wall shared by two rooms is one partition', () => {
    const shared = lines.filter((l) => !l.horiz && l.c === 10);
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ inner: true, a: 8, b: 16 });
    const across = lines.filter((l) => l.horiz && l.c === 8);
    expect(across).toHaveLength(1);
    expect(across[0]).toMatchObject({ inner: true, a: 0, b: 16 });
  });

  test('outside walls know the back (north) from the front (south)', () => {
    const back = lines.find((l) => l.horiz && l.c === 0)!;
    const front = lines.find((l) => l.horiz && l.c === 16)!;
    expect(back).toMatchObject({ inner: false, side: 1, a: 0, b: 16 });
    expect(front).toMatchObject({ inner: false, side: -1, a: 0, b: 16 });
    const sides = lines.filter((l) => !l.horiz && (l.c === 0 || l.c === 16));
    expect(sides.every((l) => !l.inner)).toBe(true);
    expect(sides.reduce((n, l) => n + (l.b - l.a), 0)).toBe(32);
  });

  test('windows keep clear of the corners and the doors', () => {
    const w = windowSpans(0, 16, [[7.2, 8.8]]);
    expect(w.length).toBeGreaterThan(1);
    for (const [s, e] of w) {
      expect(s).toBeGreaterThanOrEqual(1.4);
      expect(e).toBeLessThanOrEqual(15);
      expect(e <= 7.2 - 0.4 || s >= 8.8 + 0.4).toBe(true);
    }
  });
});

describe('flying about the scene (the Unreal way) on the map camera', () => {
  const H = 900;
  const flyCam = (zoom: number, yaw = 0, tilt = 0) => ({ x: 400, y: 300, zoom, tx: 400, ty: 300, tzoom: zoom, yaw, tilt });

  test('the flight a camera is, put back, is the same camera: eye, heading and elevation round-trip', () => {
    for (const [zoom, yaw, tilt] of [[40, 0.4, -10], [120, -2.1, 20], [ZOOM_CLOSE, 3.0, 0], [MAX_ZOOM_3D, 1.2, -5]] as const) {
      const cam = flyCam(zoom, yaw, tilt);
      const before = flyPose(cam, H);
      setFly(cam, H, before.eye, before.yaw, before.pitch);
      const after = flyPose(cam, H);
      for (let i = 0; i < 3; i++) expect(after.eye[i]).toBeCloseTo(before.eye[i], 3);
      expect(after.yaw).toBeCloseTo(before.yaw, 6);
      expect(after.pitch).toBeCloseTo(before.pitch, 4);
      expect(cam.zoom).toBeCloseTo(zoom, 3);
    }
  });

  test('moving the eye moves the map point it looks at, and the zoom follows the distance to the ground', () => {
    const cam = flyCam(60, 0.8, 0);
    const { eye, yaw, pitch } = flyPose(cam, H);
    // Ten metres east at the same height, looking the same way: the look-at point is ten metres east too.
    setFly(cam, H, [eye[0] + 10, eye[1], eye[2]], yaw, pitch);
    expect(cam.x).toBeCloseTo(410, 3);
    expect(cam.y).toBeCloseTo(300, 3);
    expect(cam.zoom).toBeCloseTo(60, 3);
    // Climbing doubles the distance to the ground, so the zoom halves (the same lens, further away).
    setFly(cam, H, [eye[0] + 10, 2 * eye[1] - liftFor(cam.zoom), eye[2]], yaw, pitch);
    expect(cam.zoom).toBeGreaterThan(29);
    expect(cam.zoom).toBeLessThan(31.5);
  });

  test('turned up toward the sky the eye stays put; the ground before it is still what the map camera is at', () => {
    const cam = flyCam(100, 0.3, 0);
    const { eye, yaw } = flyPose(cam, H);
    setFly(cam, H, eye, yaw, -30);
    const p = poseFor(cam, H);
    for (let i = 0; i < 3; i++) expect(p.eye[i]).toBeCloseTo(eye[i], 3);
    expect(p.pitch).toBeCloseTo(-30, 4);
    // The view looks up: its target is above the eye.
    expect(p.target[1]).toBeGreaterThan(p.eye[1]);
    // And the map point is where a look PITCH_MIN below the horizon would meet the ground.
    const level = flyCam(100, 0.3, 0);
    setFly(level, H, eye, yaw, PITCH_MIN);
    expect(cam.x).toBeCloseTo(level.x, 3);
    expect(cam.y).toBeCloseTo(level.y, 3);
  });

  test('the eye cannot sink through the ground: coming too close the zoom stops at the scene’s closest', () => {
    const cam = flyCam(300, 0, 0);
    const { yaw, pitch } = flyPose(cam, H);
    setFly(cam, H, [400, 0.2, 310], yaw, pitch);
    expect(cam.zoom).toBe(MAX_ZOOM_3D);
    expect(poseFor(cam, H).eye[1]).toBeGreaterThan(0.2);
  });

  test('past the end of the swoop the elevation holds at eye level, so the wheel only comes closer', () => {
    expect(pitchFor(ZOOM_CLOSE)).toBeCloseTo(pitchFor(MAX_ZOOM_3D), 6);
    expect(pitchFor(MAX_ZOOM_3D)).toBeLessThan(20);
    expect(poseFor(flyCam(MAX_ZOOM_3D), H).dist).toBeLessThan(poseFor(flyCam(ZOOM_CLOSE), H).dist);
  });

  test('orbiting turns about the look-at point within the elevations the scene allows', () => {
    const cam = flyCam(100, 0, 0);
    orbitBy(cam, 0.5, -200);
    expect(viewPitch(cam)).toBeCloseTo(PITCH_UP, 6);
    orbitBy(cam, 0, 400);
    expect(viewPitch(cam)).toBe(90);
    expect(cam.yaw).toBeCloseTo(0.5, 6);
    expect(cam.x).toBe(400);
    expect(cam.y).toBe(300);
    orbitBy(cam, Math.PI * 2 + 0.25, 0);
    expect(cam.yaw).toBeCloseTo(0.75, 6);
  });

  test('a lens set with the keys returns to the scene’s own at the handover', () => {
    const wide = { ...flyCam(100), fov: 90 };
    expect(poseFor(wide, H).fov).toBe(90);
    expect(poseFor({ ...wide, zoom: FADE_TO }, H).fov).toBe(FOV);
    // (the distance stays the map's, whatever the lens: the zoom is defined at the scene's own field of view)
    expect(poseFor(wide, H).dist).toBeCloseTo(poseFor(flyCam(100), H).dist, 9);
  });
});
