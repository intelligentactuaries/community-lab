// Canvas 2D renderer: the province at three levels of detail, people as
// classical shapes, vehicles (cars, taxis, buses, the Hyperline, the planes),
// intruders, conversations, weather and night.
import { bedWidth } from '../../sim/beds';
import { alivePeople } from '../../sim/ctx';
import { JOBS, eduRank } from '../../sim/population';
import { nightDarkness } from '../../sim/time';
import { TRAIN_LENGTH } from '../../sim/transit';
import type { Building, Conversation, Intruder, Person, Room, Vehicle, World } from '../../sim/types';
import { CITIES, COMMUNITIES, STATIONS, TRACK, TRACK_CUM, TRACK_WIDTH, WORLD_H, WORLD_W, trackPoint } from '../../sim/world';
import { fitWorld } from '../lib/camera';
import type { Camera } from '../lib/camera';
import { tokens } from '../lib/theme';
import { plotColor } from '../lib/householdColor';
import { tracePath } from './shapes';
import { furnitureOf } from './furniture';
import { indoorsOf } from './indoors';
import { treeSeeds } from './trees';

export interface RenderState {
  world: World;
  camera: Camera;
  w: number;
  h: number;
  dpr: number;
  micro: boolean;
  selection: { kind: string; id: string } | null;
  /** Household whose members get a halo (selected household, or the selected person's household). */
  highlightHouseholdId: string | null;
  hoverId: string | null;
  followId: string | null;
  dayOfYear: number;
  latitude: number;
  realNow: number;
  showLabels: boolean;
  /**
   * The 3D view is showing underneath: draw only what floats over it — names,
   * speech, the hymn's notes — at these screen positions (a person's feet and
   * the top of their head), on a transparent canvas. (The 3D view has its own
   * rain and snow, falling outdoors only.)
   */
  overlay?: Map<string, { feet: { x: number; y: number }; head: { x: number; y: number } }> | null;
  /** Over the 3D view: where each building's name goes on screen (above its entrance), nearest first. */
  overlayBuildings?: Array<{ id: string; x: number; y: number }> | null;
}

/** A ♪ over a singer: where it goes, and the space its ink asks for. */
interface NoteMark {
  x: number;
  y: number;
  font: string;
  lineWidth: number;
  box: { x: number; y: number; w: number; h: number };
}

interface Disp {
  x: number;
  y: number;
  seen: number;
}

/** How many of a singing congregation carry the whole line; every other voice carries its opening words. */
const HYMN_VOICES = 6;

/** From this zoom (px per metre) the buildings are drawn open, their rooms showing. */
const ROOMS_ZOOM = 4;

/** The opening of a sung line, for the voices that echo it: "♪ When peace like a river…". */
function opening(text: string, words = 4): string {
  const parts = text.split(' ');
  if (parts.length <= words) return text;
  return parts.slice(0, words).join(' ').replace(/[,.;:!]+$/, '') + '…';
}

const JOB_CODE: Partial<Record<string, string>> = { pilot: 'Cpt', busdriver: 'Bus', ehailer: 'Hmb', pastor: 'Pas', doctor: 'Dr', nurse: 'RN', teacher: 'Tch', police: 'SAPS', magistrate: 'Mag', clerk: 'Clk', shopkeeper: 'Shp', vendor: 'Vnd', farmer: 'Frm', farmhand: 'Fld', builder: 'Bld', office: 'Off', banker: 'Bnk', attorney: 'Adv', accountant: 'Acc', dmo: 'DMO', combanker: 'CB', taxidriver: 'Txi', domestic: 'Dom', homemaker: 'Hme', retired: 'Ret', student: 'Stu' };

export class Renderer {
  private disp = new Map<string, Disp>();
  private t: Record<string, string> = tokens();
  private lastTheme = '';
  private lastNight = '';
  private treeSeeds: Array<{ x: number; y: number; r: number }> = [];
  /** Screen boxes already occupied by labels / bubbles this frame (collision avoidance). */
  private placed: Array<{ x: number; y: number; w: number; h: number }> = [];
  /** Everyone singing a hymn right now, across every church (rebuilt each frame). */
  private singers = new Set<string>();
  /**
   * Map text (road, building, room and place names, alerts) waits here until the
   * night wash has been laid over the scenery, so night darkens the map, not the
   * words on it.
   */
  private later: Array<{ layer: number; draw: () => void }> = [];
  /** Opacity of the plates under names (0 = the map's own); raised over the 3D view. */
  private plateAlpha = 0;
  /** Buildings with someone inside this frame; the rest are drawn slightly greyed. */
  private occupied = new Set<string>();
  /**
   * Where each Hyperline train is drawn. A hop is over in a second or so of
   * simulated time, which at most viewing speeds is a single frame, so the
   * drawn train glides from station to station over about half a real second,
   * trailing a streak, and catches the simulation up at the platform.
   */
  private trains = new Map<string, { t: number; from: number; vel: number }>();

  constructor() {}

  refreshTheme(): void {
    const th = document.documentElement.getAttribute('data-theme') ?? '';
    const night = getComputedStyle(document.documentElement).getPropertyValue('--night').trim();
    if (th !== this.lastTheme || night !== this.lastNight) {
      this.t = tokens();
      this.lastTheme = th;
      this.lastNight = night;
    }
  }

  /** Queue map text for after the night wash; lower layers are drawn first (underneath). */
  private defer(layer: number, draw: () => void): void {
    this.later.push({ layer, draw });
  }

