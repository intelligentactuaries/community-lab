// The people, as lifelike figures (see humans.ts for the body, dress.ts for
// how each is dressed, motion.ts for how they move). Each frame this places
// everyone near the camera from what the simulation says: walking along their
// path (keeping to the left of it, so people passing do not walk through each
// other), standing in a circle to talk, sitting at their spot, asleep under
// the duvet, riding in a vehicle's seat, and tells each figure's animator what
// they are doing, who is speaking and where to look.
import * as THREE from 'three';
import { bedWidth } from '../../sim/beds';
import type { Person, Room, World } from '../../sim/types';
import { isLounge } from '../render/furniture';
import { plotColor } from '../lib/householdColor';
import { dressFor, skinOf } from './dress';
import { Duvet, type Capsule } from './duvet';
import { Human, loadHumans, setPeopleNight, type HumanKit } from './humans';
import { blobShadow, hash01, mixHex } from './materials';
import { Motion, idleAct, styleFor, type Act, type Activity, type Tone } from './motion';
import { FOV } from './view3d';
import { FLOOR_Y, GROUND_Y, PLATFORM_Y, type SpotPose, type World3D } from './world3d';

export { skinOf };

const BLOB_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const RING_GEO = new THREE.RingGeometry(0.5, 0.62, 40).rotateX(-Math.PI / 2);
const DUVET_MAT = new Map<string, THREE.MeshStandardMaterial>();

/**
 * Levels of detail by the share of the screen's height a figure takes, at MetaHuman's own body LOD screen sizes
 * (Body_LODSettings: LOD1 at 0.3, LOD2 at 0.15, LOD3 at 0.075 of the screen's height; a screen-size switch, so a
 * long lens keeps a distant face detailed and a wide one lets it go): 0 the full figure, animated every frame;
 * 1 the full figure, animated every other frame; 2 the light body (painted, no face) with its shadow, animated
 * every third; 3 the light body without a shadow, every fourth. At the scene's own lens the light body begins
 * 21 m from the eye and the shadow goes at 42 m.
 */
export const LOD_SCREEN = [0.3, 0.15, 0.075] as const;
export const LOD_EVERY = [1, 2, 3, 4] as const;
export function lodTier(screenShare: number): 0 | 1 | 2 | 3 {
  if (screenShare >= LOD_SCREEN[0]) return 0;
  if (screenShare >= LOD_SCREEN[1]) return 1;
  if (screenShare >= LOD_SCREEN[2]) return 2;
  return 3;
}
const FOV_TAN = Math.tan(((FOV / 2) * Math.PI) / 180);

/** Where a seated passenger sits in a vehicle: across (x, right-hand drive: the driver at -x), height, along (z, forward +). */
export interface Seat {
  x: number;
  y: number;
  z: number;
  /** Facing (radians from the vehicle's forward). */
  yaw: number;
  /** The seat's height above the floor under the passenger's feet. */
  floor?: number;
  driver?: boolean;
  lie?: boolean;
}

/** Where each vehicle is drawn and its seats (Vehicles3D provides it). */
export interface Rides {
  seatsOf(vehicleId: string): { x: number; y: number; h: number; yaw: number; pitch: number; roll: number; seats: Seat[]; turn: number } | null;
  footprints(x: number, y: number, r: number): Array<{ x: number; y: number; yaw: number; hw: number; hl: number }>;
}

interface Figure {
  h: Human;
  m: Motion;
  dressKey: string;
  x: number;
  y: number;
  /** Where the figure is drawn this frame (eased toward its target when it changes pose). */
  px: number;
  py: number;
  pf: number;
  yaw: number;
  speed: number;
  turn: number;
  lane: number;
  laneK: number;
  blob: THREE.Mesh;
  ring: THREE.Mesh;
  duvet: Duvet | null;
  act: Act;
  settled: boolean;
  /** Stepping aside: from each other (personal space) and out of vehicles' way. */
  sepX: number;
  sepY: number;
  /** Free to step aside (standing or walking, not seated, lying or riding), and whether indoors. */
  free: boolean;
  indoors: boolean;
  /** Level of detail this frame, the animator's time owed since it last ran, and this figure's turn in the stagger. */
  tier: 0 | 1 | 2 | 3;
  animAcc: number;
  slot: number;
}

