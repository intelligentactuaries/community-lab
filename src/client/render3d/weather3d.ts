// Rain and snow in the 3D view: streaks and flakes in the air round the
// camera, falling at their own speed and drifting downwind, landing on the
// ground or on whatever stands over it (a bus shelter's roof, a station's
// canopy, the Hyperline's deck, a vehicle), and never indoors. A room is under
// its roof though the doll's-house view takes the roof away, so:
//
// - nothing falls inside a room (a drop reaching the top of its walls is gone),
// - and nothing falling outside is drawn over one: the rain is drawn after the
//   scene, tested against its depth, and a drop is left out wherever what lies
//   behind it — the floor, a wall's inside, the furniture, someone at home, the
//   seats of a cabin whose roof has faded — is indoors. A wall's outside face
//   stands a hand's breadth beyond the room, so rain still shows against it.
//
// A storm's lightning lights the scene itself (scene3d.ts).
import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';
import type { Building, World } from '../../sim/types';
import { TRACK } from '../../sim/world';
import { type Indoors, indoorsOf } from '../render/indoors';
import { FLOOR_Y, GROUND_Y, PLATFORM_Y, TRACK_Y, WALL_CIVIC, WALL_FULL } from './world3d';

/** The tops of the walls: above them a room is open to the sky in this view. */
const HOUSE_TOP = FLOOR_Y + WALL_FULL;
const CIVIC_TOP = FLOOR_Y + WALL_CIVIC;
/** The rooms as seen from above, for the rain's shader: a square raster round the camera. */
const ROOMS_PX = 1024;
/** Heights in the raster: a byte for up to this many metres. */
const ROOMS_H = 8;
/** Cabins seen into from above, at most (the nearest). */
const CABINS = 8;

/** Something over open ground that catches what falls: a rectangle turned by `yaw` (three.js), and its top. */
export interface Cover {
  x: number;
  y: number;
  yaw: number;
  /** Half-width (across) and half-length (along). */
  hw: number;
  hl: number;
  top: number;
  /** A cabin seen into from above (its roof faded): its floor. What is in it counts as indoors. */
  floor?: number;
  /** cos and sin of the yaw, when worked out once for many points. */
  cs?: number;
  sn?: number;
}

export interface Sky {
  world: World;
  camera: THREE.PerspectiveCamera;
  /** What the camera looks at, on the map, and how far away it is. */
  lookX: number;
  lookY: number;
  dist: number;
  /** Real seconds since the last frame, and in all. */
  dt: number;
  t: number;
  night: number;
  /** Drawing-buffer size (device pixels) and pixel ratio. */
  width: number;
  height: number;
  dpr: number;
  /** Vehicles near a point (they come and go, so they are asked for each frame). */
  vehicles: (x: number, y: number, r: number) => Cover[];
}

/** The volume the drops fill: a box round a point ahead of the eye, sized to the view. */
export interface Volume {
  cx: number;
  cy: number;
  cz: number;
  /** Half-extents across the ground. */
  hx: number;
  hz: number;
  /** Bottom and top. */
  y0: number;
  y1: number;
}

export function volumeFor(eye: THREE.Vector3, forward: THREE.Vector3, dist: number): Volume {
  const ahead = Math.max(8, Math.min(45, dist * 0.55));
  const h = Math.max(12, Math.min(50, dist * 0.7));
  const cx = eye.x + forward.x * ahead;
  const cy = eye.y + forward.y * ahead;
  const cz = eye.z + forward.z * ahead;
  return { cx, cy, cz, hx: h, hz: h, y0: Math.max(0, cy - h), y1: Math.max(cy + h, eye.y + 4) };
}

/** Is a point (x, z) on a cover's rectangle? */
export function onCover(c: Cover, x: number, z: number): boolean {
  const dx = x - c.x;
  const dz = z - c.y;
  const cs = c.cs ?? Math.cos(c.yaw);
  const sn = c.sn ?? Math.sin(c.yaw);
  return Math.abs(dx * cs - dz * sn) <= c.hw && Math.abs(dx * sn + dz * cs) <= c.hl;
}

