// The vehicles: household cars and bakkies, the police, the ambulance, the
// minibus taxis, the buses, the e-hailing cars, the Hyperline's pod and the
// airliners on the apron. Each is built from a side profile (bonnet, beltline,
// boot, wheel arches) with an open cabin under glass, so whoever is inside can
// be seen sitting there: seats, a dashboard, a steering wheel that turns with
// the front wheels. From above the roof fades like the houses' (a doll's-house
// view); from the street it is solid. Brake lights come on as they slow and
// while they stand, indicators blink before a turn, the body dips and leans,
// and at night the lamps light. A taxi, ambulance or bus with no driver of
// its own in the simulation gets one at the wheel.
import * as THREE from 'three';
import type { Vehicle, World } from '../../sim/types';
import { TRAIN_LENGTH } from '../../sim/transit';
import { STATIONS, trackPoint } from '../../sim/world';
import { plotColor } from '../lib/householdColor';
import { box, capsule, cyl, rbox } from './geom';
import { Human, humanKit, loadHumans, type Look } from './humans';
import { blobShadow, hash01, mat, mixHex, paint } from './materials';
import { Motion, idleAct, styleFor } from './motion';
import { headingYaw, type Rides, type Seat } from './people3d';
import { GROUND_Y, TRACK_Y } from './world3d';

type Kind = Vehicle['kind'];

/** A model's parts share geometry across vehicles of a kind; the materials say what each part is. */
type Role = 'paint' | 'paint2' | 'trim' | 'glass' | 'seat' | 'dash' | 'chrome' | 'roof' | 'head' | 'tail' | 'indL' | 'indR' | 'plate' | 'bin';

interface WheelSpec {
  x: number;
  z: number;
  r: number;
  w: number;
  steer: boolean;
}

interface KindModel {
  parts: Array<{ geo: THREE.BufferGeometry; role: Role }>;
  wheels: WheelSpec[];
  /** Seat 0 is the driver's; passengers take the others in the order people fill them (taxis from the back). */
  seats: Seat[];
  /** The steering wheel: where it sits and how it is tilted (null: none). */
  steering: { x: number; y: number; z: number; tilt: number; r: number } | null;
  shadow: [number, number];
  length: number;
  width: number;
}

// ── Building bodies from side profiles ──

/** A solid of the side profile between z0 and z1 (top(z) above, bottom(z) below), across the width. */
function slab(z0: number, z1: number, top: (z: number) => number, bottom: (z: number) => number, width: number, bevel = 0.06, step = 0.05): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const n = Math.max(2, Math.ceil((z1 - z0) / step));
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n;
    if (i === 0) shape.moveTo(z, bottom(z));
    else shape.lineTo(z, bottom(z));
  }
  for (let i = n; i >= 0; i--) {
    const z = z0 + ((z1 - z0) * i) / n;
    shape.lineTo(z, top(z));
  }
  const depth = Math.max(0.01, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 4 });
  // Profile (z, y) extruded along its own z: turn it so the extrusion runs across the vehicle.
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, -1, depth / 2, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  g.computeVertexNormals();
  return g;
}

/** A thin panel following the profile (a door), at x (its outer face), inward by thickness. */
function panel(z0: number, z1: number, top: (z: number) => number, bottom: (z: number) => number, x: number, thick = 0.05): THREE.BufferGeometry {
  const g = slab(z0, z1, top, bottom, thick, 0.015);
  g.translate(x - Math.sign(x) * thick / 2, 0, 0);
  return g;
}

/** The glasshouse: the cabin's side profile above the beltline, as one rounded glass solid. */
function glasshouse(pts: Array<[number, number]>, width: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? shape.lineTo(z, y) : shape.moveTo(z, y)));
  const bevel = 0.07;
  const depth = width - bevel * 2;
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: 0.05, bevelSegments: 3, curveSegments: 4 });
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, -1, depth / 2, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  g.computeVertexNormals();
  return g;
}

/** A bar from a to b (a pillar), square in section. */
function bar(a: [number, number, number], b: [number, number, number], t: number): THREE.BufferGeometry {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.BoxGeometry(t, len, t);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0, pitch = 0): THREE.BufferGeometry => {
  const c = g.clone();
  c.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')), new THREE.Vector3(1, 1, 1)));
  return c;
};

/** A smooth step from a to b as z goes from z0 to z1. */
function ramp(z: number, z0: number, z1: number, a: number, b: number): number {
  const t = Math.max(0, Math.min(1, (z - z0) / (z1 - z0)));
  return a + (b - a) * t * t * (3 - 2 * t);
}

/** The underside: the sill, rising at the ends, cut away over the wheels. */
function sill(y: number, ends: number, len: number, wheels: WheelSpec[], wy: number): (z: number) => number {
  const half = len / 2;
  return (z) => {
    let b = y + Math.max(0, Math.abs(z) - (half - ends)) * 0.9;
    for (const w of wheels) {
      if (w.x < 0) continue;
      const r = w.r + 0.06;
      const dz = z - w.z;
      if (Math.abs(dz) < r) b = Math.max(b, wy + Math.sqrt(r * r - dz * dz));
    }
    return b;
  };
}

/** A seat: cushion, back and headrest, facing yaw (0 = forward). */
function seatParts(out: KindModel['parts'], x: number, y: number, z: number, yaw = 0, w = 0.48, head = true): void {
  out.push({ geo: at(rbox(w, 0.12, 0.48, 0.05, 2), x, y - 0.06, z, yaw), role: 'seat' });
  const bz = -0.26;
  const bx = Math.sin(yaw) * bz;
  const bzz = Math.cos(yaw) * bz;
  out.push({ geo: at(rbox(w, 0.62, 0.12, 0.05, 2), x + bx, y + 0.28, z + bzz, yaw, -0.18), role: 'seat' });
  if (head) out.push({ geo: at(rbox(w * 0.55, 0.16, 0.1, 0.04, 2), x + bx * 1.12, y + 0.66, z + bzz * 1.12, yaw, -0.1), role: 'seat' });
}

function lamps(out: KindModel['parts'], front: number, back: number, y: number, x: number, W: number, yTail = y + 0.1): void {
  for (const sx of [-1, 1]) {
    out.push({ geo: at(rbox(0.32, 0.12, 0.08, 0.04), sx * x, y, front), role: 'head' });
    out.push({ geo: at(rbox(0.3, 0.12, 0.08, 0.04), sx * x, yTail, back), role: 'tail' });
    out.push({ geo: at(rbox(0.1, 0.08, 0.08, 0.03), sx * (W / 2 - 0.05), y - 0.02, front - 0.04), role: sx > 0 ? 'indL' : 'indR' });
    out.push({ geo: at(rbox(0.1, 0.08, 0.08, 0.03), sx * (W / 2 - 0.05), yTail, back + 0.04), role: sx > 0 ? 'indL' : 'indR' });
  }
  out.push({ geo: at(box(0.52, 0.12, 0.02), 0, y - 0.18, front + 0.03), role: 'plate' });
  out.push({ geo: at(box(0.52, 0.12, 0.02), 0, yTail - 0.2, back - 0.03), role: 'plate' });
}

const models = new Map<Kind, KindModel>();

