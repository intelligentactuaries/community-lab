// How the people move: a procedural animator over the Human skeleton. It
// computes a pose for the moment from what the person is doing (walking at a
// speed, standing, sitting at a height, lying, driving) and layers on top what
// makes people look alive: the weight shifting from foot to foot, habits of
// the arms (folded, in pockets, behind the back), glances around, blinking,
// breathing, and in conversation the speaker's gestures and the listeners'
// nods, all eased so one pose flows into the next. Everyone moves a little
// differently: stride, arm swing, posture and gesture are drawn from the
// person (age, sex, temperament, mood and energy).
//
// Axes: the figure faces +z, its left is +x, up is +y; every bone rests
// unrotated (the modelled A-pose), so a bone's rotation is in the figure's
// frame: x bends forward and back, y turns, z tilts sideways.
import * as THREE from 'three';
import type { Human } from './humans';

export type Base = 'stand' | 'walk' | 'sit' | 'lie' | 'drive';
export type ArmStyle = 'relaxed' | 'crossed' | 'pockets' | 'behind' | 'akimbo' | 'clasped' | 'phone';
export type Tone = 'warm' | 'neutral' | 'tense' | 'grief' | 'joy' | 'gossip' | 'prayer';
export type Activity = 'type' | 'cook' | 'play' | 'pray' | 'sing' | 'phone' | 'read' | 'eat' | null;

export interface Style {
  /** Steps per stride length (1 = average). */
  cadence: number;
  armSwing: number;
  /** Forward lean of the trunk (radians), and the head's usual tilt. */
  lean: number;
  headPitch: number;
  /** Hip sway when walking (women's is wider). */
  sway: number;
  elbow: number;
  gesture: number;
  /** How often they shift, glance and fidget (1 = average). */
  restless: number;
  arms: Array<[ArmStyle, number]>;
  /** Legs apart when standing (m). */
  stance: number;
}

export interface Act {
  base: Base;
  /** Metres per real second along the ground (drives the stride), and per simulated second (walk or run). */
  speed: number;
  simSpeed: number;
  /** Turning, rad/s (leans into it). */
  turn: number;
  /** Seat height above the floor under the feet (m), sitting or driving. */
  seat: number;
  /** Half the seat's depth (m): on a seat deeper than the thighs are long the sitter moves forward to its edge. */
  seatDepth: number;
  /** How far behind the seat's spot its backrest's face stands (m), or null without one: the sitter sits back against it. */
  seatBack: number | null;
  /** Lying: 0 on the back, ±1 on the left or right side. */
  roll: number;
  speaking: boolean;
  listening: boolean;
  tone: Tone | null;
  /** A point to look at (world), e.g. whoever is speaking; null to look about. */
  lookAt: THREE.Vector3 | null;
  activity: Activity;
  sleeping: boolean;
  sad: boolean;
  elderly: boolean;
  mood: number;
  energy: number;
  /** Driving: how far the wheel is turned (radians, left positive). */
  wheel: number;
  /** A small child being carried or a baby: no walking cycle, arms up. */
  baby: boolean;
}

export const idleAct = (): Act => ({ base: 'stand', speed: 0, simSpeed: 0, turn: 0, seat: 0.45, seatDepth: 0.23, seatBack: null, roll: 0, speaking: false, listening: false, tone: null, lookAt: null, activity: null, sleeping: false, sad: false, elderly: false, mood: 0, energy: 1, wheel: 0, baby: false });

const B = {
  root: 0, hips: 1, spine: 2, chest: 3, neck: 4, head: 5,
  clavL: 6, upL: 7, foreL: 8, handL: 9, clavR: 10, upR: 11, foreR: 12, handR: 13,
  thighL: 14, shinL: 15, footL: 16, toeL: 17, thighR: 18, shinR: 19, footR: 20, toeR: 21,
  jaw: 22, eyeL: 23, eyeR: 24, lidL: 25, lidR: 26,
} as const;
const N = 27;
const JOINT_NAMES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'clavicleL', 'upperarmL', 'forearmL', 'handL', 'clavicleR', 'upperarmR', 'forearmR', 'handR', 'thighL', 'shinL', 'footL', 'toeL', 'thighR', 'shinR', 'footR', 'toeR', 'jaw', 'eyeL', 'eyeR', 'lidL', 'lidR'];

/** A periodic bump centred on c (phase units), of width w. */
function bump(p: number, c: number, w: number): number {
  let d = p - c;
  d -= Math.round(d);
  return Math.exp(-(d * d) / (w * w));
}
function smooth01(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}
const D = Math.PI / 180;
/** The model's arms rest 30° out from the sides (its A-pose). */
const A_POSE = 30 * D;

/** How far the upper lids turn down to close the eyes, and the jaw to open the mouth wide (radians). */
const LID_SHUT = 0.62;
const JAW_OPEN = 0.3;
/** An adult's interpupillary distance (m): what the eyes' convergence is figured from. */
const EYE_APART = 0.063;
/** How far an eye turns (radians): out, in, up and down (MetaHuman's eye rig: 42°, 38°, 30°, 40°). */
const EYE_OUT = 0.73;
const EYE_IN = 0.66;
const EYE_UP = 0.52;
const EYE_DOWN = 0.7;