/** How high what falls at (x, z) gets: the ground, a roof over it, or the top of a room's walls. */
export function catchAt(indoors: Indoors, covers: readonly Cover[], x: number, z: number): number {
  let top = GROUND_Y;
  const room = indoors.roomAt(x, z);
  if (room) top = room.house ? HOUSE_TOP : CIVIC_TOP;
  for (let i = 0; i < covers.length; i++) {
    const c = covers[i];
    if (c.top > top && onCover(c, x, z)) top = c.top;
  }
  return top;
}

const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** The roofs over open ground that never move: bus shelters, the stations' platforms and canopies, the Hyperline's deck. */
function fixedCovers(buildings: Record<string, Building>): Cover[] {
  const out: Cover[] = [];
  const rect = (x0: number, y0: number, x1: number, y1: number, top: number) => out.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, yaw: 0, hw: (x1 - x0) / 2, hl: (y1 - y0) / 2, top });
  for (const b of Object.values(buildings)) {
    if (b.kind === 'busstop') {
      // (as world3d.ts builds it: a roof along the back of the shelter)
      const d = Math.min(2.4, b.h);
      rect(b.x + 0.2, b.y + 1.2 - d / 2, b.x + b.w - 0.2, b.y + 1.2 + d / 2, 2.71);
    }
    if (b.kind === 'station') {
      for (const r of b.rooms) {
        if (r.kind !== 'stop') continue;
        rect(r.x, r.y, r.x + r.w, r.y + r.h, PLATFORM_Y);
        rect(r.x + 0.5, r.y + 0.5, r.x + r.w - 0.5, r.y + r.h - 0.5, PLATFORM_Y + 3.49);
      }
    }
  }
  for (let i = 1; i < TRACK.length; i++) {
    const a = TRACK[i - 1];
    const b = TRACK[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.1) continue;
    out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, yaw: Math.atan2(b.x - a.x, b.y - a.y), hw: 2.6, hl: len / 2 + 1.3, top: TRACK_Y });
  }
  return out;
}

const fixedCache = new WeakMap<Record<string, Building>, Cover[]>();

/** The fixed roofs over open ground in a world (worked out once per layout). */
export function fixedCoversOf(world: World): Cover[] {
  let fixed = fixedCache.get(world.buildings);
  if (!fixed) {
    fixed = fixedCovers(world.buildings);
    fixedCache.set(world.buildings, fixed);
  }
  return fixed;
}

const MAX = { rain: 6000, snow: 4000 };

const VERTEX = `attribute vec4 drop;
  attribute float seed;
  uniform vec3 trail;
  uniform float widthPx;
  uniform vec2 viewport;
  uniform float snow;
  uniform float flake;
  varying float vAlpha;
  varying vec2 vUv;
  void main() {
    vAlpha = drop.w;
    vUv = position.xy;
    if (drop.w <= 0.002) {
      gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
      return;
    }
    vec2 hv = viewport * 0.5;
    vec4 head = projectionMatrix * viewMatrix * vec4(drop.xyz, 1.0);
    if (snow > 0.5) {
      // A flake: a soft round dot, its size by distance, never smaller than a pixel.
      float r = clamp(flake * (0.6 + 0.8 * seed) * projectionMatrix[1][1] * hv.y / max(head.w, 0.01), 1.0, 5.5);
      head.xy += vec2(position.x, position.y * 2.0 - 1.0) * r / hv * head.w;
      gl_Position = head;
      return;
    }
    // A streak from the drop back along its fall, a fixed few pixels wide.
    vec4 tail = projectionMatrix * viewMatrix * vec4(drop.xyz + trail * (0.7 + 0.6 * seed), 1.0);
    vec2 a = head.xy / head.w * hv;
    vec2 b = tail.xy / tail.w * hv;
    vec2 d = b - a;
    float len = length(d);
    vec2 dir = len > 0.001 ? d / len : vec2(0.0, 1.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    vec4 p = mix(head, tail, position.y);
    p.xy += (nrm * position.x + dir * (position.y * 2.0 - 1.0)) * widthPx * 0.5 / hv * p.w;
    gl_Position = p;
  }`;