/** The geometry of a kind of vehicle, built once. Forward is +z, the figure's left +x, the ground y = 0. */
function kindModel(kind: Kind): KindModel {
  let m = models.get(kind);
  if (m) return m;
  switch (kind) {
    case 'car':
    case 'ride':
    case 'police':
      m = sedan();
      break;
    case 'taxi':
      m = minibus();
      break;
    case 'bus':
      m = bus();
      break;
    case 'bakkie':
      m = bakkie();
      break;
    case 'ambulance':
      m = ambulance();
      break;
    case 'train':
      m = pod();
      break;
    default:
      m = plane();
      break;
  }
  models.set(kind, m);
  return m;
}

function sedan(): KindModel {
  const L = 4.5;
  const W = 1.78;
  const wheels: WheelSpec[] = [];
  for (const x of [0.76, -0.76]) for (const [z, steer] of [[1.35, true], [-1.33, false]] as const) wheels.push({ x, z, r: 0.32, w: 0.21, steer });
  const top = (z: number) => (z > 0.95 ? ramp(z, 2.25, 1.95, 0.5, 0.72) + ramp(z, 1.95, 0.95, 0, 0.14) - (z > 1.95 ? 0 : 0) : z > -1.2 ? ramp(z, 0.95, -1.2, 0.86, 0.92) : ramp(z, -1.2, -2.0, 0.93, 0.9) - ramp(z, -2.0, -2.25, 0, 0.3));
  const bottom = sill(0.24, 0.3, L, wheels, 0.32);
  const parts: KindModel['parts'] = [];
  // Bonnet and boot are solid; between them the cabin is open to the glass, with doors, a floor and bulkheads.
  parts.push({ geo: slab(0.9, 2.25, top, bottom, W), role: 'paint' });
  parts.push({ geo: slab(-2.25, -1.15, top, bottom, W), role: 'paint' });
  for (const x of [W / 2, -W / 2]) parts.push({ geo: panel(-1.2, 0.95, top, bottom, x, 0.06), role: 'paint' });
  parts.push({ geo: at(box(W - 0.14, 0.06, 2.1), 0, 0.3, -0.12), role: 'trim' });
  parts.push({ geo: at(box(W - 0.14, 0.55, 0.06), 0, 0.6, -1.15), role: 'dash' });
  // Dashboard and the parcel shelf.
  parts.push({ geo: at(rbox(W - 0.16, 0.34, 0.38, 0.06), 0, 0.72, 0.78), role: 'dash' });
  parts.push({ geo: at(box(W - 0.2, 0.04, 0.32), 0, 0.92, -1.02), role: 'dash' });
  // Glass, pillars, the roof.
  parts.push({ geo: glasshouse([[0.95, 0.86], [0.2, 1.4], [-0.72, 1.42], [-1.2, 0.93]], W - 0.14), role: 'glass' });
  for (const sx of [1, -1]) {
    const x = sx * (W / 2 - 0.1);
    parts.push({ geo: bar([x, 0.86, 0.93], [sx * (W / 2 - 0.16), 1.4, 0.2], 0.06), role: 'trim' });
    parts.push({ geo: bar([x, 0.9, -0.28], [sx * (W / 2 - 0.15), 1.42, -0.3], 0.07), role: 'trim' });
    parts.push({ geo: bar([x, 0.93, -1.18], [sx * (W / 2 - 0.16), 1.42, -0.72], 0.08), role: 'paint' });
  }
  parts.push({ geo: at(rbox(W - 0.28, 0.05, 0.98, 0.02), 0, 1.44, -0.26), role: 'roof' });
  // Bumpers and grille.
  parts.push({ geo: at(rbox(W + 0.02, 0.2, 0.18, 0.07), 0, 0.42, 2.18), role: 'trim' });
  parts.push({ geo: at(rbox(W + 0.02, 0.2, 0.18, 0.07), 0, 0.44, -2.18), role: 'trim' });
  parts.push({ geo: at(rbox(0.6, 0.1, 0.05, 0.03), 0, 0.58, 2.24), role: 'chrome' });
  for (const sx of [1, -1]) parts.push({ geo: at(rbox(0.06, 0.1, 0.16, 0.03), sx * (W / 2 + 0.03), 0.95, 0.72), role: 'trim' });
  lamps(parts, 2.21, -2.22, 0.66, 0.6, W, 0.8);
  const seats: Seat[] = [
    { x: -0.37, y: 0.52, z: 0.08, yaw: 0, driver: true, floor: 0.24 },
    { x: 0.37, y: 0.52, z: 0.08, yaw: 0, floor: 0.24 },
    { x: 0.4, y: 0.52, z: -0.75, yaw: 0, floor: 0.24 },
    { x: -0.4, y: 0.52, z: -0.75, yaw: 0, floor: 0.24 },
    { x: 0, y: 0.52, z: -0.75, yaw: 0, floor: 0.24 },
  ];
  // (An e-hailing passenger sits in the back: see seatsOf.)
  for (const s of seats.slice(0, 4)) seatParts(parts, s.x, s.y, s.z, 0, 0.5);
  parts.push({ geo: at(box(0.34, 0.12, 0.46), 0, 0.46, -0.75), role: 'seat' });
  return { parts, wheels, seats, steering: { x: -0.37, y: 0.82, z: 0.52, tilt: -1.1, r: 0.19 }, shadow: [W * 1.5, L * 1.2], length: L, width: W };
}

function minibus(): KindModel {
  const L = 5.38;
  const W = 1.88;
  const wheels: WheelSpec[] = [];
  for (const x of [0.8, -0.8]) for (const [z, steer] of [[1.75, true], [-1.6, false]] as const) wheels.push({ x, z, r: 0.34, w: 0.22, steer });
  const top = (z: number) => (z > 2.3 ? ramp(z, 2.69, 2.42, 0.62, 1.12) + ramp(z, 2.42, 2.3, 0, 0.08) : ramp(z, 2.3, -2.6, 1.2, 1.25) - ramp(z, -2.6, -2.69, 0, 0.05));
  const bottom = sill(0.32, 0.22, L, wheels, 0.34);
  const parts: KindModel['parts'] = [];
  parts.push({ geo: slab(2.28, 2.69, top, bottom, W), role: 'paint' });
  parts.push({ geo: slab(-2.69, -2.55, top, bottom, W), role: 'paint' });
  for (const x of [W / 2, -W / 2]) parts.push({ geo: panel(-2.6, 2.32, top, bottom, x, 0.06), role: 'paint' });
  // The band along the sides (a taxi association's colours).
  for (const sx of [1, -1]) parts.push({ geo: at(box(0.02, 0.14, 4.9), sx * (W / 2 + 0.005), 0.95, -0.1), role: 'paint2' });
  parts.push({ geo: at(box(W - 0.14, 0.06, 4.9), 0, 0.45, -0.1), role: 'trim' });
  parts.push({ geo: at(rbox(W - 0.16, 0.34, 0.34, 0.06), 0, 1.08, 2.12), role: 'dash' });
  parts.push({ geo: glasshouse([[2.34, 1.2], [1.75, 2.22], [-2.62, 2.24], [-2.66, 1.25]], W - 0.14), role: 'glass' });
  for (const sx of [1, -1]) {
    const x = sx * (W / 2 - 0.09);
    parts.push({ geo: bar([x, 1.2, 2.32], [x * 0.98, 2.22, 1.77], 0.07), role: 'paint' });
    for (const z of [1.3, 0.0, -1.3]) parts.push({ geo: bar([x, 1.22, z], [x * 0.98, 2.24, z], 0.07), role: 'paint' });
    parts.push({ geo: bar([x, 1.25, -2.62], [x * 0.98, 2.24, -2.6], 0.09), role: 'paint' });
  }
  parts.push({ geo: at(rbox(W - 0.22, 0.06, 4.3, 0.03), 0, 2.26, -0.43), role: 'roof' });
  parts.push({ geo: at(rbox(W + 0.02, 0.2, 0.16, 0.06), 0, 0.5, 2.64), role: 'trim' });
  parts.push({ geo: at(rbox(W + 0.02, 0.2, 0.16, 0.06), 0, 0.5, -2.64), role: 'trim' });
  lamps(parts, 2.66, -2.68, 0.78, 0.64, W, 1.0);
  // "Move to the back": taxi passengers fill the rear rows first, the front bench last.
  const seats: Seat[] = [{ x: -0.48, y: 0.9, z: 1.4, yaw: 0, driver: true, floor: 0.45 }];
  for (const x of [-0.6, 0.6, -0.2, 0.2]) seats.push({ x, y: 0.9, z: -2.15, yaw: 0, floor: 0.45 });
  for (const z of [-1.3, -0.4, 0.5]) for (const x of [-0.55, 0.45, -0.05]) seats.push({ x, y: 0.9, z, yaw: 0, floor: 0.45 });
  for (const x of [0.5, 0.08]) seats.push({ x, y: 0.9, z: 1.4, yaw: 0, floor: 0.45 });
  seatParts(parts, -0.48, 0.9, 1.4, 0, 0.48);
  seatParts(parts, 0.3, 0.9, 1.4, 0, 0.88);
  for (const z of [0.5, -0.4, -1.3]) seatParts(parts, -0.05, 0.9, z, 0, 1.5, false);
  seatParts(parts, 0, 0.9, -2.15, 0, 1.64, false);
  return { parts, wheels, seats, steering: { x: -0.48, y: 1.2, z: 1.86, tilt: -0.75, r: 0.2 }, shadow: [W * 1.6, L * 1.2], length: L, width: W };
}

