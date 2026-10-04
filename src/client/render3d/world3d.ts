// The province in three dimensions, the parts that do not move: the ground and
// its lawns, the roads with their markings, the street trees and lamps, the
// Hyperline's guideway, and every building — roofless, so the camera looks into
// the rooms like a doll's house: tall walls at the back, low ones at the front,
// a floor for each room and the furniture standing at the room's own spots.
// Buildings are built as the camera comes near them, a few per frame.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bedWidth } from '../../sim/beds';
import type { Building, Room, Spot, World } from '../../sim/types';
import { TRACK, WORLD_H, WORLD_W } from '../../sim/world';
import { plotColor } from '../lib/householdColor';
import { furnitureOf, isLounge } from '../render/furniture';
import { OPEN_ROOMS as OPEN } from '../render/indoors';
import { treeSeeds } from '../render/trees';
import { Batch, box, cyl, disposeTree, plane, rbox, sphere, xf } from './geom';
import { GLASS, floor, grain, hash01, mat, mixHex } from './materials';
import { wallLines, windowSpans } from './walls';

/** Height of the Hyperline's deck, and of the station platforms beside it. */
export const TRACK_Y = 7;
export const PLATFORM_Y = TRACK_Y - 0.9;
/** Top of an indoor floor (the slab stands on a low plinth). */
export const FLOOR_Y = 0.16;
/** Where feet and wheels meet the ground outdoors: on top of the road surface. */
export const GROUND_Y = 0.035;

/** Height of a house's outside walls, and a civic building's. */
export const WALL_FULL = 2.9;
export const WALL_CIVIC = 3.6;
/** Window frames and sills. */
const FRAME = mat('#ECE9E2', 0.45);
const SILL = mat('#C9C3B8', 0.85);
const WALL_PART = 1.15;
const WALL_LOW = 0.55;
const WALL_T = 0.2;
const DOOR_W = 1.1;

/** What a person does at a spot, facing where, and how high they sit or lie. */
export interface SpotPose {
  pose: 'sit' | 'lie' | 'stand';
  /** Rotation about the vertical (three.js yaw: 0 faces south, π faces north). */
  yaw: number;
  /** Seat or mattress height above the floor. */
  height: number;
  /** Where the body goes, which may be a little off the spot (the chair at a table). */
  x: number;
  y: number;
  /** Direction sharers of the spot are spread along (a couple in a bed, a family on a pew). */
  spread: number;
}

/** The pulpit's platform, above the nave floor. */
const PULPIT_RISE = 0.25;
const FACE_N = Math.PI;
const FACE_S = 0;
const yawTo = (fx: number, fy: number, tx: number, ty: number) => Math.atan2(tx - fx, ty - fy);

interface Built {
  obj: THREE.Group;
  cx: number;
  cy: number;
  r: number;
  lit: THREE.Mesh[];
}

export class World3D {
  readonly root = new THREE.Group();
  readonly spots = new Map<string, SpotPose>();
  /** The rooms that are raised decks (station platforms), by room id. */
  readonly decks = new Set<string>();
  private built = new Map<string, Built>();
  private groundMat: THREE.MeshStandardMaterial;
  private lawnMat: THREE.MeshStandardMaterial;
  private crownMat: THREE.MeshStandardMaterial;
  private jacarandaMat: THREE.MeshStandardMaterial;
  private lampHeads: THREE.InstancedMesh | null = null;
  private season = '';
  private litGlass = new Map<string, THREE.MeshStandardMaterial>();