const FRAGMENT = `uniform vec3 color;
  uniform float opacity;
  uniform float snow;
  uniform sampler2D tDepth;
  uniform vec2 viewport;
  uniform mat4 projInv;
  uniform mat4 camWorld;
  uniform sampler2D tRooms;
  uniform vec4 roomsAt;
  uniform vec4 cabinA[${CABINS}];
  uniform vec4 cabinB[${CABINS}];
  uniform int cabins;
  varying float vAlpha;
  varying vec2 vUv;
  void main() {
    // Behind what the scene drew here: hidden.
    vec2 uv = gl_FragCoord.xy / viewport;
    float d = texture2D(tDepth, uv).x;
    if (gl_FragCoord.z > d) discard;
    // What is behind it, and where: indoors (in a room, below the top of its walls, or in an open cabin), it is left out.
    if (d < 1.0) {
      vec4 v = projInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
      vec3 w = (camWorld * vec4(v.xyz / v.w, 1.0)).xyz;
      vec2 r = (w.xz - roomsAt.xy) * roomsAt.zw;
      if (r.x > 0.0 && r.y > 0.0 && r.x < 1.0 && r.y < 1.0) {
        float top = texture2D(tRooms, r).r * ${ROOMS_H.toFixed(1)};
        if (top > 0.0 && w.y < top + 0.02) discard;
      }
      for (int i = 0; i < ${CABINS}; i++) {
        if (i >= cabins) break;
        vec4 ca = cabinA[i];
        vec4 cb = cabinB[i];
        vec2 q = w.xz - ca.xy;
        if (abs(q.x * ca.z - q.y * ca.w) <= cb.x && abs(q.x * ca.w + q.y * ca.z) <= cb.y && w.y >= cb.z && w.y <= cb.w) discard;
      }
    }
    float a;
    if (snow > 0.5) a = 1.0 - smoothstep(0.4, 1.0, length(vec2(vUv.x, vUv.y * 2.0 - 1.0)));
    else a = (1.0 - smoothstep(0.35, 1.0, abs(vUv.x))) * mix(1.0, 0.25, vUv.y);
    gl_FragColor = vec4(color, a * vAlpha * opacity);
  }`;

export class Precipitation {
  /** The drops, in a scene of their own: the pass below draws it after the rest. */
  readonly scene = new THREE.Scene();
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private geo = new THREE.InstancedBufferGeometry();
  private drops: THREE.InstancedBufferAttribute;
  private seeds: Float32Array;
  private mode: 'rain' | 'snow' | null = null;
  private n = 0;
  /** The rooms raster: its pixels, and the view it was painted for. */
  private rooms = new Uint8Array(ROOMS_PX * ROOMS_PX);
  private roomsTex: THREE.DataTexture;
  private roomsKey = '';
  private uniforms = {
    trail: { value: new THREE.Vector3() },
    widthPx: { value: 2 },
    viewport: { value: new THREE.Vector2(1, 1) },
    snow: { value: 0 },
    flake: { value: 0.028 },
    color: { value: new THREE.Color() },
    opacity: { value: 1 },
    tDepth: { value: null as THREE.Texture | null },
    projInv: { value: new THREE.Matrix4() },
    camWorld: { value: new THREE.Matrix4() },
    tRooms: { value: null as THREE.Texture | null },
    roomsAt: { value: new THREE.Vector4() },
    cabinA: { value: Array.from({ length: CABINS }, () => new THREE.Vector4()) },
    cabinB: { value: Array.from({ length: CABINS }, () => new THREE.Vector4()) },
    cabins: { value: 0 },
  };

  constructor() {
    const size = Math.max(MAX.rain, MAX.snow);
    // One quad per drop: x across the streak (-1 to 1), y along it (0 at the drop, 1 at its tail).
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    this.geo.setIndex([0, 1, 2, 2, 1, 3]);
    this.drops = new THREE.InstancedBufferAttribute(new Float32Array(size * 4), 4);
    this.drops.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('drop', this.drops);
    this.seeds = new Float32Array(size);
    for (let i = 0; i < size; i++) this.seeds[i] = Math.random();
    this.geo.setAttribute('seed', new THREE.InstancedBufferAttribute(this.seeds, 1));
    this.geo.instanceCount = 0;
    this.roomsTex = new THREE.DataTexture(this.rooms, ROOMS_PX, ROOMS_PX, THREE.RedFormat, THREE.UnsignedByteType);
    this.roomsTex.magFilter = THREE.NearestFilter;
    this.roomsTex.minFilter = THREE.NearestFilter;
    this.roomsTex.generateMipmaps = false;
    this.uniforms.tRooms.value = this.roomsTex;
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      // (tested against the scene's depth in the shader: the buffer drawn into has none of its own)
      depthTest: false,
      depthWrite: false,
      // (a streak's quad faces whichever way its fall turns it on screen)
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.name = 'precipitation';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.scene.add(this.mesh);
  }