function bus(): KindModel {
  const L = 11.8;
  const W = 2.5;
  const wheels: WheelSpec[] = [];
  for (const x of [1.05, -1.05]) for (const [z, steer] of [[3.9, true], [-2.9, false]] as const) wheels.push({ x, z, r: 0.5, w: 0.3, steer });
  const top = (z: number) => ramp(z, 5.9, 5.7, 0.9, 1.06) + ramp(z, -5.7, -5.9, 0, 0.1) * 0 + 0.0;
  const bottom = sill(0.3, 0.1, L, wheels, 0.5);
  const parts: KindModel['parts'] = [];
  parts.push({ geo: slab(5.55, 5.9, top, bottom, W, 0.08), role: 'paint' });
  parts.push({ geo: slab(-5.9, -5.6, (z) => 1.25, bottom, W, 0.08), role: 'paint' });
  for (const x of [W / 2, -W / 2]) parts.push({ geo: panel(-5.7, 5.7, (z) => 1.06, bottom, x, 0.07), role: 'paint' });
  for (const sx of [1, -1]) parts.push({ geo: at(box(0.02, 0.2, 11.2), sx * (W / 2 + 0.005), 0.72, 0), role: 'paint2' });
  parts.push({ geo: at(box(W - 0.16, 0.06, 11.2), 0, 0.35, 0), role: 'trim' });
  parts.push({ geo: glasshouse([[5.88, 1.02], [5.72, 2.95], [-5.82, 2.95], [-5.86, 1.25]], W - 0.14), role: 'glass' });
  for (const sx of [1, -1]) {
    const x = sx * (W / 2 - 0.08);
    for (let z = 4.4; z > -5.8; z -= 1.3) parts.push({ geo: bar([x, 1.04, z], [x, 2.95, z], 0.08), role: 'paint' });
    parts.push({ geo: bar([x, 1.02, 5.84], [x, 2.95, 5.7], 0.1), role: 'paint' });
  }
  parts.push({ geo: at(rbox(W - 0.16, 0.1, 11.4, 0.04), 0, 3.0, 0), role: 'roof' });
  parts.push({ geo: at(box(W - 0.3, 0.26, 0.05), 0, 2.78, 5.86), role: 'head' });
  parts.push({ geo: at(rbox(W + 0.02, 0.24, 0.16, 0.06), 0, 0.46, 5.86), role: 'trim' });
  parts.push({ geo: at(rbox(W + 0.02, 0.24, 0.16, 0.06), 0, 0.46, -5.86), role: 'trim' });
  parts.push({ geo: at(rbox(0.7, 0.4, 0.55, 0.06), -0.85, 0.95, 5.5), role: 'dash' });
  lamps(parts, 5.9, -5.9, 0.72, 0.9, W, 0.95);
  const seats: Seat[] = [{ x: -0.85, y: 0.82, z: 5.0, yaw: 0, driver: true, floor: 0.45 }];
  const rows: Seat[] = [];
  for (let z = 3.6; z > -5.2; z -= 0.82) for (const x of [-0.95, -0.5, 0.5, 0.95]) rows.push({ x, y: 0.8, z, yaw: 0, floor: 0.45 });
  // Bus passengers spread out: window seats first, all along the bus, then the aisle seats.
  rows.sort((a, b) => (Math.abs(b.x) > 0.7 ? 1 : 0) - (Math.abs(a.x) > 0.7 ? 1 : 0) || ((a.z * 7.3) % 3) - ((b.z * 7.3) % 3));
  seats.push(...rows);
  seatParts(parts, -0.85, 0.82, 5.0, 0, 0.5);
  for (let z = 3.6; z > -5.2; z -= 0.82) for (const x of [-0.725, 0.725]) seatParts(parts, x, 0.8, z, 0, 0.9, false);
  return { parts, wheels, seats, steering: { x: -0.85, y: 1.25, z: 5.28, tilt: -0.35, r: 0.24 }, shadow: [W * 1.6, L * 1.15], length: L, width: W };
}