  constructor(private world: World) {
    this.root.name = 'world';
    this.groundMat = new THREE.MeshStandardMaterial({ color: '#D6CCB3', roughness: 0.95, map: grain(7, '#FFFFFF', 0.05) });
    (this.groundMat.map as THREE.Texture).repeat.set(WORLD_W / 14, WORLD_H / 14);
    this.lawnMat = new THREE.MeshStandardMaterial({ color: '#8DB35E', roughness: 0.92, map: grain(11, '#FFFFFF', 0.09) });
    (this.lawnMat.map as THREE.Texture).repeat.set(WORLD_W / 9, WORLD_H / 9);
    this.crownMat = swaying(new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.85, vertexColors: true }));
    this.jacarandaMat = swaying(new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.85, vertexColors: true }));
    for (const b of Object.values(world.buildings)) this.planSpots(b);
    this.buildGround();
    this.buildRoads();
    this.buildTrees();
    this.buildLamps();
    this.buildGuideway();
  }

  /** Seasonal colours for the lawns and the tree crowns (the ground stays the same). */
  setSeason(season: string): void {
    if (season === this.season) return;
    this.season = season;
    const lawn = { summer: '#86B159', autumn: '#A9AA62', winter: '#B3AE8A', spring: '#93BD5F' }[season] ?? '#8DB35E';
    const crown = { summer: '#5E9A48', autumn: '#B08A3C', winter: '#8C956C', spring: '#6FAA4E' }[season] ?? '#6A9F4B';
    this.lawnMat.color.set(lawn);
    this.crownMat.color.set(crown);
    // Jacarandas flower purple in spring (October on the Highveld).
    this.jacarandaMat.color.set(season === 'spring' ? '#9B86CF' : crown);
  }

  /** Night: the lamps and every lit building's windows glow. */
  setNight(dark: number): void {
    if (this.lampHeads) (this.lampHeads.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.15 + 2.6 * dark;
    for (const [id, m] of this.litGlass) {
      const b = this.world.buildings[id];
      const on = b?.lit ? dark : 0;
      m.emissiveIntensity = 1.8 * on;
      m.opacity = 0.8 * on;
      m.visible = on > 0.01;
    }
  }

  /**
   * Build the buildings within `radius` of (cx, cy), nearest first and at most
   * `budget` per call; hide what is far away so it costs nothing to draw.
   */
  update(cx: number, cy: number, radius: number, budget = 4): number {
    const want: Array<{ b: Building; d: number }> = [];
    for (const b of Object.values(this.world.buildings)) {
      const bx = Math.max(b.x, Math.min(cx, b.x + b.w));
      const by = Math.max(b.y, Math.min(cy, b.y + b.h));
      const d = Math.hypot(bx - cx, by - cy);
      const got = this.built.get(b.id);
      if (got) got.obj.visible = d < radius * 1.35;
      else if (d < radius) want.push({ b, d });
    }
    want.sort((a, b) => a.d - b.d);
    let n = 0;
    for (const { b } of want) {
      if (n >= budget) break;
      this.buildBuilding(b);
      n++;
    }
    return want.length - n;
  }

  /** Forget buildings far from the camera, to keep memory bounded on a long session. */
  prune(cx: number, cy: number, keep: number): void {
    for (const [id, got] of this.built) {
      if (Math.hypot(got.cx - cx, got.cy - cy) - got.r > keep) {
        this.root.remove(got.obj);
        disposeTree(got.obj);
        this.built.delete(id);
        this.litGlass.delete(id);
      }
    }
  }

  // ─── Ground, lawns, roads, trees, lamps, the guideway ─────────────────────

  private buildGround(): void {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W + 2400, WORLD_H + 2400).rotateX(-Math.PI / 2), this.groundMat);
    g.position.set(WORLD_W / 2, 0, WORLD_H / 2);
    g.receiveShadow = true;
    g.name = 'ground';
    this.root.add(g);
    // Lawns: every house plot, park, farm and the cemetery.
    const batch = new Batch();
    for (const b of Object.values(this.world.buildings)) {
      if (b.kind === 'house' || b.kind === 'park' || b.kind === 'farm' || b.kind === 'cemetery' || b.kind === 'stadium' || b.kind === 'sports') {
        batch.add(plane(b.w, b.h), this.lawnMat, xf(b.x + b.w / 2, 0.02, b.y + b.h / 2));
      }
    }
    const lawns = batch.build({ cast: false });
    // World-space UVs, so the lawn grain has the same scale everywhere.
    lawns.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.geometry) return;
      const pos = m.geometry.attributes.position;
      const uv = m.geometry.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / WORLD_W, pos.getZ(i) / WORLD_H);
      uv.needsUpdate = true;
    });
    this.root.add(lawns);
  }

  private buildRoads(): void {
    const asphalt = new THREE.MeshStandardMaterial({ color: '#56595F', roughness: 0.93, map: grain(3, '#FFFFFF', 0.07) });
    (asphalt.map as THREE.Texture).repeat.set(1, 1);
    const paintM = mat('#F1EEE4', 0.6);
    const surf = new Batch();
    const marks = new Batch();
    const nodes = this.world.roads.nodes;
    const nodeW = new Map<string, number>();
    for (const e of this.world.roads.edges) {
      const a = nodes[e.a];
      const b = nodes[e.b];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.1) continue;
      const yaw = Math.atan2(b.x - a.x, b.y - a.y);
      surf.add(box(e.width, 0.03, len), asphalt, xf((a.x + b.x) / 2, 0.015, (a.y + b.y) / 2, yaw));
      nodeW.set(e.a, Math.max(nodeW.get(e.a) ?? 0, e.width));
      nodeW.set(e.b, Math.max(nodeW.get(e.b) ?? 0, e.width));
      // The centre line: 3 m dashes, 3 m gaps, clear of the junctions.
      const dash = 3;
      for (let d = e.width / 2 + 2; d + dash < len - e.width / 2 - 2; d += dash * 2) {
        const u = (d + dash / 2) / len;
        marks.add(box(0.14, 0.006, dash), paintM, xf(a.x + (b.x - a.x) * u, 0.033, a.y + (b.y - a.y) * u, yaw));
      }
      // The highways get solid edge lines.
      if (e.width > 8) {
        const nx = (b.y - a.y) / len;
        const ny = -(b.x - a.x) / len;
        for (const s of [-1, 1]) {
          const off = (e.width / 2 - 0.6) * s;
          marks.add(box(0.14, 0.006, len), paintM, xf((a.x + b.x) / 2 + nx * off, 0.033, (a.y + b.y) / 2 + ny * off, yaw));
        }
      }
    }
    for (const [id, w] of nodeW) surf.add(cyl(w / 2, w / 2, 0.03, 20), asphalt, xf(nodes[id].x, 0.015, nodes[id].y));
    const roads = surf.build({ cast: false });
    roads.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.geometry) return;
      const pos = m.geometry.attributes.position;
      const uv = m.geometry.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 10, pos.getZ(i) / 10);
    });
    (asphalt.map as THREE.Texture).repeat.set(1, 1);
    this.root.add(roads);
    this.root.add(marks.build({ cast: false }));
  }

  /**
   * Street and park trees, instanced in 300 m chunks so what is out of view is culled as a whole. Three
   * kinds of the Highveld: broad shade trees (some of them jacarandas, purple in spring), flat-topped
   * acacias and tall pale-barked gums; each crown a clump of lobes, darker underneath and inside.
   */
  private buildTrees(): void {
    const seeds = treeSeeds(this.world);
    const kinds = treeKinds();
    const barkMat = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.92, vertexColors: true });
    const chunks = new Map<string, typeof seeds>();
    for (const s of seeds) {
      const k = `${Math.floor(s.x / 300)}|${Math.floor(s.y / 300)}`;
      const arr = chunks.get(k) ?? [];
      arr.push(s);
      chunks.set(k, arr);
    }
    const c = new THREE.Color();
    for (const group of chunks.values()) {
      const byKind = new Map<number, Array<{ s: (typeof seeds)[number]; j: number }>>();
      for (const s of group) {
        const j = hash01(`${s.x.toFixed(1)}|${s.y.toFixed(1)}`);
        const k = pickKind(j, s.x, s.y);
        const arr = byKind.get(k) ?? [];
        arr.push({ s, j });
        byKind.set(k, arr);
      }
      for (const [k, list] of byKind) {
        const kd = kinds[k];
        const crowns = new THREE.InstancedMesh(kd.crown, kd.jacaranda ? this.jacarandaMat : this.crownMat, list.length);
        const trunks = new THREE.InstancedMesh(kd.trunk, barkMat, list.length);
        list.forEach(({ s, j }, i) => {
          // Wider with the canopy, taller more slowly.
          const sc = s.r * 0.62 * kd.scale * (0.88 + j * 0.24);
          const sy = (1.1 + s.r * 0.25) * kd.tall * (0.9 + j * 0.2);
          const yaw = j * 40;
          trunks.setMatrixAt(i, xf(s.x, 0, s.y, yaw, sc, sy, sc));
          crowns.setMatrixAt(i, xf(s.x, 0, s.y, yaw, sc, sy, sc));
          crowns.setColorAt(i, c.setHSL(0.27 + (j - 0.5) * 0.04, 0.12 + j * 0.1, 0.84 + j * 0.14));
        });
        trunks.computeBoundingSphere();
        crowns.computeBoundingSphere();
        trunks.castShadow = crowns.castShadow = true;
        trunks.receiveShadow = crowns.receiveShadow = true;
        this.root.add(trunks, crowns);
      }
    }
  }

  /** A lamp at the corner of every junction; the heads glow at night. */
  private buildLamps(): void {
    const deg = new Map<string, number>();
    for (const e of this.world.roads.edges) {
      deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
      deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
    }
    const spots: Array<{ x: number; y: number }> = [];
    for (const [id, n] of deg) {
      if (n < 3) continue;
      const nd = this.world.roads.nodes[id];
      spots.push({ x: nd.x + 5.5, y: nd.y + 5.5 });
    }
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.1, 5, 8).translate(0, 2.5, 0), mat('#3E4148', 0.5, 0.6), spots.length);
    const headMat = new THREE.MeshStandardMaterial({ color: '#FFF1D0', emissive: '#FFD58A', emissiveIntensity: 0.15, roughness: 0.3 });
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.26, 16, 10), headMat, spots.length);
    spots.forEach((s, i) => {
      pole.setMatrixAt(i, xf(s.x, 0, s.y));
      heads.setMatrixAt(i, xf(s.x, 5.05, s.y, 0, 1, 0.8, 1));
    });
    pole.castShadow = true;
    pole.frustumCulled = heads.frustumCulled = false;
    this.lampHeads = heads;
    this.root.add(pole, heads);
  }

  /** The Hyperline: a deck on pylons along the whole line, and the stations' raised platforms. */
  private buildGuideway(): void {
    const concrete = mat('#C9C6BF', 0.85);
    const rail = mat('#8A96A8', 0.35, 0.7);
    const bt = new Batch();
    for (let i = 1; i < TRACK.length; i++) {
      const a = TRACK[i - 1];
      const b = TRACK[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.1) continue;
      const yaw = Math.atan2(b.x - a.x, b.y - a.y);
      bt.add(box(5.2, 0.9, len + 2.6), concrete, xf((a.x + b.x) / 2, TRACK_Y - 0.45, (a.y + b.y) / 2, yaw));
      bt.add(box(1.4, 0.18, len + 2.6), rail, xf((a.x + b.x) / 2, TRACK_Y + 0.09, (a.y + b.y) / 2, yaw));
      for (let d = 20; d < len; d += 40) {
        const u = d / len;
        bt.add(cyl(0.7, 0.9, TRACK_Y - 0.9, 18), concrete, xf(a.x + (b.x - a.x) * u, (TRACK_Y - 0.9) / 2, a.y + (b.y - a.y) * u));
      }
    }
    this.root.add(bt.build());
  }

  // ─── Buildings ─────────────────────────────────────────────────────────────

  private buildBuilding(b: Building): void {
    const batch = new Batch();
    const lit: THREE.Mesh[] = [];
    // Light in the windows: invisible by day (the glass shows the room), a warm glow at night when the building is lit.
    const glassKey = new THREE.MeshStandardMaterial({ color: '#FFD9A0', emissive: '#FFC66E', emissiveIntensity: 0, roughness: 0.25, transparent: true, opacity: 0, depthWrite: false });
    this.litGlass.set(b.id, glassKey);
    if (b.kind === 'runway') this.runway(batch, b);
    else if (b.kind === 'stadium') this.stadium(batch, b);
    else if (b.kind === 'busstop') this.busStop(batch, b);
    else {
      if (b.kind === 'house') this.plotFence(batch, b);
      this.rooms(batch, b, glassKey);
    }
    const obj = batch.build();
    obj.name = b.id;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    this.root.add(obj);
    this.built.set(b.id, { obj, cx, cy, r: Math.hypot(b.w, b.h) / 2, lit });
  }

  private exterior(b: Building): string {
    if (b.kind === 'house') return mixHex(plotColor(b.plot ?? null, false), '#FBF6EC', 0.72);
    if (b.kind === 'church') return '#E7D6B6';
    if (b.kind === 'hospital' || b.kind === 'clinic' || b.kind === 'medical') return '#EEF1F0';
    if (b.kind === 'police' || b.kind === 'court' || b.kind === 'govt' || b.kind === 'council') return '#E3DDD2';
    if (b.kind === 'bank' || b.kind === 'reservebank' || b.kind === 'combank' || b.kind === 'towers' || b.kind === 'office') return '#DCE0E4';
    if (b.kind === 'farm' || b.kind === 'workshop' || b.kind === 'hangar') return '#C9B79C';
    return '#ECE4D6';
  }

  private floorMat(r: Room, b: Building): THREE.Material {
    switch (r.kind) {
      case 'bedroom':
        return floor('#D2A57A', 'planks', 4, 0.6);
      case 'living':
        return floor(b.kind === 'house' ? '#BF8A5A' : '#C4A27E', 'planks', 4, 0.55);
      case 'kitchen':
        return floor('#EDE6D8', 'tiles', 1.6, 0.4);
      case 'bathroom':
        return floor('#DCEBEE', 'tiles', 1.2, 0.3);
      case 'nave':
      case 'hall':
      case 'stage':
        return floor('#B07C4E', 'planks', 5, 0.5);
      case 'auditorium':
      case 'theatre':
        return floor('#8E3A3A', 'carpet', 2, 0.95);
      case 'classroom':
      case 'library':
      case 'office':
      case 'consult':
      case 'reception':
      case 'courtroom':
        return floor('#9DAAB5', 'carpet', 2, 0.95);
      case 'ward':
        return floor('#E2EEEA', 'tiles', 2, 0.35);
      case 'cell':
      case 'workshop':
      case 'garage':
        return floor('#AEA9A0', 'plain', 4, 0.9);
      case 'shop':
        return floor('#E9DFCC', 'tiles', 2.4, 0.45);
      default:
        return floor('#D8CFBE', 'tiles', 2.4, 0.7);
    }
  }

  /** The plot's fence in the household's colour, with a gap at the gate. */
  private plotFence(batch: Batch, b: Building): void {
    const rail = mat(mixHex(plotColor(b.plot ?? null, false), '#FFFFFF', 0.15), 0.6);
    const post = mat('#F4EFE6', 0.7);
    const gate = b.entrance;
    const edges: Array<[number, number, number, number]> = [
      [b.x, b.y, b.x + b.w, b.y],
      [b.x + b.w, b.y, b.x + b.w, b.y + b.h],
      [b.x + b.w, b.y + b.h, b.x, b.y + b.h],
      [b.x, b.y + b.h, b.x, b.y],
    ];
    for (const [x0, y0, x1, y1] of edges) {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const yaw = Math.atan2(x1 - x0, y1 - y0);
      // Split the edge around the gate.
      const pieces: Array<[number, number]> = [];
      const along = (px: number, py: number) => ((px - x0) * (x1 - x0) + (py - y0) * (y1 - y0)) / len;
      const off = Math.abs((gate.x - x0) * (y1 - y0) - (gate.y - y0) * (x1 - x0)) / len;
      if (off < 1.5) {
        const g = along(gate.x, gate.y);
        pieces.push([0, Math.max(0, g - 1.6)], [Math.min(len, g + 1.6), len]);
      } else pieces.push([0, len]);
      for (const [s0, s1] of pieces) {
        const l = s1 - s0;
        if (l < 0.3) continue;
        const u = (s0 + s1) / 2 / len;
        const mx = x0 + (x1 - x0) * u;
        const my = y0 + (y1 - y0) * u;
        batch.add(rbox(0.08, 0.1, l, 0.03), rail, xf(mx, 0.75, my, yaw));
        batch.add(rbox(0.08, 0.1, l, 0.03), rail, xf(mx, 0.38, my, yaw));
        for (let d = s0; d <= s1 + 0.01; d += 2.2) {
          const v = d / len;
          batch.add(rbox(0.14, 0.95, 0.14, 0.03), post, xf(x0 + (x1 - x0) * v, 0.475, y0 + (y1 - y0) * v));
        }
      }
    }
  }

  private runway(batch: Batch, b: Building): void {
    const tar = mat('#5E6268', 0.92);
    const white = mat('#F2F0EA', 0.6);
    batch.add(box(b.w, 0.08, b.h), tar, xf(b.x + b.w / 2, 0.04, b.y + b.h / 2));
    for (let y = b.y + 60; y < b.y + b.h - 80; y += 50) batch.add(box(0.9, 0.012, 30), white, xf(b.x + b.w / 2, 0.086, y + 15));
    for (let i = 0; i < 6; i++) {
      const x = b.x + 4 + i * 6.6 + 1.5;
      batch.add(box(3, 0.012, 28), white, xf(x, 0.086, b.y + 20));
      batch.add(box(3, 0.012, 28), white, xf(x, 0.086, b.y + b.h - 20));
    }
  }

  private busStop(batch: Batch, b: Building): void {
    const steel = mat('#4A5563', 0.45, 0.6);
    const roof = mat('#2F6DB5', 0.5);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    batch.add(box(b.w, 0.1, b.h), mat('#BDB8AE', 0.85), xf(cx, 0.05, cy));
    for (const sx of [-1, 1]) batch.add(cyl(0.06, 0.06, 2.6, 10), steel, xf(cx + sx * (b.w / 2 - 0.6), 1.3, cy - b.h / 2 + 0.6));
    batch.add(rbox(b.w - 0.4, 0.12, Math.min(2.4, b.h), 0.05), roof, xf(cx, 2.65, cy - b.h / 2 + 1.2));
    batch.add(box(1, 1, 1), mat('#9DB4C6', 0.1), xf(cx, 1.4, cy - b.h / 2 + 0.25, 0, b.w - 1.4, 2.1, 0.05));
    batch.add(rbox(b.w - 1.6, 0.08, 0.5, 0.03), mat('#A8784F', 0.6), xf(cx, 0.5, cy - b.h / 2 + 0.7));
  }

  /** The bowl: a pitch with its markings and goals between a tall north stand and a low south one. */
  private stadium(batch: Batch, b: Building): void {
    const concrete = mat('#C4C0B8', 0.85);
    const seatA = mat('#2F63D6', 0.55);
    const seatB = mat('#E4E1DA', 0.6);
    for (const r of b.rooms) {
      if (r.kind === 'pitch') this.pitch(batch, r);
      if (r.kind !== 'stand') continue;
      const north = r.y + r.h / 2 < b.y + b.h / 2;
      const tiers = north ? 7 : 3;
      const rise = north ? 0.85 : 0.45;
      for (let i = 0; i < tiers; i++) {
        const depth = r.h / tiers;
        // North stand rises away from the pitch (northward); the south one steps down toward the camera.
        const ty = north ? r.y + r.h - depth * (i + 1) : r.y + depth * i;
        const hgt = rise * (i + 1);
        batch.add(box(r.w, hgt, depth), concrete, xf(r.x + r.w / 2, hgt / 2, ty + depth / 2));
        batch.add(rbox(r.w - 1, 0.18, 0.5, 0.05), i % 2 ? seatA : seatB, xf(r.x + r.w / 2, hgt + 0.09, ty + depth / 2));
      }
    }
  }

  private pitch(batch: Batch, r: Room): void {
    const grass = mat('#6FAE55', 0.9);
    const stripe = mat('#7DBA60', 0.9);
    const line = mat('#F5F4EE', 0.6);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    batch.add(box(r.w, 0.04, r.h), grass, xf(cx, 0.03, cy));
    for (let x = r.x; x < r.x + r.w - 1; x += 10) batch.add(box(5, 0.01, r.h), stripe, xf(x + 2.5, 0.055, cy));
    const L = (w: number, d: number, x: number, y: number) => batch.add(box(w, 0.012, d), line, xf(x, 0.066, y));
    L(r.w - 4, 0.14, cx, r.y + 2);
    L(r.w - 4, 0.14, cx, r.y + r.h - 2);
    L(0.14, r.h - 4, r.x + 2, cy);
    L(0.14, r.h - 4, r.x + r.w - 2, cy);
    L(0.14, r.h - 4, cx, cy);
    const ring = new THREE.RingGeometry(8.8, 9.05, 48).rotateX(-Math.PI / 2);
    batch.add(ring, line, xf(cx, 0.067, cy));
    for (const s of r.spots) if (s.kind === 'goal') this.goal(batch, s, cx);
  }

  private goal(batch: Batch, s: Spot, pitchCx: number): void {
    const white = mat('#FAFAF7', 0.4);
    const net = new THREE.MeshStandardMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.35, roughness: 0.9, side: THREE.DoubleSide });
    const dir = s.x < pitchCx ? 1 : -1; // the mouth faces the centre spot
    const x = s.x - dir * 1;
    for (const sy of [-3.66, 3.66]) batch.add(cyl(0.06, 0.06, 2.44, 10), white, xf(x, 1.22, s.y + sy));
    batch.add(cyl(0.06, 0.06, 7.32, 10), white, xf(x, 2.44, s.y, 0, 1, 1, 1, Math.PI / 2));
    batch.add(box(0.02, 2.44, 7.32), net, xf(x - dir * 1.8, 1.22, s.y));
    batch.add(box(1.8, 0.02, 7.32), net, xf(x - dir * 0.9, 2.44, s.y));
  }

  /** Floors, walls with doors and windows, and the furniture at every spot. */
  private rooms(batch: Batch, b: Building, glassLit: THREE.MeshStandardMaterial): void {
    const walled = b.rooms.filter((r) => !OPEN.has(r.kind));
    const ext = mat(this.exterior(b), 0.9);
    const inner = mat('#F3ECE0', 0.92);
    const trim = mat(mixHex(this.exterior(b), '#5B5046', 0.35), 0.7);
    const full = b.kind === 'house' ? WALL_FULL : WALL_CIVIC;
    // A low plinth under the enclosed part.
    if (walled.length) {
      const x0 = Math.min(...walled.map((r) => r.x));
      const y0 = Math.min(...walled.map((r) => r.y));
      const x1 = Math.max(...walled.map((r) => r.x + r.w));
      const y1 = Math.max(...walled.map((r) => r.y + r.h));
      batch.add(box(x1 - x0 + 0.5, FLOOR_Y - 0.06, y1 - y0 + 0.5), mat('#B9B3A7', 0.9), xf((x0 + x1) / 2, (FLOOR_Y - 0.06) / 2, (y0 + y1) / 2));
    }
    for (const r of b.rooms) {
      if (OPEN.has(r.kind)) this.openGround(batch, b, r);
      else batch.add(box(r.w - 0.04, 0.06, r.h - 0.04), this.floorMat(r, b), xf(r.x + r.w / 2, FLOOR_Y - 0.03, r.y + r.h / 2));
      for (const s of r.spots) this.furnish(batch, b, r, s);
      if (!OPEN.has(r.kind)) this.decor(batch, b, r);
    }
    // Walls: every room edge, merged along each line; a line with rooms on both
    // sides is a partition, with one on a single side an outside wall.
    const door = b.door ?? b.entrance;
    for (const w of wallLines(walled)) {
      const len = w.b - w.a;
      if (len < 0.05) continue;
      const kind = w.inner ? 'part' : w.horiz ? (w.side > 0 ? 'back' : 'front') : 'side';
      const H = kind === 'part' ? WALL_PART : kind === 'front' ? WALL_LOW : full;
      const gaps: Array<[number, number]> = [];
      if (w.inner && len >= 2.4) gaps.push([(w.a + w.b) / 2 - DOOR_W / 2, (w.a + w.b) / 2 + DOOR_W / 2]);
      const dAlong = w.horiz ? door.x : door.y;
      const dOff = Math.abs((w.horiz ? door.y : door.x) - w.c);
      if (!w.inner && dOff < 1.2 && dAlong > w.a - 0.5 && dAlong < w.b + 0.5) gaps.push([dAlong - 0.8, dAlong + 0.8]);
      const windows = kind === 'back' || kind === 'side' ? windowSpans(w.a, w.b, gaps) : [];
      this.wall(batch, w.horiz, w.c, w.a, w.b, H, gaps, windows, w.inner ? inner : ext, trim, glassLit, kind === 'back' || kind === 'side');
    }
  }

  /** One straight wall with door gaps (open to the ceiling line) and windows (sill, glass, lintel). */
  private wall(batch: Batch, horiz: boolean, c: number, a: number, b: number, H: number, gaps: Array<[number, number]>, wins: Array<[number, number]>, m: THREE.Material, trim: THREE.Material, lit: THREE.Material, capped: boolean): void {
    const cuts = [...gaps.map(([s, e]) => ({ s, e, win: false })), ...wins.map(([s, e]) => ({ s, e, win: true }))].sort((p, q) => p.s - q.s);
    const piece = (s: number, e: number, y0: number, y1: number, mm: THREE.Material, thick = WALL_T) => {
      const l = e - s;
      if (l <= 0.02 || y1 - y0 <= 0.01) return;
      const mid = (s + e) / 2;
      const [x, z] = horiz ? [mid, c] : [c, mid];
      batch.add(box(horiz ? l : thick, y1 - y0, horiz ? thick : l), mm, xf(x, FLOOR_Y + (y0 + y1) / 2, z));
    };
    let at = a;
    for (const cut of cuts) {
      const s = Math.max(a, cut.s);
      const e = Math.min(b, cut.e);
      if (e <= s) continue;
      piece(at, s, 0, H, m);
      if (cut.win) {
        piece(s, e, 0, 0.9, m);
        piece(s, e, 2.1, H, m);
        // The window: a frame with a mullion and a transom, clear glass, and a sill proud of the wall.
        const fw = 0.055;
        piece(s, e, 0.9, 0.9 + fw, FRAME, 0.1);
        piece(s, e, 2.1 - fw, 2.1, FRAME, 0.1);
        piece(s, s + fw, 0.9, 2.1, FRAME, 0.1);
        piece(e - fw, e, 0.9, 2.1, FRAME, 0.1);
        if (e - s > 1.2) piece((s + e) / 2 - fw / 2, (s + e) / 2 + fw / 2, 0.9, 2.1, FRAME, 0.09);
        piece(s + fw, e - fw, 1.72, 1.72 + fw * 0.8, FRAME, 0.09);
        piece(s + fw, e - fw, 0.9 + fw, 2.1 - fw, GLASS, 0.02);
        piece(s + fw, e - fw, 0.9 + fw, 2.1 - fw, lit, 0.01);
        piece(s - 0.04, e + 0.04, 0.86, 0.9, SILL, WALL_T + 0.1);
      } else if (H > 2.2) piece(s, e, 2.1, H, m);
      at = e;
    }
    piece(at, b, 0, H, m);
    if (capped) {
      const mid = (a + b) / 2;
      const [x, z] = horiz ? [mid, c] : [c, mid];
      batch.add(box(horiz ? b - a + 0.06 : WALL_T + 0.06, 0.07, horiz ? WALL_T + 0.06 : b - a + 0.06), trim, xf(x, FLOOR_Y + H + 0.035, z));
    }
  }

  /** A wooden chair facing yaw: seat, back and four legs. */
  private chair(batch: Batch, x: number, y: number, yaw: number, floorY: number, seatM: THREE.Material, legM: THREE.Material): void {
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const at = (fwd: number, side: number): [number, number] => [x + sn * fwd + c * side, y + c * fwd - sn * side];
    batch.add(rbox(0.46, 0.06, 0.46, 0.02), seatM, xf(x, floorY + 0.44, y, yaw));
    const [bx, by] = at(-0.21, 0);
    batch.add(rbox(0.44, 0.5, 0.05, 0.02), seatM, xf(bx, floorY + 0.72, by, yaw));
    for (const [dx, dy] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) {
      const [lx, ly] = at(dx, dy);
      batch.add(cyl(0.022, 0.022, 0.44, 6), legM, xf(lx, floorY + 0.22, ly));
    }
  }

  /** A table w by d (along x and y), its top at 0.75 m, a leg at each corner. */
  private table(batch: Batch, x: number, y: number, w: number, d: number, floorY: number, topM: THREE.Material, legM: THREE.Material): void {
    batch.add(rbox(w, 0.05, d, 0.02), topM, xf(x, floorY + 0.75, y));
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) batch.add(cyl(0.028, 0.028, 0.72, 6), legM, xf(x + sx * (w / 2 - 0.07), floorY + 0.36, y + sy * (d / 2 - 0.07)));
  }

  /** A low coffee table among the easy chairs, with a vase on it. */
  private coffeeTable(batch: Batch, t: { x: number; y: number; w: number; d: number }, floorY: number): void {
    const top = mat('#6E4B33', 0.45);
    batch.add(rbox(t.w, 0.05, t.d, 0.02), top, xf(t.x, floorY + 0.42, t.y));
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) batch.add(cyl(0.025, 0.025, 0.4, 6), top, xf(t.x + sx * (t.w / 2 - 0.06), floorY + 0.2, t.y + sy * (t.d / 2 - 0.06)));
    batch.add(cyl(0.05, 0.07, 0.18, 12), mat('#D9D2C3', 0.4), xf(t.x, floorY + 0.53, t.y));
  }

  /** Ground that is not a floor: gardens, fields, the lake, graves, pens and platforms. */
  private openGround(batch: Batch, b: Building, r: Room): void {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    if (r.name === 'Lake' || r.name === 'Pool') {
      const water = new THREE.MeshPhysicalMaterial({ color: r.name === 'Pool' ? '#5FB6D6' : '#4F8FB0', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.88, clearcoat: 1 });
      batch.add(box(r.w, 0.05, r.h), water, xf(cx, 0.045, cy));
      if (r.name === 'Pool') batch.add(box(r.w + 0.8, 0.04, r.h + 0.8), mat('#E6E2DA', 0.6), xf(cx, 0.02, cy));
      return;
    }
    if (r.kind === 'field') {
      if (b.kind === 'farm') {
        batch.add(box(r.w, 0.05, r.h), mat('#8C7457', 0.95), xf(cx, 0.035, cy));
        const crop = mat('#6D9B45', 0.85);
        for (let y = r.y + 1.2; y < r.y + r.h - 0.8; y += 1.6) batch.add(rbox(r.w - 1.2, 0.34, 0.55, 0.16), crop, xf(cx, 0.2, y));
      }
      return;
    }
    if (r.kind === 'pitch') return this.pitch(batch, r);
    if (r.kind === 'pen') {
      batch.add(box(r.w, 0.04, r.h), mat('#9A7C58', 0.95), xf(cx, 0.03, cy));
      const wood = mat('#8B6A4B', 0.8);
      for (const [x0, y0, x1, y1] of [[r.x, r.y, r.x + r.w, r.y], [r.x + r.w, r.y, r.x + r.w, r.y + r.h], [r.x, r.y + r.h, r.x + r.w, r.y + r.h], [r.x, r.y, r.x, r.y + r.h]] as const) {
        const l = Math.hypot(x1 - x0, y1 - y0);
        const yaw = Math.atan2(x1 - x0, y1 - y0);
        batch.add(rbox(0.1, 0.12, l, 0.03), wood, xf((x0 + x1) / 2, 0.9, (y0 + y1) / 2, yaw));
        batch.add(rbox(0.1, 0.12, l, 0.03), wood, xf((x0 + x1) / 2, 0.45, (y0 + y1) / 2, yaw));
      }
      return;
    }
    if (r.kind === 'stop') {
      if (b.kind === 'station') {
        // A raised platform beside the guideway, with a canopy.
        const deck = mat('#CFCBC3', 0.8);
        batch.add(box(r.w, 0.3, r.h), deck, xf(cx, PLATFORM_Y - 0.15, cy));
        for (let x = r.x + 3; x < r.x + r.w - 1; x += 10) for (let y = r.y + 3; y < r.y + r.h - 1; y += 10) batch.add(cyl(0.35, 0.45, PLATFORM_Y - 0.3, 14), deck, xf(x, (PLATFORM_Y - 0.3) / 2, y));
        batch.add(rbox(r.w - 1, 0.18, r.h - 1, 0.08), mat('#E9E6E0', 0.4, 0.2), xf(cx, PLATFORM_Y + 3.4, cy));
        batch.add(box(r.w, 0.02, 0.35), mat('#F2C94C', 0.6), xf(cx, PLATFORM_Y + 0.01, r.y + 0.4));
        batch.add(box(r.w, 0.02, 0.35), mat('#F2C94C', 0.6), xf(cx, PLATFORM_Y + 0.01, r.y + r.h - 0.4));
      } else batch.add(box(r.w, 0.06, r.h), mat('#BDB8AE', 0.85), xf(cx, 0.04, cy));
      return;
    }
    if (r.kind === 'graves') {
      batch.add(box(r.w, 0.02, r.h), mat('#86A85C', 0.95), xf(cx, 0.025, cy));
    }
  }

  // ─── Furniture ─────────────────────────────────────────────────────────────

  /** Work out, once, how each spot is used: the pose, the facing and the height. */
  private planSpots(b: Building): void {
    for (const r of b.rooms) if (b.kind === 'station' && r.kind === 'stop') this.decks.add(r.id);
    for (const r of b.rooms) {
      const focus = focusOf(b, r);
      const floor = OPEN.has(r.kind) ? 0 : FLOOR_Y;
      for (const s of r.spots) {
        const toCentre = yawTo(s.x, s.y, r.x + r.w / 2, r.y + r.h / 2);
        // Rows face the front squarely (pews do not fan out toward the pulpit).
        const toFocus = focus ? (focus.y < s.y ? FACE_N : FACE_S) : FACE_N;
        let pose: SpotPose;
        switch (s.kind) {
          case 'bed':
            pose = { pose: 'lie', yaw: FACE_N, height: floor + 0.58, x: s.x, y: s.y + 0.15, spread: Math.PI / 2 };
            break;
          case 'ward':
            pose = { pose: 'lie', yaw: FACE_N, height: floor + 0.72, x: s.x, y: s.y, spread: Math.PI / 2 };
            break;
          case 'exam':
            pose = { pose: 'lie', yaw: Math.PI / 2, height: floor + 0.86, x: s.x, y: s.y, spread: 0 };
            break;
          case 'cell':
            pose = { pose: 'sit', yaw: toCentre, height: floor + 0.47, x: s.x, y: s.y, spread: toCentre + Math.PI / 2 };
            break;
          case 'pew':
            pose = { pose: 'sit', yaw: toFocus, height: floor + 0.475, x: s.x, y: s.y, spread: toFocus + Math.PI / 2 };
            break;
          case 'seat': {
            // Easy chairs face their coffee table; rows in halls face the front; the rest the middle of the room.
            const coffee = isLounge(r) ? furnitureOf(r).coffee : null;
            const faces = r.kind === 'stand' || r.kind === 'auditorium' || r.kind === 'theatre' || r.kind === 'hall' || r.kind === 'courtroom' || r.kind === 'nave' ? toFocus : coffee ? yawTo(s.x, s.y, coffee.x, coffee.y) : toCentre;
            const h = r.kind === 'stand' ? standHeight(b, r, s) : floor;
            // (The seat's top: a cushion, a chair's slab, a stand's step.)
            const softSeat = isLounge(r) || r.kind === 'reception' || r.kind === 'consult';
            pose = { pose: 'sit', yaw: faces, height: h + (r.kind === 'stand' ? 0.46 : softSeat ? 0.44 : 0.47), x: s.x, y: s.y, spread: faces + Math.PI / 2 };
            break;
          }
          case 'desk': {
            const teacher = isFrontDesk(r, s);
            const yaw = teacher ? FACE_S : r.spots.filter((q) => q.kind === 'desk').length === 1 ? FACE_S : FACE_N;
            pose = { pose: 'sit', yaw, height: floor + 0.48, x: s.x, y: s.y, spread: yaw + Math.PI / 2 };
            break;
          }
          case 'table': {
            // At a shared table, facing it across the middle; alone, at a small table to the north.
            const t = furnitureOf(r).byId.get(s.id);
            if (t) {
              const yaw = t.acrossY ? (s.y < t.y ? FACE_S : FACE_N) : s.x < t.x ? Math.PI / 2 : -Math.PI / 2;
              pose = { pose: 'sit', yaw, height: floor + 0.47, x: s.x, y: s.y, spread: yaw + Math.PI / 2 };
            } else pose = { pose: 'sit', yaw: FACE_N, height: floor + 0.47, x: s.x, y: s.y + 0.45, spread: Math.PI / 2 };
            break;
          }
          case 'bench':
          case 'bench-out': {
            // Sharers sit along the bench, whichever way it faces (a park bench turns toward the park's middle).
            const faces = r.kind === 'yard' || b.kind === 'park' ? toCentre : FACE_S;
            pose = { pose: 'sit', yaw: faces, height: floor + 0.47, x: s.x, y: s.y, spread: faces + Math.PI / 2 };
            break;
          }
          case 'pulpit':
            // On the platform, behind the lectern, facing the congregation.
            pose = { pose: 'stand', yaw: FACE_S, height: floor + PULPIT_RISE, x: s.x, y: s.y, spread: Math.PI / 2 };
            break;
          case 'altar':
          case 'counter':
          case 'stall':
            pose = { pose: 'stand', yaw: FACE_S, height: floor, x: s.x, y: s.y, spread: Math.PI / 2 };
            break;
          case 'stove':
            pose = { pose: 'stand', yaw: FACE_N, height: floor, x: s.x, y: s.y + 0.2, spread: Math.PI / 2 };
            break;
          default:
            pose = { pose: 'stand', yaw: toCentre, height: floor, x: s.x, y: s.y, spread: Math.PI / 2 };
        }
        if (this.decks.has(r.id)) pose.height = PLATFORM_Y + (pose.height - floor);
        this.spots.set(s.id, pose);
      }
    }
  }

  private furnish(batch: Batch, b: Building, r: Room, s: Spot): void {
    const p = this.spots.get(s.id);
    if (!p) return;
    const f = OPEN.has(r.kind) ? 0 : FLOOR_Y;
    const wood = mat('#9C6B45', 0.6);
    const woodL = mat('#C69C6D', 0.55);
    const cloth = (key: string) => mat(key, 0.95);
    const yaw = p.yaw;
    // Offsets in the furniture's own frame (forward = the way the user faces).
    const at = (fwd: number, side: number): [number, number] => [s.x + Math.sin(yaw) * fwd + Math.cos(yaw) * side, s.y + Math.cos(yaw) * fwd - Math.sin(yaw) * side];
    switch (s.kind) {
      case 'bed': {
        // A double bed with a pillow each side, or a three-quarter bed with one.
        const hh = b.householdId ? plotColor(b.plot ?? null, false) : '#7C95B5';
        const blanket = cloth(mixHex(hh, '#FFFFFF', 0.25));
        const w = bedWidth(s);
        batch.add(rbox(w, 0.32, 2.3, 0.06), wood, xf(s.x, f + 0.2, s.y + 0.1));
        batch.add(rbox(w - 0.08, 0.22, 2.2, 0.1), cloth('#F7F4EE'), xf(s.x, f + 0.46, s.y + 0.1));
        batch.add(rbox(w - 0.06, 0.1, 1.45, 0.05), blanket, xf(s.x, f + 0.58, s.y + 0.5));
        if (s.double) for (const side of [-1, 1]) batch.add(rbox(0.66, 0.14, 0.42, 0.07), cloth('#FFFFFF'), xf(s.x + side * 0.4, f + 0.63, s.y - 0.72));
        else batch.add(rbox(w - 0.45, 0.14, 0.42, 0.07), cloth('#FFFFFF'), xf(s.x, f + 0.63, s.y - 0.72));
        batch.add(rbox(w + 0.1, s.double ? 1.0 : 0.8, 0.1, 0.04), wood, xf(s.x, f + (s.double ? 0.5 : 0.4), s.y - 1.05));
        break;
      }
      case 'ward':
        batch.add(rbox(1.0, 0.5, 2.1, 0.05), mat('#DADDE0', 0.35, 0.5), xf(s.x, f + 0.4, s.y));
        batch.add(rbox(0.95, 0.16, 2.0, 0.07), cloth('#FFFFFF'), xf(s.x, f + 0.72, s.y));
        batch.add(rbox(0.97, 0.08, 1.2, 0.04), cloth('#9CC7D6'), xf(s.x, f + 0.82, s.y + 0.35));
        batch.add(rbox(0.7, 0.12, 0.4, 0.06), cloth('#FFFFFF'), xf(s.x, f + 0.85, s.y - 0.7));
        break;
      case 'exam':
        batch.add(rbox(2.0, 0.75, 0.75, 0.08), mat('#DADDE0', 0.35, 0.4), xf(s.x, f + 0.38, s.y));
        batch.add(rbox(2.0, 0.1, 0.75, 0.05), cloth('#6FA3B8'), xf(s.x, f + 0.8, s.y));
        break;
      case 'seat':
      case 'cell': {
        const soft = isLounge(r) || r.kind === 'reception' || r.kind === 'consult';
        // The lounge's coffee table, laid once (by the room's first easy chair).
        const coffee = s.kind === 'seat' && isLounge(r) ? furnitureOf(r).coffee : null;
        if (coffee && r.spots.find((q) => q.kind === 'seat') === s) this.coffeeTable(batch, coffee, f);
        const base = r.kind === 'stand' ? p.height - 0.46 : f;
        if (soft) {
          // An easy chair: a cushion as deep as a seat is (0.55 m), the backrest against its back edge, an arm each side.
          const up = cloth(r.kind === 'living' ? '#8A6F5A' : '#6C7F8E');
          batch.add(rbox(0.9, 0.42, 0.55, 0.12), up, xf(s.x, base + 0.21, s.y, yaw));
          const [bx, by] = at(-0.335, 0);
          batch.add(rbox(0.9, 0.7, 0.2, 0.09), up, xf(bx, base + 0.62, by, yaw));
          for (const side of [-0.42, 0.42]) {
            const [ax, ay] = at(-0.08, side);
            batch.add(rbox(0.16, 0.6, 0.71, 0.07), up, xf(ax, base + 0.3, ay, yaw));
          }
        } else if (r.kind !== 'stand') this.chair(batch, s.x, s.y, yaw, base, woodL, wood);
        break;
      }
      case 'pew': {
        batch.add(rbox(3.6, 0.07, 0.5, 0.02), wood, xf(s.x, f + 0.44, s.y, yaw));
        const [bx, by] = at(-0.27, 0);
        batch.add(rbox(3.6, 0.55, 0.07, 0.02), wood, xf(bx, f + 0.72, by, yaw));
        for (const side of [-1.7, 1.7]) {
          const [ex, ey] = at(-0.05, side);
          batch.add(rbox(0.08, 0.9, 0.6, 0.02), wood, xf(ex, f + 0.45, ey, yaw));
        }
        break;
      }
      case 'desk': {
        const [dx, dy] = at(0.62, 0);
        batch.add(rbox(1.3, 0.05, 0.7, 0.02), woodL, xf(dx, f + 0.74, dy, yaw));
        for (const [fx, sx] of [[-0.3, -0.58], [-0.3, 0.58], [0.3, -0.58], [0.3, 0.58]]) {
          const [lx, ly] = at(0.62 + fx, sx);
          batch.add(cyl(0.025, 0.025, 0.72, 6), mat('#4B4F57', 0.4, 0.6), xf(lx, f + 0.36, ly));
        }
        batch.add(rbox(0.5, 0.06, 0.5, 0.02), mat('#3E4A5A', 0.8), xf(s.x, f + 0.45, s.y, yaw));
        const [bx, by] = at(-0.24, 0);
        batch.add(rbox(0.46, 0.5, 0.06, 0.03), mat('#3E4A5A', 0.8), xf(bx, f + 0.74, by, yaw));
        batch.add(cyl(0.03, 0.03, 0.42, 6), mat('#4B4F57', 0.4, 0.6), xf(s.x, f + 0.21, s.y));
        // A laptop or an open book.
        const [px, py] = at(0.55, 0);
        batch.add(rbox(0.36, 0.02, 0.26, 0.01), mat(hash01(s.id) < 0.5 ? '#2C2F35' : '#F2EFE6', 0.4), xf(px, f + 0.78, py, yaw));
        break;
      }
      case 'table': {
        const t = furnitureOf(r).byId.get(s.id);
        if (t) {
          // A chair at the shared table, and the table itself (laid by its first chair): a plate at every place.
          this.chair(batch, p.x, p.y, yaw, f, woodL, wood);
          if (t.ids[0] === s.id) {
            this.table(batch, t.x, t.y, t.w, t.d, f, woodL, wood);
            const plate = mat('#F4F1EA', 0.35);
            for (const id of t.ids) {
              const q = r.spots.find((x) => x.id === id);
              if (!q) continue;
              const px = t.acrossY ? q.x : t.x + Math.sign(q.x - t.x) * (t.w / 2 - 0.2);
              const py = t.acrossY ? t.y + Math.sign(q.y - t.y) * (t.d / 2 - 0.2) : q.y;
              batch.add(cyl(0.12, 0.1, 0.02, 18), plate, xf(px, f + 0.79, py));
            }
            batch.add(sphere(0.13, 14, 8), mat('#E9E4DA', 0.3), xf(t.x, f + 0.82, t.y, 0, 1, 0.45, 1));
          }
          break;
        }
        // A small table on its own, a chair at it and another across.
        const [tx, ty] = at(0.35, 0);
        const wide = Math.abs(Math.cos(yaw)) > 0.5;
        this.table(batch, tx, ty, wide ? 1.0 : 0.8, wide ? 0.8 : 1.0, f, woodL, wood);
        this.chair(batch, p.x, p.y, yaw, f, woodL, wood);
        const [ox, oy] = at(1.1, 0);
        this.chair(batch, ox, oy, yaw + Math.PI, f, woodL, wood);
        // A bowl on the table.
        batch.add(sphere(0.12, 14, 8), mat('#E9E4DA', 0.3), xf(tx, f + 0.8, ty, 0, 1, 0.45, 1));
        break;
      }
      case 'stove': {
        const [kx, ky] = at(0.55, 0);
        batch.add(rbox(0.9, 0.9, 0.7, 0.04), mat('#E8E6E1', 0.35, 0.3), xf(kx, f + 0.45, ky, yaw));
        batch.add(box(0.86, 0.02, 0.66), mat('#1E1F22', 0.3), xf(kx, f + 0.91, ky, yaw));
        for (const [a2, b2] of [[-0.2, -0.16], [0.2, -0.16], [-0.2, 0.16], [0.2, 0.16]]) {
          const [bx, by] = at(0.55 + b2, a2);
          batch.add(cyl(0.1, 0.1, 0.015, 16), mat('#4A4B4F', 0.5, 0.6), xf(bx, f + 0.925, by));
        }
        const [px, py] = at(0.45, 0.2);
        batch.add(cyl(0.14, 0.12, 0.2, 16), mat('#B8BCC2', 0.25, 0.9), xf(px, f + 1.03, py));
        break;
      }
      case 'counter': {
        const [cx, cy] = at(0.75, 0);
        batch.add(rbox(3.2, 1.0, 0.7, 0.05), mat('#8E6B4E', 0.6), xf(cx, f + 0.5, cy, yaw));
        batch.add(rbox(3.3, 0.05, 0.78, 0.02), mat('#E4DDD0', 0.35), xf(cx, f + 1.02, cy, yaw));
        break;
      }
      case 'stall': {
        const [cx, cy] = at(0.8, 0);
        const colour = ['#D9534F', '#F0AD4E', '#5CB85C', '#5BC0DE', '#8E6CC2'][Math.floor(hash01(s.id) * 5)];
        batch.add(rbox(2.4, 0.85, 0.9, 0.04), woodL, xf(cx, f + 0.42, cy, yaw));
        for (const [fx, sx] of [[-0.4, -1.15], [-0.4, 1.15], [0.4, -1.15], [0.4, 1.15]]) {
          const [lx, ly] = at(0.8 + fx, sx);
          batch.add(cyl(0.035, 0.035, 2.2, 6), wood, xf(lx, f + 1.1, ly));
        }
        batch.add(rbox(2.6, 0.06, 1.3, 0.03), mat(colour, 0.8), xf(cx, f + 2.2, cy, yaw, 1, 1, 1, 0.12));
        for (let i = 0; i < 5; i++) {
          const [fx2, fy2] = at(0.75 + (i % 2) * 0.15, -0.9 + i * 0.45);
          batch.add(sphere(0.12, 12, 8), mat(['#E4572E', '#F3A712', '#76B041', '#A8D5E2', '#E8C547'][i], 0.6), xf(fx2, f + 0.95, fy2));
        }
        break;
      }
      case 'pulpit': {
        // The platform the pastor stands on, and a lectern at the height of his hands, so the congregation sees him
        // from the waist up.
        const [lx, ly] = at(0.55, 0);
        const top = f + PULPIT_RISE;
        batch.add(rbox(3.2, PULPIT_RISE, 2.2, 0.04), mat('#8E5E3C', 0.55), xf(s.x, f + PULPIT_RISE / 2, s.y - 0.2));
        batch.add(rbox(0.7, 1.05, 0.5, 0.05), mat('#7A4E30', 0.5), xf(lx, top + 0.525, ly, yaw, 1, 1, 1, -0.08));
        batch.add(box(0.5, 0.02, 0.36), mat('#F4EFE4', 0.6), xf(lx, top + 1.07, ly, yaw, 1, 1, 1, -0.3));
        break;
      }
      case 'altar': {
        const [ax, ay] = at(-0.9, 0);
        batch.add(rbox(1.8, 0.95, 0.8, 0.04), mat('#8A5A38', 0.5), xf(ax, f + 0.47, ay, yaw));
        batch.add(box(1.84, 0.02, 0.84), cloth('#FBF8F0'), xf(ax, f + 0.96, ay, yaw));
        for (const side of [-0.6, 0.6]) {
          const [cx, cy] = at(-0.9, side);
          batch.add(cyl(0.03, 0.03, 0.3, 8), mat('#F5EFD9', 0.5), xf(cx, f + 1.12, cy));
        }
        break;
      }
      case 'bench':
      case 'bench-out': {
        const slat = mat('#A4744C', 0.6);
        const iron = mat('#2E3136', 0.45, 0.5);
        batch.add(rbox(1.8, 0.06, 0.45, 0.02), slat, xf(s.x, f + 0.44, s.y, yaw));
        const [bx, by] = at(-0.24, 0);
        batch.add(rbox(1.8, 0.35, 0.05, 0.02), slat, xf(bx, f + 0.7, by, yaw, 1, 1, 1, -0.12));
        for (const side of [-0.8, 0.8]) {
          const [lx, ly] = at(0, side);
          batch.add(box(0.05, 0.44, 0.44), iron, xf(lx, f + 0.22, ly, yaw));
        }
        break;
      }
      case 'grave': {
        const stone = mat(hash01(s.id) < 0.5 ? '#BFC0BD' : '#9E9E98', 0.75);
        batch.add(rbox(0.7, 0.9, 0.16, 0.08), stone, xf(s.x, f + 0.45, s.y - 0.9));
        batch.add(rbox(0.9, 0.16, 1.8, 0.08), mat('#7A9A55', 0.95), xf(s.x, f + 0.08, s.y));
        break;
      }
      case 'generic':
        if (r.kind === 'bathroom') {
          batch.add(rbox(0.42, 0.42, 0.62, 0.12), mat('#FAFAF8', 0.2), xf(s.x, f + 0.21, s.y));
          batch.add(rbox(0.44, 0.5, 0.18, 0.06), mat('#FAFAF8', 0.2), xf(s.x, f + 0.55, s.y - 0.3));
        } else if (r.kind !== 'pitch' && r.kind !== 'stage' && !OPEN.has(r.kind)) {
          // A pot plant.
          batch.add(cyl(0.22, 0.17, 0.4, 14), mat('#B5653F', 0.7), xf(s.x, f + 0.2, s.y));
          batch.add(sphere(0.38, 14, 10), mat('#5E9A48', 0.8), xf(s.x, f + 0.72, s.y, 0, 1, 1.2, 1));
        }
        break;
      default:
        break;
    }
  }

  /** A few things every room of a kind has, against its back wall, clear of the spots and the doors. */
  private decor(batch: Batch, b: Building, r: Room): void {
    const f = FLOOR_Y;
    const clear = (x: number, y: number, rad: number) => r.spots.every((s) => Math.hypot(s.x - x, s.y - y) > rad + 1.1);
    const back = r.y + 0.45;
    const wood = mat('#8C5E3C', 0.6);
    switch (r.kind) {
      case 'living':
        if (b.kind === 'house') {
          if (clear(r.x + r.w / 2, back + 0.3, 1)) {
            batch.add(rbox(1.8, 0.5, 0.45, 0.04), wood, xf(r.x + r.w / 2, f + 0.25, back + 0.1));
            batch.add(rbox(1.3, 0.72, 0.06, 0.02), mat('#15161A', 0.25), xf(r.x + r.w / 2, f + 0.9, back + 0.05));
          }
          batch.add(rbox(Math.min(4, r.w * 0.4), 0.02, Math.min(3, r.h * 0.35), 0.01), mat(mixHex(plotColor(b.plot ?? null, false), '#EFE6D6', 0.55), 0.95), xf(r.x + r.w / 2, f + 0.01, r.y + r.h / 2));
        }
        if (clear(r.x + 0.8, back + 0.4, 0.5)) {
          batch.add(cyl(0.24, 0.18, 0.45, 14), mat('#B5653F', 0.7), xf(r.x + 0.8, f + 0.22, back + 0.4));
          batch.add(sphere(0.45, 14, 10), mat('#5B9646', 0.8), xf(r.x + 0.8, f + 0.85, back + 0.4, 0, 1, 1.3, 1));
        }
        break;
      case 'kitchen':
        for (let x = r.x + 0.9; x < r.x + r.w - 0.9; x += 1.0) {
          if (!clear(x, back + 0.2, 0.2)) continue;
          batch.add(rbox(0.98, 0.88, 0.62, 0.03), mat('#E8E2D6', 0.5), xf(x, f + 0.44, back + 0.1));
          batch.add(box(1.0, 0.04, 0.66), mat('#6E6259', 0.4), xf(x, f + 0.9, back + 0.1));
        }
        if (clear(r.x + r.w - 0.6, back + 0.6, 0.4)) batch.add(rbox(0.8, 1.8, 0.7, 0.08), mat('#F2F1EE', 0.3, 0.1), xf(r.x + r.w - 0.6, f + 0.9, back + 0.3));
        break;
      case 'bedroom':
        if (clear(r.x + r.w - 0.5, r.y + r.h / 2, 0.8)) batch.add(rbox(0.6, 2.0, 1.4, 0.04), wood, xf(r.x + r.w - 0.45, f + 1.0, r.y + r.h / 2));
        break;
      case 'bathroom':
        if (clear(r.x + r.w / 2, back + 0.4, 0.7)) {
          batch.add(rbox(Math.min(1.7, r.w - 0.4), 0.55, 0.75, 0.2), mat('#FAFAF8', 0.15), xf(r.x + r.w / 2, f + 0.28, back + 0.35));
          batch.add(rbox(Math.min(1.5, r.w - 0.6), 0.1, 0.6, 0.15), mat('#9FD0E0', 0.1), xf(r.x + r.w / 2, f + 0.5, back + 0.35));
        }
        break;
      case 'classroom':
        batch.add(box(Math.min(5, r.w * 0.5), 1.2, 0.05), mat('#2D4A3E', 0.9), xf(r.x + r.w / 2, f + 1.5, r.y + 0.14));
        break;
      case 'office':
      case 'library':
        for (let x = r.x + 1; x < r.x + r.w - 1 && x < r.x + (r.kind === 'library' ? r.w : 4); x += 1.3) {
          if (!clear(x, back + 0.2, 0.4)) continue;
          batch.add(rbox(1.2, 1.9, 0.4, 0.02), wood, xf(x, f + 0.95, back));
          for (let k = 0; k < 4; k++) batch.add(box(1.1, 0.26, 0.3), mat(['#8E3B3B', '#2F5D8A', '#4E7A45', '#C08A3E'][(k + Math.floor(x)) % 4], 0.8), xf(x, f + 0.3 + k * 0.45, back + 0.02));
        }
        break;
      case 'nave': {
        batch.add(box(0.14, 1.6, 0.08), mat('#6E4A2E', 0.5), xf(r.x + r.w / 2, f + 2.1, r.y + 0.15));
        batch.add(box(0.9, 0.14, 0.08), mat('#6E4A2E', 0.5), xf(r.x + r.w / 2, f + 2.45, r.y + 0.15));
        // A red runner up the aisle, from the pulpit to the door end.
        const pulpit = r.spots.find((s) => s.kind === 'pulpit');
        const ax = pulpit ? pulpit.x : r.x + r.w / 2;
        const y0 = (pulpit ? pulpit.y : r.y) + 1.5;
        batch.add(box(2.0, 0.012, r.y + r.h - 0.6 - y0), mat('#9E2B2B', 0.95), xf(ax, f + 0.006, (y0 + r.y + r.h - 0.6) / 2));
        break;
      }
      case 'workshop':
      case 'garage':
        if (clear(r.x + r.w / 2, back + 0.4, 1)) {
          batch.add(rbox(2.2, 0.9, 0.8, 0.03), mat('#7D5A3D', 0.7), xf(r.x + r.w / 2, f + 0.45, back + 0.35));
          batch.add(rbox(0.3, 0.3, 0.3, 0.04), mat('#C0392B', 0.5), xf(r.x + r.w / 2 + 0.6, f + 1.05, back + 0.3));
        }
        break;
      default:
        break;
    }
  }
}

