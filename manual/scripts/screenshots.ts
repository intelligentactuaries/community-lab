// The manual's screenshots, taken from the running app, so every picture in the manual is the app as it is.
//
//   bun run build                                                  # the client the engine serves
//   PORT=3047 COMMUNITY_DATA_DIR=/tmp/cl-shots COMMUNITY_STATIC_DIR=dist bun src/server/index.ts &
//   bun manual/scripts/screenshots.ts http://127.0.0.1:3047 /tmp/cl-shots
//
// The second argument is a folder for the sample workspace the workbench's picture runs in. The engine should be one
// of its own (its own data folder), so the shots neither read nor change the workspace you work in. The browser is
// headless Chrome on the real GPU, which the 3D close-up needs.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer, { type Page } from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3047';
const WS_PARENT = process.argv[3];
const OUT = join(import.meta.dir, '..', 'docs', 'assets', 'img');
const ONLY = process.env.SHOTS ? new Set(process.env.SHOTS.split(',')) : null;
mkdirSync(OUT, { recursive: true });

const W = 1440;
const H = 900;

if (WS_PARENT) {
  const ws = (await (await fetch(`${BASE}/api/workspace`)).json()) as { root: string | null };
  if (!ws.root) await fetch(`${BASE}/api/workspace/create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parent: WS_PARENT }) });
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  protocolTimeout: 600_000,
  env: { ...process.env, LANG: 'en_GB.UTF-8', LANGUAGE: 'en_GB', LC_ALL: 'en_GB.UTF-8' },
  // en-GB, so the browser's own date and time fields read as the app does (16/02/2030, 10:44).
  args: ['--no-sandbox', '--lang=en-GB', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu', '--force-color-profile=srgb', '--font-render-hinting=none', `--window-size=${W},${H}`],
});
const page = await browser.newPage();
await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-GB' });
await page.evaluateOnNewDocument(() => {
  try {
    if (!sessionStorage.getItem('shots')) {
      localStorage.clear();
      sessionStorage.setItem('shots', '1');
    }
    localStorage.setItem('ia.theme', 'light');
  } catch {
    /* storage unavailable */
  }
});
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String((e as Error).message)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const run = (code: string) => page.evaluate(`(() => { const s = window.communityLab.store; ${code} })()`);

async function boxOf(p: Page, selector: string, pad = 0) {
  const b = await p.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, selector);
  if (!b) throw new Error(`no ${selector}`);
  const x = Math.max(0, b.x - pad);
  const y = Math.max(0, b.y - pad);
  return { x, y, width: Math.min(W - x, b.width + 2 * pad), height: Math.min(H - y, b.height + 2 * pad) };
}

async function shot(name: string, how: { settle?: number; clip?: string; pad?: number; rect?: { x: number; y: number; width: number; height: number } } = {}) {
  if (ONLY && !ONLY.has(name)) return;
  await sleep(how.settle ?? 1200);
  const clip = how.rect ?? (how.clip ? await boxOf(page, how.clip, how.pad ?? 0) : undefined);
  await page.screenshot({ path: join(OUT, `${name}.webp`), type: 'webp', quality: 86, ...(clip ? { clip } : {}) });
  console.log('shot', name);
}

await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 90_000 });
await page.waitForSelector('canvas');
await page.waitForFunction('!!window.communityLab');
await sleep(1500);

// A province that has lived twelve years: households formed and dissolved, the books with years closed, the
// experience with deaths in it, the committee's record.
await run(`s.pause(); s.sim.runDays(12 * 365 + 40); s.bump();`);
await sleep(800);

// The whole province on a Saturday morning, panels closed.
await run(`s.set('sidebarOpen', false); s.set('inspectorOpen', false); s.jumpToWeekday(6, 10 * 60 + 40); s.resetCamera(); s.setSpeed('x60'); s.play();`);
await shot('province', { settle: 4000 });

// Setting the scene.
await run(`s.pause(); s.setScene(true);`);
await shot('scene', { clip: '.scene', pad: 8 });
await run(`s.setScene(false);`);

// Inside a household at dinner, on the flat map, with the inspector.
await run(`
  s.set('view3d', false);
  const w = s.sim.world;
  s.jumpBy(((18 * 60 + 35) - w.minuteOfDay + 1440) % 1440);
  const hh = Object.values(w.households).filter((h) => !h.dissolvedDay && h.memberIds.length).sort((a, b) => b.memberIds.length - a.memberIds.length)[0];
  s.set('inspectorOpen', true);
  s.select({ kind: 'household', id: hh.id }, { focus: true });
  s.play();
`);
await shot('household', { settle: 4000 });

// The 3D close-up: the same household at dinner, close enough to see the people themselves, looking north over the
// house's low front wall into its rooms.
await run(`
  const w = s.sim.world;
  const hh = Object.values(w.households).filter((h) => !h.dissolvedDay && h.memberIds.length).sort((a, b) => b.memberIds.length - a.memberIds.length)[0];
  const b = w.buildings[hh.houseId];
  s.set('inspectorOpen', false); s.select(null);
  s.set('view3d', true);
  s.camera.tx = b.x + b.w / 2; s.camera.ty = b.y + b.h * 0.55; s.camera.tzoom = Number(${JSON.stringify(process.env.ZOOM3D ?? '70')});
  s.setSpeed('realtime'); s.play();
`);
// At street level the camera is low, so the near half of the frame is the front garden: keep the band with the house.
await shot('3d', { settle: 12000, rect: { x: 0, y: 150, width: W - 92, height: 380 } });
await run(`s.pause(); s.set('view3d', false); s.resetCamera(); s.set('view3d', true);`);
await sleep(1500);

// The Scenario panel.
await run(`s.select(null); s.set('inspectorOpen', false); s.set('sidebarOpen', true);`);
await sleep(400);
await page.evaluate(() => (document.querySelector('#sec-households') as HTMLElement | null)?.click());
await page.evaluate(() => (document.querySelector('#sec-events') as HTMLElement | null)?.click());
await page.evaluate(() => (document.querySelector('#sec-scenario') as HTMLElement | null)?.click());
await shot('scenario', { clip: '.sidebar' });
await run(`s.set('sidebarOpen', false);`);


// Mortality A/E, full screen.
await run(`s.openDrawer('mortality'); s.setDrawerFull(true);`);
await shot('analytics', { settle: 2000 });

// The finance workspace: micro, then the journal.
await run(`s.openFinance('micro'); s.setDrawerFull(true);`);
await shot('economy-micro', { settle: 2000 });
await run(`s.setFinance({ section: 'books', entity: 'market' });`);
await sleep(800);
await page.evaluate(() => (document.querySelectorAll('.books-head .tab')[6] as HTMLElement | undefined)?.click());
await shot('books', { settle: 1500 });

// The actuarial workbench: risk and solvency.
await run(`s.openDrawer('actuarial'); s.setActuarial({ section: 'risk' }); s.setDrawerFull(true);`);
await shot('actuarial', { settle: 3000 });

// Exports, docked.
await run(`s.setDrawerFull(false); s.openDrawer('exports');`);
await shot('exports', { settle: 1500 });

// The lab: a small SAM experiment on the engine's pool, then its result.
if (!ONLY || ONLY.has('lab')) {
  // The job runs on the engine's pool; this script waits on it, not the page.
  const spec = await (await fetch(`${BASE}/api/templates/sam-life-stresses?years=4`)).json();
  const job = (await (await fetch(`${BASE}/api/experiments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...spec, seeds: 8, years: 4 }) })).json()) as { id: string };
  for (;;) {
    await sleep(3000);
    const j = (await (await fetch(`${BASE}/api/experiments/${job.id}`)).json()) as { status: string };
    if (j.status !== 'running') break;
  }
  await run(`s.openDrawer('lab'); s.setDrawerFull(true);`);
  await sleep(2500);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tr.clickable')] as HTMLElement[];
    rows[0]?.click();
  });
  await sleep(2500);
  // Bring the result into view: the forest of effects and the table of every indicator.
  await page.evaluate(() => {
    const title = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent === 'Effects against the baseline');
    title?.closest('section, .card, .viz, div')?.scrollIntoView({ block: 'start' });
  });
  await shot('lab', { settle: 1500 });
}

// Settings, on the default theme (the province's daylight; it is morning, so light).
await page.evaluate(() => {
  localStorage.removeItem('ia.theme');
  window.dispatchEvent(new CustomEvent('ia:theme-change'));
});
await run(`s.setDrawerFull(false); s.openDrawer(null); s.set('settingsOpen', true);`);
await shot('settings', { clip: '.modal', settle: 1500 });
await run(`s.set('settingsOpen', false);`);

// The workbench: the sample's A/E by age, run.
if (!ONLY || ONLY.has('workbench')) {
  await run(`s.setView('workbench');`);
  await page.waitForSelector('.wb-node', { timeout: 30_000 });
  await sleep(1500);
  await page.evaluate(() => (document.querySelector('.wb-node[title="scripts/ae-by-age.js"]') as HTMLElement | null)?.click());
  await sleep(2500);
  await page.keyboard.down('Control');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Control');
  await page.waitForFunction(() => /Done|Failed/.test(document.querySelector('.wb-console')?.textContent ?? document.body.textContent ?? ''), { timeout: 180_000 });
  await shot('workbench', { settle: 2500 });
}

console.log(errors.length ? `console errors: ${errors.slice(0, 6).join(' | ')}` : 'no console errors');
await browser.close();