function bakkie(): KindModel {
  const L = 5.3;
  const W = 1.85;
  const wheels: WheelSpec[] = [];
  for (const x of [0.78, -0.78]) for (const [z, steer] of [[1.55, true], [-1.55, false]] as const) wheels.push({ x, z, r: 0.36, w: 0.25, steer });
  const top = (z: number) => (z > 1.05 ? ramp(z, 2.65, 2.3, 0.62, 1.0) + ramp(z, 2.3, 1.05, 0, 0.06) : z > -0.3 ? 1.08 : 1.1);
  const bottom = sill(0.4, 0.2, L, wheels, 0.36);
  const parts: KindModel['parts'] = [];
  parts.push({ geo: slab(1.05, 2.65, top, bottom, W), role: 'paint' });
  for (const x of [W / 2, -W / 2]) parts.push({ geo: panel(-0.3, 1.1, top, bottom, x, 0.06), role: 'paint' });
  parts.push({ geo: at(box(W - 0.14, 0.06, 1.4), 0, 0.45, 0.4), role: 'trim' });
  parts.push({ geo: at(box(W - 0.14, 0.7, 0.06), 0, 0.75, -0.3), role: 'paint' });
  parts.push({ geo: at(rbox(W - 0.16, 0.32, 0.36, 0.06), 0, 0.92, 0.92), role: 'dash' });
  parts.push({ geo: glasshouse([[1.1, 1.05], [0.48, 1.76], [-0.2, 1.78], [-0.28, 1.08]], W - 0.14), role: 'glass' });
  for (const sx of [1, -1]) {
    const x = sx * (W / 2 - 0.1);
    parts.push({ geo: bar([x, 1.05, 1.08], [x * 0.97, 1.76, 0.5], 0.06), role: 'trim' });
    parts.push({ geo: bar([x, 1.08, -0.26], [x * 0.97, 1.78, -0.2], 0.09), role: 'paint' });
  }
  parts.push({ geo: at(rbox(W - 0.26, 0.05, 0.72, 0.02), 0, 1.8, 0.14), role: 'roof' });
  // The load bin: floor, sides and tailgate (people sometimes ride in it).
  parts.push({ geo: at(box(W - 0.1, 0.06, 2.3), 0, 0.85, -1.5), role: 'bin' });
  for (const x of [W / 2 - 0.04, -(W / 2 - 0.04)]) parts.push({ geo: panel(-2.65, -0.34, () => 1.12, (z) => Math.max(0.55, bottom(z)), x + Math.sign(x) * 0.04, 0.07), role: 'paint' });
  parts.push({ geo: at(rbox(W, 0.5, 0.07, 0.03), 0, 0.88, -2.62), role: 'paint' });
  for (const sx of [1, -1]) parts.push({ geo: at(rbox(0.26, 0.2, 0.9, 0.04), sx * 0.66, 0.95, -1.55), role: 'bin' });
  parts.push({ geo: at(rbox(W + 0.02, 0.2, 0.18, 0.06), 0, 0.52, 2.6), role: 'chrome' });
  parts.push({ geo: at(rbox(W + 0.02, 0.16, 0.14, 0.05), 0, 0.5, -2.66), role: 'trim' });
  lamps(parts, 2.62, -2.66, 0.8, 0.62, W, 0.9);
  const seats: Seat[] = [
    { x: -0.4, y: 0.78, z: 0.25, yaw: 0, driver: true, floor: 0.3 },
    { x: 0.4, y: 0.78, z: 0.25, yaw: 0, floor: 0.3 },
    { x: 0.62, y: 1.06, z: -1.2, yaw: -Math.PI / 2, floor: 0.2 },
    { x: -0.62, y: 1.06, z: -1.2, yaw: Math.PI / 2, floor: 0.2 },
    { x: 0.62, y: 1.06, z: -1.9, yaw: -Math.PI / 2, floor: 0.2 },
  ];
  seatParts(parts, -0.4, 0.78, 0.25, 0, 0.5);
  seatParts(parts, 0.4, 0.78, 0.25, 0, 0.5);
  return { parts, wheels, seats, steering: { x: -0.4, y: 1.06, z: 0.66, tilt: -1.0, r: 0.19 }, shadow: [W * 1.55, L * 1.15], length: L, width: W };
}

function ambulance(): KindModel {
  const L = 6.1;
  const W = 2.0;
  const wheels: WheelSpec[] = [];
  for (const x of [0.85, -0.85]) for (const [z, steer] of [[2.0, true], [-1.6, false]] as const) wheels.push({ x, z, r: 0.36, w: 0.25, steer });
  const top = (z: number) => (z > 2.35 ? ramp(z, 3.05, 2.6, 0.62, 1.12) + ramp(z, 2.6, 2.35, 0, 0.08) : 1.2);
  const bottom = sill(0.4, 0.15, L, wheels, 0.36);
  const parts: KindModel['parts'] = [];
  parts.push({ geo: slab(2.3, 3.05, top, bottom, W), role: 'paint' });
  for (const x of [W / 2, -W / 2]) parts.push({ geo: panel(1.5, 2.36, top, bottom, x, 0.06), role: 'paint' });
  parts.push({ geo: at(rbox(W - 0.16, 0.34, 0.34, 0.06), 0, 1.1, 2.2), role: 'dash' });
  parts.push({ geo: glasshouse([[2.4, 1.2], [1.85, 2.1], [1.55, 2.1], [1.55, 1.2]], W - 0.14), role: 'glass' });
  for (const sx of [1, -1]) parts.push({ geo: bar([sx * (W / 2 - 0.1), 1.2, 2.38], [sx * (W / 2 - 0.12), 2.1, 1.87], 0.07), role: 'paint' });
  parts.push({ geo: at(rbox(W - 0.24, 0.05, 0.4, 0.02), 0, 2.12, 1.72), role: 'roof' });
  // The patient compartment: walls with frosted windows, a floor, rear doors; its roof fades like the others.
  const boxTop = () => 2.7;
  for (const x of [W / 2, -W / 2]) {
    parts.push({ geo: panel(-3.0, 1.5, () => 1.55, bottom, x, 0.06), role: 'paint' });
    parts.push({ geo: panel(-3.0, 1.5, boxTop, () => 2.15, x, 0.06), role: 'paint' });
    parts.push({ geo: panel(-3.0, -1.2, () => 2.15, () => 1.55, x, 0.06), role: 'paint' });
    parts.push({ geo: panel(0.4, 1.5, () => 2.15, () => 1.55, x, 0.06), role: 'paint' });
    parts.push({ geo: panel(-1.2, 0.4, () => 2.15, () => 1.55, x * 0.995, 0.03), role: 'glass' });
    parts.push({ geo: at(box(0.02, 0.3, 4.3), Math.sign(x) * (W / 2 + 0.005), 1.3, -0.75), role: 'paint2' });
  }
  parts.push({ geo: at(box(W - 0.1, 1.2, 0.06), 0, 1.1, -2.98), role: 'paint' });
  parts.push({ geo: at(box(W - 0.1, 0.55, 0.03), 0, 2.0, -2.99), role: 'glass' });
  parts.push({ geo: at(box(W - 0.1, 0.2, 0.06), 0, 2.6, -2.98), role: 'paint' });
  parts.push({ geo: at(box(W - 0.14, 0.06, 4.5), 0, 0.55, -0.75), role: 'trim' });
  parts.push({ geo: at(box(W - 0.1, 1.2, 0.06), 0, 2.1, 1.5), role: 'paint' });
  parts.push({ geo: at(rbox(W, 0.08, 4.6, 0.03), 0, 2.72, -0.75), role: 'roof' });
  // Stretcher and the attendant's bench.
  parts.push({ geo: at(rbox(0.6, 0.1, 1.95, 0.04), 0.3, 0.82, -0.9), role: 'seat' });
  parts.push({ geo: at(box(0.5, 0.3, 1.8), 0.3, 0.62, -0.9), role: 'chrome' });
  parts.push({ geo: at(rbox(0.42, 0.42, 1.3, 0.04), -0.72, 0.75, -0.9), role: 'seat' });
  parts.push({ geo: at(rbox(W + 0.02, 0.22, 0.16, 0.06), 0, 0.52, 3.0), role: 'trim' });
  lamps(parts, 3.02, -3.02, 0.8, 0.68, W, 1.0);
  const seats: Seat[] = [
    { x: -0.45, y: 0.95, z: 1.95, yaw: 0, driver: true, floor: 0.45 },
    { x: 0.3, y: 0.9, z: -0.9, yaw: Math.PI, lie: true, floor: 0.35 },
    { x: -0.62, y: 1.0, z: -0.6, yaw: Math.PI / 2, floor: 0.42 },
    { x: 0.45, y: 0.95, z: 1.95, yaw: 0, floor: 0.45 },
  ];
  seatParts(parts, -0.45, 0.95, 1.95, 0, 0.5);
  seatParts(parts, 0.45, 0.95, 1.95, 0, 0.5);
  return { parts, wheels, seats, steering: { x: -0.45, y: 1.26, z: 2.3, tilt: -0.8, r: 0.2 }, shadow: [W * 1.6, L * 1.15], length: L, width: W };
}