  /** Whether any rain or snow is falling (and the pass has something to draw). */
  get falling(): boolean {
    return this.mesh.visible;
  }

  update(s: Sky): void {
    const w = s.world.weather;
    const cond = w.condition;
    const mode = cond === 'snow' ? 'snow' : cond === 'rain' || cond === 'storm' ? 'rain' : null;
    if (!mode) {
      this.mesh.visible = false;
      this.mode = null;
      return;
    }
    const cam = s.camera;
    const eye = cam.position;
    const vol = volumeFor(eye, cam.getWorldDirection(new THREE.Vector3()), s.dist);
    const pos = this.drops.array as Float32Array;
    // How hard: the day's rain sets how many drops there are; a storm's are more, and faster.
    const heavy = mode === 'snow' ? Math.min(1, 0.45 + w.rainMm / 10) : Math.min(1, (0.3 + w.rainMm / 14) * (cond === 'storm' ? 1.3 : 1));
    const want = Math.round(MAX[mode] * heavy);
    if (mode !== this.mode) {
      this.mode = mode;
      this.n = 0;
    }
    // New drops (a change of weather, or harder rain) start anywhere in the air.
    for (let i = this.n; i < want; i++) {
      pos[i * 4] = vol.cx + (Math.random() * 2 - 1) * vol.hx;
      pos[i * 4 + 1] = vol.y0 + Math.random() * (vol.y1 - vol.y0);
      pos[i * 4 + 2] = vol.cz + (Math.random() * 2 - 1) * vol.hz;
    }
    this.n = want;
    // The wind: from the compass point it blows from (sixteenths, 0 = N, clockwise) toward the opposite one.
    const from = (w.windDir / 16) * Math.PI * 2;
    const windMs = w.windKmh / 3.6;
    const drift = mode === 'snow' ? Math.min(1.6, windMs * 0.5) : windMs * (cond === 'storm' ? 0.6 : 0.45);
    const vx = -Math.sin(from) * drift;
    const vz = Math.cos(from) * drift;
    const fall = mode === 'snow' ? 1.1 : cond === 'storm' ? 10 : 8.5;
    const dt = Math.min(0.1, Math.max(0, s.dt));
    const indoors = indoorsOf(s.world);
    // What stands over the ground in the volume, and the cabins seen into from above.
    const reach = Math.hypot(vol.hx, vol.hz) + 5;
    const covers: Cover[] = [];
    for (const c of fixedCoversOf(s.world)) if (Math.hypot(c.x - vol.cx, c.y - vol.cz) < reach + c.hl + c.hw) covers.push({ ...c, cs: Math.cos(c.yaw), sn: Math.sin(c.yaw) });
    const cabins: Cover[] = [];
    for (const v of s.vehicles(s.lookX, s.lookY, Math.max(reach, s.dist * 2))) {
      const c = { ...v, cs: Math.cos(v.yaw), sn: Math.sin(v.yaw) };
      covers.push(c);
      if (c.floor !== undefined) cabins.push(c);
    }
    this.fall(pos, vol, indoors, covers, eye, mode === 'snow', vx, vz, fall, dt, s.t);
    this.drops.clearUpdateRanges();
    this.drops.addUpdateRange(0, this.n * 4);
    this.drops.needsUpdate = true;
    this.geo.instanceCount = this.n;
    // What the shader tests against: the rooms round what the camera looks at, the open cabins nearest it, the camera.
    this.paintRooms(indoors, s.lookX, s.lookY, s.dist);
    const u = this.uniforms;
    cabins.sort((a, b) => Math.hypot(a.x - s.lookX, a.y - s.lookY) - Math.hypot(b.x - s.lookX, b.y - s.lookY));
    u.cabins.value = Math.min(CABINS, cabins.length);
    for (let i = 0; i < u.cabins.value; i++) {
      const c = cabins[i];
      u.cabinA.value[i].set(c.x, c.y, c.cs!, c.sn!);
      u.cabinB.value[i].set(c.hw, c.hl, c.floor! - 0.3, c.top);
    }
    u.projInv.value.copy(cam.projectionMatrixInverse);
    u.camWorld.value.copy(cam.matrixWorld);
    // Streaks as long as a drop falls in a moment (motion blur); flakes as dots. Lit by the day (or the street lamps).
    const exposure = 0.065;
    u.trail.value.set(-vx * exposure, fall * exposure, -vz * exposure);
    u.snow.value = mode === 'snow' ? 1 : 0;
    u.widthPx.value = 3 * s.dpr;
    u.viewport.value.set(s.width, s.height);
    const light = 0.3 + 0.7 * (1 - s.night);
    if (mode === 'snow') {
      // (snow is white enough to catch what light there is)
      const lit = 0.45 + 0.55 * (1 - s.night);
      u.color.value.setRGB(0.95 * lit, 0.96 * lit, lit);
      u.opacity.value = 0.9;
    } else {
      u.color.value.setRGB(0.78 * light, 0.84 * light, 0.92 * light);
      u.opacity.value = cond === 'storm' ? 0.6 : 0.5;
    }
    this.mesh.visible = true;
  }