/** Where the people in a room look: the stage, the pitch, the pulpit or the front desk. */
function focusOf(b: Building, r: Room): { x: number; y: number } | null {
  const stage = b.rooms.find((q) => q.kind === 'stage');
  if (stage && r.kind === 'auditorium') return { x: stage.x + stage.w / 2, y: stage.y + stage.h / 2 };
  const pitch = b.rooms.find((q) => q.kind === 'pitch');
  if (pitch && r.kind === 'stand') return { x: pitch.x + pitch.w / 2, y: pitch.y + pitch.h / 2 };
  const pulpit = r.spots.find((s) => s.kind === 'pulpit');
  if (pulpit) return { x: pulpit.x, y: pulpit.y };
  const bench = r.spots.find((s) => s.kind === 'counter' || s.kind === 'desk');
  if (bench && r.kind === 'courtroom') return { x: bench.x, y: bench.y };
  return null;
}

/** The desk at the front of a room of desks faces the room; the rest face it. */
function isFrontDesk(r: Room, s: Spot): boolean {
  const desks = r.spots.filter((q) => q.kind === 'desk');
  if (desks.length < 3) return false;
  const top = Math.min(...desks.map((q) => q.y));
  return s.y === top && desks.filter((q) => q.y === top).length === 1;
}

/** Seat height on a stand's tier (matching World3D.stadium's steps). */
function standHeight(b: Building, r: Room, s: Spot): number {
  const north = r.y + r.h / 2 < b.y + b.h / 2;
  const tiers = north ? 7 : 3;
  const rise = north ? 0.85 : 0.45;
  const depth = r.h / tiers;
  const i = north ? Math.floor((r.y + r.h - s.y) / depth) : Math.floor((s.y - r.y) / depth);
  return rise * (Math.max(0, Math.min(tiers - 1, i)) + 1);
}