function pod(): KindModel {
  const L = TRAIN_LENGTH;
  const parts: KindModel['parts'] = [];
  // The capsule, split: the lower hull, and the glazed upper half (the roof above it fades from above).
  const shell = capsule(1.65, L - 3.3, 12, 28).clone();
  shell.rotateX(Math.PI / 2);
  shell.scale(1, 0.92, 1);
  shell.translate(0, 1.7, 0);
  const [low, high] = splitAt(shell, 2.0);
  const [glassBand, roof] = splitAt(high, 2.85);
  parts.push({ geo: low, role: 'paint' });
  parts.push({ geo: glassBand, role: 'glass' });
  parts.push({ geo: roof, role: 'roof' });
  parts.push({ geo: at(box(3.3, 0.35, L - 6), 0, 1.2, 0), role: 'paint2' });
  parts.push({ geo: at(box(2.6, 0.06, L - 4), 0, 0.75, 0), role: 'trim' });
  const seats: Seat[] = [{ x: 0, y: 1.2, z: L / 2 - 1.2, yaw: 0, floor: 0.45 }];
  for (let z = L / 2 - 3; z > -L / 2 + 2.5; z -= 1.15) for (const x of [-0.95, -0.45, 0.45, 0.95]) seats.push({ x, y: 1.2, z, yaw: 0, floor: 0.45 });
  for (let z = L / 2 - 3; z > -L / 2 + 2.5; z -= 1.15) for (const x of [-0.7, 0.7]) seatParts(parts, x, 1.2, z, 0, 0.95, false);
  return { parts, wheels: [], seats, steering: null, shadow: [0, 0], length: L, width: 3.3 };
}

function plane(): KindModel {
  const parts: KindModel['parts'] = [];
  const fus = capsule(1.9, 26, 12, 24).clone();
  fus.rotateX(Math.PI / 2);
  fus.translate(0, 3, 0);
  parts.push({ geo: fus, role: 'paint' });
  parts.push({ geo: at(box(30, 0.35, 4.2), 0, 2.6, 0.5), role: 'paint' });
  parts.push({ geo: at(box(10, 0.3, 2.4), 0, 3.6, -12.5), role: 'paint' });
  parts.push({ geo: at(box(0.35, 4.6, 3.6), 0, 5.5, -12.8), role: 'paint2' });
  for (const sx of [-6.5, 6.5]) {
    const eng = cyl(0.9, 0.9, 3.2, 18).clone();
    eng.rotateX(Math.PI / 2);
    eng.translate(sx, 1.8, 1.6);
    parts.push({ geo: eng, role: 'chrome' });
  }
  parts.push({ geo: at(box(0.08, 0.5, 20), 1.86, 3.5, 0.5), role: 'glass' });
  parts.push({ geo: at(box(0.08, 0.5, 20), -1.86, 3.5, 0.5), role: 'glass' });
  for (const sz of [-1.2, 8.5]) parts.push({ geo: at(cyl(0.3, 0.3, 1.2, 12), 0, 0.6, sz), role: 'trim' });
  return { parts, wheels: [], seats: [], steering: null, shadow: [30, 34], length: 30, width: 4 };
}

/** Split a geometry at a height: the triangles whose centres are below, and those above. */
function splitAt(g: THREE.BufferGeometry, y: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const src = g.index ? g.toNonIndexed() : g;
  const pos = src.attributes.position;
  const nor = src.attributes.normal;
  const lo: number[] = [];
  const hi: number[] = [];
  const ln: number[] = [];
  const hn: number[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const [P, Nn] = cy < y ? [lo, ln] : [hi, hn];
    for (let k = 0; k < 3; k++) {
      P.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
      Nn.push(nor.getX(i + k), nor.getY(i + k), nor.getZ(i + k));
    }
  }
  const make = (p: number[], n: number[]) => {
    const o = new THREE.BufferGeometry();
    o.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    o.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    return o;
  };
  return [make(lo, ln), make(hi, hn)];
}

// ── Materials by role ──

/** Glass: tinted and reflective, but you can see who is inside. */
const GLASS = new THREE.MeshPhysicalMaterial({ color: '#0E1418', roughness: 0.04, metalness: 0.05, transparent: true, opacity: 0.56, envMapIntensity: 1.1, depthWrite: false, side: THREE.FrontSide });
const SEAT = mat('#34363B', 0.85);
const DASH = mat('#1F2124', 0.7);
const TRIM = mat('#1C1D20', 0.6);
const CHROME = mat('#C9CED6', 0.25, 0.85);
const PLATE = mat('#F2E9B8', 0.5);
const BIN = mat('#2A2B2E', 0.9);
/** Roofs fade out when the camera looks down (every roof shares the fade). */
const roofs = new Map<string, THREE.MeshPhysicalMaterial>();
let roofOpacity = 1;

/** How much of a vehicle's roof shows at a camera pitch (degrees): all of it from the street, little from above. */
export function roofFade(pitch: number): number {
  return Math.max(0.12, Math.min(1, 1 - (pitch - 34) / 24));
}

/** The top of a kind of vehicle (metres above its wheels' contact), measured once from its geometry. */
const tops = new Map<Kind, number>();
function topOf(kind: Kind): number {
  let t = tops.get(kind);
  if (t === undefined) {
    t = 0;
    for (const p of kindModel(kind).parts) {
      if (!p.geo.boundingBox) p.geo.computeBoundingBox();
      t = Math.max(t, p.geo.boundingBox!.max.y);
    }
    tops.set(kind, t);
  }
  return t;
}

function roofMat(colour: string): THREE.MeshPhysicalMaterial {
  let m = roofs.get(colour);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ color: colour, roughness: 0.38, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.12, transparent: true, opacity: roofOpacity });
    roofs.set(colour, m);
  }
  return m;
}

function colours(world: World, v: Vehicle): [string, string] {
  switch (v.kind) {
    case 'car': {
      const hh = v.householdId ? world.households[v.householdId] : null;
      const c = hh ? plotColor(world.buildings[hh.houseId]?.plot ?? null, false) : '#8A8F98';
      // Real paint: the household's colour, muted toward the silvers and greys most cars are.
      return [mixHex(c, '#9AA0A6', 0.4), '#1C1D20'];
    }
    case 'ride':
      return ['#D9DCDF', '#2E8B7A'];
    case 'police':
      return ['#F4F6F8', '#2E4C8F'];
    case 'taxi': {
      const band = ['#D9A62E', '#2F6DB5', '#B8432E', '#1E7A5A'][Math.floor(hash01(v.baseId ?? v.id, 5) * 4)];
      return ['#F2F2EE', band];
    }
    case 'bus':
      return ['#2F6DB5', '#F4F6F8'];
    case 'bakkie':
      return [['#F2F2EE', '#8C7A5B', '#C9CED6', '#5A2E2A', '#2B2C31'][Math.floor(hash01(v.id, 3) * 5)], '#1C1D20'];
    case 'ambulance':
      return ['#F4F1EA', '#D0342C'];
    case 'train':
      return ['#F4F6F8', '#2F63D6'];
    default:
      return ['#F2F4F7', '#2F6DB5'];
  }
}