  /** Move every drop on by a frame; those that land start again at the top. Their fade goes in the fourth slot. */
  private fall(pos: Float32Array, vol: Volume, indoors: Indoors, covers: Cover[], eye: THREE.Vector3, snow: boolean, vx: number, vz: number, fall: number, dt: number, t: number): void {
    const ex = eye.x;
    const ey = eye.y;
    const ez = eye.z;
    const { cx, cz, hx, hz, y0, y1 } = vol;
    const span = y1 - y0;
    const ground = y0 <= GROUND_Y + 0.5;
    const seeds = this.seeds;
    for (let i = 0; i < this.n; i++) {
      const o = i * 4;
      let x = pos[o];
      let y = pos[o + 1];
      let z = pos[o + 2];
      const sd = seeds[i];
      if (snow) {
        // Snow sways as it falls, each flake to its own rhythm.
        x += (vx + Math.cos(t * (0.8 + sd) + sd * 40) * 0.35) * dt;
        z += (vz + Math.sin(t * (0.7 + sd * 0.9) + sd * 70) * 0.35) * dt;
        y -= fall * (0.75 + sd * 0.5) * dt;
      } else {
        x += vx * dt;
        z += vz * dt;
        y -= fall * (0.9 + sd * 0.2) * dt;
      }
      // The volume moves with the camera: whatever falls out of one side comes back in at the other.
      if (x < cx - hx || x > cx + hx) x = cx - hx + ((((x - (cx - hx)) % (2 * hx)) + 2 * hx) % (2 * hx));
      if (z < cz - hz || z > cz + hz) z = cz - hz + ((((z - (cz - hz)) % (2 * hz)) + 2 * hz) % (2 * hz));
      if (y > y1 + 1) y = y0 + Math.random() * span;
      // Landed (on the ground, on a roof, or at the top of a room's walls): it starts again at the top.
      if (y < y0 || y < catchAt(indoors, covers, x, z)) {
        x = cx + (Math.random() * 2 - 1) * hx;
        z = cz + (Math.random() * 2 - 1) * hz;
        y = y1 - Math.random() * fall * dt;
      }
      pos[o] = x;
      pos[o + 1] = y;
      pos[o + 2] = z;
      // Fade toward the volume's sides (and its bottom when that is in mid-air) so it has no edge,
      let a = 1;
      const edge = Math.max(Math.abs(x - cx) / hx, Math.abs(z - cz) / hz);
      if (edge > 0.72) a *= 1 - smooth((edge - 0.72) / 0.28);
      if (!ground) a *= smooth((y - y0) / (0.2 * span));
      // and out of the way right in front of the lens.
      const dx = x - ex;
      const dy = y - ey;
      const dz = z - ez;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 12.25) a *= smooth((Math.sqrt(d2) - 1.2) / 2.3);
      pos[o + 3] = a;
    }
  }

  /**
   * The rooms seen from above, round what the camera looks at: each pixel the
   * height of the walls where it is indoors, 0 outdoors. Up close a pixel is
   * finer than a wall is thick, so a wall's outside face (a hand's breadth
   * beyond the room) reads as outdoors and its inside face as indoors; from
   * high up the pixels cover more ground, and each room is painted a little
   * wider so that the inside of its walls still counts as indoors. Painted
   * again only when the view has moved or zoomed well away from the last.
   */
  private paintRooms(indoors: Indoors, x: number, y: number, dist: number): void {
    // The side: a power of 1.25 near three times the distance plus a margin (60 m up close, a pixel 6 cm).
    const side = 60 * Math.pow(1.25, Math.max(0, Math.round(Math.log((dist * 3 + 40) / 60) / Math.log(1.25))));
    const step = side / 8;
    const cx = Math.round(x / step) * step;
    const cy = Math.round(y / step) * step;
    const key = `${side}|${cx}|${cy}`;
    if (key === this.roomsKey) return;
    this.roomsKey = key;
    const px = side / ROOMS_PX;
    const x0 = cx - side / 2;
    const y0 = cy - side / 2;
    const wider = Math.max(0, px / 2 - 0.08);
    const data = this.rooms;
    data.fill(0);
    for (const r of indoors.rooms) {
      if (r.x1 < x0 || r.y1 < y0 || r.x0 > x0 + side || r.y0 > y0 + side) continue;
      // Every pixel whose centre is in the room.
      const i0 = Math.max(0, Math.ceil((r.x0 - wider - x0) / px - 0.5));
      const i1 = Math.min(ROOMS_PX - 1, Math.floor((r.x1 + wider - x0) / px - 0.5));
      const j0 = Math.max(0, Math.ceil((r.y0 - wider - y0) / px - 0.5));
      const j1 = Math.min(ROOMS_PX - 1, Math.floor((r.y1 + wider - y0) / px - 0.5));
      if (i1 < i0 || j1 < j0) continue;
      const v = Math.round(((r.house ? HOUSE_TOP : CIVIC_TOP) / ROOMS_H) * 255);
      for (let j = j0; j <= j1; j++) data.fill(v, j * ROOMS_PX + i0, j * ROOMS_PX + i1 + 1);
    }
    this.roomsTex.needsUpdate = true;
    this.uniforms.roomsAt.value.set(x0, y0, 1 / side, 1 / side);
  }

  /** The depth the scene was drawn with, while the pass draws. */
  set depth(t: THREE.Texture | null) {
    this.uniforms.tDepth.value = t;
  }

  dispose(): void {
    this.geo.dispose();
    this.mesh.material.dispose();
    this.roomsTex.dispose();
  }
}