// ── Trees ──

interface TreeKind {
  crown: THREE.BufferGeometry;
  trunk: THREE.BufferGeometry;
  /** Size relative to the seed's canopy radius, and height stretch. */
  scale: number;
  tall: number;
  jacaranda: boolean;
}

let kindsCache: TreeKind[] | null = null;

/** Broad shade trees (two shapes), jacarandas, acacias and gums; built once. */
function treeKinds(): TreeKind[] {
  if (kindsCache) return kindsCache;
  // Lobes: x, y (height), z, radius, in units of the crown's radius; the crown hangs low over a short trunk.
  const broadA = crownOf(1, [[0, 2.55, 0, 1.2], [0.95, 2.3, 0.3, 0.95], [-0.85, 2.35, -0.4, 1.0], [0.2, 3.2, -0.55, 0.9], [-0.3, 3.05, 0.7, 0.85], [0.75, 2.95, -0.8, 0.7], [-0.95, 1.95, 0.6, 0.72], [0.5, 1.8, -0.2, 0.7], [-0.2, 1.75, -0.9, 0.62]]);
  const broadB = crownOf(2, [[0, 2.7, 0, 1.15], [1.05, 2.4, -0.2, 0.92], [-1.05, 2.5, 0.2, 0.92], [0, 3.45, 0, 0.85], [0.4, 2.3, 0.95, 0.78], [-0.45, 2.2, -0.95, 0.78], [0.8, 1.85, 0.6, 0.6], [-0.7, 1.9, -0.4, 0.62]]);
  const acacia = crownOf(3, [[0, 2.95, 0, 0.9], [1.1, 2.9, 0.2, 0.85], [-1.1, 2.95, -0.2, 0.85], [0.4, 3.0, 1.0, 0.75], [-0.5, 2.95, -1.0, 0.75], [1.5, 2.85, -0.8, 0.62], [-1.5, 2.85, 0.8, 0.62], [0.9, 2.9, 1.2, 0.55], [-0.9, 2.9, -1.3, 0.55]], 0.42);
  const gum = crownOf(4, [[0, 3.4, 0, 0.8], [0.3, 4.3, 0.2, 0.72], [-0.25, 5.1, -0.1, 0.62], [0.4, 2.7, -0.3, 0.62], [-0.45, 3.9, 0.4, 0.58], [0.1, 5.8, 0.1, 0.45], [-0.3, 2.4, 0.3, 0.5]], 1);
  const bark = '#6E5038';
  kindsCache = [
    { crown: broadA, trunk: trunkOf(bark, 2.1, 0.22, 4), scale: 1, tall: 1, jacaranda: false },
    { crown: broadB, trunk: trunkOf(bark, 2.2, 0.21, 4), scale: 1, tall: 1, jacaranda: false },
    { crown: broadA, trunk: trunkOf('#5E4535', 2.0, 0.19, 5), scale: 1, tall: 0.95, jacaranda: true },
    { crown: acacia, trunk: trunkOf('#4E3F33', 2.7, 0.15, 4), scale: 1.1, tall: 0.95, jacaranda: false },
    { crown: gum, trunk: trunkOf('#D9D2C3', 3.2, 0.2, 3), scale: 0.78, tall: 1.2, jacaranda: false },
  ];
  return kindsCache;
}