interface Model {
  root: THREE.Group;
  body: THREE.Group;
  own: THREE.Material[];
  wheels: Array<{ o: THREE.Object3D; spec: WheelSpec }>;
  steering: THREE.Object3D | null;
  beacons: Array<{ m: THREE.Mesh; phase: number }>;
  sign: THREE.Mesh | null;
  head: THREE.MeshStandardMaterial;
  tail: THREE.MeshStandardMaterial;
  indL: THREE.MeshStandardMaterial;
  indR: THREE.MeshStandardMaterial;
  key: string;
  x: number;
  y: number;
  yaw: number;
  speed: number;
  accel: number;
  yawRate: number;
  steer: number;
  pitch: number;
  roll: number;
  spin: number;
  seen: number;
  t?: number;
  kind: Kind;
  chauffeur: { h: Human; m: Motion } | null;
}

const TYRE = mat('#1D1E21', 0.85);
const RIM = mat('#B9BEC6', 0.3, 0.8);

function wheelObj(spec: WheelSpec): THREE.Object3D {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  const tyre = new THREE.Mesh(cyl(spec.r, spec.r, spec.w, 22), TYRE);
  tyre.rotation.z = Math.PI / 2;
  tyre.castShadow = true;
  const rim = new THREE.Mesh(cyl(spec.r * 0.62, spec.r * 0.62, spec.w + 0.02, 14), RIM);
  rim.rotation.z = Math.PI / 2;
  const spoke = new THREE.Mesh(box(spec.w + 0.03, spec.r * 0.16, spec.r * 1.05), mat('#8E949C', 0.35, 0.7));
  spin.add(tyre, rim, spoke);
  g.add(spin);
  g.position.set(spec.x, spec.r, spec.z);
  return g;
}

function build(world: World, v: Vehicle): Model {
  const km = kindModel(v.kind);
  const [c1, c2] = colours(world, v);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const head = new THREE.MeshStandardMaterial({ color: '#FFF6DE', emissive: '#FFE9B8', emissiveIntensity: 0.2, roughness: 0.2 });
  const tail = new THREE.MeshStandardMaterial({ color: '#C8322C', emissive: '#FF2A1F', emissiveIntensity: 0.15, roughness: 0.3 });
  const indL = new THREE.MeshStandardMaterial({ color: '#E0902C', emissive: '#FFA12E', emissiveIntensity: 0, roughness: 0.3 });
  const indR = indL.clone();
  const byRole: Record<Role, THREE.Material> = {
    paint: paint(c1), paint2: paint(c2), trim: TRIM, glass: GLASS, seat: SEAT, dash: DASH, chrome: CHROME, roof: roofMat(c1), head, tail, indL, indR, plate: PLATE, bin: BIN,
  };
  for (const p of km.parts) {
    const mesh = new THREE.Mesh(p.geo, byRole[p.role]);
    mesh.castShadow = p.role !== 'glass' && p.role !== 'roof';
    mesh.receiveShadow = true;
    if (p.role === 'glass') mesh.renderOrder = 3;
    body.add(mesh);
  }
  const wheels = km.wheels.map((spec) => {
    const o = wheelObj(spec);
    root.add(o);
    return { o, spec };
  });
  let steering: THREE.Object3D | null = null;
  if (km.steering) {
    const s = km.steering;
    const pivot = new THREE.Group();
    pivot.position.set(s.x, s.y, s.z);
    pivot.rotation.x = s.tilt;
    const ring = new THREE.Mesh(steeringRing(s.r), DASH);
    const hub = new THREE.Mesh(cyl(0.05, 0.05, 0.04, 12), DASH);
    hub.rotation.x = Math.PI / 2;
    const spokeBar = new THREE.Mesh(box(s.r * 1.9, 0.03, 0.02), DASH);
    const inner = new THREE.Group();
    inner.add(ring, hub, spokeBar);
    pivot.add(inner);
    body.add(pivot);
    steering = inner;
  }
  const beacons: Model['beacons'] = [];
  let sign: THREE.Mesh | null = null;
  const beacon = (c: string) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.3 });
  if (v.kind === 'police') {
    body.add(new THREE.Mesh(rbox(1.2, 0.08, 0.3, 0.03), TRIM).translateY(1.5).translateZ(-0.2));
    const a = new THREE.Mesh(rbox(0.5, 0.12, 0.26, 0.05), beacon('#3D7BFF'));
    a.position.set(-0.3, 1.58, -0.2);
    const b = new THREE.Mesh(rbox(0.5, 0.12, 0.26, 0.05), beacon('#FF4D4D'));
    b.position.set(0.3, 1.58, -0.2);
    body.add(a, b);
    beacons.push({ m: a, phase: 0 }, { m: b, phase: Math.PI });
    // A blue band and a yellow line along the doors.
    for (const sx of [1, -1]) {
      body.add(new THREE.Mesh(box(0.02, 0.16, 3.6), paint('#2E4C8F')).translateX(sx * 0.9).translateY(0.62));
      body.add(new THREE.Mesh(box(0.02, 0.04, 3.6), paint('#E8C23A')).translateX(sx * 0.9).translateY(0.51));
    }
  }
  if (v.kind === 'ambulance') {
    const a = new THREE.Mesh(rbox(0.5, 0.14, 0.28, 0.05), beacon('#FF4D4D'));
    a.position.set(-0.5, 2.8, 1.35);
    const b = new THREE.Mesh(rbox(0.5, 0.14, 0.28, 0.05), beacon('#3D7BFF'));
    b.position.set(0.5, 2.8, 1.35);
    body.add(a, b);
    beacons.push({ m: a, phase: 0 }, { m: b, phase: Math.PI });
  }
  if (v.kind === 'ride') {
    const sm = new THREE.MeshStandardMaterial({ color: '#9BF0D2', emissive: '#9BF0D2', emissiveIntensity: 0.6, roughness: 0.3 });
    sign = new THREE.Mesh(rbox(0.62, 0.18, 0.3, 0.05), sm);
    sign.position.set(0, 1.56, -0.3);
    body.add(sign);
  }
  if (km.shadow[0] > 0) {
    const blob = new THREE.Mesh(BLOB_GEO, blobShadow());
    blob.position.y = 0.015;
    blob.scale.set(km.shadow[0], 1, km.shadow[1]);
    root.add(blob);
  }
  const own: THREE.Material[] = [head, tail, indL, indR, ...beacons.map((b) => b.m.material as THREE.Material)];
  if (sign) own.push(sign.material as THREE.Material);
  return {
    root, body, own, wheels, steering, beacons, sign, head, tail, indL, indR, key: `${v.kind}|${v.householdId ?? ''}`, x: v.x, y: v.y, yaw: headingYaw(v.heading),
    speed: 0, accel: 0, yawRate: 0, steer: 0, pitch: 0, roll: 0, spin: 0, seen: 0, kind: v.kind, chauffeur: null,
  };
}