export interface PeopleFrame {
  t: number;
  dt: number;
  micro: boolean;
  /** Simulated seconds per real second (0 when paused): walking from running, and fast-forward. */
  timeScale: number;
  cx: number;
  cy: number;
  radius: number;
  eye: THREE.Vector3;
  selectedId: string | null;
  hoverId: string | null;
  followId: string | null;
  highlightHouseholdId: string | null;
  singers: Set<string>;
  speakers: Set<string>;
  accent: string;
  rides?: Rides;
  /** How dark it is (0 day .. 1 night): pupils widen in the dark. */
  night?: number;
  /** The tangent of half the camera's vertical field of view (the scene's own lens when unset): for the levels of detail. */
  fovTan?: number;
}

/** Everyone near the camera, as figures; built when they come into range, dropped when they leave. */
export class People3D {
  readonly root = new THREE.Group();
  private figs = new Map<string, Figure>();
  private disp = new Map<string, { x: number; y: number }>();
  private kit: HumanKit | null = null;
  private frameNo = 0;
  private slotNo = 0;
  /** Where each figure was drawn last frame (for picking and labels): feet, floor, the top of the head. */
  readonly drawn = new Map<string, { x: number; y: number; floor: number; top: number; lying: boolean }>();

  constructor(private world: World, private w3: World3D) {
    this.root.name = 'people';
    loadHumans()
      .then((k) => (this.kit = k))
      .catch((e) => console.error('3D people unavailable', e));
  }

  update(f: PeopleFrame, maxFigures = 140, budget = 6): void {
    const kit = this.kit;
    if (!kit) return;
    setPeopleNight(f.night ?? 0);
    this.frameNo++;
    // Full figures built per frame (each takes a few milliseconds); the rest show their light body until their turn.
    Human.budget = 2;
    const world = this.world;
    const near: Array<{ p: Person; d: number }> = [];
    for (const id in world.people) {
      const p = world.people[id];
      if (!p.alive || p.emigrated || p.away) continue;
      if (p.inVehicleId && !f.rides?.seatsOf(p.inVehicleId)) continue;
      const d = Math.hypot(p.loc.x - f.cx, p.loc.y - f.cy);
      if (d < f.radius) near.push({ p, d });
    }
    near.sort((a, b) => a.d - b.d);
    const keep = new Set(near.slice(0, maxFigures).map((n) => n.p.id));
    for (const [id, g] of this.figs) {
      if (!keep.has(id)) this.drop(id, g);
    }
    // Who shares a spot (a couple in a bed, a family on a pew), and who is in which vehicle seat.
    const sharers = new Map<string, string[]>();
    for (const { p } of near) {
      if (!keep.has(p.id) || !p.loc.spotId) continue;
      const arr = sharers.get(p.loc.spotId) ?? [];
      arr.push(p.id);
      sharers.set(p.loc.spotId, arr);
    }
    const circles = this.circles(near, keep);
    this.stepAside(f);
    let built = 0;
    for (const { p } of near) {
      if (!keep.has(p.id)) continue;
      let g = this.figs.get(p.id);
      if (!g) {
        if (built >= budget) continue;
        g = this.build(kit, p);
        built++;
      }
      this.place(p, g, f, sharers, circles);
    }
  }

