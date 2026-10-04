import { useEffect, useRef, useState } from 'react';
import { alivePeople } from '../../sim/ctx';
import { JOBS } from '../../sim/population';
import { nightDarkness, calendarForDay } from '../../sim/time';
import { CITIES, CITY, COMMUNITY, cityAt, communityAt, pointInRect } from '../../sim/world';
import { flyToRect, easeCamera, fitWorld, focusPoint, focusRect, toWorld, zoomAt, type Camera } from '../lib/camera';
import { dialogueTick, aiStatus } from '../lib/dialogue';
import { store, useStore } from '../lib/simStore';
import { isSimTheme } from '../lib/theme';
import { Controls } from '../lib/controls';
import { Renderer } from '../render/renderer';
import { FADE_FROM, blend3d } from '../render3d/view3d';
import type { Scene3D } from '../render3d/scene3d';
import { isDarkTheme, plotColor } from '../lib/householdColor';
import { Bus, Church, Home, Hospital, Landmark, Plane, Stadium, Target, Tower, Trees } from './Icons';
import { Legend } from './Legend';

/** Who is singing a hymn line and who is speaking right now (the 3D faces move their mouths). */
function voices(): { singers: Set<string>; speakers: Set<string> } {
  const world = store.sim.world;
  const singers = new Set<string>();
  const speakers = new Set<string>();
  for (const id in world.conversations) {
    const c = world.conversations[id];
    if (!c.participantIds.every((pid) => world.people[pid]?.conversationId === id)) continue;
    if (c.hymn && c.hymn.lineIdx >= 0) {
      if (world.minute - c.hymn.lineMinute <= 2.5) for (const sid of c.hymn.singerIds) singers.add(sid);
      continue;
    }
    const line = c.lines[c.lines.length - 1];
    if (line && !line.chorus && (world.minute - line.minute <= 2.5 || c.llm === 'streaming')) speakers.add(line.speakerId);
  }
  return { singers, speakers };
}

/** The 3D scene, once loaded (three.js is fetched the first time you zoom toward it). */
const scene3d: { current: Scene3D | null; loading: boolean; failed: boolean } = { current: null, loading: false, failed: false };

/** True while the 3D view carries the picture (pointer input maps through its camera). */
function in3d(): boolean {
  return !!scene3d.current && store.view3d && blend3d(store.camera.zoom) >= 0.5;
}

/** Whoever is drawn nearest the centre of the 3D view (a controller's A button), within a generous reach. */
function personAtCentre(): string | null {
  const s3 = scene3d.current;
  if (!s3) return null;
  const { w, h } = store.viewport;
  let best: string | null = null;
  let bd = Math.min(w, h) * 0.18;
  for (const [id, d] of s3.drawnPeople) {
    const p = s3.project(d.x, (d.floor + d.top) / 2, d.y);
    if (!p) continue;
    const dd = Math.hypot(p.x - w / 2, p.y - h / 2);
    if (dd < bd) {
      bd = dd;
      best = id;
    }
  }
  return best;
}

/** The household to halo: a selected household, else the selected / followed person's household. */
function highlightHousehold(): string | null {
  const sel = store.selection;
  if (sel?.kind === 'household') return sel.id;
  const pid = sel?.kind === 'person' ? sel.id : store.followId;
  return pid ? store.sim.world.people[pid]?.householdId ?? null : null;
}