const BLOB_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const rings = new Map<number, THREE.TorusGeometry>();
/** A steering wheel's rim (one per size, shared). */
function steeringRing(r: number): THREE.TorusGeometry {
  let g = rings.get(r);
  if (!g) {
    g = new THREE.TorusGeometry(r, 0.022, 8, 28);
    rings.set(r, g);
  }
  return g;
}

/** Does the vehicle's route turn soon (so the driver indicates)? -1 left, 1 right, 0 straight on. */
function turning(v: Vehicle): -1 | 0 | 1 {
  if (!v.moving || v.path.length < 1) return 0;
  const a = Math.atan2(v.path[0].y - v.y, v.path[0].x - v.x);
  const d0 = Math.hypot(v.path[0].x - v.x, v.path[0].y - v.y);
  if (d0 > 28 || v.path.length < 2) return 0;
  const b = Math.atan2(v.path[1].y - v.path[0].y, v.path[1].x - v.path[0].x);
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  // On the map (y south), a positive turn is clockwise: to the right.
  return Math.abs(d) < 0.5 ? 0 : d > 0 ? 1 : -1;
}

export class Vehicles3D implements Rides {
  readonly root = new THREE.Group();
  private models = new Map<string, Model>();
  /** Where each vehicle was drawn (for seating the people inside, and labels). */
  readonly drawn = new Map<string, { x: number; y: number; yaw: number }>();

  constructor(private world: World) {
    this.root.name = 'vehicles';
    void loadHumans().catch(() => undefined);
  }

  /** Vehicles standing or driving near a point, as rectangles (for keeping people out of them). */
  footprints(x: number, y: number, r: number): Array<{ x: number; y: number; yaw: number; hw: number; hl: number }> {
    const out: Array<{ x: number; y: number; yaw: number; hw: number; hl: number }> = [];
    for (const m of this.models.values()) {
      if (m.kind === 'train' || m.kind === 'plane') continue;
      const km = kindModel(m.kind);
      if (Math.hypot(m.x - x, m.y - y) > r + km.length) continue;
      out.push({ x: m.x, y: m.y, yaw: m.yaw, hw: km.width / 2, hl: km.length / 2 });
    }
    return out;
  }

  /**
   * Vehicles near a point with their height (for the rain): a rectangle, the
   * floor of the cabin and the top of the roof. Aircraft are left out (a closed
   * fuselage keeps the rain out by itself).
   */
  covers(x: number, y: number, r: number): Array<{ x: number; y: number; yaw: number; hw: number; hl: number; floor: number; top: number }> {
    const out: Array<{ x: number; y: number; yaw: number; hw: number; hl: number; floor: number; top: number }> = [];
    for (const m of this.models.values()) {
      if (m.kind === 'plane') continue;
      const km = kindModel(m.kind);
      if (Math.hypot(m.x - x, m.y - y) > r + km.length) continue;
      const base = m.root.position.y;
      out.push({ x: m.x, y: m.y, yaw: m.yaw, hw: km.width / 2, hl: km.length / 2, floor: base + 0.4, top: base + topOf(m.kind) });
    }
    return out;
  }

  seatsOf(id: string): ReturnType<Rides['seatsOf']> {
    const m = this.models.get(id);
    if (!m) return null;
    const km = kindModel(m.kind);
    if (!km.seats.length) return null;
    // E-hailing riders take the back seats before the front.
    const seats = m.kind === 'ride' ? [km.seats[0], km.seats[2], km.seats[3], km.seats[1], km.seats[4]] : km.seats;
    return { x: m.x, y: m.y, h: m.root.position.y, yaw: m.yaw, pitch: m.pitch, roll: m.roll, seats, turn: m.steer * 2.2 };
  }