  private build(kit: HumanKit, p: Person): Figure {
    const h = new Human(kit);
    const female = p.sex === 'F';
    const seed = Math.floor(hash01(p.id, 71) * 1e9);
    const m = new Motion(h, styleFor({ seed, female, age: p.age, archetype: p.archetype, mood: p.mood, energy: p.energy }), seed);
    const blob = new THREE.Mesh(BLOB_GEO, blobShadow());
    blob.renderOrder = 1;
    const ring = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color: '#26714C', transparent: true, opacity: 0.95, depthWrite: false }));
    ring.visible = false;
    ring.renderOrder = 2;
    this.root.add(h.root, blob, ring);
    const g: Figure = {
      h, m, dressKey: '', x: p.loc.x, y: p.loc.y, px: p.loc.x, py: p.loc.y, pf: 0, yaw: headingYaw(p.heading), speed: 0, turn: 0,
      // Walkers keep to the left of their way (0.25-0.7 m), so two people passing do not meet.
      lane: 0.25 + hash01(p.id, 73) * 0.45, laneK: 0, blob, ring, duvet: null, act: idleAct(), settled: false, sepX: 0, sepY: 0, free: false, indoors: false,
      tier: 0, animAcc: 0, slot: this.slotNo++,
    };
    this.figs.set(p.id, g);
    return g;
  }

  private drop(id: string, g: Figure): void {
    this.root.remove(g.h.root, g.blob, g.ring);
    if (g.duvet) {
      this.root.remove(g.duvet.mesh);
      g.duvet.dispose();
    }
    g.h.dispose();
    (g.ring.material as THREE.Material).dispose();
    this.figs.delete(id);
    this.drawn.delete(id);
    this.disp.delete(id);
  }

  /**
   * Personal space: people on foot who would overlap step apart (walkers sideways, so they walk side by
   * side), and nobody stands inside a vehicle (a bus draws up where its passengers wait).
   */
  private stepAside(f: PeopleFrame): void {
    const list = [...this.figs.values()].filter((g) => g.free && g.settled);
    const want = new Map<Figure, [number, number]>();
    for (const g of list) want.set(g, [0, 0]);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = a.px - b.px;
        const dy = a.py - b.py;
        const d = Math.hypot(dx, dy);
        const need = 0.62;
        if (d >= need || Math.abs(a.pf - b.pf) > 0.5) continue;
        // Apart along the line between them (or sideways to their way when on top of each other).
        let ux = dx / (d || 1);
        let uy = dy / (d || 1);
        if (d < 0.02) {
          ux = Math.cos(a.yaw);
          uy = -Math.sin(a.yaw);
        }
        const push = (need - d) / 2;
        const wa = want.get(a)!;
        const wb = want.get(b)!;
        wa[0] += ux * push;
        wa[1] += uy * push;
        wb[0] -= ux * push;
        wb[1] -= uy * push;
      }
    }
    for (const g of list) {
      const w = want.get(g)!;
      if (!g.indoors && f.rides) {
        for (const v of f.rides.footprints(g.px, g.py, 3)) {
          // Into the vehicle's frame: lx across (left +), lz along.
          const dx = g.px - v.x;
          const dy = g.py - v.y;
          const c = Math.cos(v.yaw);
          const s = Math.sin(v.yaw);
          const lx = dx * c - dy * s;
          const lz = dx * s + dy * c;
          const mx = v.hw + 0.35 - Math.abs(lx);
          const mz = v.hl + 0.35 - Math.abs(lz);
          if (mx <= 0 || mz <= 0) continue;
          // Out by the nearer side.
          const ox = mx < mz ? Math.sign(lx || 1) * mx : 0;
          const oz = mx < mz ? 0 : Math.sign(lz || 1) * mz;
          w[0] += ox * c + oz * s;
          w[1] += -ox * s + oz * c;
        }
      }
      // Walkers only sidestep (across their way), so they do not stop or surge.
      if (g.act.base === 'walk') {
        const lx = Math.cos(g.yaw);
        const ly = -Math.sin(g.yaw);
        const side = w[0] * lx + w[1] * ly;
        w[0] = lx * side;
        w[1] = ly * side;
      }
      const cap = g.indoors ? 0.3 : 3;
      const len = Math.hypot(w[0], w[1]);
      if (len > cap) {
        w[0] *= cap / len;
        w[1] *= cap / len;
      }
      const k = Math.min(1, f.dt * 2.5);
      g.sepX += (g.sepX + w[0] - g.sepX) * k;
      g.sepY += (g.sepY + w[1] - g.sepY) * k;
      // Let it go again once there is room.
      g.sepX *= 1 - Math.min(1, f.dt * 0.35);
      g.sepY *= 1 - Math.min(1, f.dt * 0.35);
    }
    for (const g of this.figs.values()) {
      if (g.free) continue;
      g.sepX *= 1 - Math.min(1, f.dt * 3);
      g.sepY *= 1 - Math.min(1, f.dt * 3);
    }
  }

  /** Standing conversations: each group's centre and how far apart they stand (a circle, facing in). */
  private circles(near: Array<{ p: Person }>, keep: Set<string>): Map<string, { x: number; y: number; r: number; ids: string[] }> {
    const out = new Map<string, { x: number; y: number; r: number; ids: string[] }>();
    const world = this.world;
    for (const { p } of near) {
      const cid = p.conversationId;
      if (!cid || !keep.has(p.id) || p.inVehicleId) continue;
      let c = out.get(cid);
      if (!c) {
        c = { x: 0, y: 0, r: 0, ids: [] };
        out.set(cid, c);
      }
      const d = this.disp.get(p.id) ?? p.loc;
      c.x += d.x;
      c.y += d.y;
      c.ids.push(p.id);
    }
    for (const [cid, c] of out) {
      const n = c.ids.length;
      c.x /= n;
      c.y /= n;
      c.r = n <= 2 ? 0.52 : n === 3 ? 0.64 : n === 4 ? 0.74 : 0.34 + 0.1 * n;
      if (!world.conversations[cid] || n < 2) out.delete(cid);
    }
    return out;
  }

  private place(p: Person, g: Figure, f: PeopleFrame, sharers: Map<string, string[]>, circles: Map<string, { x: number; y: number; r: number; ids: string[] }>): void {
    const world = this.world;
    const h = g.h;
    // Where the simulation has them: exact while animated, eased in time-lapse (like the flat map).
    let d = this.disp.get(p.id);
    if (!d) this.disp.set(p.id, (d = { x: p.loc.x, y: p.loc.y }));
    const px = d.x;
    const py = d.y;
    if (f.micro) {
      d.x = p.loc.x;
      d.y = p.loc.y;
    } else {
      const k = 1 - Math.exp(-f.dt / 0.22);
      d.x += (p.loc.x - d.x) * k;
      d.y += (p.loc.y - d.y) * k;
    }
    const moved = Math.hypot(d.x - px, d.y - py);
    const inst = f.dt > 0 ? moved / f.dt : 0;
    g.speed += (inst - g.speed) * Math.min(1, f.dt * 8);
    const a = p.plan[p.planIdx];
    const b = p.loc.buildingId ? world.buildings[p.loc.buildingId] : null;
    const room = b && p.loc.roomId ? b.rooms.find((r) => r.id === p.loc.roomId) : null;
    const walled = !!room && !['yard', 'field', 'pitch', 'graves', 'pen', 'stop', 'stand'].includes(room.kind);
    let floor = walled ? FLOOR_Y : GROUND_Y;
    if (room && this.w3.decks.has(room.id)) floor = PLATFORM_Y;
    const sp: SpotPose | undefined = p.loc.spotId ? this.w3.spots.get(p.loc.spotId) : undefined;
    const spot = p.loc.spotId && room ? room.spots.find((s) => s.id === p.loc.spotId) : undefined;
    const spotKind = spot?.kind;
    const walking = g.speed > 0.25 && !p.inVehicleId;
    let base: Act['base'] = walking ? 'walk' : 'stand';
    let x = d.x;
    let y = d.y;
    let yaw = walking ? headingYaw(Math.atan2(d.y - py, d.x - px)) : g.yaw;
    let seat = floor;
    let roll = 0;
    let pitch = 0;
    let bodyRoll = 0;
    const atSpot = !!sp && Math.hypot(p.loc.x - sp.x, p.loc.y - sp.y) < 1.6 && !walking;
    const sleeping = !!a && a.kind === 'sleep' && !!sp && sp.pose === 'lie';
    const hs = p.health.state;
    let lying = false;
    let driving = false;
    let wheel = 0;
    const conv = p.conversationId ? world.conversations[p.conversationId] : null;
    if (p.inVehicleId && f.rides) {
      // In a vehicle: in their seat, moving with it.
      const v = world.vehicles[p.inVehicleId];
      const r = f.rides.seatsOf(p.inVehicleId)!;
      const occ = v ? v.occupantIds.filter((id) => world.people[id]) : [];
      const drv = v?.driverId && occ.includes(v.driverId) ? v.driverId : null;
      const order = drv ? [drv, ...occ.filter((id) => id !== drv)] : occ;
      let idx = order.indexOf(p.id);
      // Seat 0 is the driver's; without a driver of their own, passengers start from seat 1.
      if (!drv) idx += 1;
      const st = r.seats[Math.min(r.seats.length - 1, Math.max(0, idx))];
      const cs = Math.cos(r.yaw);
      const sn = Math.sin(r.yaw);
      // Vehicle frame: forward +z, left +x (the scene's yaw turns +z toward the heading).
      x = r.x + st.x * cs + st.z * sn;
      y = r.y - st.x * sn + st.z * cs;
      floor = r.h + st.y - (st.floor ?? 0.45);
      seat = r.h + st.y;
      yaw = r.yaw + st.yaw;
      pitch = r.pitch;
      bodyRoll = r.roll;
      base = st.lie ? 'lie' : st.driver && p.id === drv ? 'drive' : 'sit';
      driving = base === 'drive';
      wheel = r.turn;
      lying = !!st.lie;
    } else if (atSpot && sp && (sharers.get(p.loc.spotId!) ?? [p.id]).indexOf(p.id) >= capacity(spotKind)) {
      // More people than the seat holds: the rest stand beside it (a visitor at a hospital bed, a friend by an armchair).
      const mates = sharers.get(p.loc.spotId!) ?? [p.id];
      const extra = mates.indexOf(p.id) - capacity(spotKind);
      const side = extra % 2 === 0 ? 1 : -1;
      const off = side * (0.75 + Math.floor(extra / 2) * 0.55);
      x = sp.x + Math.sin(sp.spread) * off;
      y = sp.y + Math.cos(sp.spread) * off;
      yaw = sp.pose === 'lie' ? yawToward(x, y, sp.x, sp.y) : sp.yaw;
    } else if (atSpot && sp) {
      const all = sharers.get(p.loc.spotId!) ?? [p.id];
      const mates = all.slice(0, capacity(spotKind));
      const i = mates.indexOf(p.id);
      const n = mates.length;
      // Side by side; a bed holds only so many (children squeeze in). In a bed at home each keeps to their own side
      // of it, as the simulation has them (a husband and wife in their double bed).
      const gap = sp.pose === 'lie' ? Math.min(0.46, 1.2 / Math.max(1, n - 1)) : 0.58;
      const half = spot?.kind === 'bed' ? bedWidth(spot) / 2 - 0.25 : 0;
      const off = spot && half ? Math.max(-half, Math.min(half, p.loc.x - spot.x)) : (i - (n - 1) / 2) * gap;
      x = sp.x + Math.sin(sp.spread) * off;
      y = sp.y + Math.cos(sp.spread) * off;
      if (sp.pose === 'lie' && (sleeping || hs === 'ill' || hs === 'injured' || hs === 'critical' || room?.kind === 'ward' || spotKind === 'exam')) {
        base = 'lie';
        lying = true;
        seat = sp.height;
        // Some sleep on their back, most on a side (and turn over in the night).
        const turn = Math.floor(world.minute / 97 + hash01(p.id, 75) * 7) % 3;
        roll = hs === 'critical' || room?.kind === 'ward' ? 0 : turn === 0 ? 0 : turn === 1 ? 1 : -1;
        yaw = sp.yaw + Math.PI;
      } else if (sp.pose === 'sit' || sp.pose === 'lie') {
        base = 'sit';
        seat = sp.pose === 'lie' ? sp.height - 0.1 : sp.height;
        yaw = sp.pose === 'lie' ? sp.yaw + Math.PI / 2 : sp.yaw;
      } else {
        // Standing: on whatever raises the spot (the pulpit's platform).
        yaw = sp.yaw;
        floor = Math.max(floor, sp.height);
      }
    }
    // A baby not yet walking sits on the floor rather than standing.
    if (p.age < 1 && base === 'stand') {
      base = 'sit';
      seat = floor + 0.02;
    }
    // Talking while standing: a circle facing in, a comfortable distance apart.
    const circle = conv && base === 'stand' && !atSpot ? circles.get(conv.id) : undefined;
    if (circle && circle.ids.length >= 2) {
      let dx = x - circle.x;
      let dy = y - circle.y;
      let l = Math.hypot(dx, dy);
      if (l < 0.05) {
        const ang = (circle.ids.indexOf(p.id) / circle.ids.length) * Math.PI * 2;
        dx = Math.cos(ang);
        dy = Math.sin(ang);
        l = 1;
      }
      x = circle.x + (dx / l) * circle.r;
      y = circle.y + (dy / l) * circle.r;
    }
    if (conv && base !== 'lie' && base !== 'walk' && base !== 'drive' && !(base === 'sit' && sp && (room?.kind === 'nave' || room?.kind === 'auditorium' || room?.kind === 'classroom'))) {
      let ox = 0;
      let oy = 0;
      let k = 0;
      for (const q of conv.participantIds) {
        if (q === p.id) continue;
        const qd = this.disp.get(q) ?? world.people[q]?.loc;
        if (!qd) continue;
        ox += qd.x;
        oy += qd.y;
        k++;
      }
      if (k) {
        const want = Math.atan2(ox / k - x, oy / k - y);
        // Seated people turn their heads rather than their chairs.
        if (base === 'stand') yaw = want;
      }
    }
    // Walkers keep to the left of their way outdoors (not through doorways).
    const outdoors = !p.loc.buildingId && !p.inVehicleId;
    g.laneK += ((walking && outdoors ? 1 : 0) - g.laneK) * Math.min(1, f.dt * 1.5);
    if (g.laneK > 0.001) {
      const hx = Math.sin(yaw);
      const hz = Math.cos(yaw);
      // The walker's left, in the scene: (hz, -hx) turned from their heading (+z forward, +x left); and a gentle meander.
      const off = (g.lane + Math.sin(f.t * 0.23 + g.lane * 40) * 0.12) * g.laneK;
      x += hz * off;
      y += -hx * off;
    }
    // Personal space, and out of vehicles' way.
    g.free = !p.inVehicleId && (base === 'walk' || (base === 'stand' && !atSpot));
    g.indoors = walled;
    if (g.free) {
      x += g.sepX;
      y += g.sepY;
    }
    // Turning speed, for leaning into turns.
    let dyaw = yaw - g.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const turnRate = Math.min(walking ? 10 : 6, 60) * f.dt;
    g.turn += ((f.dt > 0 ? dyaw / Math.max(f.dt, 1e-3) : 0) * 0.1 - g.turn) * Math.min(1, f.dt * 4);
    g.yaw += dyaw * Math.min(1, turnRate);
    // Changing pose (sitting down, getting up) the body glides to its new place instead of jumping.
    const settle = base === 'walk' || p.inVehicleId ? 1 : 1 - Math.exp(-f.dt / 0.18);
    if (!g.settled) {
      g.px = x;
      g.py = y;
      g.pf = floor;
    } else {
      g.px += (x - g.px) * settle;
      g.py += (y - g.py) * settle;
      g.pf += (floor - g.pf) * settle;
    }
    h.root.position.set(g.px, g.pf, g.py);
    h.root.rotation.set(pitch, g.yaw, bodyRoll, 'YXZ');
    // What they are doing, for the animator.
    const act = g.act;
    act.base = base;
    act.speed = g.speed;
    act.simSpeed = f.timeScale > 0 ? g.speed / f.timeScale : 0;
    act.turn = g.turn;
    act.seat = Math.max(0.2, seat - floor);
    const sg = seatGeometry(spotKind, room, !!p.inVehicleId);
    act.seatDepth = sg.depth;
    act.seatBack = sg.back;
    act.roll = roll;
    act.speaking = f.speakers.has(p.id);
    act.listening = !!conv && !act.speaking;
    act.tone = (conv?.tone as Tone | undefined) ?? null;
    act.activity = activityOf(p, a?.kind, spotKind, base, f.singers.has(p.id));
    act.sleeping = lying && (sleeping || hs === 'critical');
    act.sad = !!p.grief || hs === 'critical' || conv?.tone === 'grief';
    act.elderly = p.age >= 75;
    act.mood = p.mood;
    act.energy = p.energy;
    act.wheel = driving ? wheel : 0;
    act.baby = p.age < 1.5;
    act.lookAt = conv && base !== 'lie' ? this.lookTarget(p, conv, f.t) : null;
    // Dress for the day and the moment.
    // Sunday best at church, and at a funeral or a wedding.
    const church = !!a && (a.kind === 'church' || a.kind === 'funeral' || a.kind === 'wedding') && p.loc.buildingId === a.buildingId;
    const working = !!a && (a.kind === 'work' || a.kind === 'patrol') && p.loc.buildingId === a.buildingId;
    const school = !!a && a.kind === 'school';
    const dctx = { working, school, church, asleep: act.sleeping || (lying && !!a && a.kind === 'sleep') };
    const key = `${p.age < 2 ? 0 : Math.floor(p.age)}|${working ? p.job : ''}|${school}|${church}|${dctx.asleep}|${world.day}|${world.weather.season}`;
    if (key !== g.dressKey) {
      g.dressKey = key;
      const dr = dressFor(world, p, dctx);
      h.setLook(dr.look);
    }
    // Far away (by how much of the screen they take): the lighter body, no face, then no shadow.
    const dist = f.eye.distanceTo(tmpV.set(g.px, g.pf + 1.2, g.py));
    const tier = lodTier(h.height / (2 * dist * (f.fovTan ?? FOV_TAN)));
    g.tier = tier;
    h.setFar(tier >= 2);
    h.setShadows(tier <= 2);
    // The animator runs every frame up close and every second, third or fourth frame further off (Unreal's
    // update-rate optimisation), the figures staggered so no frame carries them all; the eased pose keeps up.
    g.animAcc += f.dt;
    const ran = !g.settled || (this.frameNo + g.slot) % LOD_EVERY[tier] === 0;
    if (ran) {
      g.m.update(f.t, g.animAcc, act);
      g.animAcc = 0;
    }
    if (!g.settled) {
      g.m.snap();
      g.settled = true;
    }
    // One duvet over whoever lies in a bed (a blanket in the ward), laid by the first of them and draped over all
    // of them; what lies beneath it is not drawn, so nothing pokes through it.
    const inBed = lying && !p.inVehicleId && !!sp && spotKind !== 'exam';
    const mates = inBed && p.loc.spotId ? (sharers.get(p.loc.spotId) ?? [p.id]).slice(0, capacity(spotKind)) : [];
    if (inBed && mates[0] === p.id && sp) {
      const ward = room?.kind === 'ward';
      const hb = ward ? '#9CC7D6' : b?.kind === 'house' ? plotColor(b.plot ?? null, false) : '#8EA3BE';
      const n = mates.length;
      // Across the whole of a bed at home; over however many lie there anywhere else.
      const wide = spot?.kind === 'bed' ? bedWidth(spot) - 0.1 : Math.max(0.85, (n > 1 ? Math.min(0.46, 1.2 / (n - 1)) * (n - 1) : 0) + 0.75);
      this.duvet(g, mixHex(hb, '#FFFFFF', ward ? 0.1 : 0.35), seat - floor, sp.x, sp.y, wide, mates, ran);
    } else if (g.duvet) g.duvet.mesh.visible = false;
    if (!inBed) h.setDuvet(null);
    // The contact shadow and the ring (selected, followed, hovered, or the highlighted household).
    g.blob.visible = !lying && !p.inVehicleId;
    const s = h.scale;
    g.blob.position.set(g.px, g.pf + 0.012, g.py);
    g.blob.scale.set(0.95 * Math.max(0.5, s), 1, 0.95 * Math.max(0.5, s));
    const ring = p.id === f.selectedId ? f.accent : p.id === f.followId ? f.accent : p.id === f.hoverId ? '#8A8478' : f.highlightHouseholdId === p.householdId ? plotColor(world.buildings[world.households[p.householdId]?.houseId ?? '']?.plot ?? null, false) : null;
    this.setRing(g, ring, p.id === f.selectedId ? 1.1 : 1, lying ? seat + 0.35 : p.inVehicleId ? seat + 0.02 : g.pf + 0.02);
    // For labels and picking: the head's actual place this frame.
    h.root.updateMatrixWorld(true);
    const head = h.bone('head').getWorldPosition(tmpV);
    const top = head.y + h.headTop;
    this.drawn.set(p.id, { x: lying ? head.x : g.px, y: lying ? head.z : g.py, floor: g.pf, top, lying });
  }

  /** Who a talker looks at: listeners watch whoever spoke last; the speaker looks round at them in turn. */
  private lookTarget(p: Person, conv: { participantIds: string[]; lines: Array<{ speakerId: string }> }, t: number): THREE.Vector3 | null {
    const last = conv.lines[conv.lines.length - 1]?.speakerId;
    let who: string | undefined;
    if (last && last !== p.id) who = last;
    else {
      const others = conv.participantIds.filter((id) => id !== p.id && this.drawn.has(id));
      if (!others.length) return null;
      who = others[Math.floor(t / 3.2 + hash01(p.id, 77) * others.length) % others.length];
    }
    const d = who ? this.drawn.get(who) : undefined;
    if (!d) return null;
    return new THREE.Vector3(d.x, d.top - 0.1, d.y);
  }

  /**
   * The duvet over a bed's sleepers: centred on the bed, `wide` across, from their chests to past their feet,
   * draped over every one of them (their trunks and limbs as capsules, the way a cloth simulation settles over a
   * character's collision shapes) whenever the animator has moved them; and each of them hidden within its
   * footprint, so no knee or elbow can come through it.
   */
  private duvet(g: Figure, colour: string, mattress: number, bx: number, by: number, wide: number, mates: string[], relay: boolean): void {
    let m = DUVET_MAT.get(colour);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.92, side: THREE.DoubleSide });
      DUVET_MAT.set(colour, m);
    }
    if (!g.duvet) {
      g.duvet = new Duvet(m);
      this.root.add(g.duvet.mesh);
      relay = true;
    }
    g.duvet.mesh.material = m;
    g.duvet.mesh.visible = true;
    // Along the sleepers (they lie head to -z of their own frame, so the feet are toward +z).
    const fx = Math.sin(g.yaw);
    const fz = Math.cos(g.yaw);
    if (relay) {
      const caps: Capsule[] = [];
      for (const id of mates) {
        const f = this.figs.get(id);
        if (f) capsulesOf(f.h, caps);
      }
      g.duvet.update(bx + fx * 0.4, by + fz * 0.4, g.yaw, wide, 1.5, g.pf + mattress, caps);
    }
    g.duvet.footprint(dvM, dvV);
    for (const id of mates) this.figs.get(id)?.h.setDuvet(dvM, dvV);
  }

  private setRing(g: Figure, color: string | null, width: number, y: number): void {
    if (!color) {
      g.ring.visible = false;
      return;
    }
    g.ring.visible = true;
    (g.ring.material as THREE.MeshBasicMaterial).color.set(color);
    const k = 0.9 * width * Math.max(0.6, g.h.scale);
    g.ring.scale.set(k, 1, k);
    g.ring.position.set(g.px, y, g.py);
  }

  clear(): void {
    for (const [id, g] of this.figs) this.drop(id, g);
    this.figs.clear();
    this.drawn.clear();
  }
}