class Rand {
  constructor(private s: number) {}
  next(): number {
    this.s = (this.s * 1664525 + 1013904223) >>> 0;
    return this.s / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  pick<T>(w: Array<[T, number]>): T {
    let tot = 0;
    for (const [, x] of w) tot += x;
    let r = this.next() * tot;
    for (const [v, x] of w) {
      r -= x;
      if (r <= 0) return v;
    }
    return w[w.length - 1][0];
  }
}

type Gesture = 'beat' | 'open' | 'point' | 'self' | 'shrug' | 'sweep' | 'chop' | 'rest' | 'laugh' | 'lean';

const GESTURES: Record<Tone, Array<[Gesture, number]>> = {
  warm: [['open', 3], ['beat', 3], ['self', 2], ['sweep', 1], ['rest', 2]],
  neutral: [['beat', 4], ['open', 2], ['rest', 3], ['sweep', 1], ['shrug', 1]],
  tense: [['chop', 3], ['point', 3], ['beat', 2], ['shrug', 1], ['rest', 1]],
  grief: [['rest', 5], ['self', 2], ['open', 1]],
  joy: [['open', 3], ['laugh', 3], ['beat', 2], ['sweep', 2]],
  gossip: [['lean', 3], ['beat', 2], ['open', 1], ['rest', 2]],
  prayer: [['rest', 1]],
};

/** The animator for one person. */
export class Motion {
  private rx = new Float32Array(N);
  private ry = new Float32Array(N);
  private rz = new Float32Array(N);
  private hipX = 0;
  private hipY = 0;
  private hipZ = 0;
  private bones: THREE.Bone[];
  private rnd: Rand;
  // walking
  phase = 0;
  // standing
  private arms: ArmStyle = 'relaxed';
  private armsUntil = 0;
  private weight = 1;
  private weightTarget = 1;
  private weightAt = 0;
  // gaze
  private gazeYaw = 0;
  private gazePitch = 0;
  private gazeTarget: [number, number] = [0, 0];
  private gazeAt = 0;
  /** How far away what they look at is (metres; the eyes converge on it), or none when looking about. */
  private gazeDist = 0;
  private vergence = 0;
  /** Where the gaze is bound (the head eases there; the eyes are there at once). */
  private wantYaw = 0;
  private wantPitch = 0;
  // face
  private blinkAt = 0;
  private blinkT = 1;
  private mouthOpen = 0;
  // conversation
  private gesture: Gesture = 'rest';
  private gestureT = 0;
  private gestureLen = 1;
  private gestureSide: 1 | -1 = 1;
  private nodAt = 0;
  private nodT = 1;
  private lastSpeaking = false;
  /** An occasional fidget while standing about: a stretch, a scratch of the head, a look at the time. */
  private fidget: 'stretch' | 'scratch' | 'watch' | 'neck' | null = null;
  private fidgetAt = 0;
  private fidgetT = 0;
  private rate = 8;
  private onFeet = true;
  /** The pelvis turns about the vertical first (walking); lying, it tips back first and then rolls onto a side. */
  private hipOrder: THREE.EulerOrder = 'YXZ';
  private tq = new THREE.Quaternion();
  private te = new THREE.Euler();

  constructor(readonly human: Human, readonly style: Style, seed: number) {
    this.bones = JOINT_NAMES.map((n) => human.bone(n));
    this.rnd = new Rand(seed >>> 0 || 1);
    this.phase = this.rnd.next();
    this.arms = this.rnd.pick(style.arms);
    this.weightTarget = this.rnd.next() < 0.5 ? 1 : -1;
    this.weight = this.weightTarget;
  }

  /** Pose the skeleton for this frame. */
  update(t: number, dt: number, a: Act): void {
    this.rx.fill(0);
    this.ry.fill(0);
    this.rz.fill(0);
    this.hipX = 0;
    this.hipZ = 0;
    this.hipOrder = 'YXZ';
    this.onFeet = a.base === 'walk' || a.base === 'stand';
    const s = this.style;
    this.hipY = this.human.hipY;
    const lean = s.lean + (a.elderly ? 0.12 : 0) + (a.sad ? 0.08 : 0) - Math.max(0, a.mood) * 0.03 + (1 - a.energy) * 0.06;
    this.rx[B.spine] = lean * 0.6;
    this.rx[B.chest] = lean * 0.4;
    this.rx[B.head] = s.headPitch + (a.sad ? 0.25 : 0);
    // Arms hang at the sides: the model's A-pose brought in.
    this.armsDown();
    let rate = 9;
    switch (a.base) {
      case 'walk':
        this.walk(dt, a);
        rate = 22;
        break;
      case 'sit':
        this.sit(t, dt, a, false);
        break;
      case 'drive':
        this.sit(t, dt, a, true);
        break;
      case 'lie':
        this.lie(t, a);
        rate = 6;
        break;
      default:
        this.stand(t, dt, a);
        break;
    }
    // Breathing: the chest rises, the shoulders lift a touch.
    const br = Math.sin(t * (a.sleeping ? 1.6 : 2.3) + this.phase * 6);
    this.rx[B.chest] -= br * 0.012;
    this.rz[B.clavL] += br * 0.01;
    this.rz[B.clavR] -= br * 0.01;
    if (a.base !== 'lie') this.talk(t, dt, a);
    this.gaze(t, dt, a);
    this.face(t, dt, a);
    this.rate += (rate - this.rate) * Math.min(1, dt * 3);
    this.apply(dt);
  }

  /**
   * Set an arm in anatomical terms, blended in by k: flex swings it forward (negative back), abd lifts
   * it out to the side from hanging straight down, rot turns it inward about its length (so a bent
   * elbow brings the hand across the body), elbow bends the forearm, pron turns the palm down.
   */
  private arm(side: 1 | -1, flex: number, abd: number, rot: number, elbow: number, k = 1, pron = 0): void {
    const [up, fore] = side > 0 ? [B.upL, B.foreL] : [B.upR, B.foreR];
    const x = -flex;
    const z = side * (abd - A_POSE);
    const y = -side * rot;
    this.rx[up] += (x - this.rx[up]) * k;
    this.ry[up] += (y - this.ry[up]) * k;
    this.rz[up] += (z - this.rz[up]) * k;
    this.rx[fore] += (-elbow - this.rx[fore]) * k;
    this.ry[fore] += (-side * pron - this.ry[fore]) * k;
    this.rz[fore] += (0 - this.rz[fore]) * k;
  }