  update(f: { t: number; dt: number; micro: boolean; cx: number; cy: number; radius: number; night: number; eye: THREE.Vector3; pitch: number }, budget = 6): void {
    const world = this.world;
    // Roofs fade when looking down from above (a doll's-house view into the cabins).
    const fade = roofFade(f.pitch);
    if (Math.abs(fade - roofOpacity) > 0.005) {
      roofOpacity = fade;
      for (const m of roofs.values()) {
        m.opacity = fade;
        m.depthWrite = fade > 0.95;
      }
    }
    const keep = new Set<string>();
    let built = 0;
    for (const id in world.vehicles) {
      const v = world.vehicles[id];
      if (v.kind === 'plane' && v.airborne) continue;
      let vx = v.x;
      let vy = v.y;
      let heading = v.heading;
      if (v.kind === 'train') {
        const m = this.models.get(v.id);
        const dest = v.moving ? STATIONS[v.stopIdx + v.dir] ?? STATIONS[v.stopIdx] : null;
        const target = dest ? dest.t : v.trackPos;
        const t = m?.t === undefined || Math.abs(target - m.t) > 3000 ? target : m.t + (target - m.t) * (1 - Math.exp(-f.dt / 0.24));
        const pt = trackPoint(t);
        vx = pt.x;
        vy = pt.y;
        heading = target - t >= 0 ? pt.heading : pt.heading + Math.PI;
        if (m) m.t = t;
      }
      if (Math.hypot(vx - f.cx, vy - f.cy) > f.radius + (v.kind === 'train' ? 60 : v.kind === 'plane' ? 40 : 0)) continue;
      keep.add(id);
      let m = this.models.get(id);
      const key = `${v.kind}|${v.householdId ?? ''}`;
      if (m && m.key !== key) {
        this.drop(id, m);
        m = undefined;
      }
      if (!m) {
        if (built >= budget) continue;
        m = build(world, v);
        if (v.kind === 'train') m.t = v.trackPos;
        m.x = vx;
        m.y = vy;
        this.models.set(id, m);
        this.root.add(m.root);
        built++;
      }
      // Position: exact while animated, eased in time-lapse; speed, acceleration and turning from the motion.
      const px = m.x;
      const py = m.y;
      if (f.micro || v.kind === 'train') {
        m.x = vx;
        m.y = vy;
      } else {
        const k = 1 - Math.exp(-f.dt / 0.22);
        m.x += (vx - m.x) * k;
        m.y += (vy - m.y) * k;
      }
      const moved = Math.hypot(m.x - px, m.y - py);
      const sp = f.dt > 0 ? moved / f.dt : 0;
      const prev = m.speed;
      m.speed += (sp - m.speed) * Math.min(1, f.dt * 4);
      m.accel += ((f.dt > 0 ? (m.speed - prev) / f.dt : 0) - m.accel) * Math.min(1, f.dt * 3);
      const yaw = headingYaw(heading);
      let dy = yaw - m.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      const turn = dy * Math.min(1, f.dt * 8);
      m.yaw += turn;
      m.yawRate += ((f.dt > 0 ? turn / f.dt : 0) - m.yawRate) * Math.min(1, f.dt * 5);
      // Front wheels steer into the turn; the body dips under braking and leans out of turns.
      m.steer += (Math.max(-0.5, Math.min(0.5, m.yawRate * (m.speed > 0.5 ? 2.6 / Math.max(2, m.speed) : 0.4))) - m.steer) * Math.min(1, f.dt * 6);
      m.pitch += (Math.max(-0.03, Math.min(0.03, -m.accel * 0.006)) - m.pitch) * Math.min(1, f.dt * 5);
      m.roll += (Math.max(-0.035, Math.min(0.035, m.yawRate * m.speed * 0.004)) - m.roll) * Math.min(1, f.dt * 5);
      const y0 = v.kind === 'train' ? TRACK_Y + 0.18 : GROUND_Y;
      m.root.position.set(m.x, y0, m.y);
      m.root.rotation.y = m.yaw;
      m.body.rotation.set(m.pitch, 0, m.roll);
      m.spin += moved;
      for (const w of m.wheels) {
        const spin = w.o.children[0];
        spin.rotation.x = m.spin / w.spec.r;
        w.o.rotation.y = w.spec.steer ? m.steer : 0;
      }
      if (m.steering) m.steering.rotation.z = -m.steer * 4;
      for (const b of m.beacons) {
        const on = v.moving && Math.sin(f.t * 9 + b.phase) > 0;
        (b.m.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 3.2 : 0.25;
      }
      if (m.sign) {
        const sm = m.sign.material as THREE.MeshStandardMaterial;
        const c = !v.online ? '#8A8A8A' : (v.surge ?? 1) > 1.05 && v.stage !== null ? '#F2A33A' : '#9BF0D2';
        sm.color.set(c);
        sm.emissive.set(c);
        sm.emissiveIntensity = v.online ? 0.8 + f.night * 1.8 : 0.1;
      }
      // Lamps: headlights while driving (and at night); brake lights slowing down or standing with someone at the wheel.
      const occupied = v.occupantIds.length > 0 || !!m.chauffeur;
      m.head.emissiveIntensity = v.moving || v.kind === 'bus' ? 0.25 + f.night * 3 : 0.1;
      const braking = (v.moving && m.accel < -0.8) || (occupied && m.speed < 0.3 && v.kind !== 'train');
      m.tail.emissiveIntensity = (braking ? 2.2 : 0.15) + f.night * 1.1;
      const ind = turning(v);
      const blink = Math.sin(f.t * 9.4) > 0 ? 3 : 0;
      // (Indicator on the side it turns to: left on the map is the vehicle's left, +x.)
      m.indL.emissiveIntensity = ind === -1 ? blink : 0;
      m.indR.emissiveIntensity = ind === 1 ? blink : 0;
      this.chauffeur(v, m, f);
      m.seen = f.t;
      this.drawn.set(id, { x: m.x, y: m.y, yaw: m.yaw });
    }
    for (const [id, m] of this.models) if (!keep.has(id)) this.drop(id, m);
  }

  /** A driver at the wheel of a taxi, ambulance or bus that has none of its own in the simulation. */
  private chauffeur(v: Vehicle, m: Model, f: { t: number; dt: number; eye: THREE.Vector3 }): void {
    const needs = (v.kind === 'taxi' || v.kind === 'ambulance' || v.kind === 'bus') && !v.driverId && (v.moving || v.stage !== null || v.occupantIds.length > 0);
    const kit = humanKit();
    if (!needs || !kit) {
      if (m.chauffeur) {
        m.body.remove(m.chauffeur.h.root);
        m.chauffeur.h.dispose();
        m.chauffeur = null;
      }
      return;
    }
    const km = kindModel(v.kind);
    const st = km.seats[0];
    if (!m.chauffeur) {
      const h = new Human(kit);
      const seed = Math.floor(hash01(v.id, 9) * 1e9);
      const female = hash01(v.id, 11) < (v.kind === 'ambulance' ? 0.45 : 0.12);
      // Drivers from all the district's peoples (most of them from its African families).
      const who = hash01(v.id, 21);
      const people = who < 0.7 ? 'african' : who < 0.82 ? 'coloured' : who < 0.92 ? 'indian' : 'white';
      const skin =
        people === 'african' ? ['#8C5B3C', '#6E452C', '#553421', '#7A4E33'][Math.floor(hash01(v.id, 13) * 4)]
        : people === 'coloured' ? ['#B98660', '#A0704C'][Math.floor(hash01(v.id, 13) * 2)]
        : people === 'indian' ? ['#A9744F', '#94623F'][Math.floor(hash01(v.id, 13) * 2)]
        : ['#EAC7AE', '#E2B495'][Math.floor(hash01(v.id, 13) * 2)];
      const ancestry = people === 'african' ? { african: 1, asian: 0, caucasian: 0 } : people === 'coloured' ? { african: 0.45, asian: 0.2, caucasian: 0.35 } : people === 'indian' ? { african: 0.25, asian: 0.05, caucasian: 0.7 } : { african: 0, asian: 0, caucasian: 1 };
      const straight = people === 'indian' || people === 'white';
      const uniform = v.kind === 'ambulance' ? '#2F5D50' : v.kind === 'bus' ? '#3B5E8C' : ['#F4F3EF', '#2B2C31', '#3E5C8A', '#8E3B3B'][Math.floor(hash01(v.id, 15) * 4)];
      const age = 30 + hash01(v.id, 19) * 25;
      const wear: Look['wear'] = female
        ? [{ id: 'f_jeans', colors: ['#26282D'] }, { id: 'f_blouse', colors: [uniform] }, { id: 'shoes04', colors: [] }]
        : [{ id: 'm_trousers', colors: ['#26282D'] }, { id: v.kind === 'taxi' ? 'm_tee' : 'm_shirt', colors: [uniform] }, { id: 'shoes04', colors: [] }];
      if (v.kind === 'bus') wear.push({ id: 'hat_cap', colors: ['#27334A', '#101522'] });
      h.setLook({
        sex: female ? 'F' : 'M', age, height: female ? 1.62 : 1.72, weight: 0.45 + hash01(v.id, 17) * 0.3, muscle: 0.5, ancestry, details: {},
        skin, eyes: people === 'white' ? '#4A6FA0' : '#3A2414', hair: v.kind === 'bus' ? null : female ? (straight ? 'ponytail01' : 'bob02') : straight ? 'short02' : null, hairColor: people === 'white' ? '#5A3E28' : '#16110E',
        crop: v.kind === 'bus' || (!female && !straight) ? 1 : 0, recede: 0,
        brows: female ? 'eyebrow010' : 'eyebrow001', browColor: '#16110E', lashes: female ? 'eyelashes02' : 'eyelashes01', beard: female ? 0 : 0.4, wear, onesie: null,
      });
      const mo = new Motion(h, styleFor({ seed, female, age: 40, archetype: 'balanced', mood: 0.2, energy: 1 }), seed);
      h.root.position.set(st.x, st.y - (st.floor ?? 0.45), st.z);
      m.body.add(h.root);
      m.chauffeur = { h, m: mo };
      const act = { ...idleAct(), base: 'drive' as const, seat: st.floor ?? 0.45 };
      mo.update(f.t, f.dt, act);
      mo.snap();
    }
    const { h, m: mo } = m.chauffeur;
    const far = f.eye.distanceTo(tmpW.set(m.x, 1, m.y)) > 42;
    h.setFar(far);
    h.setShadows(!far);
    mo.update(f.t, f.dt, { ...idleAct(), base: 'drive', seat: st.floor ?? 0.45, wheel: m.steer * 2.2 });
  }

  private drop(id: string, m: Model): void {
    this.root.remove(m.root);
    for (const mm of m.own) mm.dispose();
    if (m.chauffeur) m.chauffeur.h.dispose();
    this.models.delete(id);
    this.drawn.delete(id);
  }

  clear(): void {
    for (const [id, m] of this.models) this.drop(id, m);
    this.models.clear();
    this.drawn.clear();
  }
}

const tmpW = new THREE.Vector3();