/**
 * What is sat on (the furniture in world3d.ts and vehicles3d.ts): half its depth (how far its front edge is
 * from the spot) and how far behind the spot its backrest's face stands, if it has one.
 */
function seatGeometry(kind: string | undefined, room: Room | null | undefined, vehicle: boolean): { depth: number; back: number | null } {
  if (vehicle) return { depth: 0.24, back: null };
  switch (kind) {
    case 'bench':
    case 'bench-out':
      return { depth: 0.225, back: 0.215 };
    case 'pew':
      return { depth: 0.25, back: 0.235 };
    case 'desk':
      return { depth: 0.25, back: 0.21 };
    case 'seat':
      if (room?.kind === 'stand') return { depth: 0.23, back: null };
      return room && (isLounge(room) || room.kind === 'reception' || room.kind === 'consult') ? { depth: 0.275, back: 0.235 } : { depth: 0.23, back: 0.185 };
    case 'cell':
    case 'table':
      return { depth: 0.23, back: 0.185 };
    default:
      return { depth: 0.23, back: null };
  }
}

const dvM = new THREE.Matrix4();
const dvV = new THREE.Vector3();
const capA = new THREE.Vector3();
const capB = new THREE.Vector3();

/**
 * A figure's trunk and limbs as capsules in world space, the way a physics asset stands for a body (the
 * shoulders across, the trunk, each arm and hand, each leg and foot; the head stays out, on the pillow), for
 * the duvet to drape over.
 */