/** Which kind of tree grows at a seed: mostly shade trees, jacarandas along the town streets, gums and thorn trees. */
function pickKind(j: number, x: number, y: number): number {
  const k = hash01(`${Math.round(x)}|${Math.round(y)}`, 9);
  if (k < 0.22) return 2;
  if (k < 0.36) return 3;
  if (k < 0.5) return 4;
  return j < 0.5 ? 0 : 1;
}

/** A crown: lobes (centre x, y, z, radius, in canopy radii) merged and roughened, lit darker underneath and inside. */
function crownOf(seed: number, lobes: Array<[number, number, number, number]>, flatten = 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const [x, y, z, r] of lobes) {
    const g = new THREE.IcosahedronGeometry(r, 2);
    g.scale(1, flatten < 1 ? flatten * 1.2 : 0.9, 1);
    g.translate(x, y, z);
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  // Weld each lobe's vertices (smooth shading), then roughen the outline so it reads as foliage.
  for (const g of parts) g.deleteAttribute('uv');
  const merged = mergeVertices(mergeGeometries(parts, false)!, 1e-4);
  const pos = merged.attributes.position as THREE.BufferAttribute;
  let my = 0;
  for (let i = 0; i < pos.count; i++) my += pos.getY(i);
  my /= pos.count;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = (noise3(x * 2.1 + seed, y * 2.1, z * 2.1) - 0.5) * 0.4 + (noise3(x * 6.3, y * 6.3 + seed, z * 6.3) - 0.5) * 0.16 + (noise3(x * 14, y * 14, z * 14 + seed) - 0.5) * 0.06;
    const l = Math.hypot(x, y - my, z) || 1;
    pos.setXYZ(i, x + (x / l) * n, y + ((y - my) / l) * n, z + (z / l) * n);
  }
  merged.computeVertexNormals();
  // Light from above and outside: the underside and the heart of the crown are in shade.
  const col = new Float32Array(pos.count * 3);
  let cy = 0;
  for (let i = 0; i < pos.count; i++) cy += pos.getY(i);
  cy /= pos.count;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const out = Math.min(1, Math.hypot(pos.getX(i), (y - cy) * 1.2, pos.getZ(i)) / 1.6);
    const up = Math.max(0, Math.min(1, (y - cy + 1.2) / 2.4));
    const v = 0.52 + 0.36 * up + 0.16 * out + (noise3(pos.getX(i) * 3, y * 3, pos.getZ(i) * 3 + seed) - 0.5) * 0.14;
    col[i * 3] = v * 0.96;
    col[i * 3 + 1] = v;
    col[i * 3 + 2] = v * 0.92;
  }
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  merged.computeBoundingSphere();
  return merged;
}