/**
 * Draws the rain over the finished scene (after the ambient occlusion, before
 * the bloom), reading the depth the scene was drawn with. That depth belongs to
 * the buffer the scene went into, which cannot be drawn into while it is read,
 * so when that buffer holds the picture, the picture is copied across first.
 */
export class RainPass extends Pass {
  private copy = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms), vertexShader: CopyShader.vertexShader, fragmentShader: CopyShader.fragmentShader }));

  constructor(
    private precip: Precipitation,
    private camera: THREE.Camera,
    private sceneTarget: () => THREE.WebGLRenderTarget | null,
  ) {
    super();
    this.needsSwap = false;
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const src = this.sceneTarget();
    this.needsSwap = false;
    if (!this.precip.falling || !src?.depthTexture) return;
    let target = readBuffer;
    if (src === readBuffer) {
      (this.copy.material as THREE.ShaderMaterial).uniforms.tDiffuse.value = readBuffer.texture;
      renderer.setRenderTarget(writeBuffer);
      this.copy.render(renderer);
      target = writeBuffer;
      this.needsSwap = true;
    }
    this.precip.depth = src.depthTexture;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.render(this.precip.scene, this.camera);
    renderer.autoClear = auto;
    this.precip.depth = null;
  }

  dispose(): void {
    this.copy.dispose();
    (this.copy.material as THREE.Material).dispose();
  }
}