function capsulesOf(h: Human, out: Capsule[]): void {
  h.root.updateMatrixWorld(true);
  const s = (h.height / 1.7) * h.stout;
  const seg = (a: string, b: string, r: number, extend = 0) => {
    h.bone(a).getWorldPosition(capA);
    h.bone(b).getWorldPosition(capB);
    if (extend > 0) {
      capB.sub(capA);
      const l = capB.length() || 1;
      capB.multiplyScalar((l + extend) / l).add(capA);
    }
    out.push({ ax: capA.x, ay: capA.y, az: capA.z, bx: capB.x, by: capB.y, bz: capB.z, r });
  };
  seg('upperarmL', 'upperarmR', 0.075 * s);
  seg('hips', 'chest', 0.13 * s);
  seg('chest', 'neck', 0.115 * s);
  for (const sd of ['L', 'R']) {
    seg(`upperarm${sd}`, `forearm${sd}`, 0.05 * s);
    seg(`forearm${sd}`, `hand${sd}`, 0.045 * s, 0.09 * s);
    seg(`thigh${sd}`, `shin${sd}`, 0.08 * s);
    seg(`shin${sd}`, `foot${sd}`, 0.06 * s);
    seg(`foot${sd}`, `toe${sd}`, 0.055 * s, 0.03 * s);
  }
}