/** A trunk that forks into a few boughs reaching into the crown. */
function trunkOf(colour: string, height: number, radius: number, boughs: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const t = new THREE.CylinderGeometry(radius * 0.7, radius, height, 8, 3);
  t.translate(0, height / 2, 0);
  parts.push(t.toNonIndexed());
  for (let i = 0; i < boughs; i++) {
    const a = (i / boughs) * Math.PI * 2 + 0.6;
    const len = 1.4 + (i % 2) * 0.4;
    const b = new THREE.CylinderGeometry(radius * 0.28, radius * 0.5, len, 6);
    b.translate(0, len / 2, 0);
    b.rotateZ(0.7);
    b.rotateY(a);
    b.translate(0, height * 0.82, 0);
    parts.push(b.toNonIndexed());
  }
  const g = mergeGeometries(parts, false)!;
  const col = new Float32Array(g.attributes.position.count * 3);
  const c = new THREE.Color(colour);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const v = 0.85 + (noise3(pos.getX(i) * 9, pos.getY(i) * 3, pos.getZ(i) * 9) - 0.5) * 0.3;
    col[i * 3] = c.r * v;
    col[i * 3 + 1] = c.g * v;
    col[i * 3 + 2] = c.b * v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Smooth value noise in 3D, 0..1. */
function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const f = (t: number) => t * t * (3 - 2 * t);
  const u = f(x - xi);
  const v = f(y - yi);
  const w = f(z - zi);
  const h = (a: number, b: number, c: number) => {
    let n = (a * 374761393 + b * 668265263 + c * 1274126177) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

/** Shared clock for the trees' sway in the wind. */
export const treeWind = { time: { value: 0 }, strength: { value: 0.3 } };

/** Crowns stir in the wind: the higher the leaves, the more they move. */
function swaying(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = treeWind.time;
    shader.uniforms.uWind = treeWind.strength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 wp = instanceMatrix[3].xyz;
        #else
          vec3 wp = vec3(0.0);
        #endif
        float sway = max(0.0, position.y - 2.0) * 0.05 * uWind;
        float ph = wp.x * 0.13 + wp.z * 0.17;
        transformed.x += sin(uTime * 1.3 + ph) * sway + sin(uTime * 3.1 + ph * 2.0 + position.y) * sway * 0.25;
        transformed.z += cos(uTime * 1.1 + ph) * sway * 0.6;`,
      );
  };
  m.customProgramCacheKey = () => 'sway';
  return m;
}
