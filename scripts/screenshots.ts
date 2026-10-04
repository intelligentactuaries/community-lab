// The README's pictures (docs/media/*.png), taken from the running app, each the scene its caption describes:
//
//   bun run dev                                     # the dev pair, UI on http://localhost:5195/
//   bun scripts/screenshots.ts [url] [out-dir]      # defaults: http://localhost:5195/ and docs/media
//
// The flat map at every zoom (the README describes the plan views; the 3D close-up has its own pictures in the
// manual), 1600 × 1000, the light theme, en-GB dates. The script logs what each caption claims (the airport's two
// aircraft, a train leaving a station, the service under way) so a moment that did not hold is seen before the
// pictures are committed. `SHOTS=airport,hyperline` saves only those (the clock still runs through every scene).

import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.argv[2] ?? 'http://localhost:5195/';
const OUT = process.argv[3] ?? 'docs/media';
const ONLY = process.env.SHOTS ? new Set(process.env.SHOTS.split(',')) : null;
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  protocolTimeout: 600_000,
  env: { ...process.env, LANG: 'en_GB.UTF-8', LANGUAGE: 'en_GB', LC_ALL: 'en_GB.UTF-8' },
  args: ['--no-sandbox', '--lang=en-GB', '--force-color-profile=srgb', '--font-render-hinting=none', '--window-size=1600,1000'],
});
const page = await browser.newPage();
await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-GB' });
await page.evaluateOnNewDocument(() => {
  try {
    if (!sessionStorage.getItem('readme-shots')) {
      localStorage.clear();
      sessionStorage.setItem('readme-shots', '1');
    }
    localStorage.setItem('ia.theme', 'light');
  } catch {
    /* storage unavailable */
  }
});
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String((e as Error).message)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const run = <T = unknown>(code: string) => page.evaluate(`(() => { const s = window.communityLab.store; ${code} })()`) as Promise<T>;
const clock = () => run<string>(`const c = s.cal(); return c.isoDate + ' ' + String(Math.floor(s.sim.world.minuteOfDay / 60)).padStart(2, '0') + ':' + String(s.sim.world.minuteOfDay % 60).padStart(2, '0');`);
const shot = async (name: string, settle = 1200) => {
  if (ONLY && !ONLY.has(name)) return;
  await sleep(settle);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`shot ${name} · ${await clock()}`);
};
const want = (name: string) => !ONLY || ONLY.has(name);
const fly = (label: string) => page.evaluate((l) => (document.querySelector(`button.fly[aria-label="Fly to ${l}"]`) as HTMLElement | null)?.click(), label);

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 90_000 });
await page.waitForSelector('canvas');
await page.waitForFunction('!!window.communityLab');
await sleep(1500);

// The flat map at every zoom, both side panels closed. The pictures follow one province through time, as the first
// set did: its first fortnight (the province scenes), a Sunday four months in (the church, a household, the scene
// controls), and three years later (the analytics and the finance workspace).
await run(`s.pause(); try { s.set('view3d', false); } catch {} s.set('sidebarOpen', false); s.set('inspectorOpen', false); s.bump();`);
await sleep(800);

// 1. The Hyperline leaving Ithemba on the first Tuesday morning, when most households are out and their plots greyed:
//    wait for a train standing at the station, slow to real time, and take it as it pulls away (at real time a hop
//    lasts long enough to be seen; faster, it is a single frame).
if (want('hyperline')) {
  await run(`s.jumpToWeekday(2, 10 * 60);
    const st = s.sim.world.buildings['st-ithemba'];
    s.followId = null; s.camera.x = s.camera.tx = st.x + st.w / 2 + 380; s.camera.y = s.camera.ty = st.y + st.h / 2 - 160; s.camera.zoom = s.camera.tzoom = 1.1;
    s.setSpeed('x60'); s.play();`);
  const standing = `const st = s.sim.world.buildings['st-ithemba']; return Object.values(s.sim.world.vehicles).find((v) => v.kind === 'train' && Math.hypot(v.x - (st.x + st.w / 2), v.y - (st.y + st.h / 2)) < 160);`;
  let atStation = false;
  for (let i = 0; i < 600 && !atStation; i++) {
    atStation = await run<boolean>(`const v = (() => { ${standing} })(); return !!v && !v.moving;`);
    if (!atStation) await sleep(50);
  }
  await run(`s.setSpeed('realtime');`);
  let left = false;
  for (let i = 0; i < 3000 && !left; i++) {
    left = await run<boolean>(`return Object.values(s.sim.world.vehicles).some((v) => v.kind === 'train' && v.moving && (v.speed ?? 0) > 1000 && Math.hypot(v.x - (s.sim.world.buildings['st-ithemba'].x + 40), v.y - (s.sim.world.buildings['st-ithemba'].y + 30)) < 900);`);
    if (!left) await sleep(50);
  }
  console.log(`  a train leaving Ithemba: ${left ? 'yes' : 'NOT CAUGHT'} (${atStation ? 'it stood at the station first' : 'none stood at the station'})`);
  if (left) await shot('hyperline', 250);
  await run(`s.pause();`);
}