function activityOf(p: Person, kind: string | undefined, spot: string | undefined, base: Act['base'], singing: boolean): Activity {
  if (singing) return 'sing';
  if (base === 'sit' && spot === 'desk' && (kind === 'work' || kind === 'school' || kind === 'homeschool')) return 'type';
  if (base === 'sit' && (kind === 'breakfast' || kind === 'lunch' || kind === 'dinner') && (spot === 'table' || spot === 'seat')) return 'eat';
  if (base === 'stand' && spot === 'stove') return 'cook';
  if ((kind === 'play' || kind === 'sport' || kind === 'match') && p.age < 14 && base !== 'sit') return 'play';
  if (kind === 'biblestudy' && base === 'sit') return 'read';
  // Teenagers and adults at rest check their phones now and then.
  if ((kind === 'rest' || kind === 'idle') && p.age >= 13 && p.age < 65 && Math.sin(Date.now() / 60000 + hash01(p.id, 79) * 20) > 0.55) return 'phone';
  return null;
}

const tmpV = new THREE.Vector3();

/** How many can sit (or lie) at a spot of this kind; the rest stand beside it. */
function capacity(kind: string | undefined): number {
  switch (kind) {
    case 'bed':
      return 4;
    case 'pew':
      return 6;
    case 'bench':
    case 'bench-out':
      return 3;
    case 'cell':
      return 2;
    case undefined:
      return 99;
    default:
      return 1;
  }
}

/** The yaw that faces from (x, y) toward (tx, ty) on the map. */
function yawToward(x: number, y: number, tx: number, ty: number): number {
  return Math.atan2(tx - x, ty - y);
}

/** A heading on the map (atan2 of dy, dx) as a yaw in the scene (0 faces +z, south). */
export function headingYaw(h: number): number {
  return Math.atan2(Math.cos(h), Math.sin(h));
}

