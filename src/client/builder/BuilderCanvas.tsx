// The builder's drawing board. Wheel to zoom, the middle or right button (or
// the hand tool, or space held down) to pan. The tools: select and move,
// place a building from the library, draw a road, lay out a street of houses,
// mark out a settlement or a city, draw the Hyperline's guideway, erase.

import { useEffect, useRef, useState } from 'react';
import type { Facing } from '../../sim/layout/builders';
import { ASSET, assetSize } from '../../sim/plan/assets';
import { addBuildings, addCity, addRoad, addSettlement, axisLock, buildingAt, buildingsIn, duplicateBuildings, facingTowardRoad, freshRoadName, moveBuildings, newBuilding, removeBuildings, removeRoads, resizeBuilding, roadAt, setTrack, snapToNetwork, snapToRoad, turnBuilding, updateCity, updateRoad, updateSettlement, type Selection } from '../../sim/plan/edit';
import { AIRFIELD_SIZE, airfield, civicCentre, street, villageCore } from '../../sim/plan/prefabs';
import type { PlanBuilding, WorldPlan } from '../../sim/plan/types';
import { easeCamera } from '../lib/camera';
import { builder, useBuilder, type PrefabId } from './builderStore';
import { BuilderRenderer, HANDLES, handlePoints, type Ghost, type Handle, type Preview } from './render';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number }
  | { kind: 'move'; ids: string[]; ax: number; ay: number; dx: number; dy: number; anchor: { x: number; y: number }; moved: boolean }
  | { kind: 'resize'; id: string; handle: Handle; orig: { x: number; y: number; w: number; h: number }; rect: { x: number; y: number; w: number; h: number } }
  | { kind: 'line'; street: boolean; x1: number; y1: number; x2: number; y2: number; snappedA: boolean; snappedB: boolean }
  | { kind: 'zone'; what: 'settlement' | 'city'; ax: number; ay: number; bx: number; by: number }
  | { kind: 'marquee'; ax: number; ay: number; bx: number; by: number; add: boolean; sx: number; sy: number }
  | { kind: 'road'; index: number; ax: number; ay: number; dx: number; dy: number }
  | { kind: 'roadend'; index: number; end: 1 | 2; x: number; y: number }
  | { kind: 'zoneresize'; what: 'settlement' | 'city'; id: string; handle: Handle; orig: { x: number; y: number; w: number; h: number }; rect: { x: number; y: number; w: number; h: number } }
  | { kind: 'trackpt'; index: number; x: number; y: number };

const PREFAB_SIZE: Record<PrefabId, { w: number; h: number }> = { village: { w: 640, h: 230 }, civic: { w: 240, h: 230 }, airfield: AIRFIELD_SIZE };

function overlaps(plan: WorldPlan, r: { x: number; y: number; w: number; h: number }, ignore: Set<string> = new Set()): boolean {
  for (const b of plan.buildings) {
    if (ignore.has(b.id)) continue;
    const w = Math.min(r.x + r.w, b.x + b.w) - Math.max(r.x, b.x);
    const h = Math.min(r.y + r.h, b.y + b.h) - Math.max(r.y, b.y);
    if (w > 0 && h > 0 && w * h > 4) return true;
  }
  return false;
}

function inWorld(plan: WorldPlan, r: { x: number; y: number; w: number; h: number }): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= plan.size.w && r.y + r.h <= plan.size.h;
}

/** Where the asset in hand would go, its door's side and whether it fits. */
function placementGhost(plan: WorldPlan, wx: number, wy: number, alt: boolean): Ghost | null {
  const p = builder.placing;
  if (!p) return null;
  const a = ASSET[p.asset];
  if (!a) return null;
  let facing: Facing = p.facing ?? 'S';
  let sz = assetSize(a, { ...p.options, facing });
  if (!p.facing) {
    facing = facingTowardRoad(plan, { x: wx - sz.w / 2, y: wy - sz.h / 2, w: sz.w, h: sz.h }, a.facings);
    sz = assetSize(a, { ...p.options, facing });
  }
  let x = builder.q(wx - sz.w / 2);
  let y = builder.q(wy - sz.h / 2);
  // Near a road, its door goes to the road at the province's setback (Alt places it freely).
  if (!alt) {
    const probe: PlanBuilding = { id: '_ghost', asset: a.id, name: '', settlement: '', x, y, w: sz.w, h: sz.h, facing, options: p.options };
    const s = snapToRoad(plan, probe, 24);
    if (s && (!p.facing || p.facing === s.facing)) {
      facing = s.facing;
      sz = assetSize(a, { ...p.options, facing });
      x = Math.round(s.x);
      y = Math.round(s.y);
    }
  }
  const rect = { x, y, w: sz.w, h: sz.h };
  return { kind: 'building', rect, facing, ok: inWorld(plan, rect) && !overlaps(plan, rect), label: a.label };
}

