// Produces the README image set into docs/media from the running dev app.
//   bun run dev            # in one terminal
//   bun scripts/screenshots.ts
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5175/';
const OUT = 'docs/media';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb', '--font-render-hinting=none'],
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.clear();
    localStorage.setItem('ia.theme', 'light');
  } catch {
    /* first run */
  }
});
await page.setViewport({ width: 1800, height: 950, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String((e as Error).message)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const run = (code: string) => page.evaluate(`(() => { ${code} })()`);
const shot = async (name: string, settle = 1200) => {
  await new Promise((r) => setTimeout(r, settle));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
};

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForSelector('canvas');

// A community that has lived a few years: households formed, events on the ledger.
await run(`const s = window.communityLab.store; s.sim.runDays(1500); s.bump();`);

// 1. The whole community on a Saturday morning, both panels closed: the market
//    is open, children are at the park, people are on the roads.
await run(`const s = window.communityLab.store; s.jumpToWeekday(6, 10 * 60 + 40); s.resetCamera(); s.setSpeed('x60'); s.play();`);
await shot('community', 4000);

// 2. Inside a house in the evening: interiors, household colours, the inspector.
await run(`
  const s = window.communityLab.store, w = s.sim.world;
  s.pause(); s.jumpBy(((18 * 60 + 35) - w.minuteOfDay + 1440) % 1440);
  const hh = Object.values(w.households).filter((h) => !h.dissolvedDay).sort((a, b) => b.memberIds.length - a.memberIds.length)[0];
  s.set('inspectorOpen', true); s.select({ kind: 'household', id: hh.id }, { focus: true });
  s.play();
`);
await shot('household', 4000);

// 3. The Sunday service: the pastor preaching, the congregation in the pews.
await run(`
  const s = window.communityLab.store;
  s.pause(); s.set('inspectorOpen', false); s.jumpToWeekday(0, 9 * 60 + 45);
  s.select({ kind: 'building', id: 'church' }, { focus: true }); s.play();
`);
await new Promise((r) => setTimeout(r, 3200));
await run(`
  const w = window.communityLab.store.sim.world, p = w.people[w.roles.pastorId];
  const c = p.conversationId ? w.conversations[p.conversationId] : null;
  console.log('pastor', p.firstName, p.sex, 'topic', c && c.topic, 'lines', c ? c.lines.length : 0);
`);
await shot('service', 200);

// 4. Fellowship afterwards, zoomed in on the hall.
await run(`
  const s = window.communityLab.store, w = s.sim.world;
  s.jumpBy((11 * 60 + 20) - w.minuteOfDay);
  const r = w.buildings.church.rooms.find((x) => x.id === 'church-hall');
  s.camera.tx = r.x + r.w / 2; s.camera.ty = r.y + r.h / 2; s.camera.tzoom = 11;
`);
await shot('fellowship', 3200);

// 5. The actuarial payload: actual-vs-expected mortality, full screen.
await run(`const s = window.communityLab.store; s.pause(); s.openDrawer('mortality'); s.setDrawerFull(true);`);
await shot('analytics', 1800);

// 6. Directing the scene.
await run(`const s = window.communityLab.store; s.setDrawerFull(false); s.openDrawer(null); s.setScene(true);`);
await shot('scene', 1400);

console.log(errors.length ? `console errors: ${errors.slice(0, 5).join(' | ')}` : 'no console errors');
await browser.close();