  /**
   * Map lettering: the ink on a soft glow of the ground's colour (a blurred
   * shadow, not an outline), so a name reads over roads, plots and roofs without
   * looking stamped on.
   */
  private halo(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, ink: string): void {
    ctx.save();
    ctx.shadowColor = this.lastTheme === 'dark' ? 'rgba(22, 19, 16, 0.9)' : 'rgba(242, 238, 228, 0.95)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = ink;
    // Two passes build the glow up to a readable backing; the glyphs stay crisp on top.
    ctx.fillText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  private sx(cam: Camera, w: number, x: number): number {
    return (x - cam.x) * cam.zoom + w / 2;
  }
  private sy(cam: Camera, h: number, y: number): number {
    return (y - cam.y) * cam.zoom + h / 2;
  }

  /** Display position with easing (macro mode) or exact (micro). */
  private displayPos(p: Person, micro: boolean, dt: number, now: number): { x: number; y: number } {
    let d = this.disp.get(p.id);
    if (!d) {
      d = { x: p.loc.x, y: p.loc.y, seen: now };
      this.disp.set(p.id, d);
    }
    if (micro) {
      d.x = p.loc.x;
      d.y = p.loc.y;
    } else {
      const k = 1 - Math.exp(-dt / 0.22);
      d.x += (p.loc.x - d.x) * k;
      d.y += (p.loc.y - d.y) * k;
    }
    d.seen = now;
    return d;
  }

  draw(ctx: CanvasRenderingContext2D, st: RenderState, dt: number): void {
    this.refreshTheme();
    this.later = [];
    if (st.overlay) {
      this.drawOverlay(ctx, st, st.overlay);
      return;
    }
    const { world, camera: cam, w, h } = st;
    const z = cam.zoom;
    const t = this.t;
    ctx.save();
    ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = t.ground;
    ctx.fillRect(0, 0, w, h);
    // World frame
    const X = (x: number) => this.sx(cam, w, x);
    const Y = (y: number) => this.sy(cam, h, y);
    const season = world.weather.season;
    // Village ground
    ctx.fillStyle = seasonGround(t, season, this.lastTheme === 'dark');
    ctx.fillRect(X(0), Y(0), WORLD_W * z, WORLD_H * z);
    ctx.strokeStyle = t.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(X(0), Y(0), WORLD_W * z, WORLD_H * z);

    // Who is where, before anything is drawn: empty places are greyed a little.
    this.occupied.clear();
    for (const p of alivePeople(world)) if (!p.away && !p.inVehicleId && p.loc.buildingId) this.occupied.add(p.loc.buildingId);
    this.drawPlotsAndGrass(ctx, st, X, Y);
    this.drawCityBounds(ctx, st, X, Y);
    this.drawRoads(ctx, st, X, Y);
    for (const id in world.buildings) this.drawBuilding(ctx, st, world.buildings[id], X, Y);
    this.drawTrees(ctx, st, X, Y);
    this.drawGraves(ctx, st, X, Y);
    this.drawTrack(ctx, st, X, Y);
    this.drawCommunityNames(ctx, st, X, Y);
    for (const vid in world.vehicles) this.drawVehicle(ctx, st, world.vehicles[vid], X, Y, dt);
    for (const iid in world.intruders) this.drawIntruder(ctx, st, world.intruders[iid], X, Y);
    this.drawIncidents(ctx, st, X, Y);
    // People (sorted by y so nearer ones overlap correctly)
    const people = alivePeople(world).filter((p) => !p.away);
    const positions = new Map<string, { x: number; y: number }>();
    for (const p of people) positions.set(p.id, this.displayPos(p, st.micro, dt, st.realNow));
    people.sort((a, b) => positions.get(a.id)!.y - positions.get(b.id)!.y);
    this.drawConversationLinks(ctx, st, positions, X, Y);
    this.singers.clear();
    for (const id in world.conversations) {
      const c = world.conversations[id];
      if (!c.hymn || c.hymn.lineIdx < 0) continue;
      if (!c.participantIds.every((pid) => world.people[pid]?.conversationId === id)) continue;
      for (const sid of c.hymn.singerIds) this.singers.add(sid);
    }
    this.placed = [];
    for (const p of people) this.drawPerson(ctx, st, p, positions.get(p.id)!, X, Y);
    // Night falls on the scenery, the rain falls on it; then the words go on top, undimmed and unstreaked.
    this.drawWeatherAndNight(ctx, st, X, Y);
    this.drawPrecipitation(ctx, st);
    for (const l of this.later.sort((a, b) => a.layer - b.layer)) l.draw();
    this.later = [];
    // A hymn puts a note over every voice. The bubbles route around them so no
    // sung line lands under a note; the name plates are left free to crowd as
    // they always do, and the notes are painted last, over whatever they meet.
    const notes = this.singingNotes(ctx, st, positions, X, Y);
    for (const n of notes) this.placed.push(n.box);
    // Bubbles are laid out BEFORE names: what someone is saying matters more
    // than their label, so in a crowded room the labels yield, not the speech.
    if (z >= 6) this.drawBubbles(ctx, st, positions, X, Y);
    this.placed.splice(0, notes.length);
    this.drawLabels(ctx, st, people, positions, X, Y);
    for (const n of notes) {
      ctx.font = n.font;
      ctx.lineWidth = n.lineWidth;
      ctx.strokeStyle = t.bg;
      ctx.strokeText('♪', n.x, n.y);
      ctx.fillStyle = t.accent;
      ctx.fillText('♪', n.x, n.y);
    }
    ctx.restore();
    // GC display cache
    if (this.disp.size > people.length + 50) for (const [id, d] of this.disp) if (d.seen !== st.realNow) this.disp.delete(id);
  }

  private drawPlotsAndGrass(ctx: CanvasRenderingContext2D, st: RenderState, X: (x: number) => number, Y: (y: number) => number): void {
    const { world, camera: cam } = st;
    const z = cam.zoom;
    const t = this.t;
    for (const id in world.buildings) {
      const b = world.buildings[id];
      if (b.kind === 'park' || b.kind === 'farm' || b.kind === 'cemetery') {
        ctx.fillStyle = seasonGrass(t, world.weather.season, this.lastTheme === 'dark', b.kind === 'farm');
        ctx.fillRect(X(b.x), Y(b.y), b.w * z, b.h * z);
      }
      if (b.kind === 'house') {
        ctx.fillStyle = seasonGrass(t, world.weather.season, this.lastTheme === 'dark', false);
        ctx.globalAlpha = 0.55;
        ctx.fillRect(X(b.x), Y(b.y), b.w * z, b.h * z);
        ctx.globalAlpha = 1;
        if (b.householdId) {
          // The plot wears the household colour: a tint and a coloured border —
          // both a little faded while nobody is home.
          const home = this.occupied.has(b.id);
          const hc = plotColor(b.plot, this.lastTheme === 'dark');
          ctx.fillStyle = hc;
          ctx.globalAlpha = (this.lastTheme === 'dark' ? 0.16 : 0.13) * (home ? 1 : 0.5);
          ctx.fillRect(X(b.x), Y(b.y), b.w * z, b.h * z);
          ctx.globalAlpha = 1;
          if (!home) {
            ctx.fillStyle = this.lastTheme === 'dark' ? 'rgba(30,32,38,0.22)' : 'rgba(160,160,160,0.2)';
            ctx.fillRect(X(b.x), Y(b.y), b.w * z, b.h * z);
          }
          const hl = st.highlightHouseholdId === b.householdId;
          ctx.strokeStyle = hc;
          ctx.globalAlpha = home || hl ? 1 : 0.55;
          ctx.lineWidth = hl ? 3 : Math.max(1, Math.min(2, z * 0.35));
          ctx.strokeRect(X(b.x) + 0.5, Y(b.y) + 0.5, b.w * z, b.h * z);
          ctx.globalAlpha = 1;
        } else {
          ctx.strokeStyle = t.border;
          ctx.lineWidth = 1;
          ctx.strokeRect(X(b.x) + 0.5, Y(b.y) + 0.5, b.w * z, b.h * z);
        }
      }
    }
  }

  private drawRoads(ctx: CanvasRenderingContext2D, st: RenderState, X: (x: number) => number, Y: (y: number) => number): void {
    const { world, camera: cam } = st;
    const z = cam.zoom;
    const t = this.t;
    ctx.lineCap = 'butt';
    // Streets are 7 m, the highways wider; at region zoom the highways keep a
    // minimum width so the network reads as a network.
    for (const e of world.roads.edges) {
      const a = world.roads.nodes[e.a];
      const b = world.roads.nodes[e.b];
      ctx.strokeStyle = t.road;
      ctx.lineWidth = Math.max(e.width > 7 ? 3 : 2, e.width * z);
      ctx.beginPath();
      ctx.moveTo(X(a.x), Y(a.y));
      ctx.lineTo(X(b.x), Y(b.y));
      ctx.stroke();
    }
    if (z >= 1.2 || true) {
      ctx.strokeStyle = this.lastTheme === 'dark' ? 'rgba(241,236,223,0.25)' : 'rgba(255,255,255,0.7)';
      ctx.setLineDash([3 * z, 3 * z]);
      for (const e of world.roads.edges) {
        if (z < 1.2 && e.width <= 7) continue;
        const a = world.roads.nodes[e.a];
        const b = world.roads.nodes[e.b];
        ctx.lineWidth = Math.max(z < 1.2 ? 0.6 : 1, 0.35 * z);
        ctx.beginPath();
        ctx.moveTo(X(a.x), Y(a.y));
        ctx.lineTo(X(b.x), Y(b.y));
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    if (z >= 0.5 && st.showLabels) {
      // One label per road name, on that name's longest stretch; only the
      // highways at region zoom, the arterials at city zoom, every street inside.
      const best = new Map<string, { len: number; ax: number; ay: number; bx: number; by: number; width: number }>();
      for (const e of world.roads.edges) {
        const a = world.roads.nodes[e.a];
        const b = world.roads.nodes[e.b];
        const cur = best.get(e.name);
        if (!cur || e.length > cur.len) best.set(e.name, { len: e.length, ax: a.x, ay: a.y, bx: b.x, by: b.y, width: e.width });
      }
      this.defer(1, () => {
        ctx.font = `500 ${Math.max(10, Math.min(15, 2.6 * z))}px ${'SN Pro'}, sans-serif`;
        ctx.textBaseline = 'middle';
        for (const [name, e] of best) {
          const major = e.len >= 200;
          if (z < 1.1 && e.width <= 7) continue;
          if (z < 2.4 && !major) continue;
          const mx = (e.ax + e.bx) / 2;
          const my = (e.ay + e.by) / 2;
          if (Math.abs(e.bx - e.ax) >= Math.abs(e.by - e.ay)) {
            ctx.textAlign = 'center';
            this.halo(ctx, name, X(mx), Y(my) - 6 * z, t.muted);
          } else {
            ctx.save();
            ctx.translate(X(mx) - 6 * z, Y(my));
            ctx.rotate(-Math.PI / 2);
            ctx.textAlign = 'center';
            this.halo(ctx, name, 0, 0, t.muted);
            ctx.restore();
          }
        }
      });
    }
  }

  /** The Hyperline's guideway: a viaduct over everything it crosses, with its pylons showing from city zoom. */
  private drawTrack(ctx: CanvasRenderingContext2D, st: RenderState, X: (x: number) => number, Y: (y: number) => number): void {
    const z = st.camera.zoom;
    const dark = this.lastTheme === 'dark';
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    const trace = () => {
      ctx.beginPath();
      TRACK.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
    };
    if (z >= 1.2) {
      // pylons every 40 m
      ctx.fillStyle = dark ? 'rgba(200,210,225,0.7)' : 'rgba(60,72,92,0.7)';
      const s = Math.max(1.5, 2.6 * z);
      for (let i = 1; i < TRACK.length; i++) {
        const a = TRACK[i - 1];
        const b = TRACK[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        for (let d = 20; d < len; d += 40) {
          const u = d / len;
          ctx.fillRect(X(a.x + (b.x - a.x) * u) - s / 2, Y(a.y + (b.y - a.y) * u) - s / 2, s, s);
        }
      }
    }
    trace();
    ctx.strokeStyle = dark ? 'rgba(150,165,190,0.5)' : 'rgba(84,98,120,0.5)';
    ctx.lineWidth = Math.max(2.5, TRACK_WIDTH * z);
    ctx.stroke();
    trace();
    ctx.strokeStyle = dark ? '#C9D3E3' : '#2F4360';
    ctx.lineWidth = Math.max(0.9, 1.1 * z);
    ctx.stroke();
    ctx.restore();
  }

  private drawBuilding(ctx: CanvasRenderingContext2D, st: RenderState, b: Building, X: (x: number) => number, Y: (y: number) => number): void {
    const { camera: cam, world } = st;
    const z = cam.zoom;
    const t = this.t;
    const dark = this.lastTheme === 'dark';
    const footprint = houseFootprint(b);
    const isSel = (st.selection?.kind === 'building' && st.selection.id === b.id) || (st.selection?.kind === 'household' && world.households[st.selection.id]?.houseId === b.id);
    if (b.kind === 'runway') {
      // Asphalt, a dashed centreline, threshold bars and the designators.
      const x = X(b.x);
      const y = Y(b.y);
      const w = b.w * z;
      const h = b.h * z;
      ctx.fillStyle = dark ? '#474B53' : '#6E7278';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = isSel ? t.accent : dark ? '#7C838E' : '#4A4E55';
      ctx.lineWidth = isSel ? 2 : 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = Math.max(0.8, 0.9 * z);
      ctx.setLineDash([Math.max(3, 30 * z), Math.max(3, 20 * z)]);
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y + 60 * z);
      ctx.lineTo(x + w / 2, y + h - 60 * z);
      ctx.stroke();
      ctx.setLineDash([]);
      if (z >= 0.9) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        for (let i = 0; i < 6; i++) {
          const bx = x + (4 + i * 6.6) * z;
          ctx.fillRect(bx, y + 6 * z, 3 * z, 28 * z);
          ctx.fillRect(bx, y + h - 34 * z, 3 * z, 28 * z);
        }
        ctx.font = `700 ${Math.max(9, 14 * z)}px ${'SN Pro'}, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.save();
        ctx.translate(x + w / 2, y + 50 * z);
        ctx.rotate(Math.PI);
        ctx.fillText('18', 0, 0);
        ctx.restore();
        ctx.fillText('36', x + w / 2, y + h - 50 * z);
      }
      return; // nobody is ever "in" the runway, so it is never greyed
    }
    if (b.kind === 'park' || b.kind === 'cemetery' || b.kind === 'farm' || b.kind === 'busstop') {
      // outline only
      ctx.strokeStyle = isSel ? t.accent : t.border;
      ctx.lineWidth = isSel ? 2 : 1;
      ctx.strokeRect(X(b.x) + 0.5, Y(b.y) + 0.5, b.w * z, b.h * z);
      if (b.kind === 'busstop') {
        ctx.fillStyle = t.roofCivic;
        ctx.fillRect(X(b.x), Y(b.y), b.w * z, b.h * z);
      }
    } else if (b.kind === 'stadium') {
      // The bowl: an oval of stands around a green pitch.
      const cx = X(b.x + b.w / 2);
      const cy = Y(b.y + b.h / 2);
      ctx.fillStyle = t.roofCivic;
      ctx.beginPath();
      ctx.ellipse(cx, cy, (b.w / 2) * z, (b.h / 2) * z, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isSel ? t.accent : t.fg2;
      ctx.lineWidth = isSel ? 2 : Math.max(0.75, Math.min(1.5, z * 0.25));
      ctx.stroke();
      ctx.fillStyle = seasonGrass(t, world.weather.season, dark, false);
      ctx.beginPath();
      ctx.ellipse(cx, cy, (b.w / 2) * z * 0.62, (b.h / 2) * z * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const fx = X(footprint.x);
      const fy = Y(footprint.y);
      const fw = footprint.w * z;
      const fh = footprint.h * z;
      ctx.fillStyle = b.kind === 'house' ? t.roof : b.kind === 'church' ? t.roofChurch : t.roofCivic;
      ctx.fillRect(fx, fy, fw, fh);
      ctx.strokeStyle = isSel ? t.accent : t.fg2;
      ctx.lineWidth = isSel ? 2 : Math.max(0.75, Math.min(1.5, z * 0.25));
      ctx.strokeRect(fx + 0.5, fy + 0.5, fw, fh);
      // The hospital's cross
      if (b.kind === 'hospital') {
        ctx.strokeStyle = '#C62828';
        ctx.lineWidth = Math.max(1.5, Math.min(4, z * 0.6));
        const cx = X(b.x + 14);
        const cy = Y(b.y + 14);
        const arm = Math.min(4 * z, 18);
        ctx.beginPath();
        ctx.moveTo(cx - arm, cy);
        ctx.lineTo(cx + arm, cy);
        ctx.moveTo(cx, cy - arm);
        ctx.lineTo(cx, cy + arm);
        ctx.stroke();
      }
      // Church cross
      if (b.kind === 'church') {
        ctx.strokeStyle = t.fg2;
        ctx.lineWidth = Math.max(1, Math.min(3, z * 0.35));
        const cx = X(b.x + 40);
        const cy = Y(b.y + 10);
        const arm = Math.min(3 * z, 22);
        ctx.beginPath();
        ctx.moveTo(cx, cy - arm);
        ctx.lineTo(cx, cy + arm);
        ctx.moveTo(cx - arm * 0.6, cy - arm * 0.35);
        ctx.lineTo(cx + arm * 0.6, cy - arm * 0.35);
        ctx.stroke();
      }
      // Occupancy glow at night
      if (b.lit) {
        ctx.fillStyle = dark ? 'rgba(235, 180, 110, 0.18)' : 'rgba(255, 220, 140, 0.35)';
        ctx.fillRect(fx, fy, fw, fh);
      }
    }
    // Interiors
    if (z >= ROOMS_ZOOM && b.rooms.length && b.kind !== 'busstop') {
      for (const r of b.rooms) this.drawRoom(ctx, st, b, r, X, Y);
    }
    // The lake in the grand park and the pool at the sports centre read as
    // water; the apron and the station platforms as paving, at every zoom.
    for (const r of b.rooms) {
      if (r.kind === 'field' && r.name === 'Lake' || r.name === 'Pool') {
        ctx.fillStyle = dark ? 'rgba(90,140,200,0.35)' : 'rgba(120,170,220,0.55)';
        ctx.fillRect(X(r.x), Y(r.y), r.w * z, r.h * z);
      } else if (r.name === 'Apron') {
        ctx.fillStyle = dark ? 'rgba(120,126,136,0.45)' : 'rgba(150,156,166,0.5)';
        ctx.fillRect(X(r.x), Y(r.y), r.w * z, r.h * z);
        if (z >= 1.4) {
          ctx.strokeStyle = 'rgba(255,255,255,0.6)';
          ctx.lineWidth = Math.max(0.8, 0.5 * z);
          for (const s of r.spots) {
            ctx.beginPath();
            ctx.arc(X(s.x), Y(s.y), 16 * z, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      } else if (b.kind === 'station' && r.kind === 'stop') {
        ctx.fillStyle = dark ? 'rgba(200,210,225,0.35)' : 'rgba(60,72,92,0.3)';
        ctx.fillRect(X(r.x), Y(r.y), r.w * z, r.h * z);
      }
    }
    // Nobody inside: a slight grey wash over the whole of it, so an empty
    // house, a weekday church or a closed shop reads as such at a glance.
    if (!this.occupied.has(b.id)) {
      ctx.fillStyle = dark ? 'rgba(28,30,36,0.34)' : 'rgba(168,168,168,0.36)';
      if (b.kind === 'stadium') {
        ctx.beginPath();
        ctx.ellipse(X(b.x + b.w / 2), Y(b.y + b.h / 2), (b.w / 2) * z + 1, (b.h / 2) * z + 1, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const f = b.kind === 'house' ? footprint : { x: b.x, y: b.y, w: b.w, h: b.h };
        ctx.fillRect(X(f.x), Y(f.y), f.w * z, f.h * z);
      }
    }
    // Door / gate marks
    if (z >= 3) {
      ctx.fillStyle = t.fg2;
      const d = (b as Building & { door?: { x: number; y: number } }).door ?? b.entrance;
      ctx.fillRect(X(d.x) - 1.2 * z, Y(d.y) - 0.6 * z, 2.4 * z, 1.2 * z);
    }
    // Label
    if (st.showLabels && (z >= 1.1 || b.kind !== 'house')) {
      const fs = Math.max(10.5, Math.min(13.5, 2.2 * z));
      const font = `${b.kind === 'house' ? 500 : 600} ${fs}px ${'SN Pro'}, sans-serif`;
      const lx = X(b.x + b.w / 2);
      const insideTop = b.kind === 'park' || b.kind === 'farm' || b.kind === 'office' || b.kind === 'workshop' || b.kind === 'cemetery' || b.kind === 'busstop' || b.kind === 'bank' || b.w >= 100;
      // A house's label sits at the end of the plot away from its gate.
      const ly = b.kind === 'house' ? (b.entrance.y > b.y + b.h / 2 ? Y(b.y) + 3 : Y(b.y + b.h) - fs - 4) : insideTop ? Y(b.y) + 3 : Y(b.y + b.h) + 3;
      const label = b.kind === 'house' ? (z >= 2.5 ? b.name : `${b.plot}`) : b.name;
      if (b.kind === 'house' && z < 1.1) return;
      // At region zoom the city names carry the map; at city zoom the big landmarks are named; every building inside.
      if (z < 0.5) return;
      if (z < 0.72 && b.w < 100) return;
      this.defer(2, () => {
        ctx.font = font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        this.halo(ctx, label, lx, ly, t.fg2);
      });
    }
  }

  private drawRoom(ctx: CanvasRenderingContext2D, st: RenderState, b: Building, r: Room, X: (x: number) => number, Y: (y: number) => number): void {
    const z = st.camera.zoom;
    const t = this.t;
    const dark = this.lastTheme === 'dark';
    const rx = X(r.x);
    const ry = Y(r.y);
    const rw = r.w * z;
    const rh = r.h * z;
    if (r.kind !== 'yard' && r.kind !== 'field' && r.kind !== 'pitch' && r.kind !== 'graves' && r.kind !== 'pen') {
      ctx.fillStyle = dark ? 'rgba(241,236,223,0.05)' : 'rgba(255,255,255,0.35)';
      ctx.fillRect(rx, ry, rw, rh);
    }
    ctx.strokeStyle = dark ? 'rgba(241,236,223,0.25)' : 'rgba(24,23,21,0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
    // furniture
    if (z >= 6) {
      ctx.fillStyle = dark ? 'rgba(241,236,223,0.22)' : 'rgba(24,23,21,0.18)';
      ctx.strokeStyle = dark ? 'rgba(241,236,223,0.35)' : 'rgba(24,23,21,0.35)';
      // Shared tables (a family's dining table) and a lounge's coffee table, then each piece at its spot.
      const fur = furnitureOf(r);
      for (const t of fur.tables) ctx.strokeRect(X(t.x - t.w / 2), Y(t.y - t.d / 2), t.w * z, t.d * z);
      if (fur.coffee) {
        const c = fur.coffee;
        ctx.strokeRect(X(c.x - c.w / 2), Y(c.y - c.d / 2), c.w * z, c.d * z);
      }
      for (const s of r.spots) {
        const x = X(s.x);
        const y = Y(s.y);
        switch (s.kind) {
          case 'bed': {
            // A double bed with two pillows, a single with one (the head to the north).
            const w = bedWidth(s) + 0.5;
            const l = s.double ? 3.8 : 3.4;
            roundRect(ctx, x - (w / 2) * z, y - (l / 2) * z, w * z, l * z, 0.4 * z);
            ctx.fill();
            const pillows = s.double ? 2 : 1;
            const pw = (w - 0.5) / pillows - 0.15;
            for (let k = 0; k < pillows; k++) ctx.strokeRect(x + (-(w - 0.5) / 2 + 0.075 + k * (pw + 0.15)) * z, y - (l / 2 - 0.3) * z, pw * z, 0.6 * z);
            break;
          }
          case 'ward':
            roundRect(ctx, x - 1.1 * z, y - 1.9 * z, 2.2 * z, 3.8 * z, 0.4 * z);
            ctx.fill();
            break;
          case 'pew':
          case 'bench':
            ctx.fillRect(x - 2.2 * z, y - 0.5 * z, 4.4 * z, 1 * z);
            break;
          case 'seat':
          case 'cell':
            ctx.fillRect(x - 0.45 * z, y - 0.45 * z, 0.9 * z, 0.9 * z);
            break;
          case 'table':
            // A chair at a shared table is just the chair; a table on its own is drawn with it.
            if (fur.byId.has(s.id)) ctx.fillRect(x - 0.24 * z, y - 0.24 * z, 0.48 * z, 0.48 * z);
            else ctx.strokeRect(x - 1.2 * z, y - 0.8 * z, 2.4 * z, 1.6 * z);
            break;
          case 'desk':
          case 'counter':
          case 'stall':
            ctx.strokeRect(x - 1.2 * z, y - 0.8 * z, 2.4 * z, 1.6 * z);
            break;
          case 'stove':
            ctx.fillRect(x - 0.9 * z, y - 0.9 * z, 1.8 * z, 1.8 * z);
            break;
          case 'pulpit':
            ctx.beginPath();
            ctx.moveTo(x, y - 1.6 * z);
            ctx.lineTo(x + 1.4 * z, y + 1 * z);
            ctx.lineTo(x - 1.4 * z, y + 1 * z);
            ctx.closePath();
            ctx.fill();
            break;
          case 'goal':
            ctx.strokeRect(x - 2.5 * z, y - 0.6 * z, 5 * z, 1.2 * z);
            break;
          case 'bench-out':
            ctx.fillRect(x - 1.5 * z, y - 0.35 * z, 3 * z, 0.7 * z);
            break;
          default:
            break;
        }
      }
    }
    if (z >= 7 && st.showLabels) {
      this.defer(3, () => {
        ctx.font = `500 ${Math.max(9.5, Math.min(12, 1.1 * z))}px ${'SN Pro'}, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        this.halo(ctx, r.name, rx + 3, ry + 2, t.muted);
      });
    }
    void b;
  }

  /** At region zoom a faint boundary around each city, so three cities read as three. */
  private drawCityBounds(ctx: CanvasRenderingContext2D, st: RenderState, X: (x: number) => number, Y: (y: number) => number): void {
    const z = st.camera.zoom;
    const fit = fitWorld(st.w, st.h);
    if (z >= fit * 3) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, (fit * 3 - z) / (fit * 1.2))) * 0.7;
    ctx.strokeStyle = this.t.border;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 5]);
    for (const c of CITIES) if (c.kind !== 'centre') ctx.strokeRect(X(c.x) + 0.5, Y(c.y) + 0.5, c.w * z, c.h * z);
    ctx.setLineDash([]);
    ctx.restore();
  }

  /**
   * Names by level: at region zoom the three cities and the centre's zones,
   * at city zoom each settlement; each layer fades out as you drill past it.
   */
  private drawCommunityNames(ctx: CanvasRenderingContext2D, st: RenderState, X: (x: number) => number, Y: (y: number) => number): void {
    if (!st.showLabels) return;
    this.defer(0, () => this.placeNames(ctx, st, X, Y));
  }

  private placeNames(ctx: CanvasRenderingContext2D, st: RenderState, X: (x: number) => number, Y: (y: number) => number): void {
    const z = st.camera.zoom;
    const fit = fitWorld(st.w, st.h);
    ctx.save();
    ctx.textAlign = 'center';
    // Cities
    if (z < fit * 2.2) {
      const a = Math.min(1, Math.max(0, (fit * 2.2 - z) / (fit * 0.6)));
      ctx.globalAlpha = a < 0.3 ? 0 : a * 0.92;
      for (const c of CITIES) {
        if (c.kind === 'centre') continue;
        const airport = c.kind === 'airport';
        if (airport && z >= fit * 1.2) continue; // the airfield's own name takes over from city zoom
        const cx = X(c.x + c.w / 2);
        const cy = Y(c.y + c.h / 2);
        ctx.font = `700 ${Math.max(airport ? 11 : 13, (airport ? 22 : 34) * z / fit)}px ${'SN Pro'}, sans-serif`;
        ctx.textBaseline = 'alphabetic';
        this.halo(ctx, airport ? 'AIRPORT' : c.name.toUpperCase(), cx, cy - 4, this.t.fg2);
        ctx.font = `${Math.max(9, 13 * z / fit)}px ${'SN Pro'}, sans-serif`;
        ctx.textBaseline = 'top';
        this.halo(ctx, c.id === 'emmaus' ? 'the rich city' : c.id === 'newhaven' ? 'the secular city' : airport ? 'Unity Provincial' : 'the poor city', cx, cy + 2, this.t.muted);
      }
    }
    // Settlements and the centre's zones
    const lo = fit * 1.2;
    const hi = Math.max(fit * 5.5, 1.75);
    if (z >= lo && z < hi) {
      const a = Math.min(1, (z - lo) / (fit * 0.6), (hi - z) / (fit * 1.2));
      // Half-faded giant lettering reads as a smudge over the buildings' names: show it only while it is clearly there.
      ctx.globalAlpha = a < 0.3 ? 0 : a * 0.9;
      for (const c of COMMUNITIES) {
        const cx = X(c.x + c.w / 2);
        const cy = Y(c.y + c.h / 2);
        ctx.font = `600 ${Math.max(12, Math.min(26, 7.5 * z))}px ${'SN Pro'}, sans-serif`;
        ctx.textBaseline = 'alphabetic';
        this.halo(ctx, c.name.toUpperCase(), cx, cy - 2, this.t.fg2);
        ctx.font = `${Math.max(9, Math.min(13, 4 * z))}px ${'SN Pro'}, sans-serif`;
        ctx.textBaseline = 'top';
        this.halo(ctx, c.tier === 'civic' ? (c.city === 'unity' ? 'Unity Centre' : c.city === 'airport' ? 'terminal · tower · hangar · runway 18/36' : 'civic centre') : c.tier === 'middle' ? 'middle-class' : c.tier === 'working' ? 'working-class' : c.tier === 'ultra' ? 'the estates' : c.tier, cx, cy + 2, this.t.muted);
      }
    }
    ctx.restore();
  }

  private drawTrees(ctx: CanvasRenderingContext2D, st: RenderState, X: (x: number) => number, Y: (y: number) => number): void {
    const z = st.camera.zoom;
    if (!this.treeSeeds.length) this.treeSeeds = treeSeeds(st.world);
    ctx.fillStyle = seasonTree(this.t, st.world.weather.season, this.lastTheme === 'dark');
    for (const tr of this.treeSeeds) {
      ctx.beginPath();
      ctx.arc(X(tr.x), Y(tr.y), Math.max(1.5, tr.r * z), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawGraves(ctx: CanvasRenderingContext2D, st: RenderState, X: (x: number) => number, Y: (y: number) => number): void {
    const z = st.camera.zoom;
    if (z < 1.5) return;
    ctx.strokeStyle = this.t.fg2;
    ctx.lineWidth = Math.max(1, 0.35 * z);
    for (const g of st.world.graves) {
      const x = X(g.x);
      const y = Y(g.y);
      ctx.beginPath();
      ctx.moveTo(x, y - 1.6 * z);
      ctx.lineTo(x, y + 1.6 * z);
      ctx.moveTo(x - 1 * z, y - 0.6 * z);
      ctx.lineTo(x + 1 * z, y - 0.6 * z);
      ctx.stroke();
    }
  }

  /** Points along the guideway between two distances, for the streak. */
  private trackSlice(a: number, b: number): Array<{ x: number; y: number }> {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const pts: Array<{ x: number; y: number }> = [trackPoint(lo)];
    for (let i = 1; i < TRACK.length - 1; i++) if (TRACK_CUM[i] > lo && TRACK_CUM[i] < hi) pts.push(TRACK[i]);
    pts.push(trackPoint(hi));
    return a <= b ? pts : pts.reverse();
  }

  /** Where a train is drawn this frame: gliding toward its next platform, or standing at one. */
  private trainDisplay(v: Vehicle, dt: number): { t: number; heading: number; vel: number; from: number } {
    const dest = v.moving ? STATIONS[v.stopIdx + v.dir] ?? STATIONS[v.stopIdx] : null;
    const target = dest ? dest.t : v.trackPos;
    let d = this.trains.get(v.id);
    if (!d || Math.abs(target - d.t) > 3000) {
      d = { t: target, from: target, vel: 0 };
      this.trains.set(v.id, d);
    }
    const gap = target - d.t;
    if (Math.abs(gap) > 0.5) {
      const k = 1 - Math.exp(-dt / 0.24);
      const step = gap * k;
      d.t += step;
      d.vel = dt > 0 ? step / dt : 0;
      if (Math.abs(target - d.t) <= 0.5) {
        d.t = target;
        d.from = target;
        d.vel = 0;
      }
    } else {
      d.from = target;
      d.vel = 0;
    }
    const pt = trackPoint(d.t);
    const forward = gap !== 0 ? Math.sign(gap) : v.dir;
    return { t: d.t, heading: forward >= 0 ? pt.heading : pt.heading + Math.PI, vel: d.vel, from: d.from };
  }

  private drawVehicle(ctx: CanvasRenderingContext2D, st: RenderState, v: Vehicle, X: (x: number) => number, Y: (y: number) => number, dt: number): void {
    const z = st.camera.zoom;
    const t = this.t;
    const empty = v.occupantIds.length === 0;
    /** An empty vehicle's paint: the same colour, drained a little toward grey. */
    const paint = (c: string) => (empty ? greyed(c) : c);
    if (v.kind === 'train') {
      // The Hyperline: drawn where the glide has it, trailing a streak along the guideway while it moves.
      const disp = this.trainDisplay(v, dt);
      const pt = trackPoint(disp.t);
      const travelled = Math.abs(disp.t - disp.from);
      const speed = Math.abs(disp.vel); // metres per real second
      if (speed > 300 && travelled > 5) {
        // A bright streak along the guideway behind it: a soft light-blue halo
        // and a hot white core, both fading toward where it came from.
        const len = Math.min(travelled, Math.min(1400, speed * 0.45));
        const back = disp.t - Math.sign(disp.t - disp.from) * len;
        const pts = this.trackSlice(back, disp.t);
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const halo = ctx.createLinearGradient(X(pts[0].x), Y(pts[0].y), X(pt.x), Y(pt.y));
        halo.addColorStop(0, 'rgba(120,180,255,0)');
        halo.addColorStop(1, 'rgba(120,180,255,0.6)');
        ctx.strokeStyle = halo;
        ctx.lineWidth = Math.max(5, 7 * z);
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
        ctx.stroke();
        const core = this.trackSlice(disp.t - Math.sign(disp.t - disp.from) * len * 0.6, disp.t);
        const cg = ctx.createLinearGradient(X(core[0].x), Y(core[0].y), X(pt.x), Y(pt.y));
        cg.addColorStop(0, 'rgba(240,248,255,0)');
        cg.addColorStop(1, 'rgba(240,248,255,0.95)');
        ctx.strokeStyle = cg;
        ctx.lineWidth = Math.max(2, 2.2 * z);
        ctx.beginPath();
        core.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.translate(X(pt.x), Y(pt.y));
      ctx.rotate(disp.heading);
      if (empty) ctx.globalAlpha = 0.6;
      const TLn = Math.max(10, TRAIN_LENGTH * z);
      const TW = Math.max(3.5, 3.4 * z);
      ctx.fillStyle = paint(this.lastTheme === 'dark' ? '#D8DEE9' : '#EEF1F6');
      roundRect(ctx, -TLn / 2, -TW / 2, TLn, TW, TW / 2);
      ctx.fill();
      ctx.strokeStyle = paint('#2F4360');
      ctx.lineWidth = Math.max(1, 0.3 * z);
      ctx.stroke();
      ctx.fillStyle = paint('#2F6DB5');
      ctx.beginPath();
      ctx.moveTo(TLn / 2 - TLn * 0.16, -TW / 2 + 0.5);
      ctx.lineTo(TLn / 2 - TW / 2, -TW / 2 + 0.5);
      ctx.arc(TLn / 2 - TW / 2, 0, TW / 2 - 0.5, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(TLn / 2 - TLn * 0.16, TW / 2 - 0.5);
      ctx.closePath();
      ctx.fill();
      if (z >= 3) {
        ctx.fillStyle = 'rgba(47,67,96,0.55)';
        const n = 10;
        for (let i = 1; i < n; i++) ctx.fillRect(-TLn / 2 + (i / n) * TLn * 0.8 + TLn * 0.02, -TW * 0.25, TLn * 0.03, TW * 0.5);
      }
      if (speed > 300) {
        // the nose glows while it runs
        const gl = ctx.createRadialGradient(TLn / 2, 0, 0, TLn / 2, 0, TW * 3);
        gl.addColorStop(0, 'rgba(200,228,255,0.95)');
        gl.addColorStop(1, 'rgba(200,228,255,0)');
        ctx.fillStyle = gl;
        ctx.beginPath();
        ctx.arc(TLn / 2, 0, TW * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    const x = X(v.x);
    const y = Y(v.y);
    const L = Math.max(6, 4.2 * z);
    const W = Math.max(3, 2 * z);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(v.heading);
    // Nobody aboard: faded and drained a little, like an empty house.
    if (empty) ctx.globalAlpha = 0.6;
    const taxi = v.kind === 'taxi';
    if (v.kind === 'plane') {
      if (v.airborne) {
        ctx.restore();
        return;
      }
      // Fuselage, swept wings, a blue tail.
      const S = Math.max(9, 30 * z);
      ctx.fillStyle = paint('#E4E8EE');
      ctx.strokeStyle = paint('#2F4360');
      ctx.lineWidth = Math.max(0.6, 0.25 * z);
      ctx.beginPath();
      ctx.moveTo(-S * 0.02, -S * 0.05);
      ctx.lineTo(-S * 0.24, -S * 0.48);
      ctx.lineTo(-S * 0.36, -S * 0.48);
      ctx.lineTo(-S * 0.2, S * 0);
      ctx.lineTo(-S * 0.36, S * 0.48);
      ctx.lineTo(-S * 0.24, S * 0.48);
      ctx.lineTo(-S * 0.02, S * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = paint('#F6F7F9');
      roundRect(ctx, -S / 2, -S * 0.065, S, S * 0.13, S * 0.065);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = paint('#2F6DB5');
      ctx.beginPath();
      ctx.moveTo(-S * 0.5, -S * 0.02);
      ctx.lineTo(-S * 0.42, -S * 0.2);
      ctx.lineTo(-S * 0.36, -S * 0.2);
      ctx.lineTo(-S * 0.38, -S * 0.02);
      ctx.lineTo(-S * 0.38, S * 0.02);
      ctx.lineTo(-S * 0.36, S * 0.2);
      ctx.lineTo(-S * 0.42, S * 0.2);
      ctx.lineTo(-S * 0.5, S * 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }
    const bus = v.kind === 'bus';
    const TL = bus ? Math.max(9, 12 * z) : taxi ? L * 1.3 : L;
    const BW = bus ? Math.max(3.5, 2.6 * z) : W;
    ctx.fillStyle = paint(v.kind === 'police' ? '#2E4C8F' : v.kind === 'ambulance' ? '#F4F1EA' : v.kind === 'bakkie' ? '#8C7A5B' : bus ? '#2F6DB5' : taxi ? '#E9C24C' : v.kind === 'ride' ? '#2E8B7A' : t.fg2);
    roundRect(ctx, -TL / 2, -BW / 2, TL, BW, Math.min(3, 0.6 * z));
    ctx.fill();
    ctx.strokeStyle = t.fg;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    if (bus) {
      // A pale roof band, and the windows from house zoom
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(-TL / 2 + 1, -BW * 0.16, TL - 2, BW * 0.32);
      if (z >= 3) {
        ctx.fillStyle = 'rgba(30,40,60,0.6)';
        for (let i = 0; i < 5; i++) ctx.fillRect(-TL / 2 + 2 + i * ((TL - 4) / 5), -BW / 2 + 1, (TL - 4) / 5 - 1.5, BW * 0.24);
      }
    }
    if (v.kind === 'ambulance' && v.moving) {
      ctx.fillStyle = Math.floor(st.realNow / 220) % 2 === 0 ? '#FF4D4D' : '#3D7BFF';
      ctx.beginPath();
      ctx.arc(-TL * 0.3, 0, Math.max(1.5, 0.6 * z), 0, Math.PI * 2);
      ctx.fill();
    }
    if (taxi) {
      // The minibus stripe
      ctx.strokeStyle = '#2B2B2B';
      ctx.lineWidth = Math.max(0.8, 0.3 * z);
      ctx.beginPath();
      ctx.moveTo(-TL / 2 + 1, 0);
      ctx.lineTo(TL / 2 - 1, 0);
      ctx.stroke();
    }
    if (v.kind === 'ride') {
      // The app's roof sign: lit while the driver-partner is online, amber when the trip is surge-priced.
      ctx.fillStyle = !v.online ? 'rgba(120,120,120,0.7)' : (v.surge ?? 1) > 1.05 && v.stage !== null ? '#F2A33A' : '#9BF0D2';
      ctx.fillRect(-TL * 0.12, -BW * 0.3, TL * 0.24, BW * 0.6);
    }
    if (v.kind === 'police' && v.moving) {
      ctx.fillStyle = Math.floor(st.realNow / 250) % 2 === 0 ? '#3D7BFF' : '#FF4D4D';
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(1.5, 0.6 * z), 0, Math.PI * 2);
      ctx.fill();
    }
    if (v.kind === 'ambulance') {
      ctx.strokeStyle = '#C62828';
      ctx.lineWidth = Math.max(1, 0.4 * z);
      ctx.beginPath();
      ctx.moveTo(-0.7 * z, 0);
      ctx.lineTo(0.7 * z, 0);
      ctx.moveTo(0, -0.7 * z);
      ctx.lineTo(0, 0.7 * z);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawIntruder(ctx: CanvasRenderingContext2D, st: RenderState, it: Intruder, X: (x: number) => number, Y: (y: number) => number): void {
    const z = st.camera.zoom;
    const t = this.t;
    const x = X(it.x);
    const y = Y(it.y);
    const r = Math.max(4, 1.6 * z);
    ctx.save();
    ctx.translate(x, y);
    const flick = Math.sin(st.realNow / 90);
    switch (it.kind) {
      case 'wildfire': {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + st.realNow / 400;
          const rr = r * (1.6 + 0.4 * Math.sin(st.realNow / 130 + i));
          ctx.fillStyle = i % 2 ? '#F28C28' : '#D64541';
          ctx.globalAlpha = 0.75;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * rr * 0.6, Math.sin(a) * rr * 0.6, rr * 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'snake':
        ctx.strokeStyle = '#6B8E23';
        ctx.lineWidth = Math.max(1.5, 0.5 * z);
        ctx.beginPath();
        for (let i = -3; i <= 3; i++) ctx.lineTo(i * r * 0.5, Math.sin(i + st.realNow / 300) * r * 0.5);
        ctx.stroke();
        break;
      case 'stray-dog':
        ctx.fillStyle = '#8B6B3E';
        roundRect(ctx, -r, -r * 0.55, r * 2, r * 1.1, r * 0.4);
        ctx.fill();
        ctx.fillRect(r * 0.6, -r * 0.9, r * 0.5, r * 0.6);
        break;
      case 'stranger':
        ctx.strokeStyle = t.muted;
        ctx.setLineDash([2, 2]);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      default: {
        // human intruders: dark square with a stripe
        ctx.fillStyle = it.state === 'caught' ? t.muted : '#2B2B2B';
        ctx.fillRect(-r * 0.9, -r * 0.9, r * 1.8, r * 1.8);
        ctx.strokeStyle = it.kind === 'troublemaker' ? '#D64541' : '#F2C14E';
        ctx.lineWidth = Math.max(1, 0.35 * z);
        ctx.beginPath();
        ctx.moveTo(-r * 0.9, -r * 0.2);
        ctx.lineTo(r * 0.9, -r * 0.2);
        ctx.stroke();
      }
    }
    if (it.state === 'acting' && it.kind !== 'stranger') {
      ctx.strokeStyle = '#D64541';
      ctx.globalAlpha = 0.35 + 0.35 * flick;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, r * 2.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (z >= 4 && st.showLabels) {
      this.defer(4, () => {
        ctx.font = `600 ${Math.max(10, 1.4 * z)}px ${'SN Pro'}, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        this.halo(ctx, it.name, x, y - r - 3, t.error);
      });
    }
  }

  private drawIncidents(ctx: CanvasRenderingContext2D, st: RenderState, X: (x: number) => number, Y: (y: number) => number): void {
    const { world } = st;
    const z = st.camera.zoom;
    const recent = world.minute - 90;
    for (const id in world.incidents) {
      const inc = world.incidents[id];
      if (inc.minute < recent && inc.status !== 'active' && inc.status !== 'responding') continue;
      const age = (world.minute - inc.minute) / 90;
      const pulse = (st.realNow / 900) % 1;
      ctx.strokeStyle = inc.kind === 'stranger' ? this.t.link : this.t.error;
      ctx.globalAlpha = Math.max(0, 1 - pulse) * (1 - Math.min(1, age)) * 0.9;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(inc.x), Y(inc.y), (4 + pulse * 10) * Math.max(0.6, z / 3), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawConversationLinks(ctx: CanvasRenderingContext2D, st: RenderState, pos: Map<string, { x: number; y: number }>, X: (x: number) => number, Y: (y: number) => number): void {
    const { world } = st;
    const z = st.camera.zoom;
    if (z < 3) return;
    for (const id in world.conversations) {
      const c = world.conversations[id];
      if (c.participantIds.length < 2) continue;
      const live = c.participantIds.every((pid) => world.people[pid]?.conversationId === id);
      if (!live) continue;
      const [a, b] = c.participantIds.map((pid) => pos.get(pid));
      if (!a || !b) continue;
      ctx.strokeStyle = c.tone === 'tense' ? this.t.error : this.t.muted;
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(X(a.x), Y(a.y));
      ctx.lineTo(X(b.x), Y(b.y));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawPerson(ctx: CanvasRenderingContext2D, st: RenderState, p: Person, pos: { x: number; y: number }, X: (x: number) => number, Y: (y: number) => number): void {
    const z = st.camera.zoom;
    const t = this.t;
    const x = X(pos.x);
    const y = Y(pos.y);
    const ageScale = p.age < 1 ? 0.4 : p.age < 5 ? 0.5 : p.age < 13 ? 0.65 : p.age < 18 ? 0.85 : 1;
    const r = Math.max(3.1, Math.min(15, 1.35 * z)) * ageScale;
    const isSel = st.selection?.kind === 'person' && st.selection.id === p.id;
    const isHover = st.hoverId === p.id;
    const hh = st.world.households[p.householdId];
    const house = hh ? st.world.buildings[hh.houseId] : null;
    const hcol = plotColor(house?.plot ?? null, this.lastTheme === 'dark');
    ctx.save();
    ctx.translate(x, y);
    // household halo (everyone in the highlighted household, wherever they are)
    if (st.highlightHouseholdId && p.householdId === st.highlightHouseholdId && !p.inVehicleId) {
      ctx.strokeStyle = hcol;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.9 + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // selection halo
    if (isSel || isHover || st.followId === p.id) {
      ctx.strokeStyle = isSel ? t.accent : t.fg2;
      ctx.lineWidth = isSel ? 2 : 1;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.9 + 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    // in a vehicle: draw nothing more (they are inside)
    if (p.inVehicleId) {
      ctx.restore();
      return;
    }
    // health ring
    const hs = p.health.state;
    if (hs !== 'healthy' || p.grief) {
      ctx.strokeStyle = hs === 'critical' ? t.error : hs === 'healthy' ? t.muted : hs === 'recovering' ? t.warn : t.error;
      ctx.lineWidth = hs === 'critical' ? 2.5 : 1.5;
      if (p.grief && hs === 'healthy') ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.45 + 1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // body
    tracePath(ctx, p.shape, r);
    ctx.fillStyle = p.sex === 'M' ? t.male : t.female;
    ctx.fill();
    ctx.strokeStyle = t.fg;
    ctx.lineWidth = Math.max(0.6, Math.min(1.4, r * 0.12));
    ctx.stroke();
    // pregnancy dot
    if (p.pregnancy && st.world.day - p.pregnancy.conceivedDay > 90 && z >= 5) {
      ctx.fillStyle = t.bg;
      ctx.beginPath();
      ctx.arc(0, r * 0.25, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
    // education ticks (top arc)
    if (z >= 6 && p.age >= 6) {
      const n = eduRank(p.education);
      ctx.strokeStyle = t.fg;
      ctx.lineWidth = 1;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.32;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * (r * 1.5 + 1), Math.sin(a) * (r * 1.5 + 1));
        ctx.lineTo(Math.cos(a) * (r * 1.5 + 4), Math.sin(a) * (r * 1.5 + 4));
        ctx.stroke();
      }
    }
    // profession code
    if (z >= 9 && p.age >= 18) {
      const code = JOB_CODE[p.job];
      if (code) {
        ctx.fillStyle = t.bg;
        ctx.font = `600 ${Math.max(7, r * 0.75)}px ${'SN Pro'}, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(code, 0, p.shape === 'triangle' ? r * 0.25 : 0);
      }
    }
    // mood dot (top-right)
    if (z >= 5) {
      ctx.fillStyle = p.mood > 0.35 ? t.accent : p.mood < -0.35 ? t.error : p.mood < -0.1 ? t.warn : t.muted;
      ctx.beginPath();
      ctx.arc(r * 1.05, -r * 1.05, Math.max(1.5, r * 0.26), 0, Math.PI * 2);
      ctx.fill();
    }
    // household badge (bottom-right): the plot colour, so kin can be told apart anywhere
    if (z >= 2.2 && house) {
      const br = Math.max(1.8, r * 0.36);
      ctx.fillStyle = hcol;
      ctx.beginPath();
      ctx.arc(r * 1.0, r * 1.0, br, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = t.bg;
      ctx.lineWidth = Math.max(0.8, br * 0.3);
      ctx.stroke();
    }
    // alert
    if (p.alertTimer > 0) {
      this.defer(4, () => {
        ctx.font = `700 ${Math.max(10, r * 1.2)}px ${'SN Pro'}, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        this.halo(ctx, '!', x, y - r * 1.6, t.error);
      });
    }
    ctx.restore();
  }

  /** Over the 3D view: names under the feet, speech and notes over the heads. */
  private drawOverlay(ctx: CanvasRenderingContext2D, st: RenderState, over: NonNullable<RenderState['overlay']>): void {
    // The scene behind can be any colour, so the ink is a fixed pair (never a blend
    // caught mid-way between day and night) and the plates are firmer than on the map.
    const saved = this.t;
    const dark = this.lastTheme === 'dark';
    this.t = { ...saved, ...(dark ? OVERLAY_INK_DARK : OVERLAY_INK_LIGHT) };
    this.plateAlpha = dark ? 0.84 : 0.88;
    try {
      this.drawOverlayInk(ctx, st, over);
    } finally {
      this.t = saved;
      this.plateAlpha = 0;
    }
  }

  private drawOverlayInk(ctx: CanvasRenderingContext2D, st: RenderState, over: NonNullable<RenderState['overlay']>): void {
    const { world, w, h } = st;
    ctx.save();
    ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const I = (v: number) => v;
    const people = alivePeople(world).filter((p) => !p.away && over.has(p.id));
    const feet = new Map<string, { x: number; y: number }>();
    const heads = new Map<string, { x: number; y: number }>();
    for (const p of people) {
      const o = over.get(p.id)!;
      feet.set(p.id, o.feet);
      heads.set(p.id, o.head);
    }
    people.sort((a, b) => feet.get(a.id)!.y - feet.get(b.id)!.y);
    this.singers.clear();
    for (const id in world.conversations) {
      const c = world.conversations[id];
      if (!c.hymn || c.hymn.lineIdx < 0) continue;
      if (!c.participantIds.every((pid) => world.people[pid]?.conversationId === id)) continue;
      for (const sid of c.hymn.singerIds) this.singers.add(sid);
    }
    this.placed = [];
    const notes = this.singingNotes(ctx, st, heads, I, I);
    for (const n of notes) this.placed.push(n.box);
    this.drawBubbles(ctx, st, heads, I, I);
    this.placed.splice(0, notes.length);
    // Names only where a person is drawn large enough to be read about, or matters now (selected, hovered,
    // followed, talking); just the name unless selected, so a full church is not a wall of labels.
    const named = people.filter((p) => {
      const o = over.get(p.id)!;
      return o.feet.y - o.head.y >= 80 || p.id === st.hoverId || p.id === st.followId || (st.selection?.kind === 'person' && st.selection.id === p.id) || !!p.conversationId;
    });
    this.drawLabels(ctx, { ...st, camera: { ...st.camera, zoom: Math.min(st.camera.zoom, 11) } }, named, feet, I, I);
    // Building names, where there is room: the people's names and speech come first.
    if (st.showLabels && st.overlayBuildings) {
      const dark = this.lastTheme === 'dark';
      for (const bl of st.overlayBuildings) {
        const b = world.buildings[bl.id];
        if (!b) continue;
        const label = b.name;
        const fs = b.kind === 'house' ? 11 : 12.5;
        ctx.font = `${b.kind === 'house' ? 500 : 600} ${fs}px 'SN Pro', sans-serif`;
        const tw = ctx.measureText(label).width + 12;
        const box = { x: bl.x - tw / 2, y: bl.y - fs - 8, w: tw, h: fs + 8 };
        if (box.x < 4 || box.x + box.w > w - 4 || box.y < 50 || box.y + box.h > h - 70) continue;
        if (this.placed.some((q) => intersects(q, box))) continue;
        this.placed.push(box);
        ctx.fillStyle = dark ? 'rgba(27,24,21,0.84)' : 'rgba(250,247,240,0.9)';
        roundRect(ctx, box.x, box.y, box.w, box.h, 6);
        ctx.fill();
        ctx.fillStyle = this.t.fg2;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, bl.x, box.y + box.h / 2 + 0.5);
      }
    }
    for (const n of notes) {
      ctx.font = n.font;
      ctx.lineWidth = n.lineWidth;
      ctx.strokeStyle = this.t.bg;
      ctx.strokeText('♪', n.x, n.y);
      ctx.fillStyle = this.t.accent;
      ctx.fillText('♪', n.x, n.y);
    }
    ctx.restore();
    void h;
  }

  /** Name labels, placed below the shape and pushed down / dropped when they would collide. */
  private drawLabels(ctx: CanvasRenderingContext2D, st: RenderState, people: Person[], pos: Map<string, { x: number; y: number }>, X: (x: number) => number, Y: (y: number) => number): void {
    const z = st.camera.zoom;
    const t = this.t;
    if (!st.showLabels) return;
    const fs = Math.max(9, Math.min(12, 1.2 * z));
    const fs2 = Math.max(8.5, Math.min(10.5, 1 * z));
    for (const p of people) {
      const isSel = st.selection?.kind === 'person' && st.selection.id === p.id;
      const isHover = st.hoverId === p.id;
      if (!(z >= 7 || isSel || isHover)) continue;
      if (p.inVehicleId) continue;
      const d = pos.get(p.id)!;
      const x = X(d.x);
      const y = Y(d.y);
      const ageScale = p.age < 1 ? 0.4 : p.age < 5 ? 0.5 : p.age < 13 ? 0.65 : p.age < 18 ? 0.85 : 1;
      const r = Math.max(3.1, Math.min(15, 1.35 * z)) * ageScale;
      const detailed = z >= 12 || isSel;
      const name = detailed ? `${p.firstName} ${p.surname}` : p.firstName;
      const a = p.plan[p.planIdx];
      const hh = st.world.households[p.householdId];
      const house = hh ? st.world.buildings[hh.houseId] : null;
      const sub = detailed ? `${p.age} · ${JOBS[p.job]?.label ?? p.job}${house?.plot ? ` · plot ${house.plot}` : ''}${a ? ` · ${a.label}` : ''}` : '';
      ctx.font = `${isSel ? 600 : 400} ${fs}px 'SN Pro', sans-serif`;
      const w1 = ctx.measureText(name).width;
      ctx.font = `${fs2}px 'SN Pro', sans-serif`;
      const w2 = sub ? ctx.measureText(sub).width : 0;
      const bw = Math.max(w1, w2) + 6;
      const bh = fs + (sub ? fs2 + 1 : 0) + 4;
      let by = y + r * 1.6 + 2;
      const bx = x - bw / 2;
      let ok = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        const box = { x: bx, y: by, w: bw, h: bh };
        if (!this.placed.some((q) => intersects(q, box))) {
          ok = true;
          break;
        }
        by += bh + 2;
      }
      if (!ok && !(isSel || isHover || p.conversationId)) continue;
      this.placed.push({ x: bx, y: by, w: bw, h: bh });
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      // soft plate so labels stay legible over furniture and other shapes
      ctx.fillStyle = this.lastTheme === 'dark' ? `rgba(27,24,21,${this.plateAlpha || 0.55})` : `rgba(232,228,216,${this.plateAlpha || 0.7})`;
      roundRect(ctx, bx, by - 1, bw, bh, 3);
      ctx.fill();
      ctx.fillStyle = t.fg;
      ctx.font = `${isSel ? 600 : 400} ${fs}px 'SN Pro', sans-serif`;
      ctx.fillText(name, x, by + 1);
      if (sub) {
        ctx.fillStyle = t.muted;
        ctx.font = `${fs2}px 'SN Pro', sans-serif`;
        ctx.fillText(sub, x, by + 1 + fs + 1);
      }
    }
  }

  /**
   * Where a note goes over each voice in a hymn, with the box its own ink needs
   * — tight, so a crowded nave still finds room around it. Sets the canvas up
   * for drawing them; the caller paints them once the overlays are placed.
   */
  private singingNotes(ctx: CanvasRenderingContext2D, st: RenderState, pos: Map<string, { x: number; y: number }>, X: (x: number) => number, Y: (y: number) => number): NoteMark[] {
    const marks: NoteMark[] = [];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round';
    if (!this.singers.size) return marks;
    const z = st.camera.zoom;
    for (const id of this.singers) {
      const p = st.world.people[id];
      const d = pos.get(id);
      if (!p || !d) continue;
      const ageScale = p.age < 1 ? 0.4 : p.age < 5 ? 0.5 : p.age < 13 ? 0.65 : p.age < 18 ? 0.85 : 1;
      const r = Math.max(3.1, Math.min(15, 1.35 * z)) * ageScale;
      const x = X(d.x);
      const y = Y(d.y) - (r * 1.5 + 5);
      if (x < -20 || x > st.w + 20 || y < -20 || y > st.h + 20) continue;
      const fs = Math.max(10, r * 1.5);
      const font = `700 ${fs}px 'SN Pro', sans-serif`;
      ctx.font = font;
      const m = ctx.measureText('♪');
      const top = y - (m.actualBoundingBoxAscent || fs * 0.72);
      const nw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight || m.width;
      marks.push({ x, y, font, lineWidth: Math.max(2.5, r * 0.45), box: { x: x - nw / 2 - 1, y: top - 1, w: nw + 2, h: y - top + 2 } });
    }
    return marks;
  }

  private drawBubbles(ctx: CanvasRenderingContext2D, st: RenderState, pos: Map<string, { x: number; y: number }>, X: (x: number) => number, Y: (y: number) => number): void {
    const { world, w, h } = st;
    const z = st.camera.zoom;
    const t = this.t;
    const dark = this.lastTheme === 'dark';
    const fs = Math.max(10, Math.min(13, 1.1 * z));
    ctx.font = `${fs}px 'SN Pro', sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const pad = 6;
    const maxW = 240;
    // One live line per conversation: people speak in turns. A hymn is the
    // exception — the room sings in unison, so the line goes over every voice.
    // A small bubble is an echo: a singer carrying the opening words of the line.
    const smallFs = Math.max(9, fs - 2);
    const smallPad = 4;
    const items: Array<{ x: number; y: number; lines: string[]; bw: number; bh: number; tense: boolean; sung: boolean; small: boolean }> = [];
    const push = (speakerId: string, text: string, tense: boolean, sung: boolean, small = false) => {
      const p = pos.get(speakerId);
      if (!p) return;
      const sx = X(p.x);
      const sy = Y(p.y);
      if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) return; // speaker off-screen
      const f = small ? smallFs : fs;
      const pd = small ? smallPad : pad;
      ctx.font = `${f}px 'SN Pro', sans-serif`;
      const clipped = text.length > 110 ? text.slice(0, 108) + '…' : text;
      const lines = wrap(ctx, clipped, small ? 160 : maxW);
      const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pd * 2;
      const bh = lines.length * (f + 3) + pd * 2;
      items.push({ x: sx, y: sy, lines, bw, bh, tense, sung, small });
    };
    for (const id in world.conversations) {
      const c = world.conversations[id];
      const live = c.participantIds.every((pid) => world.people[pid]?.conversationId === id);
      if (!live) continue;
      const hymn = c.hymn;
      if (hymn && hymn.lineIdx >= 0 && world.minute - hymn.lineMinute <= 2.5) {
        // The whole room sings: the pastor and a rotating handful carry the
        // whole line, and every other voice echoes its opening words in a
        // small bubble of its own, so a full church reads as a full church
        // singing. Where it is too crowded a bubble yields; the ♪ stays.
        const line = hymn.verse[hymn.lineIdx];
        const sung = `♪ ${line}`;
        const echo = `♪ ${opening(line)}`;
        const voices = hymn.singerIds;
        const leads = new Set<string>([voices[0]]);
        const rest = voices.length - 1;
        const n = Math.min(HYMN_VOICES - 1, rest);
        const stride = Math.max(1, Math.floor(rest / Math.max(1, n)));
        for (let i = 0; i < n; i++) leads.add(voices[1 + ((hymn.lineIdx + i * stride) % rest)]);
        for (const sid of voices) push(sid, leads.has(sid) ? sung : echo, false, true, !leads.has(sid));
        continue;
      }
      if (!c.lines.length) continue;
      const line = c.lines[c.lines.length - 1];
      if (line.chorus) continue; // the verse just ended; it was never his line alone
      if (world.minute - line.minute > 2.5 && c.llm !== 'streaming') continue;
      push(line.speakerId, line.text, c.tone === 'tense', false);
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) {
      // Candidate anchors: above-right, above-left, then stacked higher, then below.
      const cands: Array<[number, number]> = [
        [it.x + 10, it.y - 18 - it.bh],
        [it.x - 10 - it.bw, it.y - 18 - it.bh],
        [it.x + 10, it.y - 18 - it.bh * 2 - 6],
        [it.x - 10 - it.bw, it.y - 18 - it.bh * 2 - 6],
        [it.x + 10, it.y + 16],
        [it.x - 10 - it.bw, it.y + 16],
        [it.x + 10, it.y - 18 - it.bh * 3 - 12],
      ];
      let box: { x: number; y: number; w: number; h: number } | null = null;
      for (const [cx, cy] of cands) {
        const bx = Math.min(w - it.bw - 4, Math.max(4, cx));
        const by = Math.min(h - it.bh - 4, Math.max(4, cy));
        const cand = { x: bx, y: by, w: it.bw, h: it.bh };
        if (!this.placed.some((q) => intersects(q, cand))) {
          box = cand;
          break;
        }
      }
      if (!box) continue; // too crowded: the transcript panel still has the line
      this.placed.push(box);
      const { x: bx, y: by } = box;
      ctx.fillStyle = dark ? 'rgba(34,30,26,0.94)' : 'rgba(255,253,247,0.96)';
      ctx.strokeStyle = it.tense ? t.error : it.sung ? t.accent : t.border;
      ctx.lineWidth = 1;
      roundRect(ctx, bx, by, it.bw, it.bh, 8);
      ctx.fill();
      ctx.stroke();
      // tail toward the speaker, from the nearest edge
      const ax = Math.min(bx + it.bw - 12, Math.max(bx + 12, it.x));
      const tailY = by + it.bh < it.y ? by + it.bh : by;
      const tipY = by + it.bh < it.y ? it.y - 6 : it.y + 6;
      ctx.beginPath();
      ctx.moveTo(ax - 5, tailY);
      ctx.lineTo(it.x + (it.x < ax ? 2 : -2), tipY);
      ctx.lineTo(ax + 5, tailY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = it.small ? t.fg2 : t.fg;
      const f = it.small ? smallFs : fs;
      const pd = it.small ? smallPad : pad;
      ctx.font = `${f}px 'SN Pro', sans-serif`;
      it.lines.forEach((l, i) => ctx.fillText(l, bx + pd, by + pd + (f + 3) * i + f / 2));
    }
  }

  private drawWeatherAndNight(ctx: CanvasRenderingContext2D, st: RenderState, X: (x: number) => number, Y: (y: number) => number): void {
    const { world, w, h } = st;
    const dark = nightDarkness(st.latitude, st.dayOfYear, world.minuteOfDay);
    const cond = world.weather.condition;
    const overcast = cond === 'rain' || cond === 'storm' || cond === 'cloudy' || cond === 'fog' || cond === 'snow';
    if (overcast) {
      ctx.fillStyle = this.lastTheme === 'dark' ? 'rgba(20,24,30,0.22)' : 'rgba(90,100,120,0.16)';
      ctx.fillRect(0, 0, w, h);
    }
    if (dark > 0) {
      // Window light before the dark wash so lit buildings glow through
      const lit = new Set<string>();
      for (const p of alivePeople(world)) if (p.loc.buildingId && !p.away) lit.add(p.loc.buildingId);
      ctx.fillStyle = this.lastTheme === 'dark' ? 'rgba(10,12,28,' + (0.62 * dark).toFixed(3) + ')' : 'rgba(18,22,48,' + (0.55 * dark).toFixed(3) + ')';
      ctx.fillRect(0, 0, w, h);
      const z = st.camera.zoom;
      for (const id of lit) {
        const b = world.buildings[id];
        if (!b || b.kind === 'park' || b.kind === 'cemetery' || b.kind === 'busstop') continue;
        const f = houseFootprint(b);
        const g = ctx.createRadialGradient(X(f.x + f.w / 2), Y(f.y + f.h / 2), 2, X(f.x + f.w / 2), Y(f.y + f.h / 2), Math.max(f.w, f.h) * z * 0.9);
        g.addColorStop(0, `rgba(255, 214, 140, ${(0.42 * dark).toFixed(3)})`);
        g.addColorStop(1, 'rgba(255, 214, 140, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(X(f.x) - f.w * z * 0.5, Y(f.y) - f.h * z * 0.5, f.w * z * 2, f.h * z * 2);
      }
      // street lamps at intersections
      for (const n of [[80, 240], [320, 240], [560, 240], [320, 120], [320, 360]]) {
        const g = ctx.createRadialGradient(X(n[0]), Y(n[1]), 1, X(n[0]), Y(n[1]), 22 * z);
        g.addColorStop(0, `rgba(255, 230, 170, ${(0.28 * dark).toFixed(3)})`);
        g.addColorStop(1, 'rgba(255, 230, 170, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(X(n[0]) - 22 * z, Y(n[1]) - 22 * z, 44 * z, 44 * z);
      }
    }
  }

  /**
   * Rain or snow streaks in screen space, and the storm's flash. Once the rooms
   * are drawn (house zoom) none falls over a room with walls: it is under its
   * roof, though the plan leaves the roof off to show inside.
   */
  private drawPrecipitation(ctx: CanvasRenderingContext2D, st: RenderState): void {
    const { world, w, h } = st;
    const cond = world.weather.condition;
    const dark = nightDarkness(st.latitude, st.dayOfYear, world.minuteOfDay);
    if (cond === 'rain' || cond === 'storm' || cond === 'snow') {
      const n = cond === 'storm' ? 220 : 120;
      const tt = st.realNow / (cond === 'snow' ? 2200 : 500);
      // The streaks must contrast with what is actually under them: the ground is
      // dark in the dark theme and, in either theme, under the night wash.
      const groundDark = this.lastTheme === 'dark' || dark > 0.45;
      ctx.strokeStyle = cond === 'snow' ? (groundDark ? 'rgba(255,255,255,0.75)' : 'rgba(118,134,166,0.9)') : groundDark ? 'rgba(190,205,230,0.5)' : 'rgba(46,66,104,0.5)';
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = groundDark ? 1 : 1.25;
      const cam = st.camera;
      const indoors = cam.zoom >= ROOMS_ZOOM ? indoorsOf(world) : null;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const px = ((i * 97.13 + tt * 40) % 1) * w;
        const py = ((i * 57.31 + tt) % 1) * h;
        // (where the streak is on the map: its middle)
        if (indoors?.inside(cam.x + (px - 1.25 - w / 2) / cam.zoom, cam.y + (py + 5.5 - h / 2) / cam.zoom)) continue;
        if (cond === 'snow') {
          ctx.moveTo(px + 1.7, py);
          ctx.arc(px, py, 1.7, 0, Math.PI * 2);
        } else {
          ctx.moveTo(px, py);
          ctx.lineTo(px - 2.5, py + 11);
        }
      }
      if (cond === 'snow') ctx.fill();
      else ctx.stroke();
      if (cond === 'storm' && Math.floor(st.realNow / 100) % 47 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(0, 0, w, h);
      }
    }
  }
}

/** Ink for text drawn over the 3D view: the theme's day and night values, never a blend of the two. */
const OVERLAY_INK_LIGHT: Record<string, string> = { fg: '#181715', fg2: '#3D3A35', muted: '#56504A', bg: '#F5F1E7', border: '#CDC7B8', accent: '#26714C', warn: '#8E5823', error: '#B43939' };
const OVERLAY_INK_DARK: Record<string, string> = { fg: '#F3EEE2', fg2: '#D8D2C5', muted: '#B5AD9F', bg: '#1E1A16', border: '#4A4137', accent: '#82D7AF', warn: '#EBB46E', error: '#E66E6E' };

/** A hex colour drained halfway to grey (anything else is returned as it is). */
function greyed(c: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return c;
  const n = parseInt(m[1], 16);
  const mix = (v: number) => Math.round(v * 0.5 + 154 * 0.5);
  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

function houseFootprint(b: Building): { x: number; y: number; w: number; h: number } {
  if (b.kind !== 'house') return { x: b.x, y: b.y, w: b.w, h: b.h };
  const rooms = b.rooms.filter((r) => r.kind !== 'yard');
  const x0 = Math.min(...rooms.map((r) => r.x));
  const y0 = Math.min(...rooms.map((r) => r.y));
  const x1 = Math.max(...rooms.map((r) => r.x + r.w));
  const y1 = Math.max(...rooms.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function intersects(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(' ');
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxW && cur) {
      out.push(cur);
      cur = w;
    } else cur = test;
  }
  if (cur) out.push(cur);
  return out;
}

function seasonGround(t: Record<string, string>, season: string, dark: boolean): string {
  if (dark) return t.ground;
  switch (season) {
    case 'summer':
      return '#E3DECF';
    case 'autumn':
      return '#E5DCC6';
    case 'winter':
      return '#E6E2D8';
    default:
      return '#E1DFCC';
  }
}

function seasonGrass(t: Record<string, string>, season: string, dark: boolean, farm: boolean): string {
  if (dark) return farm ? '#33402C' : t.grass;
  switch (season) {
    case 'summer':
      return farm ? '#B8C88C' : '#C3D19E';
    case 'autumn':
      return farm ? '#C9BE86' : '#CDC79A';
    case 'winter':
      return farm ? '#D0C6A6' : '#D4D0B4';
    default:
      return farm ? '#B9CC8E' : '#BFD39A';
  }
}

function seasonTree(t: Record<string, string>, season: string, dark: boolean): string {
  if (dark) return t.tree;
  switch (season) {
    case 'summer':
      return '#6F8C55';
    case 'autumn':
      return '#A0874C';
    case 'winter':
      return '#8E9478';
    default:
      return '#7C9B5B';
  }
}

export { houseFootprint };
export type { Conversation };
