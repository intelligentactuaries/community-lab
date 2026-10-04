/// <reference lib="webworker" />
// A live province in a worker: the page sends a basis and a speed, and gets
// the layout once and a snapshot every frame (positions as a transferable
// Float32Array), with the lab's indicators each simulated month. The same
// engine and the same day-step pipeline as the IDE, so the figures a page
// shows are the engine's own.
//
//   page → worker   { type: 'init', params?, minutesPerSecond? }
//                   { type: 'speed', minutesPerSecond } | { type: 'pause' } | { type: 'play' }
//                   { type: 'jump', minute }            (forward only; the days between are lived)
//                   { type: 'rebuild', params? }
//   worker → page   { type: 'ready', layout, snapshot }
//                   { type: 'frame', snapshot }
//                   { type: 'indicators', values, date }
//                   { type: 'error', message }

import { createProvince, type ScenarioParams } from './engine';

declare const self: DedicatedWorkerGlobalScope;

let province: ReturnType<typeof createProvince> | null = null;
let speed = 1;
let playing = true;
let last = 0;
let lastMonth = -1;
let timer: ReturnType<typeof setInterval> | null = null;

function frame(): void {
  if (!province) return;
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  try {
    if (playing && dt > 0) province.advance(speed * dt);
    const snap = province.snapshot();
    self.postMessage({ type: 'frame', snapshot: snap }, [snap.positions.buffer]);
    const month = Math.floor(snap.day / 30.44);
    if (month !== lastMonth) {
      lastMonth = month;
      self.postMessage({ type: 'indicators', values: province.indicators(), date: snap.date });
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    if (timer) clearInterval(timer);
    timer = null;
  }
}

function build(params?: Partial<ScenarioParams>): void {
  province = createProvince(params);
  lastMonth = -1;
  const snap = province.snapshot();
  self.postMessage({ type: 'ready', layout: province.layout(), snapshot: snap }, [snap.positions.buffer]);
  last = performance.now();
  if (!timer) timer = setInterval(frame, 1000 / 30);
}

self.onmessage = (e: MessageEvent) => {
  const m = e.data as { type: string; params?: Partial<ScenarioParams>; minutesPerSecond?: number; minute?: number };
  try {
    if (m.type === 'init' || m.type === 'rebuild') {
      if (typeof m.minutesPerSecond === 'number') speed = m.minutesPerSecond;
      build(m.params);
    } else if (m.type === 'speed' && typeof m.minutesPerSecond === 'number') speed = Math.max(0, m.minutesPerSecond);
    else if (m.type === 'pause') playing = false;
    else if (m.type === 'play') playing = true;
    else if (m.type === 'jump' && province && typeof m.minute === 'number') {
      province.jumpToMinute(m.minute);
      lastMonth = -1;
    } else if (m.type === 'stop' && timer) {
      clearInterval(timer);
      timer = null;
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