// 2. The CBD at 10:30 on the first Saturday.
await run(`s.pause(); s.jumpToWeekday(6, 10 * 60 + 29); s.setSpeed('x60'); s.play();`);
if (want('unity-centre')) {
  await fly('Unity CBD');
  await sleep(1000);
  await run(`s.setSpeed('x10');`);
  await shot('unity-centre', 2500);
}

// 3. The province later that morning.
await run(`s.pause(); s.jumpBy(Math.max(0, 10 * 60 + 40 - s.sim.world.minuteOfDay)); s.resetCamera(); s.setSpeed('x60'); s.play();`);
await shot('region', 4000);

// 4. The airport at 09:12 the next Tuesday: the 09:10 departure taxiing out, the other aircraft on its stand. Framed on
//    the terminal and its apron, with the station, the bus stop, the tower, the hangar, the fire station and the runway.
if (want('airport')) {
  // Land at 09:11: the departure pushes back on the first minute tick at or after its time, which a jump landing at
  // 09:12 would not see until 09:13.
  await run(`s.pause(); s.jumpToWeekday(2, 9 * 60 + 11);
    const t = s.sim.world.buildings['ap-terminal'];
    s.followId = null; s.camera.x = s.camera.tx = t.x + t.w; s.camera.y = s.camera.ty = t.y + t.h * 0.94; s.camera.zoom = s.camera.tzoom = 3.04;
    s.setSpeed('x60'); s.play();`);
  for (let i = 0; i < 200; i++) {
    const out = await run<boolean>(`return s.sim.world.minuteOfDay >= 9 * 60 + 12.2 && Object.values(s.sim.world.vehicles).some((v) => v.kind === 'plane' && v.moving && !v.airborne);`);
    if (out) break;
    await sleep(50);
  }
  await run(`s.setSpeed('x10');`);
  const planes = await run<string>(`return Object.values(s.sim.world.vehicles).filter((v) => v.kind === 'plane').map((v) => (v.airborne ? 'airborne' : v.moving ? 'taxiing' : 'on its stand')).join(', ');`);
  console.log(`  the aircraft at ${await clock()}: ${planes}`);
  await shot('airport', 300);
}

// 5. The Sunday service, four months in: the pastor preaching, the congregation in the pews.
await run(`s.pause(); s.jumpTo('2026-05-10', 9 * 60 + 40); s.select({ kind: 'building', id: 'church' }, { focus: true }); s.setSpeed('x60'); s.play();`);
await sleep(3200);
const service = await run<string>(`const w = s.sim.world; const p = w.people[w.roles.pastorId]; const c = p && p.conversationId ? w.conversations[p.conversationId] : null; const inside = Object.values(w.people).filter((q) => q.alive && q.loc.buildingId === 'church').length; return (p ? p.firstName : 'no pastor') + ' · ' + (c ? c.topic + ' · ' + c.lines.length + ' lines' : 'not speaking') + ' · ' + inside + ' in the church';`);
console.log(`  the service: ${service}`);
await shot('service', 200);

// 6. Directing the scene, over the province in daylight (the panel is glass: over the evening map it reads dim).
await run(`s.pause(); s.select(null); s.resetCamera(); s.setScene(true);`);
await shot('scene', 1400);
await run(`s.setScene(false);`);

// 7. Fellowship afterwards, in the hall.
await run(`
  const w = s.sim.world;
  s.jumpBy((11 * 60 + 14) - w.minuteOfDay);
  const r = w.buildings.church.rooms.find((x) => x.id === 'church-hall');
  s.camera.tx = r.x + r.w / 2; s.camera.ty = r.y + r.h / 2; s.camera.tzoom = 11; s.play();
`);
await shot('fellowship', 3200);

// 8. A household at dinner that evening, with the inspector.
await run(`
  s.pause();
  const w = s.sim.world;
  s.jumpBy((18 * 60 + 40) - w.minuteOfDay);
  const hh = Object.values(w.households).filter((h) => !h.dissolvedDay && h.memberIds.length).sort((a, b) => b.memberIds.length - a.memberIds.length)[0];
  s.set('inspectorOpen', true); s.select({ kind: 'household', id: hh.id }, { focus: true });
  s.play();
`);
await shot('household', 4000);

// Three years on: the analytics and the books want history.
await run(`s.pause(); s.select(null); s.set('inspectorOpen', false); const e = s.jumpTo('2029-05-09', 0); if (e) throw new Error(e); s.bump();`);
await sleep(1000);

// 9. Mortality A/E, full screen.
await run(`s.openDrawer('mortality'); s.setDrawerFull(true);`);
await shot('analytics', 1800);

// 10–14. The finance workspace.
await run(`s.openFinance('micro'); s.setDrawerFull(true);`);
await shot('economy-micro', 1800);
await run(`s.setFinance({ section: 'macro' });`);
await shot('economy-macro', 1800);
await run(`s.setFinance({ section: 'bank' });`);
await shot('bank', 1800);
await run(`s.setFinance({ section: 'tax' });`);
await shot('tax', 1800);
await run(`s.setFinance({ section: 'books', entity: 'market' });`);
await sleep(800);
await page.evaluate(() => (document.querySelectorAll('.books-head .tab')[6] as HTMLElement | undefined)?.click());
await shot('books', 1500);

console.log(errors.length ? `console errors: ${errors.slice(0, 5).join(' | ')}` : 'no console errors');
await browser.close();
