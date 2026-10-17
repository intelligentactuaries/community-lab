// Drawing a plan for editing: the map's own palette (ground, roads, roofs,
// grass, the guideway), with what an editor needs on top — a grid, the cities'
// and settlements' zones tinted by wealth, each door's side, the selection with
// its handles, the ghost of what is being placed, and a mark on anything the
// checks found wrong.

import type { Facing } from '../../sim/layout/builders';
import type { Selection } from '../../sim/plan/edit';
import type { PlanBuilding, WorldPlan } from '../../sim/plan/types';
import type { Issue } from '../../sim/plan/validate';
import type { Building, Room, Tier } from '../../sim/types';
import type { Camera } from '../lib/camera';
import { tokens } from '../lib/theme';
import { houseFootprint } from '../render/renderer';

export interface Ghost {
  kind: 'building';
  rect: { x: number; y: number; w: number; h: number };
  facing: Facing;
  ok: boolean;
  label: string;
}

export interface Preview {
  ghosts: Ghost[];
  /** A road or guideway being drawn, its ends snapped or not. */
  line: { x1: number; y1: number; x2: number; y2: number; width: number; snappedA: boolean; snappedB: boolean; track?: boolean } | null;
  /** A zone or a marquee being dragged. */
  rect: { x: number; y: number; w: number; h: number; kind: 'settlement' | 'city' | 'marquee' } | null;
  /** Buildings being dragged, and by how much. */
  move: { ids: Set<string>; dx: number; dy: number } | null;
  /** A building being resized to this rectangle. */
  resize: { id: string; rect: { x: number; y: number; w: number; h: number } } | null;
  /** The guideway as it will be after the drag in progress (drawn in place of the plan's). */
  trackDraft: Array<{ x: number; y: number }> | null;
}

export interface View {
  plan: WorldPlan;
  built: Record<string, Building>;
  camera: Camera;
  w: number;
  h: number;
  dpr: number;
  selection: Selection[];
  hover: Selection | null;
  issues: Issue[];
  layers: { zones: boolean; labels: boolean; interiors: boolean; grid: boolean; issues: boolean };
  preview: Preview;
  dark: boolean;
}

/** Wealth tints for the settlements' zones: ochre for the poorest to violet for the estates. */
export const TIER_TINT: Record<Tier, string> = {
  'low-income': '#B9772E',
  working: '#9C8A3A',
  middle: '#4E8A5A',
  comfortable: '#3F7E8E',
  affluent: '#3F63B6',
  ultra: '#6F4FB8',
  civic: '#7A746A',
};

export const TIER_LABEL: Record<Tier, string> = {
  'low-income': 'low-income',
  working: 'working-class',
  middle: 'middle-class',
  comfortable: 'comfortable',
  affluent: 'affluent',
  ultra: 'the estates',
  civic: 'civic zone',
};

/** Handles of a selected building's frame, clockwise from the top left. */
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type Handle = (typeof HANDLES)[number];

export function handlePoints(r: { x: number; y: number; w: number; h: number }): Record<Handle, { x: number; y: number }> {
  return {
    nw: { x: r.x, y: r.y },
    n: { x: r.x + r.w / 2, y: r.y },
    ne: { x: r.x + r.w, y: r.y },
    e: { x: r.x + r.w, y: r.y + r.h / 2 },
    se: { x: r.x + r.w, y: r.y + r.h },
    s: { x: r.x + r.w / 2, y: r.y + r.h },
    sw: { x: r.x, y: r.y + r.h },
    w: { x: r.x, y: r.y + r.h / 2 },
  };
}

export class BuilderRenderer {
  private t: Record<string, string> = tokens();
  private lastTheme = '';
  /** Screen boxes taken by labels this frame: a label that would overlap one is left out. */
  private placed: Array<{ x: number; y: number; w: number; h: number }> = [];