  /**
   * Put a hand on a point: target and elbow direction relative to the shoulders (between them, figure
   * axes: x left, y up, z forward, metres for an adult). Two-bone IK solved in the collarbone's frame, so
   * the reach follows the torso; the upper arm is turned so the elbow bends on its own hinge.
   */
  private reach(side: 1 | -1, tx: number, ty: number, tz: number, px: number, py: number, pz: number, k = 1): void {
    const ik = this.human.arms;
    if (!ik) return;
    const r = side > 0 ? ik.L : ik.R;
    const arms = this.human.armScale;
    // Target and pole in the collarbone's frame (at rest its axes are the figure's).
    ikT.set(tx * arms, ty * arms, tz * arms).add(ik.mid).sub(r.clav);
    ikP.set(px, py, pz).add(ik.mid).sub(r.clav);
    // (The targets are an adult's, scaled to this person's reach; the arm is their own.)
    const L1 = r.l1;
    const L2 = r.l2;
    ikD.copy(ikT).sub(r.s);
    let dist = ikD.length();
    dist = Math.max(Math.abs(L1 - L2) + 0.01, Math.min(L1 + L2 - 0.002, dist));
    ikD.normalize();
    // The elbow: in the plane of shoulder, target and pole.
    ikV.copy(ikP).sub(r.s);
    ikV.addScaledVector(ikD, -ikV.dot(ikD));
    if (ikV.lengthSq() < 1e-8) ikV.set(side * 0.5, -0.5, -0.3).addScaledVector(ikD, -ikD.dot(tmpA.set(side * 0.5, -0.5, -0.3)));
    ikV.normalize();
    const cosA = Math.max(-1, Math.min(1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    ikE.copy(r.s).addScaledVector(ikD, L1 * cosA).addScaledVector(ikV, L1 * sinA);
    // Upper arm: its rest direction and hinge onto the new ones.
    const a1n = tmpA.copy(ikE).sub(r.s).normalize();
    const a2n = tmpB.copy(ikT).sub(r.s).addScaledVector(ikD, 0).sub(tmpC.copy(ikE).sub(r.s)).normalize();
    const h1 = tmpC.copy(a1n).cross(a2n);
    if (h1.lengthSq() < 1e-6) h1.copy(a1n).cross(ikV);
    h1.normalize();
    ikM1.makeBasis(r.a1, r.h, tmpD.copy(r.a1).cross(r.h));
    ikM2.makeBasis(a1n, h1, tmpE.copy(a1n).cross(h1));
    ikQ1.setFromRotationMatrix(ikM2.multiply(ikM1.transpose()));
    // Forearm: in the upper arm's frame, from its rest direction to the new one.
    tmpF.copy(a2n).applyQuaternion(ikQ1inv.copy(ikQ1).invert());
    ikQ2.setFromUnitVectors(r.a2, tmpF);
    const [up, fore] = side > 0 ? [B.upL, B.foreL] : [B.upR, B.foreR];
    this.te.setFromQuaternion(ikQ1, 'XYZ');
    this.rx[up] += (this.te.x - this.rx[up]) * k;
    this.ry[up] += (this.te.y - this.ry[up]) * k;
    this.rz[up] += (this.te.z - this.rz[up]) * k;
    this.te.setFromQuaternion(ikQ2, 'XYZ');
    this.rx[fore] += (this.te.x - this.rx[fore]) * k;
    this.ry[fore] += (this.te.y - this.ry[fore]) * k;
    this.rz[fore] += (this.te.z - this.rz[fore]) * k;
  }

  private armsDown(): void {
    const e = this.style.elbow;
    this.arm(1, 0.03, 0.07, 0.35, e, 1, 0.3);
    this.arm(-1, 0.03, 0.07, 0.35, e, 1, 0.3);
  }

  // ── Locomotion ──
  private walk(dt: number, a: Act): void {
    const s = this.style;
    const h = this.human;
    const run = a.simSpeed > 2.6 && !a.elderly;
    const L = h.legs;
    const leg = L.thigh + L.shin + L.ankle;
    const v = Math.max(0.2, a.speed);
    // Stride grows with speed (and cadence with it); cap the cadence in fast-forward, when the feet may slide.
    const simV = Math.min(a.simSpeed || v, run ? 6 : 2.2);
    const stride = leg * (run ? 1.1 + 0.62 * simV : 0.92 + 0.46 * simV) / s.cadence;
    this.phase = (this.phase + Math.min(v / stride, run ? 3 : 2.4) * dt) % 1;
    const amp = Math.min(1.35, (stride / leg) / 1.45) * (run ? 1.25 : 1);
    const p = this.phase;
    const legs: Array<[number, number, number, number]> = [];
    for (const [side, off] of [[B.thighL, 0], [B.thighR, 0.5]] as const) {
      const q = (p + off) % 1;
      let hip: number;
      let knee: number;
      let ank: number;
      if (run) {
        hip = (12 + 38 * Math.cos(2 * Math.PI * (q - 0.05))) * amp;
        knee = 18 + 22 * bump(q, 0.2, 0.1) + 95 * bump(q, 0.7, 0.16);
        ank = 12 * bump(q, 0.25, 0.1) - 22 * bump(q, 0.45, 0.08);
      } else {
        // Gait-lab averages: hip flexion 30° at heel strike to 10° extension at toe-off; knee 18° at loading, 60° in swing; ankle push-off.
        hip = (10 + 20 * Math.cos(2 * Math.PI * (q - 0.02))) * amp;
        knee = 4 + 14 * bump(q, 0.14, 0.08) * amp + 56 * bump(q, 0.72, 0.13) * amp;
        ank = -5 * bump(q, 0.06, 0.04) + 9 * bump(q, 0.42, 0.12) - 17 * bump(q, 0.61, 0.06) * amp + 4 * bump(q, 0.85, 0.08);
      }
      const shin = side === B.thighL ? B.shinL : B.shinR;
      const foot = side === B.thighL ? B.footL : B.footR;
      const toe = side === B.thighL ? B.toeL : B.toeR;
      this.rx[side] = -hip * D;
      this.rx[shin] = knee * D;
      this.rx[foot] = -ank * D;
      this.rx[toe] = 20 * D * bump(q, 0.6, 0.06);
      legs.push([hip * D, knee * D, ank * D, q]);
    }
    // The pelvis rides on whichever leg reaches the ground: its height falls out of the leg angles (the walking bob).
    let reach = 0;
    for (const [hip, knee] of legs) reach = Math.max(reach, L.thigh * Math.cos(hip) + L.shin * Math.cos(hip - knee) + L.ankle);
    const flight = run ? 0.04 * (leg / 0.93) * Math.max(0, Math.sin(4 * Math.PI * p)) : 0;
    this.hipY = h.hipY - (leg - reach) + flight;
    // Pelvis rotation, drop on the swinging side, and the shift over the standing foot.
    const c2 = Math.cos(2 * Math.PI * p);
    const s2 = Math.sin(2 * Math.PI * p);
    this.ry[B.hips] = 5 * D * c2 * amp;
    this.rz[B.hips] = 4 * D * s2 * s.sway;
    this.hipX = 0.022 * s2 * s.sway;
    // The trunk counter-rotates, leans into speed and turns; the shoulders swing opposite to the hips.
    this.ry[B.chest] = -8 * D * c2 * amp;
    this.rx[B.spine] += (run ? 0.16 : 0.03 + 0.02 * a.speed);
    this.rz[B.spine] = Math.max(-0.15, Math.min(0.15, -a.turn * 0.08));
    // Each arm swings with the opposite leg; the elbow bends more on the way forward.
    const swing = s.armSwing * (run ? 1.4 : 1) * amp;
    const elbow = run ? 1.45 : s.elbow + 0.12;
    for (const [side, ph] of [[1, p - 0.5], [-1, p]] as const) {
      const c = Math.cos(2 * Math.PI * ph);
      this.arm(side, 0.04 + 18 * D * swing * c, run ? 0.22 : 0.08, run ? 0.5 : 0.35, elbow + 0.25 * Math.max(0, c) * swing, 1, 0.3);
    }
    // The head stays steady: it undoes the chest's twist.
    this.ry[B.neck] = 6 * D * c2 * amp;
    // Hands in pockets or holding a phone while walking keep the arms still.
    if (this.arms === 'pockets' || this.arms === 'phone' || this.arms === 'behind') {
      this.armPose(this.arms, 1);
    }
  }

  // ── Standing about ──
  private stand(t: number, dt: number, a: Act): void {
    const s = this.style;
    const h = this.human;
    // Shift the weight from one foot to the other now and then.
    if (t > this.weightAt) {
      this.weightAt = t + this.rnd.range(4, 13) / s.restless;
      if (this.rnd.next() < 0.7) this.weightTarget = -this.weightTarget as 1 | -1;
    }
    this.weight += (this.weightTarget - this.weight) * Math.min(1, dt * 1.6);
    const w = this.weight;
    // Contrapposto: the pelvis over the standing leg and dropping on the free side, the free knee bent.
    this.hipX = 0.03 * w;
    this.rz[B.hips] = -0.055 * w;
    this.rz[B.spine] = 0.035 * w;
    this.rz[B.chest] = 0.025 * w;
    const free = w > 0 ? 'R' : 'L';
    const k = Math.abs(w);
    const stand = s.stance;
    this.rz[B.thighL] = stand * 0.12 + (w > 0 ? 0.055 : 0.02);
    this.rz[B.thighR] = -stand * 0.12 - (w < 0 ? 0.055 : 0.02);
    if (free === 'R') {
      this.rx[B.thighR] = -0.12 * k;
      this.rx[B.shinR] = 0.28 * k;
      this.rx[B.footR] = -0.1 * k;
      this.ry[B.thighR] = -0.15 * k;
    } else {
      this.rx[B.thighL] = -0.12 * k;
      this.rx[B.shinL] = 0.28 * k;
      this.rx[B.footL] = -0.1 * k;
      this.ry[B.thighL] = 0.15 * k;
    }
    // The dropped hip lowers the pelvis a little.
    this.hipY = h.hipY - 0.012 * k;
    // A slow sway.
    this.rx[B.hips] += Math.sin(t * 0.6 + this.phase * 5) * 0.01;
    // A habit for the arms, changed now and then.
    if (t > this.armsUntil) {
      this.armsUntil = t + this.rnd.range(9, 30) / s.restless;
      this.arms = this.rnd.pick(s.arms);
    }
    let style: ArmStyle = this.arms;
    if (a.activity === 'phone') style = 'phone';
    if (a.activity === 'pray' || a.tone === 'prayer') style = 'clasped';
    if (a.activity === 'cook') {
      this.cook(t);
      return;
    }
    if (a.activity === 'play' && !a.baby) {
      // Hopping about with the arms up.
      const j = Math.abs(Math.sin(t * 6 + this.phase * 9));
      this.hipY += j * 0.12;
      this.arm(1, 0.3, 2.3 + Math.sin(t * 6) * 0.3, 0, 0.3);
      this.arm(-1, 0.3, 2.3 + Math.sin(t * 6) * 0.3, 0, 0.3);
      this.rx[B.thighL] = -0.3 * j;
      this.rx[B.thighR] = -0.3 * j;
      this.rx[B.shinL] = 0.6 * j;
      this.rx[B.shinR] = 0.6 * j;
      return;
    }
    if (!a.speaking) this.armPose(style, 1);
    if (!a.speaking && !a.listening && !a.activity) this.fidgets(t, dt);
    else this.fidget = null;
  }

  /** Now and then, while waiting about: stretch, scratch the head, look at the time, rub the neck. */
  private fidgets(t: number, dt: number): void {
    if (!this.fidget) {
      if (this.fidgetAt === 0) this.fidgetAt = t + this.rnd.range(8, 40) / this.style.restless;
      if (t < this.fidgetAt) return;
      this.fidget = this.rnd.pick([['scratch', 3], ['watch', 3], ['neck', 2], ['stretch', 1]] as Array<['stretch' | 'scratch' | 'watch' | 'neck', number]>);
      this.fidgetT = 0;
    }
    this.fidgetT += dt;
    const len = this.fidget === 'stretch' ? 3.2 : 2.4;
    const k = smooth01(this.fidgetT / 0.5) * smooth01((len - this.fidgetT) / 0.5);
    switch (this.fidget) {
      case 'scratch':
        this.reach(-1, -0.08, 0.3 + Math.sin(t * 14) * 0.01, 0.0, -0.5, 0.2, 0.1, k);
        this.rz[B.head] -= 0.1 * k;
        break;
      case 'watch':
        this.reach(1, -0.02, -0.18, 0.3, 0.45, -0.5, -0.1, k);
        this.rx[B.head] += 0.35 * k;
        this.ry[B.head] += 0.2 * k;
        break;
      case 'neck':
        this.reach(-1, -0.03, 0.14, -0.08, -0.5, 0.1, 0.3, k);
        this.rx[B.head] -= 0.12 * k;
        this.ry[B.neck] += Math.sin(t * 2) * 0.15 * k;
        break;
      case 'stretch':
        this.arm(1, 2.6, 0.35, 0.2, 0.4, k);
        this.arm(-1, 2.6, 0.35, 0.2, 0.4, k);
        this.rx[B.spine] -= 0.12 * k;
        this.rx[B.head] -= 0.2 * k;
        this.mouthOpen = Math.max(this.mouthOpen, 0.5 * k);
        break;
    }
    if (this.fidgetT >= len) {
      this.fidget = null;
      this.fidgetAt = t + this.rnd.range(15, 60) / this.style.restless;
    }
  }

  private cook(t: number): void {
    // One hand steadies the pot, the other stirs.
    this.reach(1, 0.14, -0.38, 0.42, 0.5, -0.4, -0.1);
    this.reach(-1, -0.12 + Math.cos(t * 5.5) * 0.05, -0.36, 0.44 + Math.sin(t * 5.5) * 0.05, -0.5, -0.4, -0.1);
    this.rx[B.spine] += 0.08;
    this.rx[B.head] += 0.35;
  }

  /** The arms in one of the habits, blended in by k (0 leaves them as they were). */
  private armPose(style: ArmStyle, k: number): void {
    switch (style) {
      case 'crossed':
        // Folded across the chest: each hand at the other arm, the left forearm over the right.
        this.reach(1, -0.16, -0.17, 0.17, 0.4, -0.35, 0.25, k);
        this.reach(-1, 0.15, -0.23, 0.14, -0.4, -0.4, 0.2, k);
        break;
      case 'pockets':
        this.reach(1, 0.2, -0.5, 0.06, 0.55, -0.25, -0.35, k);
        this.reach(-1, -0.2, -0.5, 0.06, -0.55, -0.25, -0.35, k);
        break;
      case 'behind':
        // Hands held together behind the back.
        this.reach(1, 0.03, -0.5, -0.2, 0.5, -0.3, -0.1, k);
        this.reach(-1, -0.03, -0.5, -0.2, -0.5, -0.3, -0.1, k);
        break;
      case 'akimbo':
        // Hands on the hips, elbows out to the sides.
        this.reach(1, 0.19, -0.44, 0.02, 0.7, -0.2, -0.2, k);
        this.reach(-1, -0.19, -0.44, 0.02, -0.7, -0.2, -0.2, k);
        break;
      case 'clasped':
        // Hands together in front, at the waist.
        this.reach(1, 0.025, -0.44, 0.19, 0.5, -0.3, -0.2, k);
        this.reach(-1, -0.025, -0.44, 0.19, -0.5, -0.3, -0.2, k);
        break;
      case 'phone':
        // A phone held in front of the chest, the head bent over it.
        this.reach(-1, -0.05, -0.2, 0.32, -0.45, -0.5, -0.2, k);
        this.rx[B.head] += 0.42 * k;
        this.rx[B.neck] += 0.15 * k;
        break;
      default:
        break;
    }
  }

  // ── Seated ──
  private sit(t: number, dt: number, a: Act, driving: boolean): void {
    const h = this.human;
    const L = h.legs;
    // Thighs level, shins down to the floor; the pelvis on the seat.
    const seat = a.seat;
    this.hipY = seat + L.seat + L.hipDrop;
    const hip = 86 * D;
    // Where on the seat: back against the backrest when the legs allow (the pelvis a finger's breadth from it),
    // else forward so the knees clear the front edge by the shin's own thickness and the shins hang in front of
    // it, not through it (a child on a bench, anyone whose thighs are shorter than the seat is deep); the middle
    // of a seat without a backrest.
    const kneeMin = a.seatDepth - L.thigh * Math.sin(hip) + 0.07;
    const pelvis = 0.12 * (L.thigh / 0.42);
    this.hipZ = a.seatBack === null ? Math.max(0, kneeMin) : Math.max(kneeMin, pelvis + 0.02 - a.seatBack);
    this.rx[B.thighL] = -hip;
    this.rx[B.thighR] = -hip;
    // A knee angle that brings the feet to the floor when the seat allows (small children's dangle).
    const hipJoint = seat + L.seat;
    const need = Math.max(-1, Math.min(1, (hipJoint - L.ankle) / L.shin));
    const knee = Math.max(55 * D, Math.min(125 * D, Math.PI / 2 + Math.asin(Math.max(-0.9, Math.min(0.9, need - 1)))));
    this.rx[B.shinL] = knee - 0.02;
    this.rx[B.shinR] = knee + 0.03;
    this.rx[B.footL] = -(Math.PI / 2 - knee) * 0.6;
    this.rx[B.footR] = -(Math.PI / 2 - knee) * 0.6;
    this.rz[B.thighL] = 0.06;
    this.rz[B.thighR] = -0.06;
    this.rx[B.spine] = 0.02;
    this.rx[B.chest] = 0.02;
    if (driving) {
      // Both hands on the wheel (ten to two), turning it: the hands go round with the rim.
      const w = Math.max(-0.9, Math.min(0.9, a.wheel));
      const R = 0.18;
      for (const side of [1, -1] as const) {
        const ang = side * 1.0 + w;
        this.reach(side, Math.sin(ang) * R, -0.33 + Math.cos(ang) * R * 0.55, 0.43 - Math.cos(ang) * R * 0.3, side * 0.5, -0.5, 0.05);
      }
      this.rx[B.spine] = -0.06;
      return;
    }
    // Hands resting on the thighs (a target within the arm's reach, so the elbows bend and the hands lie on the
    // lap rather than the arms hanging straight into the seat), or at the desk, or folded in prayer.
    this.reach(1, 0.11, -0.39, 0.2, 0.45, -0.4, -0.1);
    this.reach(-1, -0.11, -0.39, 0.2, -0.45, -0.4, -0.1);
    if (a.activity === 'type' || a.activity === 'eat' || a.activity === 'read') {
      const tp = a.activity === 'type';
      const bob = (ph: number) => (tp ? Math.max(0, Math.sin(t * 13 + ph)) * 0.015 : 0);
      if (a.activity === 'read') {
        this.reach(1, 0.1, -0.3, 0.32, 0.45, -0.5, -0.1);
        this.reach(-1, -0.1, -0.3, 0.32, -0.45, -0.5, -0.1);
      } else {
        // At the desk or the table: the hands on its top (0.75 m up, a little above the seated shoulders' height less 0.28).
        this.reach(1, 0.15, -0.28 + bob(0), 0.4, 0.45, -0.45, -0.1);
        // Eating: the fork goes to the mouth now and then.
        const lift = a.activity === 'eat' ? Math.max(0, Math.sin(t * 1.4)) : 0;
        this.reach(-1, -0.15 + lift * 0.12, -0.28 + bob(2) + lift * 0.4, 0.4 - lift * 0.24, -0.45, -0.45, -0.1);
      }
      this.rx[B.spine] = 0.12;
      this.rx[B.head] += 0.28;
      return;
    }
    if (a.activity === 'pray' || a.tone === 'prayer') {
      // Hands together at the chest, the head bowed.
      this.reach(1, 0.012, -0.2, 0.24, 0.4, -0.45, 0.0);
      this.reach(-1, -0.012, -0.2, 0.24, -0.4, -0.45, 0.0);
      this.rx[B.head] += 0.4;
      return;
    }
    if (a.activity === 'phone') {
      this.reach(-1, -0.05, -0.28, 0.3, -0.45, -0.5, -0.2);
      this.rx[B.head] += 0.42;
      this.rx[B.neck] += 0.15;
      return;
    }
    // Habits: leaning back, or forward with the elbows on the knees; legs crossed for some.
    const habit = this.arms;
    if (habit === 'crossed') this.armPose('crossed', 1);
    else if (habit === 'akimbo') {
      // Leaning forward, forearms on the knees.
      this.rx[B.spine] = 0.3;
      this.rx[B.chest] = 0.1;
      this.reach(1, 0.1, -0.44, 0.34, 0.45, -0.3, -0.2);
      this.reach(-1, -0.1, -0.44, 0.34, -0.45, -0.3, -0.2);
    } else if (habit === 'behind' || habit === 'pockets') {
      // Legs crossed at the knee.
      this.rx[B.thighR] = -hip - 0.12;
      this.ry[B.thighR] = 0.2;
      this.rz[B.thighR] = 0.22;
      this.rx[B.shinR] = knee - 0.35;
      this.rx[B.spine] = -0.05;
    }
  }

  // ── Lying ──
  private lie(t: number, a: Act): void {
    // The body tips back to lie along -z (the head there), on the back or turned onto a side.
    // Turned partly onto a side (a flat duvet cannot drape over a body lying fully on its side).
    const roll = a.roll * 0.5;
    this.rx[B.hips] = -Math.PI / 2;
    // Tipped back to lie along the bed, then rolled about the body's length onto a side.
    this.rz[B.hips] = roll;
    this.hipOrder = 'ZXY';
    // On the mattress: the pelvis a hand's depth above it (less on a side).
    this.hipY = a.seat + (a.roll ? 0.13 : 0.1) * (this.human.legs.thigh / 0.42);
    this.hipZ = 0;
    // The head up on the pillow.
    this.rx[B.spine] = 0.04;
    this.rx[B.chest] = 0.06;
    this.rx[B.neck] = a.roll ? 0.1 : 0.28;
    this.rx[B.head] = a.roll ? 0.05 : 0.12;
    if (a.roll) this.rz[B.neck] = -a.roll * 0.22;
    // On the back the arms lie at the sides; on a side they come forward, bent.
    if (a.roll) {
      this.arm(1, 0.3, 0.02, 0.8, 0.9);
      this.arm(-1, 0.3, 0.02, 0.8, 0.9);
    } else {
      this.arm(1, 0.02, 0.12, 0.3, 0.3);
      this.arm(-1, 0.02, 0.12, 0.3, 0.3);
    }
    // Knees drawn up a little on the side; nearly straight on the back.
    const bend = a.roll ? 0.3 : 0.08;
    this.rx[B.thighL] = -bend;
    this.rx[B.thighR] = -bend * (a.roll ? 1.3 : 1);
    this.rx[B.shinL] = bend * 1.6;
    this.rx[B.shinR] = bend * 1.9;
    this.rx[B.footL] = 0.35;
    this.rx[B.footR] = 0.35;
  }

  // ── Talking ──
  private talk(t: number, dt: number, a: Act): void {
    const s = this.style;
    if (a.speaking !== this.lastSpeaking) {
      this.lastSpeaking = a.speaking;
      this.gestureT = this.gestureLen;
    }
    if (a.speaking) {
      // A new gesture every second or three, chosen by the tone of the talk.
      this.gestureT += dt;
      if (this.gestureT >= this.gestureLen) {
        this.gesture = this.rnd.pick(GESTURES[a.tone ?? 'neutral']);
        this.gestureLen = this.rnd.range(1.1, 2.8);
        this.gestureT = 0;
        this.gestureSide = this.rnd.next() < 0.6 ? -1 : 1;
      }
      const env = smooth01(this.gestureT / 0.35) * smooth01((this.gestureLen - this.gestureT) / 0.4);
      const k = env * s.gesture;
      const beat = Math.sin(t * 13 + this.phase * 7) * Math.max(0, Math.sin(t * 2.3));
      const side = this.gestureSide;
      const sitting = a.base === 'sit' || a.base === 'drive';
      if (a.base === 'drive') return;
      switch (this.gesture) {
        case 'beat':
          this.arm(side, 0.62 + beat * 0.06, 0.16, 0.75, 1.3 - beat * 0.22, k, 0.5);
          break;
        case 'open':
          this.arm(1, 0.5, 0.28, -0.25, 1.15 - beat * 0.06, k, -0.4);
          this.arm(-1, 0.5, 0.28, -0.25, 1.15 - beat * 0.06, k, -0.4);
          break;
        case 'point':
          this.arm(side, 1.15, 0.12, 0.25, 0.25, k, 0.6);
          break;
        case 'chop':
          this.arm(side, 0.75, 0.12, 0.8, 1.15 + Math.sin(t * 9) * 0.35, k, 0.1);
          this.rx[B.spine] += 0.06 * k;
          break;
        case 'self':
          this.reach(side, -side * 0.03, -0.12, 0.15, side * 0.45, -0.45, -0.1, k);
          break;
        case 'shrug':
          this.rz[B.clavL] += 0.12 * k;
          this.rz[B.clavR] -= 0.12 * k;
          this.arm(1, 0.3, 0.32, -0.45, 1.3, k, -0.6);
          this.arm(-1, 0.3, 0.32, -0.45, 1.3, k, -0.6);
          this.rz[B.head] += 0.08 * k;
          break;
        case 'sweep': {
          const sw = Math.sin((this.gestureT / this.gestureLen) * Math.PI * 2);
          this.arm(side, 0.6, 0.12 + sw * 0.45, 0.3, 0.8, k, -0.2);
          break;
        }
        case 'laugh': {
          const sh = Math.sin(t * 16) * 0.5 + 0.5;
          this.rx[B.head] += (-0.25 - sh * 0.05) * k;
          this.rx[B.chest] += (-0.08 + sh * 0.04) * k;
          this.rz[B.clavL] += sh * 0.05 * k;
          this.rz[B.clavR] -= sh * 0.05 * k;
          this.mouthOpen = Math.max(this.mouthOpen, 0.7 * k);
          break;
        }
        case 'lean':
          this.rx[B.spine] += 0.14 * k;
          this.rx[B.head] += 0.1 * k;
          if (!sitting) this.arm(side, 0.45, 0.02, 1.2, 1.7, k, 0.3);
          break;
        default:
          break;
      }
      // Emphasis: the head bobs with the words.
      this.rx[B.head] += beat * 0.035 * s.gesture;
    } else if (a.listening) {
      // Nod now and then; laugh along when it is merry.
      if (t > this.nodAt) {
        this.nodAt = t + this.rnd.range(1.6, 5.5);
        this.nodT = 0;
      }
      this.nodT += dt;
      const nod = this.nodT < 0.9 ? Math.sin((this.nodT / 0.9) * Math.PI * 2) * Math.sin((this.nodT / 0.9) * Math.PI) : 0;
      this.rx[B.head] += nod * 0.13;
      if (a.tone === 'joy' && Math.sin(t * 0.7 + this.phase * 11) > 0.75) {
        const sh = Math.sin(t * 15) * 0.5 + 0.5;
        this.rx[B.head] -= 0.18;
        this.rz[B.clavL] += sh * 0.04;
        this.rz[B.clavR] -= sh * 0.04;
        this.mouthOpen = Math.max(this.mouthOpen, 0.55);
      }
      if (a.tone === 'grief') this.rx[B.head] += 0.25;
      if (a.tone === 'tense' && this.arms !== 'crossed') this.armPose('crossed', 0.8);
    }
  }

  // ── Where they look ──
  private gaze(t: number, dt: number, a: Act): void {
    const s = this.style;
    let yaw = 0;
    let pitch = 0;
    const root = this.human.root;
    if (a.lookAt && a.base !== 'lie') {
      // Toward the point: into the figure's frame, measured from the eyes.
      tmpV.copy(a.lookAt);
      root.worldToLocal(tmpV);
      const eyeY = this.hipY + this.human.eyeY;
      const dx = tmpV.x;
      const dz = tmpV.z;
      yaw = Math.atan2(dx, Math.max(0.05, dz));
      if (dz < 0) yaw = Math.sign(dx || 1) * (Math.PI / 2 + Math.atan2(-dz, Math.abs(dx)) * 0.2);
      pitch = -Math.atan2(tmpV.y - eyeY, Math.hypot(dx, dz));
      this.gazeDist = Math.hypot(dx, dz, tmpV.y - eyeY);
      // Glance away now and then.
      if (t > this.gazeAt) {
        this.gazeAt = t + this.rnd.range(1.5, 4.5);
        this.gazeTarget = this.rnd.next() < 0.18 ? [this.rnd.range(-0.5, 0.5), this.rnd.range(-0.1, 0.25)] : [0, 0];
      }
      yaw += this.gazeTarget[0] * 0.5;
      pitch += this.gazeTarget[1] * 0.5;
    } else if (a.base === 'walk') {
      if (t > this.gazeAt) {
        this.gazeAt = t + this.rnd.range(2, 7) / s.restless;
        this.gazeTarget = this.rnd.next() < 0.3 ? [this.rnd.range(-0.9, 0.9), this.rnd.range(-0.05, 0.15)] : [0, this.rnd.range(0.05, 0.2)];
      }
      [yaw, pitch] = this.gazeTarget;
      this.gazeDist = 0;
    } else if (a.base !== 'lie' && !a.sleeping) {
      // Look about: a quick turn of the head, then a pause.
      if (t > this.gazeAt) {
        this.gazeAt = t + this.rnd.range(1.5, 6) / s.restless;
        this.gazeTarget = this.rnd.next() < 0.4 ? [0, this.rnd.range(-0.05, 0.1)] : [this.rnd.range(-1.0, 1.0), this.rnd.range(-0.15, 0.25)];
        if (this.arms === 'phone' || a.activity === 'phone' || a.activity === 'type' || a.activity === 'read') this.gazeTarget = [this.rnd.range(-0.15, 0.15), 0];
      }
      [yaw, pitch] = this.gazeTarget;
      // A phone, a book, a screen: something held close, the eyes converge on it.
      const near = this.arms === 'phone' || a.activity === 'phone' || a.activity === 'read' ? 0.4 : a.activity === 'type' || a.activity === 'eat' ? 0.6 : 0;
      this.gazeDist = near;
    } else this.gazeDist = 0;
    yaw = Math.max(-1.25, Math.min(1.25, yaw));
    pitch = Math.max(-0.5, Math.min(0.6, pitch));
    this.wantYaw = yaw;
    this.wantPitch = pitch;
    // Heads turn quickly and settle (a saccade), faster toward a speaker.
    const quick = Math.min(1, dt * (a.lookAt ? 7 : 5));
    const before = this.gazeYaw;
    this.gazeYaw += (yaw - this.gazeYaw) * quick;
    this.gazePitch += (pitch - this.gazePitch) * quick;
    // A big turn of the head starts with a blink.
    if (Math.abs(this.gazeYaw - before) > dt * 2.2 && this.blinkT > 0.3) this.blinkT = 0;
    this.ry[B.neck] += this.gazeYaw * 0.35;
    this.ry[B.head] += this.gazeYaw * 0.5;
    this.ry[B.chest] += this.gazeYaw * 0.15;
    this.rx[B.neck] += this.gazePitch * 0.35;
    this.rx[B.head] += this.gazePitch * 0.65;
  }

  // ── The face: blinking, the mouth ──
  private face(t: number, dt: number, a: Act): void {
    this.blinkT += dt;
    if (t > this.blinkAt) {
      this.blinkAt = t + this.rnd.range(1.8, 6.5);
      this.blinkT = 0;
    }
    const b = this.blinkT < 0.16 ? Math.sin((this.blinkT / 0.16) * Math.PI) : 0;
    const shut = a.sleeping ? 1 : b;
    // The upper lids come down over the eyes (they rest a little lowered when drowsy or sad).
    const lid = Math.max(shut, (1 - a.energy) * 0.25 + (a.sad ? 0.15 : 0));
    this.rx[B.lidL] = lid * LID_SHUT;
    this.rx[B.lidR] = lid * LID_SHUT;
    let open = 0;
    if (a.speaking) {
      // Syllables, with pauses between phrases.
      const syl = Math.max(0, Math.sin(t * 24 + Math.sin(t * 5.1) * 2)) * (0.55 + 0.45 * Math.sin(t * 7.3));
      open = Math.sin(t * 1.3 + this.phase * 9) > -0.55 ? syl : 0;
    } else if (a.activity === 'sing') open = 0.45 + 0.35 * Math.abs(Math.sin(t * 2.4 + this.phase * 5));
    open = Math.max(open, this.mouthOpen);
    this.mouthOpen *= Math.exp(-dt * 6);
    this.rx[B.jaw] = open * JAW_OPEN;
    // The eyes lead: they are on what is looked at at once, as far as they turn (MetaHuman's eye: 42° out, 38° in,
    // 30° up, 40° down), while the head catches up and they come back to the centre, and they wander a little.
    const sac = Math.sin(t * 0.9 + this.phase * 13) * Math.sin(t * 2.3 + this.phase * 5);
    const eyeYaw = THREE.MathUtils.clamp(this.wantYaw - this.gazeYaw + sac * 0.06, -EYE_OUT, EYE_OUT);
    // Both eyes converge on what is looked at (the nearer, the more: a face across a conversation, a phone in the
    // hand), each turning in toward it by the angle its own offset from the midline subtends there.
    const want = this.gazeDist > 0.05 ? Math.atan2((EYE_APART * this.human.headScale) / 2, this.gazeDist) : 0;
    this.vergence += (want - this.vergence) * Math.min(1, dt * 8);
    this.ry[B.eyeL] = THREE.MathUtils.clamp(eyeYaw - this.vergence, -EYE_OUT, EYE_IN);
    this.ry[B.eyeR] = THREE.MathUtils.clamp(eyeYaw + this.vergence, -EYE_IN, EYE_OUT);
    this.rx[B.eyeL] = this.rx[B.eyeR] = THREE.MathUtils.clamp(this.wantPitch - this.gazePitch + lid * 0.12, -EYE_UP, EYE_DOWN);
  }

  /** Ease every bone toward this frame's pose. */
  private apply(dt: number): void {
    const k = 1 - Math.exp(-dt * this.rate);
    for (let i = 1; i < N; i++) {
      const b = this.bones[i];
      this.te.set(this.rx[i], this.ry[i], this.rz[i], i === B.hips ? this.hipOrder : 'XYZ');
      this.tq.setFromEuler(this.te);
      b.quaternion.slerp(this.tq, k);
    }
    // Shoes lift the figure by their soles while it stands on its feet.
    this.bones[B.root].position.y = this.onFeet ? this.human.footLift : 0;
    const hips = this.bones[B.hips];
    hips.position.x += (this.hipX - hips.position.x) * k;
    hips.position.y += (this.hipY - hips.position.y) * k;
    hips.position.z += (this.hipZ - hips.position.z) * k;
  }

  /** Jump straight to this frame's pose (a person just built, or teleported). */
  snap(): void {
    this.bones[B.root].position.y = this.onFeet ? this.human.footLift : 0;
    for (let i = 1; i < N; i++) {
      this.te.set(this.rx[i], this.ry[i], this.rz[i], i === B.hips ? this.hipOrder : 'XYZ');
      this.bones[i].quaternion.setFromEuler(this.te);
    }
    this.bones[B.hips].position.set(this.hipX, this.hipY, this.hipZ);
  }
}

const tmpV = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const tmpE = new THREE.Vector3();
const tmpF = new THREE.Vector3();
const ikT = new THREE.Vector3();
const ikP = new THREE.Vector3();
const ikD = new THREE.Vector3();
const ikV = new THREE.Vector3();
const ikE = new THREE.Vector3();
const ikM1 = new THREE.Matrix4();
const ikM2 = new THREE.Matrix4();
const ikQ1 = new THREE.Quaternion();
const ikQ1inv = new THREE.Quaternion();
const ikQ2 = new THREE.Quaternion();

/** A person's way of moving, drawn from who they are. */
export function styleFor(o: { seed: number; female: boolean; age: number; archetype: string; mood: number; energy: number }): Style {
  const r = new Rand(o.seed * 7919 + 13);
  const old = o.age >= 65;
  const child = o.age < 13;
  const arms: Array<[ArmStyle, number]> = [['relaxed', 4], ['crossed', 1.2], ['pockets', o.female ? 0.6 : 1.6], ['behind', old ? 1.6 : 0.4], ['akimbo', 0.5], ['clasped', o.female ? 1.4 : 0.6], ['phone', o.age >= 13 && o.age < 60 ? 1.2 : 0.1]];
  const style: Style = {
    cadence: r.range(0.92, 1.08) * (child ? 1.12 : 1) * (old ? 0.9 : 1),
    armSwing: r.range(0.65, 1.25) * (old ? 0.6 : 1) * (child ? 1.2 : 1),
    lean: r.range(-0.02, 0.06) + (old ? 0.06 : 0),
    headPitch: r.range(-0.04, 0.08),
    sway: (o.female ? 1.5 : 0.8) * r.range(0.8, 1.2),
    elbow: r.range(0.12, 0.32),
    gesture: r.range(0.7, 1.25),
    restless: r.range(0.8, 1.3) * (child ? 1.6 : 1) * (old ? 0.7 : 1),
    arms,
    stance: r.range(0.1, 0.6) * (o.female ? 0.6 : 1),
  };
  switch (o.archetype) {
    case 'driver':
      style.gesture *= 1.3;
      style.lean -= 0.02;
      style.cadence *= 1.05;
      arms.push(['akimbo', 1]);
      break;
    case 'harmoniser':
      style.gesture *= 1.15;
      arms.push(['clasped', 1]);
      break;
    case 'thinker':
      style.gesture *= 0.75;
      style.headPitch += 0.04;
      arms.push(['behind', 1.2], ['crossed', 1]);
      break;
    case 'sentinel':
      arms.push(['crossed', 2]);
      style.restless *= 1.2;
      break;
    case 'organiser':
      style.cadence *= 1.04;
      arms.push(['clasped', 1]);
      break;
    default:
      break;
  }
  return style;
}