export function MapCanvas() {
  const st = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const controlsRef = useRef<Controls | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; title: string; sub: string; color?: string; hh?: string } | null>(null);
  const dragRef = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean; g?: { x: number; y: number } | null; rx?: number; ry?: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current!;
    const gl = glRef.current!;
    const host = hostRef.current!;
    const ctx = canvas.getContext('2d')!;
    const renderer = new Renderer();
    rendererRef.current = renderer;
    let raf = 0;
    let last = performance.now();
    let lastNight = -1;
    let simOwned = false;
    let fpsAccum = 0;
    let fpsN = 0;
    let simMinAccum = 0;
    let lastReport = last;
    // The mouse, keyboard and a game controller, Unreal's viewport way (see lib/controls.ts), applied each frame.
    const controls = new Controls({
      in3d,
      groundAt: (sx, sy) => scene3d.current?.groundAt(sx, sy) ?? null,
      following: () => !!store.followId,
      pickCentre: () => {
        const pid = in3d() ? personAtCentre() : null;
        if (pid) {
          store.select({ kind: 'person', id: pid }, { focus: false });
          return;
        }
        const cam = store.camera;
        for (const b of Object.values(store.sim.world.buildings)) {
          if (cam.x >= b.x && cam.x <= b.x + b.w && cam.y >= b.y && cam.y <= b.y + b.h) {
            store.select(b.householdId ? { kind: 'household', id: b.householdId } : { kind: 'building', id: b.id }, { focus: false });
            return;
          }
        }
      },
      back: () => {
        if (store.followId) {
          store.followId = null;
          store.bump();
        } else if (store.selection) store.select(null);
        else store.drillOut();
      },
      follow: () => {
        const sel = store.selection;
        if (sel?.kind === 'person') store.select(sel, { follow: !store.followId, focus: true });
      },
      toggle3d: () => store.set('view3d', !store.view3d),
      toggleRun: () => store.toggle(),
      toggleLegend: () => store.set('legendOpen', !store.legendOpen),
      took: () => {
        store.followId = null;
        store.camera.flight = null;
      },
      say: (t) => store.say(t),
    });
    controlsRef.current = controls;
    const resize = () => {
      const r = host.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(r.width * dpr));
      canvas.height = Math.max(1, Math.floor(r.height * dpr));
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      store.setViewport(r.width, r.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const before = store.sim.world.minute;
      store.advanceFrame(dt);
      simMinAccum += store.sim.world.minute - before;
      dialogueTick();
      const cam: Camera = store.camera;
      controls.frame(cam, store.viewport.h, dt);
      // Automation / console hook, beside the store (see main.tsx): the controls, once the hook exists.
      const hookC = (window as unknown as { communityLab?: Record<string, unknown> }).communityLab;
      if (hookC && hookC.controls !== controls) {
        hookC.controls = controls;
        hookC.scene3dState = scene3d;
      }
      // follow
      if (store.followId) {
        const p = store.sim.world.people[store.followId];
        if (p && p.alive && !p.emigrated) {
          cam.tx = p.loc.x;
          cam.ty = p.loc.y;
        } else store.followId = null;
      }
      easeCamera(cam, dt);
      store.updateDrill();
      const w = store.viewport.w;
      const h = store.viewport.h;
      const cal = calendarForDay(store.startMs, store.sim.world.day);
      // Past the bare floor the map becomes a 3D scene: fetch it as the zoom approaches, fade it in, then let it carry the picture.
      if (store.view3d && !scene3d.current && !scene3d.loading && !scene3d.failed && cam.zoom > FADE_FROM * 0.7) {
        scene3d.loading = true;
        import('../render3d/scene3d')
          .then((m) => {
            scene3d.current = new m.Scene3D(gl, store.sim.world);
            // Automation / console hook, beside the store (see main.tsx).
            const hook = (window as unknown as { communityLab?: Record<string, unknown> }).communityLab;
            if (hook) hook.scene3d = scene3d.current;
          })
          .catch((err) => {
            console.error('3D view unavailable', err);
            scene3d.failed = true;
          })
          .finally(() => (scene3d.loading = false));
      }
      const a = store.view3d && scene3d.current ? blend3d(cam.zoom) : 0;
      let overlay: Map<string, { feet: { x: number; y: number }; head: { x: number; y: number } }> | null = null;
      let overlayBuildings: Array<{ id: string; x: number; y: number }> | null = null;
      if (a > 0 && scene3d.current) {
        const s3 = scene3d.current;
        if (gl.style.display !== 'block') gl.style.display = 'block';
        const { singers, speakers } = voices();
        const sel = store.selection;
        s3.update({
          world: store.sim.world,
          cam,
          w,
          h,
          dpr: Math.min(2, window.devicePixelRatio || 1),
          dt,
          micro: store.sim.micro,
          selectionId: sel?.kind === 'person' ? sel.id : null,
          hoverId: store.hover.personId,
          followId: store.followId,
          highlightHouseholdId: highlightHousehold(),
          dayOfYear: cal.dayOfYear,
          latitude: store.sim.world.meta.latitude,
          singers,
          speakers,
          timeScale: store.running ? store.speed.minutesPerSecond * 60 : 0,
        });
        s3.render();
        if (a >= 0.999) {
          overlay = new Map();
          for (const [id, d] of s3.drawnPeople) {
            const feet = s3.project(d.x, d.floor, d.y);
            const head = s3.project(d.x, d.top + 0.1, d.y);
            if (feet && head) overlay.set(id, { feet, head });
          }
          // Name the buildings in view, nearest the centre first, over their entrance (houses only up close).
          const named: Array<{ id: string; x: number; y: number; d: number }> = [];
          for (const b of Object.values(store.sim.world.buildings)) {
            if (b.kind === 'runway' || (b.kind === 'house' && cam.zoom < 14)) continue;
            const e = b.door ?? b.entrance;
            const d = Math.hypot(e.x - cam.x, e.y - cam.y);
            if (d > s3.radius * 1.1) continue;
            const p = s3.project(e.x, b.kind === 'house' ? 3.4 : 4.4, e.y);
            if (p) named.push({ id: b.id, x: p.x, y: p.y, d });
          }
          overlayBuildings = named.sort((a, b) => a.d - b.d);
        }
      } else if (gl.style.display !== 'none') gl.style.display = 'none';
      canvas.style.opacity = a > 0 && !overlay ? String(1 - a) : '1';
      // While the 3D view carries the picture, the floating chrome frosts over (see styles.css, data-scene).
      const scene = a >= 0.5 ? '3d' : '';
      if ((document.documentElement.dataset.scene ?? '') !== scene) {
        if (scene) document.documentElement.dataset.scene = scene;
        else delete document.documentElement.dataset.scene;
      }
      // The UI theme follows the sim's daylight: light by day, dark by night,
      // blended through dawn and dusk via the --night variable — unless the
      // user pinned a static theme in the settings.
      const nd = Math.round(nightDarkness(store.sim.world.meta.latitude, cal.dayOfYear, store.sim.world.minuteOfDay) * 100) / 100;
      if (isSimTheme()) {
        if (!simOwned) {
          simOwned = true;
          lastNight = -1; // reclaim from a static choice: repaint immediately
        }
        if (nd !== lastNight) {
          lastNight = nd;
          const el = document.documentElement;
          el.style.setProperty('--night', String(nd));
          el.setAttribute('data-theme', nd > 0.55 ? 'dark' : 'light');
        }
      } else simOwned = false;
      renderer.draw(ctx, {
        world: store.sim.world,
        camera: cam,
        w,
        h,
        dpr: Math.min(2, window.devicePixelRatio || 1),
        micro: store.sim.micro,
        selection: store.selection,
        highlightHouseholdId: highlightHousehold(),
        hoverId: store.hover.personId,
        followId: store.followId,
        dayOfYear: cal.dayOfYear,
        latitude: store.sim.world.meta.latitude,
        realNow: now,
        showLabels: true,
        overlay,
        overlayBuildings,
      }, dt);
      fpsAccum += dt;
      fpsN++;
      if (now - lastReport > 1000) {
        store.achieved = simMinAccum / ((now - lastReport) / 1000);
        simMinAccum = 0;
        lastReport = now;
        fpsAccum = 0;
        fpsN = 0;
      }
      store.maybeTick(now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      controlsRef.current = null;
    };
  }, []);

  // Pointer interaction
  const hitPerson = (sx: number, sy: number): string | null => {
    const s3 = scene3d.current;
    if (s3 && in3d()) {
      // The nearest drawn body to the pointer: distance to the line from the feet to the head, on screen.
      let best: string | null = null;
      let bd = 22;
      for (const [id, d] of s3.drawnPeople) {
        const a = s3.project(d.x, d.floor + 0.1, d.y);
        const b = s3.project(d.x, d.top, d.y);
        if (!a || !b) continue;
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const L = vx * vx + vy * vy || 1;
        const u = Math.max(0, Math.min(1, ((sx - a.x) * vx + (sy - a.y) * vy) / L));
        const dd = Math.hypot(sx - (a.x + vx * u), sy - (a.y + vy * u));
        if (dd < bd) {
          bd = dd;
          best = id;
        }
      }
      return best;
    }
    const cam = store.camera;
    const { w, h } = store.viewport;
    const wp = toWorld(cam, w, h, sx, sy);
    const tol = Math.max(2.2, 10 / cam.zoom);
    let best: string | null = null;
    let bd = tol;
    for (const p of alivePeople(store.sim.world)) {
      if (p.away || p.inVehicleId) continue;
      const d = Math.hypot(p.loc.x - wp.x, p.loc.y - wp.y);
      if (d < bd) {
        bd = d;
        best = p.id;
      }
    }
    return best;
  };
  /** The map point under a screen point: through the 3D camera when it is showing. */
  const worldAt = (sx: number, sy: number): { x: number; y: number } => {
    const s3 = scene3d.current;
    if (s3 && in3d()) {
      const g = s3.groundAt(sx, sy);
      if (g) return g;
    }
    const { w, h } = store.viewport;
    return toWorld(store.camera, w, h, sx, sy);
  };
  const hitBuilding = (sx: number, sy: number): string | null => {
    const wp = worldAt(sx, sy);
    for (const id in store.sim.world.buildings) {
      const b = store.sim.world.buildings[id];
      if (pointInRect(wp.x, wp.y, b.x, b.y, b.w, b.h)) return id;
    }
    return null;
  };
  /** Which city, centre zone or airfield a screen point is over, for the province-level tooltip. */
  const hitZone = (sx: number, sy: number): { title: string; sub: string } | null => {
    const wp = worldAt(sx, sy);
    const com = communityAt(wp.x, wp.y);
    if (com) {
      const c = COMMUNITY[com];
      const city = CITY[c.city];
      return { title: c.name, sub: `${c.tier === 'civic' ? city.kind === 'centre' ? 'Unity Centre' : city.kind === 'airport' ? city.blurb : `${city.name}'s civic centre` : `${c.tier} · ${city.name}`}` };
    }
    const city = cityAt(wp.x, wp.y);
    return city ? { title: CITY[city].name, sub: CITY[city].blurb } : null;
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    store.camera.flight = null;
    const el = e.currentTarget;
    // (the middle button must not start the browser's own autoscroll)
    if (e.button === 1) e.preventDefault();
    // In the 3D view the buttons are Unreal's: the controls take the press (a plain left click still picks, on release).
    if (controlsRef.current?.press(e.nativeEvent, el)) {
      setTip(null);
      return;
    }
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* a pointer the browser does not know: the drag still works within the window */
    }
    const rect = el.getBoundingClientRect();
    const s3 = scene3d.current;
    const g = s3 && in3d() ? s3.groundAt(e.clientX - rect.left, e.clientY - rect.top) : null;
    dragRef.current = { x: e.clientX, y: e.clientY, cx: store.camera.tx, cy: store.camera.ty, moved: false, g, rx: store.camera.x, ry: store.camera.y };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const c = controlsRef.current;
    if (c?.dragging) {
      c.move(e.nativeEvent);
      if (!dragging) setDragging(true);
      return;
    }
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        dragRef.current.moved = true;
        setDragging(true);
        store.followId = null;
        const d = dragRef.current;
        const s3 = scene3d.current;
        const g = d.g && s3 && in3d() ? s3.groundAt(sx, sy) : null;
        if (d.g && g && s3) {
          // Where the pointer would be over the ground had the camera stayed put since the press; move by the difference.
          const gx = g.x - (s3.lookX - (d.rx ?? 0));
          const gy = g.y - (s3.lookY - (d.ry ?? 0));
          store.camera.tx = (d.rx ?? 0) + (d.g.x - gx);
          store.camera.ty = (d.ry ?? 0) + (d.g.y - gy);
        } else {
          store.camera.tx = d.cx - dx / store.camera.zoom;
          store.camera.ty = d.cy - dy / store.camera.zoom;
        }
        store.camera.x = store.camera.tx;
        store.camera.y = store.camera.ty;
      }
      return;
    }
    const pid = hitPerson(sx, sy);
    store.hover = { x: sx, y: sy, personId: pid };
    if (pid) {
      const p = store.sim.world.people[pid];
      const a = p.plan[p.planIdx];
      const hh = store.sim.world.households[p.householdId];
      const house = hh ? store.sim.world.buildings[hh.houseId] : null;
      setTip({ x: sx + 14, y: sy + 14, title: `${p.firstName} ${p.surname}`, sub: `${p.age} · ${p.sex === 'M' ? 'male' : 'female'} · ${JOBS[p.job]?.label ?? p.job} · ${p.archetype}${a ? ` · ${a.label}` : ''}${p.health.state !== 'healthy' ? ` · ${p.health.state}` : ''}`, color: plotColor(house?.plot, isDarkTheme()), hh: hh ? `${hh.name} household · plot ${house?.plot ?? '?'}` : undefined });
    } else {
      const bid = hitBuilding(sx, sy);
      if (bid) {
        const b = store.sim.world.buildings[bid];
        const inside = alivePeople(store.sim.world).filter((q) => q.loc.buildingId === bid && !q.away).length;
        setTip({ x: sx + 14, y: sy + 14, title: b.name, sub: `${b.kind} · ${COMMUNITY[b.community].name}${inside ? ` · ${inside} inside` : ''}${b.householdId ? ` · ${store.sim.world.households[b.householdId]?.memberIds.length ?? 0} residents` : ''}` });
      } else if (store.drill === 'province' || store.drill === 'city') {
        const z = hitZone(sx, sy);
        if (z) setTip({ x: sx + 14, y: sy + 14, title: z.title, sub: z.sub });
        else setTip(null);
      } else setTip(null);
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = controlsRef.current;
    if (c?.dragging) {
      const click = c.release(e.nativeEvent);
      if (c.dragging) return; // one of two buttons let go: the drag goes on
      setDragging(false);
      // A right or middle click on its own does nothing here (Unreal's context menu is not ours).
      if (!click || e.button !== 0) return;
    } else {
      const d = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      if (!d || d.moved) return;
    }
    // Click outside the analytics drawer dismisses it (this click does nothing else).
    if (store.drawerTab) {
      store.openDrawer(null);
      return;
    }
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const pid = hitPerson(sx, sy);
    if (pid) {
      const p = store.sim.world.people[pid];
      if (p.conversationId && store.camera.zoom >= 6) store.select({ kind: 'conversation', id: p.conversationId }, { focus: false });
      else store.select({ kind: 'person', id: pid }, { focus: false });
      return;
    }
    const bid = hitBuilding(sx, sy);
    if (bid) {
      const b = store.sim.world.buildings[bid];
      store.select(b.householdId ? { kind: 'household', id: b.householdId } : { kind: 'building', id: bid }, { focus: false });
      return;
    }
    store.select(null);
  };
  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const pid = hitPerson(sx, sy);
    if (pid) {
      store.select({ kind: 'person', id: pid }, { follow: true });
      const p = store.sim.world.people[pid];
      focusPoint(store.camera, p.loc.x, p.loc.y, 16);
      store.bump();
      return;
    }
    const bid = hitBuilding(sx, sy);
    if (bid) {
      const b = store.sim.world.buildings[bid];
      store.followId = null;
      focusRect(store.camera, store.viewport.w, store.viewport.h, b.x, b.y, b.w, b.h, 1.25);
      store.select(b.householdId ? { kind: 'household', id: b.householdId } : { kind: 'building', id: bid });
    }
  };
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    // In the 3D view the wheel dollies toward the ground under the cursor (or, with a button held, sets the camera speed), Unreal's way.
    if (controlsRef.current?.wheel(e.nativeEvent, e.currentTarget)) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    store.followId = null;
    zoomAt(store.camera, store.viewport.w, store.viewport.h, e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0016));
  };

  const world = st.sim.world;
  const fit = fitWorld(st.viewport.w, st.viewport.h);
  const sel = st.selection;
  const selPerson = sel?.kind === 'person' ? world.people[sel.id] : st.followId ? world.people[st.followId] : null;
  const houseName = (() => {
    if (selPerson?.loc.buildingId) return world.buildings[selPerson.loc.buildingId]?.name;
    if (sel?.kind === 'household') return world.buildings[world.households[sel.id]?.houseId ?? '']?.name;
    if (sel?.kind === 'building') return world.buildings[sel.id]?.name;
    return null;
  })();
  const drill = st.drill;
  const crumbCommunity = (() => {
    const bId = selPerson?.loc.buildingId ?? (sel?.kind === 'household' ? world.households[sel.id]?.houseId : sel?.kind === 'building' ? sel.id : null);
    const viaSel = bId ? world.buildings[bId]?.community : null;
    return viaSel ?? communityAt(st.camera.x, st.camera.y) ?? null;
  })();
  const crumbCity = crumbCommunity ? COMMUNITY[crumbCommunity].city : cityAt(st.camera.x, st.camera.y);
  const flyTo = (x: number, y: number, w: number, h: number, pad: number) => { store.followId = null; flyToRect(store.camera, st.viewport.w, st.viewport.h, x, y, w, h, pad); store.bump(); };
  return (
    <div className="stage" ref={hostRef}>
      <canvas ref={glRef} className="gl" aria-hidden style={{ display: 'none' }} />
      <canvas ref={canvasRef} className={dragging ? 'dragging' : ''} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => setTip(null)} onDoubleClick={onDoubleClick} onWheel={onWheel} onContextMenu={(e) => e.preventDefault()} />
      <div className="hud">
        <div className="crumb">
          <button className={drill === 'province' ? 'on' : ''} onClick={() => { store.resetCamera(); store.bump(); }} title="Bird's-eye view of the whole province">
            <Home size={12} /> Province
          </button>
          {crumbCity && (drill !== 'province' || houseName) && (
            <>
              <span className="sep">›</span>
              <button className={drill === 'city' ? 'on' : ''} onClick={() => { const c = CITY[crumbCity]; flyTo(c.x, c.y, c.w, c.h, 1.08); }} title={`Fit ${CITY[crumbCity].name}`}>
                {CITY[crumbCity].short}
              </button>
            </>
          )}
          {crumbCommunity && (drill === 'community' || drill === 'house' || drill === 'person' || houseName) && (
            <>
              <span className="sep">›</span>
              <button className={drill === 'community' ? 'on' : ''} onClick={() => { const c = COMMUNITY[crumbCommunity]; store.followId = null; focusRect(store.camera, st.viewport.w, st.viewport.h, c.x, c.y, c.w, c.h, 1.12); store.bump(); }} title={`Fit ${COMMUNITY[crumbCommunity].name}`}>
                {COMMUNITY[crumbCommunity].short}
              </button>
            </>
          )}
          {houseName && (
            <>
              <span className="sep">›</span>
              <button className={drill === 'house' ? 'on' : ''} onClick={() => { const b = selPerson?.loc.buildingId ? world.buildings[selPerson.loc.buildingId] : sel?.kind === 'household' ? world.buildings[world.households[sel.id]?.houseId ?? ''] : sel?.kind === 'building' ? world.buildings[sel.id] : null; if (b) { store.followId = null; focusRect(store.camera, st.viewport.w, st.viewport.h, b.x, b.y, b.w, b.h, 1.25); store.bump(); } }}>
                {houseName}
              </button>
            </>
          )}
          {selPerson && (
            <>
              <span className="sep">›</span>
              <button className={drill === 'person' ? 'on' : ''} onClick={() => { store.select({ kind: 'person', id: selPerson.id }, { follow: true }); focusPoint(store.camera, selPerson.loc.x, selPerson.loc.y, 16); }}>
                {selPerson.firstName} {selPerson.surname}
              </button>
            </>
          )}
        </div>
        <span className="overlay-note mono" title="Simulated time per real second, as achieved">{fmtSpeed(st.achieved)}{st.sim.micro ? ' · animated' : ' · time-lapse'} · zoom {(st.camera.zoom / fit).toFixed(1)}×</span>
        {aiStatus.inflight > 0 && <span className="overlay-note"><span className="led busy" /> AI scripting…</span>}
        {aiStatus.lastError && aiStatus.inflight === 0 && <span className="overlay-note err" title={aiStatus.lastError}>AI: {aiStatus.lastError.slice(0, 60)}</span>}
      </div>
      <div className="hud-right">
        <div className="zoomctl">
          <button onClick={() => zoomAt(store.camera, st.viewport.w, st.viewport.h, st.viewport.w / 2, st.viewport.h / 2, 1.6)} title="Zoom in">+</button>
          <button onClick={() => zoomAt(store.camera, st.viewport.w, st.viewport.h, st.viewport.w / 2, st.viewport.h / 2, 1 / 1.6)} title="Zoom out">−</button>
          <button onClick={() => { store.resetCamera(); store.bump(); }} title="Fit the province">⌂</button>
          <button className={st.view3d ? 'on' : ''} onClick={() => store.set('view3d', !st.view3d)} title={st.view3d ? 'Zooming in past the rooms turns the map into a 3D scene (click for the flat map only)' : 'The flat map at every zoom (click to let close zoom become 3D)'}>3D</button>
          <button className={st.followId ? 'on' : ''} onClick={() => { if (st.followId) { store.followId = null; store.bump(); } else if (sel?.kind === 'person') store.select(sel, { follow: true, focus: true }); }} title="Follow the selected person (F)"><Target size={13} /></button>
          <span className="divider" aria-hidden />
          {CITIES.filter((c) => c.kind === 'city' || c.kind === 'airport').map((c) => {
            const Icon = c.id === 'emmaus' ? Church : c.id === 'newhaven' ? Trees : c.id === 'airport' ? Plane : Bus;
            const here = drill !== 'province' && cityAt(st.camera.x, st.camera.y) === c.id;
            return (
              <button key={c.id} className={`fly ${here ? 'on' : ''}`} aria-label={`Fly to ${c.name}`} onClick={() => flyTo(c.x, c.y, c.w, c.h, 1.08)}>
                <Icon size={13} />
                <span className="fly-label">{c.name} — {c.blurb}</span>
              </button>
            );
          })}
          <span className="divider" aria-hidden />
          {(['cbd', 'precinct', 'campus'] as const).map((id) => {
            const c = COMMUNITY[id];
            const Icon = id === 'cbd' ? Tower : id === 'precinct' ? Stadium : Hospital;
            const here = drill !== 'province' && communityAt(st.camera.x, st.camera.y) === id;
            return (
              <button key={id} className={`fly ${here ? 'on' : ''}`} aria-label={`Fly to ${c.name}`} onClick={() => flyTo(c.x, c.y, c.w, c.h, 1.12)}>
                <Icon size={13} />
                <span className="fly-label">{c.name}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="hud-bottom">
        {st.legendOpen ? <Legend /> : (
          <button className="legend-toggle" onClick={() => store.set('legendOpen', true)} title="Show the legend (L)">
            legend
          </button>
        )}
      </div>
      {st.notice && performance.now() - st.notice.at < 5000 && <div className="toast">{st.notice.text}</div>}
      {tip && (
        <div className="tooltip" style={{ left: Math.min(tip.x, st.viewport.w - 240), top: Math.min(tip.y, st.viewport.h - 60) }}>
          <div className="t">{tip.title}</div>
          <div className="muted">{tip.sub}</div>
          {tip.hh && (
            <div className="row" style={{ gap: 5, marginTop: 2 }}>
              <span className="hh-chip" style={{ background: tip.color }} /> <span className="muted">{tip.hh}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function fmtSpeed(minPerSec: number): string {
  if (minPerSec < 1 / 60) return 'paused';
  if (minPerSec < 1) return `${(minPerSec * 60).toFixed(0)}× real time`;
  if (minPerSec < 60) return `${minPerSec.toFixed(0)} min/s`;
  if (minPerSec < 1440) return `${(minPerSec / 60).toFixed(1)} h/s`;
  if (minPerSec < 1440 * 30) return `${(minPerSec / 1440).toFixed(1)} d/s`;
  if (minPerSec < 1440 * 365) return `${(minPerSec / 1440 / 30.44).toFixed(1)} mo/s`;
  return `${(minPerSec / 1440 / 365.25).toFixed(2)} yr/s`;
}