export function BuilderCanvas() {
  const b = useBuilder();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const renderer = useRef(new BuilderRenderer());
  const preview = useRef<Preview>({ ghosts: [], line: null, rect: null, move: null, resize: null, trackDraft: null });
  const drag = useRef<Drag | null>(null);
  const space = useRef(false);
  const mouse = useRef<{ x: number; y: number; alt: boolean } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  // The frame loop: ease the camera and draw.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const cv = canvasRef.current;
      const wrap = wrapRef.current;
      const plan = builder.plan;
      if (cv && wrap && plan) {
        const dpr = window.devicePixelRatio || 1;
        const w = wrap.clientWidth;
        const h = wrap.clientHeight;
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
          cv.width = Math.round(w * dpr);
          cv.height = Math.round(h * dpr);
          builder.setViewport(w, h);
        }
        easeCamera(builder.camera, dt);
        const ctx = cv.getContext('2d');
        if (ctx) {
          renderer.current.draw(ctx, {
            plan,
            built: builder.built,
            camera: builder.camera,
            w,
            h,
            dpr,
            selection: builder.selection,
            hover: builder.hover,
            issues: builder.issues,
            layers: builder.layers,
            preview: preview.current,
            dark: document.documentElement.getAttribute('data-theme') === 'dark',
          });
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toWorld = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const cam = builder.camera;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return { sx, sy, x: (sx - builder.viewport.w / 2) / cam.zoom + cam.x, y: (sy - builder.viewport.h / 2) / cam.zoom + cam.y };
  };

  /** The handle of the one selected building under a screen point. */
  const handleAt = (sx: number, sy: number): { id: string; handle: Handle } | null => {
    if (builder.selection.length !== 1 || builder.selection[0].kind !== 'building') return null;
    const id = builder.selection[0].id;
    const pb = builder.plan?.buildings.find((x) => x.id === id);
    if (!pb) return null;
    const a = ASSET[pb.asset];
    if (!a || a.fixedSize) return null;
    const cam = builder.camera;
    const hp = handlePoints(pb);
    for (const k of HANDLES) {
      const px = (hp[k].x - cam.x) * cam.zoom + builder.viewport.w / 2;
      const py = (hp[k].y - cam.y) * cam.zoom + builder.viewport.h / 2;
      if (Math.abs(px - sx) <= 7 && Math.abs(py - sy) <= 7) return { id, handle: k };
    }
    return null;
  };

  /** The handle of the one selected settlement or city under a screen point (its corners and the middles of its sides). */
  const zoneHandleAt = (sx: number, sy: number): { what: 'settlement' | 'city'; id: string; handle: Handle; rect: { x: number; y: number; w: number; h: number } } | null => {
    if (builder.selection.length !== 1) return null;
    const s = builder.selection[0];
    if (s.kind !== 'settlement' && s.kind !== 'city') return null;
    const z = s.kind === 'settlement' ? builder.plan?.settlements.find((q) => q.id === s.id) : builder.plan?.cities.find((q) => q.id === s.id);
    if (!z) return null;
    const cam = builder.camera;
    const hp = handlePoints(z);
    for (const k of HANDLES) {
      const px = (hp[k].x - cam.x) * cam.zoom + builder.viewport.w / 2;
      const py = (hp[k].y - cam.y) * cam.zoom + builder.viewport.h / 2;
      if (Math.abs(px - sx) <= 7 && Math.abs(py - sy) <= 7) return { what: s.kind, id: s.id, handle: k, rect: { x: z.x, y: z.y, w: z.w, h: z.h } };
    }
    return null;
  };

  /** An end of the one selected road under a screen point. */
  const roadEndAt = (sx: number, sy: number): { index: number; end: 1 | 2 } | null => {
    if (builder.selection.length !== 1 || builder.selection[0].kind !== 'road') return null;
    const index = builder.selection[0].index;
    const r = builder.plan?.roads[index];
    if (!r) return null;
    const cam = builder.camera;
    for (const end of [1, 2] as const) {
      const x = end === 1 ? r.x1 : r.x2;
      const y = end === 1 ? r.y1 : r.y2;
      const px = (x - cam.x) * cam.zoom + builder.viewport.w / 2;
      const py = (y - cam.y) * cam.zoom + builder.viewport.h / 2;
      if (Math.hypot(px - sx, py - sy) <= 8) return { index, end };
    }
    return null;
  };

  const trackVertexAt = (sx: number, sy: number): number | null => {
    const pts = builder.plan?.track ?? [];
    const cam = builder.camera;
    for (let i = pts.length - 1; i >= 0; i--) {
      const px = (pts[i].x - cam.x) * cam.zoom + builder.viewport.w / 2;
      const py = (pts[i].y - cam.y) * cam.zoom + builder.viewport.h / 2;
      if (Math.hypot(px - sx, py - sy) <= 8) return i;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const plan = builder.plan;
    if (!plan) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const { sx, sy, x, y } = toWorld(e);
    const tool = builder.tool;
    // Panning: middle or right button, the hand tool, or space held.
    if (e.button === 1 || e.button === 2 || tool === 'pan' || space.current) {
      drag.current = { kind: 'pan', sx, sy, cx: builder.camera.x, cy: builder.camera.y };
      setGrabbing(true);
      return;
    }
    if (e.button !== 0) return;
    const tol = 8 / builder.camera.zoom;
    if (tool === 'select') {
      const zh = zoneHandleAt(sx, sy);
      if (zh) {
        drag.current = { kind: 'zoneresize', what: zh.what, id: zh.id, handle: zh.handle, orig: zh.rect, rect: { ...zh.rect } };
        return;
      }
      const re = roadEndAt(sx, sy);
      if (re) {
        const r = plan.roads[re.index];
        drag.current = { kind: 'roadend', index: re.index, end: re.end, x: re.end === 1 ? r.x1 : r.x2, y: re.end === 1 ? r.y1 : r.y2 };
        return;
      }
      const h = handleAt(sx, sy);
      if (h) {
        const pb = plan.buildings.find((q) => q.id === h.id)!;
        const orig = { x: pb.x, y: pb.y, w: pb.w, h: pb.h };
        drag.current = { kind: 'resize', id: h.id, handle: h.handle, orig, rect: { ...orig } };
        return;
      }
      const hit = buildingAt(plan, x, y);
      if (hit) {
        const sel: Selection = { kind: 'building', id: hit.id };
        if (e.shiftKey) builder.select([sel], true);
        else if (!builder.isSelected(sel)) builder.select([sel]);
        const ids = builder.selection.filter((s) => s.kind === 'building').map((s) => (s as { id: string }).id);
        if (ids.includes(hit.id)) drag.current = { kind: 'move', ids, ax: x, ay: y, dx: 0, dy: 0, anchor: { x: hit.x, y: hit.y }, moved: false };
        return;
      }
      const tv = trackVertexAt(sx, sy);
      if (tv !== null) {
        builder.select([{ kind: 'track', index: tv }]);
        drag.current = { kind: 'trackpt', index: tv, x: plan.track![tv].x, y: plan.track![tv].y };
        return;
      }
      const ri = roadAt(plan, x, y, tol);
      if (ri !== null) {
        builder.select([{ kind: 'road', index: ri }], e.shiftKey);
        drag.current = { kind: 'road', index: ri, ax: x, ay: y, dx: 0, dy: 0 };
        return;
      }
      drag.current = { kind: 'marquee', ax: x, ay: y, bx: x, by: y, add: e.shiftKey, sx, sy };
      return;
    }
    if (tool === 'place') {
      const g = placementGhost(plan, x, y, e.altKey);
      if (!g) return;
      if (!g.ok) {
        builder.say(inWorld(plan, g.rect) ? 'It would overlap another building: move it a little.' : 'It would stand partly off the map.', 'error');
        return;
      }
      const p = builder.placing!;
      const nb = newBuilding(plan, p.asset, g.rect.x + g.rect.w / 2, g.rect.y + g.rect.h / 2, { facing: g.facing, options: p.options });
      nb.x = g.rect.x;
      nb.y = g.rect.y;
      nb.w = g.rect.w;
      nb.h = g.rect.h;
      builder.commit(addBuildings(plan, [nb]), { select: [{ kind: 'building', id: nb.id }] });
      return;
    }
    if (tool === 'prefab') {
      placePrefab(plan, builder.prefab, x, y);
      return;
    }
    if (tool === 'road' || tool === 'street') {
      const s = snapToNetwork(plan, builder.q(x), builder.q(y), Math.max(10, tol * 1.5));
      drag.current = { kind: 'line', street: tool === 'street', x1: s.x, y1: s.y, x2: s.x, y2: s.y, snappedA: s.snapped, snappedB: false };
      return;
    }
    if (tool === 'settlement' || tool === 'city') {
      drag.current = { kind: 'zone', what: tool, ax: builder.q(x), ay: builder.q(y), bx: builder.q(x), by: builder.q(y) };
      return;
    }
    if (tool === 'track') {
      const pts = plan.track ?? [];
      const last = pts[pts.length - 1];
      let px = builder.q(x);
      let py = builder.q(y);
      if (last) {
        const l = axisLock(last.x, last.y, px, py);
        px = l.x2;
        py = l.y2;
        if (px === last.x && py === last.y) return;
      }
      builder.commit(setTrack(plan, [...pts, { x: px, y: py }]), { select: [{ kind: 'track', index: pts.length }] });
      return;
    }
    if (tool === 'erase') {
      const hit = buildingAt(plan, x, y);
      if (hit) {
        builder.commit(removeBuildings(plan, [hit.id]));
        return;
      }
      const tv = trackVertexAt(sx, sy);
      if (tv !== null) {
        builder.commit(setTrack(plan, (plan.track ?? []).filter((_, i) => i !== tv)));
        return;
      }
      const ri = roadAt(plan, x, y, tol);
      if (ri !== null) builder.commit(removeRoads(plan, [ri]));
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const plan = builder.plan;
    if (!plan) return;
    const { sx, sy, x, y } = toWorld(e);
    mouse.current = { x, y, alt: e.altKey };
    setCursor({ x, y });
    const d = drag.current;
    const pv = preview.current;
    if (d?.kind === 'pan') {
      builder.camera.x = d.cx - (sx - d.sx) / builder.camera.zoom;
      builder.camera.y = d.cy - (sy - d.sy) / builder.camera.zoom;
      builder.camera.tx = builder.camera.x;
      builder.camera.ty = builder.camera.y;
      return;
    }
    if (d?.kind === 'move') {
      // Snap the grabbed building's corner to the grid; everything moves with it.
      const nx = builder.q(d.anchor.x + (x - d.ax));
      const ny = builder.q(d.anchor.y + (y - d.ay));
      d.dx = nx - d.anchor.x;
      d.dy = ny - d.anchor.y;
      if (Math.abs(x - d.ax) * builder.camera.zoom > 3 || Math.abs(y - d.ay) * builder.camera.zoom > 3) d.moved = true;
      pv.move = d.moved ? { ids: new Set(d.ids), dx: d.dx, dy: d.dy } : null;
      return;
    }
    if (d?.kind === 'resize') {
      const o = d.orig;
      let x0 = o.x;
      let y0 = o.y;
      let x1 = o.x + o.w;
      let y1 = o.y + o.h;
      const qx = builder.q(x);
      const qy = builder.q(y);
      if (d.handle.includes('w')) x0 = Math.min(qx, x1 - 10);
      if (d.handle.includes('e')) x1 = Math.max(qx, x0 + 10);
      if (d.handle.includes('n')) y0 = Math.min(qy, y1 - 10);
      if (d.handle.includes('s')) y1 = Math.max(qy, y0 + 10);
      const pb = plan.buildings.find((q) => q.id === d.id);
      const a = pb ? ASSET[pb.asset] : null;
      if (a) {
        const w = Math.max(a.min.w, Math.min(a.max.w, x1 - x0));
        const h = Math.max(a.min.h, Math.min(a.max.h, y1 - y0));
        if (d.handle.includes('w')) x0 = x1 - w;
        else x1 = x0 + w;
        if (d.handle.includes('n')) y0 = y1 - h;
        else y1 = y0 + h;
      }
      d.rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      pv.resize = { id: d.id, rect: d.rect };
      return;
    }
    if (d?.kind === 'zoneresize') {
      const o = d.orig;
      let x0 = o.x;
      let y0 = o.y;
      let x1 = o.x + o.w;
      let y1 = o.y + o.h;
      const qx = builder.q(x);
      const qy = builder.q(y);
      if (d.handle.includes('w')) x0 = Math.min(qx, x1 - 40);
      if (d.handle.includes('e')) x1 = Math.max(qx, x0 + 40);
      if (d.handle.includes('n')) y0 = Math.min(qy, y1 - 40);
      if (d.handle.includes('s')) y1 = Math.max(qy, y0 + 40);
      d.rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      pv.rect = { ...d.rect, kind: d.what };
      return;
    }
    if (d?.kind === 'roadend') {
      const r = plan.roads[d.index];
      const horizontal = r.y1 === r.y2;
      // An end slides along the road's own axis, and snaps to a road it meets.
      const s = snapToNetwork({ ...plan, roads: plan.roads.filter((_, i) => i !== d.index) }, builder.q(x), builder.q(y), Math.max(8, 10 / builder.camera.zoom));
      d.x = horizontal ? s.x : r.x1;
      d.y = horizontal ? r.y1 : s.y;
      const other = d.end === 1 ? { x: r.x2, y: r.y2 } : { x: r.x1, y: r.y1 };
      pv.line = { x1: other.x, y1: other.y, x2: d.x, y2: d.y, width: r.width ?? 7, snappedA: false, snappedB: s.snapped };
      return;
    }
    if (d?.kind === 'line') {
      const l = axisLock(d.x1, d.y1, builder.q(x), builder.q(y));
      const s = snapToNetwork({ ...plan, roads: plan.roads }, l.x2, l.y2, Math.max(10, 12 / builder.camera.zoom));
      // Keep the snapped end on the line's axis.
      const horizontal = l.y2 === d.y1;
      d.x2 = s.snapped ? (horizontal ? s.x : d.x1) : l.x2;
      d.y2 = s.snapped ? (horizontal ? d.y1 : s.y) : l.y2;
      d.snappedB = s.snapped && (horizontal ? s.y === d.y1 : s.x === d.x1);
      pv.line = { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, width: builder.roadWidth, snappedA: d.snappedA, snappedB: d.snappedB };
      pv.ghosts = d.street ? streetGhosts(plan, d) : [];
      return;
    }
    if (d?.kind === 'zone') {
      d.bx = builder.q(x);
      d.by = builder.q(y);
      pv.rect = { x: Math.min(d.ax, d.bx), y: Math.min(d.ay, d.by), w: Math.abs(d.bx - d.ax), h: Math.abs(d.by - d.ay), kind: d.what };
      return;
    }
    if (d?.kind === 'marquee') {
      d.bx = x;
      d.by = y;
      if (Math.hypot(sx - d.sx, sy - d.sy) > 4) pv.rect = { x: Math.min(d.ax, d.bx), y: Math.min(d.ay, d.by), w: Math.abs(d.bx - d.ax), h: Math.abs(d.by - d.ay), kind: 'marquee' };
      return;
    }
    if (d?.kind === 'road') {
      const r = plan.roads[d.index];
      const horizontal = r.y1 === r.y2;
      // A road slides across its own axis (along it, it would only change where it ends).
      d.dx = horizontal ? 0 : builder.q(x - d.ax);
      d.dy = horizontal ? builder.q(y - d.ay) : 0;
      pv.line = { x1: r.x1 + d.dx, y1: r.y1 + d.dy, x2: r.x2 + d.dx, y2: r.y2 + d.dy, width: r.width ?? 7, snappedA: false, snappedB: false };
      return;
    }
    if (d?.kind === 'trackpt') {
      d.x = builder.q(x);
      d.y = builder.q(y);
      const pts = [...(plan.track ?? [])];
      pts[d.index] = { x: d.x, y: d.y };
      // The guideway as it will be, drawn in place of the plan's.
      pv.trackDraft = pts;
      pv.line = null;
      pv.ghosts = [];
      return;
    }
    // No drag: hover and the placement ghost.
    pv.ghosts = [];
    if (builder.tool === 'place') {
      const g = placementGhost(plan, x, y, e.altKey);
      pv.ghosts = g ? [g] : [];
    } else if (builder.tool === 'prefab') {
      const sz = PREFAB_SIZE[builder.prefab];
      const r = { x: builder.q(x), y: builder.q(y), w: sz.w, h: sz.h };
      pv.ghosts = [{ kind: 'building', rect: r, facing: 'S', ok: inWorld(plan, r), label: builder.prefab === 'village' ? 'Village core' : builder.prefab === 'civic' ? 'Civic centre' : 'Airfield' }];
    } else if (builder.tool === 'track') {
      const pts = plan.track ?? [];
      const last = pts[pts.length - 1];
      if (last) {
        const l = axisLock(last.x, last.y, builder.q(x), builder.q(y));
        pv.line = { x1: last.x, y1: last.y, x2: l.x2, y2: l.y2, width: 6, snappedA: true, snappedB: false, track: true };
      } else pv.line = null;
    } else if (builder.tool === 'road' || builder.tool === 'street') {
      const s = snapToNetwork(plan, builder.q(x), builder.q(y), Math.max(10, 12 / builder.camera.zoom));
      pv.line = { x1: s.x, y1: s.y, x2: s.x, y2: s.y, width: builder.roadWidth, snappedA: s.snapped, snappedB: s.snapped };
    }
    const hit = buildingAt(plan, x, y);
    const hov: Selection | null = hit ? { kind: 'building', id: hit.id } : (() => {
      const ri = roadAt(plan, x, y, 8 / builder.camera.zoom);
      return ri !== null ? { kind: 'road', index: ri } : null;
    })();
    if (JSON.stringify(hov) !== JSON.stringify(builder.hover)) {
      builder.hover = hov;
      builder.bump();
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const plan = builder.plan;
    const d = drag.current;
    drag.current = null;
    setGrabbing(false);
    const pv = preview.current;
    pv.move = null;
    pv.resize = null;
    pv.rect = null;
    if (d?.kind === 'line' || d?.kind === 'road' || d?.kind === 'roadend') pv.line = null;
    if (!plan || !d) return;
    if (d.kind === 'zoneresize') {
      const r = d.rect;
      if (r.x !== d.orig.x || r.y !== d.orig.y || r.w !== d.orig.w || r.h !== d.orig.h) builder.commit(d.what === 'settlement' ? updateSettlement(plan, d.id, r) : updateCity(plan, d.id, r));
      return;
    }
    if (d.kind === 'roadend') {
      const r = plan.roads[d.index];
      const patch = d.end === 1 ? { x1: d.x, y1: d.y } : { x2: d.x, y2: d.y };
      const nx1 = d.end === 1 ? d.x : r.x1;
      const ny1 = d.end === 1 ? d.y : r.y1;
      const nx2 = d.end === 2 ? d.x : r.x2;
      const ny2 = d.end === 2 ? d.y : r.y2;
      if (Math.hypot(nx2 - nx1, ny2 - ny1) >= 4 && (nx1 !== r.x1 || ny1 !== r.y1 || nx2 !== r.x2 || ny2 !== r.y2)) builder.commit(updateRoad(plan, d.index, patch));
      return;
    }
    if (d.kind === 'move' && d.moved && (d.dx || d.dy)) {
      const next = moveBuildings(plan, d.ids, d.dx, d.dy);
      builder.commit(next);
      return;
    }
    if (d.kind === 'resize') {
      const r = d.rect;
      if (r.x !== d.orig.x || r.y !== d.orig.y || r.w !== d.orig.w || r.h !== d.orig.h) builder.commit(resizeBuilding(plan, d.id, r));
      return;
    }
    if (d.kind === 'line') {
      pv.ghosts = [];
      const len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
      if (len < 4) return;
      const horizontal = d.y1 === d.y2;
      const name = freshRoadName(plan, horizontal);
      if (d.street) {
        const pieces = street({ x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, name, tier: builder.street.tier, sides: builder.street.sides, settlement: settlementFor(plan, (d.x1 + d.x2) / 2, (d.y1 + d.y2) / 2), taken: new Set(plan.buildings.map((q) => q.id)), plotsUsed: new Set(plan.buildings.map((q) => q.plot ?? 0)), withRoad: true });
        const fits = pieces.buildings.filter((q) => inWorld(plan, q) && !overlaps(plan, q)).map((q) => ({ ...q, settlement: settlementFor(plan, q.x + q.w / 2, q.y + q.h / 2) }));
        // Along a road that is already there, only the plots are new.
        let next = onExistingRoad(plan, d) ? plan : addRoad(plan, { ...pieces.roads[0], width: builder.roadWidth === 7 ? undefined : builder.roadWidth });
        next = addBuildings(next, fits);
        builder.commit(next, { select: fits.map((q) => ({ kind: 'building', id: q.id })) });
        builder.say(`${name}: ${fits.length} plot${fits.length === 1 ? '' : 's'}${fits.length < pieces.buildings.length ? ` (${pieces.buildings.length - fits.length} left out where something stands)` : ''}.`, 'ok');
      } else builder.commit(addRoad(plan, { name, x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, ...(builder.roadWidth !== 7 ? { width: builder.roadWidth } : {}) }), { select: [{ kind: 'road', index: plan.roads.length }] });
      return;
    }
    if (d.kind === 'zone') {
      const r = { x: Math.min(d.ax, d.bx), y: Math.min(d.ay, d.by), w: Math.abs(d.bx - d.ax), h: Math.abs(d.by - d.ay) };
      if (r.w < 40 || r.h < 40) {
        builder.say(`Drag out a larger ${d.what === 'city' ? 'city' : 'settlement'} (at least 40 × 40 m).`);
        return;
      }
      if (d.what === 'settlement') {
        const out = addSettlement(plan, r);
        builder.commit(out.plan, { select: [{ kind: 'settlement', id: out.id }] });
      } else {
        const out = addCity(plan, r);
        builder.commit(out.plan, { select: [{ kind: 'city', id: out.id }] });
      }
      builder.setTool('select');
      return;
    }
    if (d.kind === 'marquee') {
      if (pv.ghosts.length) pv.ghosts = [];
      const r = { x: Math.min(d.ax, d.bx), y: Math.min(d.ay, d.by), w: Math.abs(d.bx - d.ax), h: Math.abs(d.by - d.ay) };
      const { sx, sy } = toWorld(e);
      if (Math.hypot(sx - d.sx, sy - d.sy) <= 4) {
        // A click on open ground: the settlement there, else the city, else nothing.
        const s = plan.settlements.filter((q) => d.ax >= q.x && d.ax <= q.x + q.w && d.ay >= q.y && d.ay <= q.y + q.h).sort((a, b2) => a.w * a.h - b2.w * b2.h)[0];
        const c = plan.cities.filter((q) => d.ax >= q.x && d.ax <= q.x + q.w && d.ay >= q.y && d.ay <= q.y + q.h).sort((a, b2) => a.w * a.h - b2.w * b2.h)[0];
        builder.select(s ? [{ kind: 'settlement', id: s.id }] : c ? [{ kind: 'city', id: c.id }] : []);
        return;
      }
      const ids = buildingsIn(plan, r);
      builder.select(ids.map((id) => ({ kind: 'building', id })), d.add);
      return;
    }
    if (d.kind === 'road' && (d.dx || d.dy)) {
      const r = plan.roads[d.index];
      builder.commit(updateRoad(plan, d.index, { x1: r.x1 + d.dx, y1: r.y1 + d.dy, x2: r.x2 + d.dx, y2: r.y2 + d.dy }));
      return;
    }
    if (d.kind === 'trackpt') {
      const pts = pv.trackDraft;
      pv.trackDraft = null;
      if (pts) builder.commit(setTrack(plan, pts));
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    builder.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0016));
  };

  const onDoubleClick = () => {
    if (builder.tool === 'track' || builder.tool === 'place' || builder.tool === 'prefab') builder.setTool('select');
  };

  // Keyboard: tools, nudging, turning, deleting, undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!builder.active || builder.dialog) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const plan = builder.plan;
      if (!plan) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key;
      if (k === ' ') {
        space.current = true;
        e.preventDefault();
        return;
      }
      if (mod && (k === 'z' || k === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) builder.redo();
        else builder.undo();
        return;
      }
      if (mod && (k === 'y' || k === 'Y')) {
        e.preventDefault();
        builder.redo();
        return;
      }
      if (mod && (k === 's' || k === 'S')) {
        e.preventDefault();
        builder.save();
        return;
      }
      if (mod && (k === 'd' || k === 'D')) {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if (mod && (k === 'a' || k === 'A')) {
        e.preventDefault();
        builder.select(plan.buildings.map((q) => ({ kind: 'building', id: q.id })));
        return;
      }
      if (mod) return;
      if (k === 'Escape') {
        if (drag.current) {
          drag.current = null;
          preview.current = { ghosts: [], line: null, rect: null, move: null, resize: null, trackDraft: null };
        } else if (builder.tool !== 'select') builder.setTool('select');
        else builder.select([]);
        preview.current.ghosts = [];
        preview.current.line = null;
        return;
      }
      if (k === 'Delete' || k === 'Backspace') {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (k === 'Enter' && builder.tool === 'track') {
        builder.setTool('select');
        preview.current.line = null;
        return;
      }
      const tools: Record<string, Parameters<typeof builder.setTool>[0]> = { v: 'select', h: 'pan', r: 'road', s: 'street', z: 'settlement', c: 'city', t: 'track', x: 'erase' };
      if (tools[k.toLowerCase()] && !e.altKey) {
        builder.setTool(tools[k.toLowerCase()]);
        preview.current.ghosts = [];
        preview.current.line = null;
        return;
      }
      if (k === 'f' || k === 'F') {
        turnSelection();
        return;
      }
      if (k === 'g' || k === 'G') {
        builder.setSnap(!builder.snap);
        builder.say(builder.snap ? `Snapping to a ${builder.grid} m grid.` : 'Snapping off.');
        return;
      }
      if (k === '0') {
        builder.fit();
        return;
      }
      if (k === '+' || k === '=') builder.zoomAt(builder.viewport.w / 2, builder.viewport.h / 2, 1.5);
      if (k === '-' || k === '_') builder.zoomAt(builder.viewport.w / 2, builder.viewport.h / 2, 1 / 1.5);
      if (k.startsWith('Arrow')) {
        e.preventDefault();
        const step = (e.shiftKey ? 10 : 1) * (builder.snap ? builder.grid : 1);
        const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
        const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
        const ids = builder.selection.filter((s) => s.kind === 'building').map((s) => (s as { id: string }).id);
        if (ids.length) builder.commit(moveBuildings(plan, ids, dx, dy));
        else {
          builder.camera.tx += (dx * 40) / builder.camera.zoom / step;
          builder.camera.ty += (dy * 40) / builder.camera.zoom / step;
        }
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === ' ') space.current = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  // The status line: where the pointer is and what the tool does.
  const hint = TOOL_HINT[b.tool] + (b.tool === 'place' && b.placing ? ` · ${ASSET[b.placing.asset]?.label}` : '');
  return (
    <div ref={wrapRef} className="stage builder-stage">
      <canvas ref={canvasRef} className={`${grabbing ? 'dragging' : ''} tool-${b.tool}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => (preview.current.ghosts = [])} onWheel={onWheel} onDoubleClick={onDoubleClick} onContextMenu={(e) => e.preventDefault()} />
      <div className="b-status">
        <span>{hint}</span>
        {cursor && b.plan && (
          <span className="mono muted">
            {Math.round(cursor.x)}, {Math.round(cursor.y)} m
          </span>
        )}
        <span className="mono muted">{b.snap ? `snap ${b.grid} m` : 'free'}</span>
      </div>
    </div>
  );
}

const TOOL_HINT: Record<string, string> = {
  select: 'Select: click a building, road, settlement or city; drag to move; drag on open ground to select several',
  pan: 'Pan: drag the map (or hold space, or use the right button)',
  place: 'Place: click to put it down (F turns it, Alt places it away from the road, Esc stops)',
  prefab: 'Place the set: click where its north-west corner goes',
  road: 'Road: drag from one point to another; ends snap to the roads they meet',
  street: 'Street: drag a road and houses line it on both sides',
  settlement: 'Settlement: drag out its zone',
  city: 'City: drag out its bounds',
  track: 'Hyperline: click to add each bend of the guideway; Enter or a double click to finish',
  erase: 'Erase: click a building, a road or a bend of the guideway to remove it',
};

/** Whether a drawn line runs along a road that is already there (most of its length on it). */
function onExistingRoad(plan: WorldPlan, l: { x1: number; y1: number; x2: number; y2: number }): boolean {
  const horizontal = l.y1 === l.y2;
  const lo = horizontal ? Math.min(l.x1, l.x2) : Math.min(l.y1, l.y2);
  const hi = horizontal ? Math.max(l.x1, l.x2) : Math.max(l.y1, l.y2);
  let covered = 0;
  for (const r of plan.roads) {
    if (horizontal ? r.y1 !== r.y2 || r.y1 !== l.y1 : r.x1 !== r.x2 || r.x1 !== l.x1) continue;
    const rlo = horizontal ? Math.min(r.x1, r.x2) : Math.min(r.y1, r.y2);
    const rhi = horizontal ? Math.max(r.x1, r.x2) : Math.max(r.y1, r.y2);
    covered += Math.max(0, Math.min(hi, rhi) - Math.max(lo, rlo));
  }
  return covered >= 0.9 * (hi - lo);
}

function settlementFor(plan: WorldPlan, x: number, y: number): string {
  const inside = plan.settlements.filter((s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h).sort((a, b) => a.w * a.h - b.w * b.h)[0];
  if (inside) return inside.id;
  let best = plan.settlements[0];
  let bd = Infinity;
  for (const s of plan.settlements) {
    const d = Math.hypot(Math.max(s.x - x, 0, x - s.x - s.w), Math.max(s.y - y, 0, y - s.y - s.h));
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best?.id ?? 'settlement';
}

function streetGhosts(plan: WorldPlan, d: { x1: number; y1: number; x2: number; y2: number }): Ghost[] {
  if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 40) return [];
  const pieces = street({ x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, name: '', tier: builder.street.tier, sides: builder.street.sides, settlement: '', taken: new Set(plan.buildings.map((q) => q.id)), plotsUsed: new Set(plan.buildings.map((q) => q.plot ?? 0)) });
  return pieces.buildings.map((q) => ({ kind: 'building' as const, rect: { x: q.x, y: q.y, w: q.w, h: q.h }, facing: q.facing, ok: inWorld(plan, q) && !overlaps(plan, q), label: '' }));
}

function placePrefab(plan: WorldPlan, id: PrefabId, x: number, y: number): void {
  const taken = new Set(plan.buildings.map((q) => q.id));
  const sz = PREFAB_SIZE[id];
  const px = builder.q(x);
  const py = builder.q(y);
  if (!inWorld(plan, { x: px, y: py, w: sz.w, h: sz.h })) {
    builder.say('The set would stand partly off the map.', 'error');
    return;
  }
  const s = settlementFor(plan, px + sz.w / 2, py + sz.h / 2);
  const town = plan.cities.find((c) => c.id === plan.settlements.find((q) => q.id === s)?.city)?.short ?? plan.name.split(' ')[0];
  const pieces = id === 'village' ? villageCore(px, py + 115, s, taken, town) : id === 'civic' ? civicCentre(px + 120, py + 10, s, taken, town) : airfield(px, py, s, taken, plan.name);
  const clash = pieces.buildings.filter((q) => overlaps(plan, q));
  if (clash.length) {
    builder.say(`${clash.length} of the set's buildings would overlap what is there: find open ground.`, 'error');
    return;
  }
  let next = plan;
  for (const r of pieces.roads) next = addRoad(next, r);
  next = addBuildings(next, pieces.buildings.map((q) => ({ ...q, settlement: settlementFor(plan, q.x + q.w / 2, q.y + q.h / 2) })));
  builder.commit(next, { select: pieces.buildings.map((q) => ({ kind: 'building', id: q.id })) });
  builder.setTool('select');
  builder.say(id === 'airfield' ? 'Airfield placed: connect Airport Road to your network.' : `${id === 'village' ? 'Village core' : 'Civic centre'} placed.`, 'ok');
}

/** Delete whatever is selected. */
export function deleteSelection(): void {
  const plan = builder.plan;
  if (!plan || !builder.selection.length) return;
  const ids = builder.selection.filter((s) => s.kind === 'building').map((s) => (s as { id: string }).id);
  const roads = builder.selection.filter((s) => s.kind === 'road').map((s) => (s as { index: number }).index);
  const verts = builder.selection.filter((s) => s.kind === 'track').map((s) => (s as { index: number }).index);
  let next = plan;
  if (ids.length) next = removeBuildings(next, ids);
  if (roads.length) next = removeRoads(next, roads);
  if (verts.length) next = setTrack(next, (next.track ?? []).filter((_, i) => !verts.includes(i)));
  builder.commit(next, { select: [] });
}

export function duplicateSelection(): void {
  const plan = builder.plan;
  if (!plan) return;
  const ids = builder.selection.filter((s) => s.kind === 'building').map((s) => (s as { id: string }).id);
  if (!ids.length) return;
  const out = duplicateBuildings(plan, ids, 20, 20);
  builder.commit(out.plan, { select: out.ids.map((id) => ({ kind: 'building', id })) });
}

export function turnSelection(): void {
  const plan = builder.plan;
  if (!plan) return;
  if (builder.tool === 'place' && builder.placing) {
    const a = ASSET[builder.placing.asset];
    const fs = a?.facings ?? ['N', 'E', 'S', 'W'];
    const cur = builder.placing.facing ?? 'S';
    builder.placing = { ...builder.placing, facing: fs[(fs.indexOf(cur) + 1) % fs.length] };
    builder.bump();
    return;
  }
  const ids = builder.selection.filter((s) => s.kind === 'building').map((s) => (s as { id: string }).id);
  let next = plan;
  for (const id of ids) next = turnBuilding(next, id);
  builder.commit(next);
}