  /** Draw a label unless it would collide with one already drawn (the textAlign and textBaseline set decide its box); true when drawn. */
  private label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, ink: string, dark: boolean, size: number): boolean {
    const w = ctx.measureText(text).width;
    const align = ctx.textAlign;
    const base = ctx.textBaseline;
    const bx = align === 'center' ? x - w / 2 : align === 'right' || align === 'end' ? x - w : x;
    const by = base === 'top' ? y : base === 'middle' ? y - size / 2 : y - size;
    const box = { x: bx - 2, y: by - 1, w: w + 4, h: size + 2 };
    for (const p of this.placed) if (box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y) return false;
    this.placed.push(box);
    this.halo(ctx, text, x, y, ink, dark);
    return true;
  }

  draw(ctx: CanvasRenderingContext2D, v: View): void {
    const th = document.documentElement.getAttribute('data-theme') ?? '';
    if (th !== this.lastTheme) {
      this.t = tokens();
      this.lastTheme = th;
    }
    const t = this.t;
    const { camera: cam, w, h, plan } = v;
    const z = cam.zoom;
    const X = (x: number) => (x - cam.x) * z + w / 2;
    const Y = (y: number) => (y - cam.y) * z + h / 2;
    ctx.save();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = t.ground;
    ctx.fillRect(0, 0, w, h);
    // The world's ground and edge.
    const W = plan.size.w;
    const H = plan.size.h;
    ctx.fillStyle = v.dark ? '#26221D' : '#EDE9DC';
    ctx.fillRect(X(0), Y(0), W * z, H * z);
    if (v.layers.grid) this.grid(ctx, v, X, Y);
    ctx.strokeStyle = t.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(X(0) + 0.5, Y(0) + 0.5, W * z, H * z);
    if (v.layers.zones) this.zones(ctx, v, X, Y);
    this.roads(ctx, v, X, Y);
    this.track(ctx, v, X, Y);
    const moved = v.preview.move;
    const issueBy = this.issueMap(v);
    for (const pb of plan.buildings) {
      const b = v.built[pb.id];
      if (!b) continue;
      let dx = 0;
      let dy = 0;
      if (moved?.ids.has(pb.id)) {
        dx = moved.dx;
        dy = moved.dy;
      }
      const resizing = v.preview.resize?.id === pb.id ? v.preview.resize.rect : null;
      if (resizing) this.outline(ctx, resizing, X, Y, t.accent, true);
      else this.building(ctx, v, pb, b, dx, dy, X, Y, issueBy.get(pb.id) ?? null);
    }
    this.selectionMarks(ctx, v, X, Y);
    this.previewMarks(ctx, v, X, Y);
    this.placed = [];
    if (v.layers.labels) this.labels(ctx, v, X, Y);
    ctx.restore();
  }

  private issueMap(v: View): Map<string, 'error' | 'warning'> {
    const out = new Map<string, 'error' | 'warning'>();
    if (!v.layers.issues) return out;
    for (const i of v.issues) {
      if (i.level === 'note') continue;
      for (const id of i.ids ?? []) if (out.get(id) !== 'error') out.set(id, i.level);
    }
    return out;
  }

  private grid(ctx: CanvasRenderingContext2D, v: View, X: (x: number) => number, Y: (y: number) => number): void {
    const z = v.camera.zoom;
    const W = v.plan.size.w;
    const H = v.plan.size.h;
    const step = z >= 3 ? 10 : z >= 0.8 ? 50 : z >= 0.3 ? 100 : 500;
    const major = step * 5;
    // Only the lines in view.
    const x0 = Math.max(0, Math.floor(((0 - v.w / 2) / z + v.camera.x) / step) * step);
    const x1 = Math.min(W, ((v.w - v.w / 2) / z + v.camera.x));
    const y0 = Math.max(0, Math.floor(((0 - v.h / 2) / z + v.camera.y) / step) * step);
    const y1 = Math.min(H, ((v.h - v.h / 2) / z + v.camera.y));
    ctx.lineWidth = 1;
    for (let x = x0; x <= x1; x += step) {
      ctx.strokeStyle = x % major === 0 ? (v.dark ? 'rgba(241,236,223,0.09)' : 'rgba(24,23,21,0.09)') : v.dark ? 'rgba(241,236,223,0.04)' : 'rgba(24,23,21,0.045)';
      ctx.beginPath();
      ctx.moveTo(Math.round(X(x)) + 0.5, Y(0));
      ctx.lineTo(Math.round(X(x)) + 0.5, Y(H));
      ctx.stroke();
    }
    for (let y = y0; y <= y1; y += step) {
      ctx.strokeStyle = y % major === 0 ? (v.dark ? 'rgba(241,236,223,0.09)' : 'rgba(24,23,21,0.09)') : v.dark ? 'rgba(241,236,223,0.04)' : 'rgba(24,23,21,0.045)';
      ctx.beginPath();
      ctx.moveTo(X(0), Math.round(Y(y)) + 0.5);
      ctx.lineTo(X(W), Math.round(Y(y)) + 0.5);
      ctx.stroke();
    }
  }

  private zones(ctx: CanvasRenderingContext2D, v: View, X: (x: number) => number, Y: (y: number) => number): void {
    const z = v.camera.zoom;
    const t = this.t;
    // Cities: a dashed frame.
    for (const c of v.plan.cities) {
      const sel = v.selection.some((s) => s.kind === 'city' && s.id === c.id);
      ctx.strokeStyle = sel ? t.accent : v.dark ? 'rgba(241,236,223,0.35)' : 'rgba(24,23,21,0.35)';
      ctx.lineWidth = sel ? 2 : 1.2;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(X(c.x) + 0.5, Y(c.y) + 0.5, c.w * z, c.h * z);
      ctx.setLineDash([]);
    }
    // Settlements: tinted by wealth; civic zones hatched.
    for (const s of v.plan.settlements) {
      const tint = TIER_TINT[s.tier] ?? '#7A746A';
      const sel = v.selection.some((x) => x.kind === 'settlement' && x.id === s.id);
      const hov = v.hover?.kind === 'settlement' && v.hover.id === s.id;
      ctx.fillStyle = hexA(tint, v.dark ? 0.1 : 0.085);
      ctx.fillRect(X(s.x), Y(s.y), s.w * z, s.h * z);
      if (s.tier === 'civic') {
        ctx.save();
        ctx.beginPath();
        ctx.rect(X(s.x), Y(s.y), s.w * z, s.h * z);
        ctx.clip();
        ctx.strokeStyle = hexA(tint, 0.12);
        ctx.lineWidth = 1;
        const step = 12;
        for (let d = -s.h * z; d < s.w * z; d += step) {
          ctx.beginPath();
          ctx.moveTo(X(s.x) + d, Y(s.y) + s.h * z);
          ctx.lineTo(X(s.x) + d + s.h * z, Y(s.y));
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.strokeStyle = sel ? t.accent : hexA(tint, hov ? 0.85 : 0.55);
      ctx.lineWidth = sel ? 2 : 1;
      ctx.strokeRect(X(s.x) + 0.5, Y(s.y) + 0.5, s.w * z, s.h * z);
    }
  }

  private roads(ctx: CanvasRenderingContext2D, v: View, X: (x: number) => number, Y: (y: number) => number): void {
    const z = v.camera.zoom;
    const t = this.t;
    ctx.lineCap = 'square';
    v.plan.roads.forEach((r, i) => {
      const sel = v.selection.some((s) => s.kind === 'road' && s.index === i);
      const hov = v.hover?.kind === 'road' && v.hover.index === i;
      const width = r.width ?? 7;
      if (sel || hov) {
        ctx.globalAlpha = sel ? 1 : 0.5;
        ctx.strokeStyle = t.accent;
        ctx.lineWidth = Math.max(4, width * z + 4);
        ctx.beginPath();
        ctx.moveTo(X(r.x1), Y(r.y1));
        ctx.lineTo(X(r.x2), Y(r.y2));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = t.road;
      ctx.lineWidth = Math.max(width > 7 ? 2.5 : 1.6, width * z);
      ctx.beginPath();
      ctx.moveTo(X(r.x1), Y(r.y1));
      ctx.lineTo(X(r.x2), Y(r.y2));
      ctx.stroke();
    });
    if (z >= 1.2) {
      ctx.strokeStyle = v.dark ? 'rgba(241,236,223,0.25)' : 'rgba(255,255,255,0.75)';
      ctx.setLineDash([3 * z, 3 * z]);
      ctx.lineWidth = Math.max(1, 0.35 * z);
      ctx.lineCap = 'butt';
      for (const r of v.plan.roads) {
        ctx.beginPath();
        ctx.moveTo(X(r.x1), Y(r.y1));
        ctx.lineTo(X(r.x2), Y(r.y2));
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }

  private track(ctx: CanvasRenderingContext2D, v: View, X: (x: number) => number, Y: (y: number) => number): void {
    const pts = v.preview.trackDraft ?? v.plan.track ?? [];
    if (pts.length < 2) {
      if (pts.length === 1) this.dot(ctx, X(pts[0].x), Y(pts[0].y), 4, v.dark ? '#C9D3E3' : '#2F4360');
      return;
    }
    const z = v.camera.zoom;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    const trace = () => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
    };
    trace();
    ctx.strokeStyle = v.dark ? 'rgba(150,165,190,0.5)' : 'rgba(84,98,120,0.5)';
    ctx.lineWidth = Math.max(2.5, 6 * z);
    ctx.stroke();
    trace();
    ctx.strokeStyle = v.dark ? '#C9D3E3' : '#2F4360';
    ctx.lineWidth = Math.max(0.9, 1.1 * z);
    ctx.stroke();
    // Vertices (the selected one ringed).
    pts.forEach((p, i) => {
      const sel = v.selection.some((s) => s.kind === 'track' && s.index === i);
      this.dot(ctx, X(p.x), Y(p.y), sel ? 5 : 3, sel ? this.t.accent : v.dark ? '#C9D3E3' : '#2F4360');
    });
    ctx.restore();
  }

  private building(ctx: CanvasRenderingContext2D, v: View, pb: PlanBuilding, b: Building, dx: number, dy: number, X0: (x: number) => number, Y0: (y: number) => number, issue: 'error' | 'warning' | null): void {
    const t = this.t;
    const z = v.camera.zoom;
    const X = (x: number) => X0(x + dx);
    const Y = (y: number) => Y0(y + dy);
    // Off screen: skip.
    if (X(b.x + b.w) < -40 || Y(b.y + b.h) < -40 || X(b.x) > v.w + 40 || Y(b.y) > v.h + 40) return;
    const sel = v.selection.some((s) => s.kind === 'building' && s.id === pb.id);
    const hov = v.hover?.kind === 'building' && v.hover.id === pb.id;
    const dark = v.dark;
    if (b.kind === 'runway') {
      ctx.fillStyle = dark ? '#474B53' : '#6E7278';
      ctx.fillRect(X(b.x), Y(b.y), b.w * z, b.h * z);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.setLineDash([Math.max(3, 30 * z), Math.max(3, 20 * z)]);
      ctx.lineWidth = Math.max(0.8, 0.9 * z);
      ctx.beginPath();
      ctx.moveTo(X(b.x + b.w / 2), Y(b.y + 60));
      ctx.lineTo(X(b.x + b.w / 2), Y(b.y + b.h - 60));
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (b.kind === 'park' || b.kind === 'farm' || b.kind === 'cemetery') {
      ctx.fillStyle = b.kind === 'farm' ? (dark ? '#3B3A26' : '#D6CF9E') : t.grass;
      ctx.fillRect(X(b.x), Y(b.y), b.w * z, b.h * z);
      ctx.strokeStyle = t.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(X(b.x) + 0.5, Y(b.y) + 0.5, b.w * z, b.h * z);
    } else if (b.kind === 'house') {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = t.grass;
      ctx.fillRect(X(b.x), Y(b.y), b.w * z, b.h * z);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = t.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(X(b.x) + 0.5, Y(b.y) + 0.5, b.w * z, b.h * z);
      const f = houseFootprint(b);
      ctx.fillStyle = t.roof;
      ctx.fillRect(X(f.x), Y(f.y), f.w * z, f.h * z);
      ctx.strokeStyle = t.fg2;
      ctx.lineWidth = Math.max(0.75, Math.min(1.5, z * 0.25));
      ctx.strokeRect(X(f.x) + 0.5, Y(f.y) + 0.5, f.w * z, f.h * z);
    } else {
      ctx.fillStyle = b.kind === 'church' ? t.roofChurch : t.roofCivic;
      ctx.fillRect(X(b.x), Y(b.y), b.w * z, b.h * z);
      ctx.strokeStyle = t.fg2;
      ctx.lineWidth = Math.max(0.75, Math.min(1.5, z * 0.25));
      ctx.strokeRect(X(b.x) + 0.5, Y(b.y) + 0.5, b.w * z, b.h * z);
    }
    // Courtyards and squares in front (aprons outside the footprint).
    for (const r of b.rooms) {
      const outside = r.x < b.x - 0.5 || r.y < b.y - 0.5 || r.x + r.w > b.x + b.w + 0.5 || r.y + r.h > b.y + b.h + 0.5;
      if (!outside) continue;
      ctx.strokeStyle = dark ? 'rgba(241,236,223,0.25)' : 'rgba(24,23,21,0.22)';
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(X(r.x) + 0.5, Y(r.y) + 0.5, r.w * z, r.h * z);
      ctx.setLineDash([]);
    }
    if (v.layers.interiors && z >= 2.6) for (const r of b.rooms) this.room(ctx, v, r, X, Y);
    // The door: a notch on its side, pointing out.
    if (z >= 0.45) {
      const d = b.door ?? b.entrance;
      const e = b.entrance;
      const size = Math.max(3, Math.min(9, 2.2 * z));
      ctx.fillStyle = sel ? t.accent : t.fg2;
      const side = sideOf(b, e);
      this.notch(ctx, X(e.x), Y(e.y), side, size);
      if (b.door && z >= 2.6) ctx.fillRect(X(d.x) - 1.2 * z, Y(d.y) - 0.6 * z, 2.4 * z, 1.2 * z);
    }
    // Marks: selection drawn later; hover and issues here.
    if (hov && !sel) {
      ctx.globalAlpha = 0.7;
      this.outline(ctx, b, X, Y, t.accent, false);
      ctx.globalAlpha = 1;
    }
    if (issue && !sel) {
      ctx.strokeStyle = issue === 'error' ? t.error : t.warn;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(X(b.x) - 1.5, Y(b.y) - 1.5, b.w * z + 3, b.h * z + 3);
      ctx.setLineDash([]);
      this.badge(ctx, X(b.x + b.w) - 2, Y(b.y) + 2, issue === 'error' ? t.error : t.warn);
    }
  }

  private room(ctx: CanvasRenderingContext2D, v: View, r: Room, X: (x: number) => number, Y: (y: number) => number): void {
    const z = v.camera.zoom;
    const dark = v.dark;
    const open = r.kind === 'yard' || r.kind === 'field' || r.kind === 'pitch' || r.kind === 'graves' || r.kind === 'pen';
    if (!open) {
      ctx.fillStyle = dark ? 'rgba(241,236,223,0.05)' : 'rgba(255,255,255,0.35)';
      ctx.fillRect(X(r.x), Y(r.y), r.w * z, r.h * z);
    }
    ctx.strokeStyle = dark ? 'rgba(241,236,223,0.25)' : 'rgba(24,23,21,0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(X(r.x) + 0.5, Y(r.y) + 0.5, r.w * z, r.h * z);
    if (z >= 6) {
      ctx.fillStyle = dark ? 'rgba(241,236,223,0.3)' : 'rgba(24,23,21,0.25)';
      for (const s of r.spots) {
        const sz = s.kind === 'bed' ? (s.double ? 1.7 : 1.1) : s.kind === 'pew' || s.kind === 'bench' ? 2 : 0.8;
        ctx.fillRect(X(s.x) - (sz / 2) * z, Y(s.y) - (sz / 2) * z, sz * z, sz * z);
      }
    }
    if (z >= 7 && v.layers.labels) {
      ctx.font = `500 ${Math.max(9.5, Math.min(12, 1.1 * z))}px 'SN Pro', sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = this.t.muted;
      ctx.fillText(r.name, X(r.x) + 3, Y(r.y) + 2);
    }
  }

  private selectionMarks(ctx: CanvasRenderingContext2D, v: View, X: (x: number) => number, Y: (y: number) => number): void {
    const t = this.t;
    const z = v.camera.zoom;
    const moved = v.preview.move;
    // A selected settlement or city: handles on its corners and sides; a selected road: its two ends.
    if (v.selection.length === 1) {
      const s = v.selection[0];
      const zone = s.kind === 'settlement' ? v.plan.settlements.find((q) => q.id === s.id) : s.kind === 'city' ? v.plan.cities.find((q) => q.id === s.id) : null;
      if (zone && !v.preview.rect) {
        const hp = handlePoints(zone);
        for (const k of HANDLES) {
          ctx.fillStyle = t.bg;
          ctx.strokeStyle = t.accent;
          ctx.lineWidth = 1.5;
          ctx.fillRect(X(hp[k].x) - 4, Y(hp[k].y) - 4, 8, 8);
          ctx.strokeRect(X(hp[k].x) - 4 + 0.5, Y(hp[k].y) - 4 + 0.5, 7, 7);
        }
      }
      if (s.kind === 'road' && !v.preview.line) {
        const r = v.plan.roads[s.index];
        if (r) {
          for (const [x, y] of [[r.x1, r.y1], [r.x2, r.y2]] as Array<[number, number]>) {
            ctx.beginPath();
            ctx.arc(X(x), Y(y), 5, 0, Math.PI * 2);
            ctx.fillStyle = t.bg;
            ctx.fill();
            ctx.strokeStyle = t.accent;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
      }
    }
    for (const s of v.selection) {
      if (s.kind !== 'building') continue;
      const b = v.built[s.id];
      const pb = v.plan.buildings.find((x) => x.id === s.id);
      if (!b || !pb) continue;
      const dx = moved?.ids.has(s.id) ? moved.dx : 0;
      const dy = moved?.ids.has(s.id) ? moved.dy : 0;
      const r = v.preview.resize?.id === s.id ? v.preview.resize.rect : { x: pb.x + dx, y: pb.y + dy, w: pb.w, h: pb.h };
      ctx.strokeStyle = t.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(X(r.x) - 1, Y(r.y) - 1, r.w * z + 2, r.h * z + 2);
      if (v.selection.length === 1) {
        const hp = handlePoints(r);
        for (const k of HANDLES) {
          ctx.fillStyle = t.bg;
          ctx.strokeStyle = t.accent;
          ctx.lineWidth = 1.5;
          ctx.fillRect(X(hp[k].x) - 4, Y(hp[k].y) - 4, 8, 8);
          ctx.strokeRect(X(hp[k].x) - 4 + 0.5, Y(hp[k].y) - 4 + 0.5, 7, 7);
        }
        // Its size, under it.
        ctx.font = `600 11px 'SN Pro', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        this.pill(ctx, `${Math.round(r.w)} × ${Math.round(r.h)} m`, X(r.x + r.w / 2), Y(r.y + r.h) + 8, t.accent);
      }
    }
  }

  private previewMarks(ctx: CanvasRenderingContext2D, v: View, X: (x: number) => number, Y: (y: number) => number): void {
    const t = this.t;
    const z = v.camera.zoom;
    const p = v.preview;
    for (const g of p.ghosts) {
      const col = g.ok ? t.accent : t.error;
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = col;
      ctx.fillRect(X(g.rect.x), Y(g.rect.y), g.rect.w * z, g.rect.h * z);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(X(g.rect.x) + 0.5, Y(g.rect.y) + 0.5, g.rect.w * z, g.rect.h * z);
      ctx.setLineDash([]);
      ctx.fillStyle = col;
      const side = g.facing;
      const ex = side === 'E' ? g.rect.x + g.rect.w : side === 'W' ? g.rect.x : g.rect.x + g.rect.w / 2;
      const ey = side === 'S' ? g.rect.y + g.rect.h : side === 'N' ? g.rect.y : g.rect.y + g.rect.h / 2;
      this.notch(ctx, X(ex), Y(ey), side, Math.max(4, Math.min(10, 2.4 * z)));
    }
    if (p.ghosts.length === 1) {
      const g = p.ghosts[0];
      ctx.font = `600 11px 'SN Pro', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      this.pill(ctx, g.label, X(g.rect.x + g.rect.w / 2), Y(g.rect.y) - 8, g.ok ? t.accent : t.error, 'bottom');
    }
    if (p.line) {
      const l = p.line;
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = t.accent;
      ctx.lineCap = 'square';
      ctx.lineWidth = Math.max(3, (l.track ? 6 : l.width) * z);
      ctx.beginPath();
      ctx.moveTo(X(l.x1), Y(l.y1));
      ctx.lineTo(X(l.x2), Y(l.y2));
      ctx.stroke();
      ctx.globalAlpha = 1;
      for (const [x, y, snapped] of [[l.x1, l.y1, l.snappedA], [l.x2, l.y2, l.snappedB]] as Array<[number, number, boolean]>) {
        ctx.beginPath();
        ctx.arc(X(x), Y(y), snapped ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = snapped ? t.accent : t.bg;
        ctx.fill();
        ctx.strokeStyle = t.accent;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
      ctx.font = `600 11px 'SN Pro', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      this.pill(ctx, `${Math.round(len)} m`, X((l.x1 + l.x2) / 2), Y((l.y1 + l.y2) / 2) - 10, t.accent, 'bottom');
    }
    if (p.rect) {
      const r = p.rect;
      const col = r.kind === 'marquee' ? t.accent : r.kind === 'city' ? t.fg2 : t.accent;
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = col;
      ctx.fillRect(X(r.x), Y(r.y), r.w * z, r.h * z);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(r.kind === 'city' ? [8, 6] : [5, 4]);
      ctx.strokeRect(X(r.x) + 0.5, Y(r.y) + 0.5, r.w * z, r.h * z);
      ctx.setLineDash([]);
      if (r.kind !== 'marquee') {
        ctx.font = `600 11px 'SN Pro', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        this.pill(ctx, `${Math.round(r.w)} × ${Math.round(r.h)} m`, X(r.x + r.w / 2), Y(r.y + r.h) + 8, col);
      }
    }
  }

  private labels(ctx: CanvasRenderingContext2D, v: View, X: (x: number) => number, Y: (y: number) => number): void {
    const t = this.t;
    const z = v.camera.zoom;
    // Zones: name and wealth, top left inside.
    if (v.layers.zones) {
      const zs = Math.max(10, Math.min(13, 9 + z * 2));
      const ss = Math.max(9.5, Math.min(11.5, 8.5 + z * 1.5));
      for (const c of v.plan.cities) {
        ctx.font = `600 ${zs}px 'SN Pro', sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        this.label(ctx, c.name.toUpperCase(), X(c.x) + 6, Y(c.y) + 5, t.fg2, v.dark, zs);
      }
      for (const s of v.plan.settlements) {
        if (s.w * z < 70) continue;
        ctx.font = `600 ${zs}px 'SN Pro', sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        // Below the city's own name where the two corners meet on screen.
        const under = v.plan.cities.some((c) => Math.abs(X(c.x) - X(s.x)) < 60 && Math.abs(Y(c.y) - Y(s.y)) < zs + 8);
        const y = Y(s.y) + (under ? zs + 10 : 5);
        if (this.label(ctx, s.name, X(s.x) + 6, y, TIER_TINT[s.tier] ?? t.fg2, v.dark, zs)) {
          ctx.font = `500 ${ss}px 'SN Pro', sans-serif`;
          this.label(ctx, TIER_LABEL[s.tier], X(s.x) + 6, y + zs + 3, t.muted, v.dark, ss);
        }
      }
    }
    // Buildings: the name under (or in) each one, houses their plot number.
    if (z < 0.55) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const moved = v.preview.move;
    for (const pb of v.plan.buildings) {
      const b = v.built[pb.id];
      if (!b) continue;
      const dx = moved?.ids.has(pb.id) ? moved.dx : 0;
      const dy = moved?.ids.has(pb.id) ? moved.dy : 0;
      if (b.kind === 'house') {
        if (z < 1.2) continue;
        const fs = Math.max(9.5, Math.min(12, 1.6 * z));
        ctx.font = `500 ${fs}px 'SN Pro', sans-serif`;
        this.label(ctx, z >= 3 ? pb.name : String(pb.plot ?? ''), X(b.x + dx + b.w / 2), Y(b.y + dy) + 3, t.muted, v.dark, fs);
        continue;
      }
      if (z < 0.9 && b.w < 100) continue;
      const fs = Math.max(10, Math.min(13, 2 * z));
      ctx.font = `600 ${fs}px 'SN Pro', sans-serif`;
      const inside = b.kind === 'park' || b.kind === 'farm' || b.kind === 'cemetery' || b.kind === 'runway' || b.w >= 100;
      this.label(ctx, pb.name, X(b.x + dx + b.w / 2), inside ? Y(b.y + dy) + 4 : Y(b.y + dy + b.h) + 4, t.fg2, v.dark, fs);
    }
    // Road names on their segments.
    if (z >= 1.4) {
      const fs = Math.max(10, Math.min(13, 2.2 * z));
      ctx.font = `500 ${fs}px 'SN Pro', sans-serif`;
      ctx.textBaseline = 'middle';
      for (const r of v.plan.roads) {
        const len = Math.hypot(r.x2 - r.x1, r.y2 - r.y1);
        if (len * z < 120) continue;
        const mx = (r.x1 + r.x2) / 2;
        const my = (r.y1 + r.y2) / 2;
        if (r.y1 === r.y2) {
          ctx.textAlign = 'center';
          this.label(ctx, r.name, X(mx), Y(my) - ((r.width ?? 7) / 2) * z - 7, t.muted, v.dark, fs);
        } else {
          ctx.save();
          ctx.translate(X(mx) - ((r.width ?? 7) / 2) * z - 7, Y(my));
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = 'center';
          this.halo(ctx, r.name, 0, 0, t.muted, v.dark);
          ctx.restore();
        }
      }
    }
  }

  // ── little marks ──

  private outline(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }, X: (x: number) => number, Y: (y: number) => number, col: string, dashed: boolean): void {
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    if (dashed) ctx.setLineDash([5, 4]);
    ctx.strokeRect(X(r.x) - 1, Y(r.y) - 1, (X(r.x + r.w) - X(r.x)) + 2, (Y(r.y + r.h) - Y(r.y)) + 2);
    ctx.setLineDash([]);
  }

  /** A small triangle on a building's edge, pointing out through its door. */
  private notch(ctx: CanvasRenderingContext2D, x: number, y: number, side: Facing, s: number): void {
    ctx.beginPath();
    if (side === 'S') {
      ctx.moveTo(x - s, y);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s);
    } else if (side === 'N') {
      ctx.moveTo(x - s, y);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y - s);
    } else if (side === 'E') {
      ctx.moveTo(x, y - s);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x + s, y);
    } else {
      ctx.moveTo(x, y - s);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - s, y);
    }
    ctx.closePath();
    ctx.fill();
  }

  private badge(ctx: CanvasRenderingContext2D, x: number, y: number, col: string): void {
    ctx.beginPath();
    ctx.arc(x - 6, y + 6, 7, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `700 10px 'SN Pro', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', x - 6, y + 6.5);
  }

  private dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string): void {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  }

  /** Text on a small rounded plate (sizes and lengths while editing). */
  private pill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, col: string, base: 'top' | 'bottom' = 'top'): void {
    const w = ctx.measureText(text).width + 12;
    const h = 18;
    const top = base === 'top' ? y : y - h;
    ctx.fillStyle = col;
    roundRect(ctx, x - w / 2, top, w, h, 9);
    ctx.fill();
    ctx.fillStyle = this.t.bg;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, x, top + h / 2 + 0.5);
  }

  private halo(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, ink: string, dark: boolean): void {
    ctx.save();
    ctx.shadowColor = dark ? 'rgba(22, 19, 16, 0.9)' : 'rgba(242, 238, 228, 0.95)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = ink;
    ctx.fillText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.restore();
  }
}

/** Which side of its footprint a building's gate is on. */
export function sideOf(b: { x: number; y: number; w: number; h: number }, e: { x: number; y: number }): Facing {
  const dN = Math.abs(e.y - b.y);
  const dS = Math.abs(e.y - (b.y + b.h));
  const dW = Math.abs(e.x - b.x);
  const dE = Math.abs(e.x - (b.x + b.w));
  const m = Math.min(dN, dS, dW, dE);
  return m === dS ? 'S' : m === dN ? 'N' : m === dE ? 'E' : 'W';
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A colour (hex or rgb()) as rgba with alpha. */
export function hexA(c: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (m) {
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const r = /rgba?\(([^)]+)\)/.exec(c);
  if (r) {
    const [R, G, B] = r[1].split(',').map((x) => parseFloat(x));
    return `rgba(${R}, ${G}, ${B}, ${a})`;
  }
  return c;
}
