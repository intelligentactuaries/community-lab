// The README's pictures of the Community Builder, from the running dev app.
//   bun run dev            # in one terminal
//   bun scripts/builder-shots.ts [url] [out-dir]
// Light theme, 1600 × 1000. builder.png: Masakhane in the builder, the village
// church selected; built-world.png: Masakhane running, the Sunday service.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5195/';
const OUT = process.argv[3] ?? 'docs/media';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb', '--font-render-hinting=none', '--lang=en-GB'] });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.clear();
    localStorage.setItem('ia.theme', 'light');
  } catch {
    /* first run */
  }
});
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String((e as Error).message)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const run = (code: string) => page.evaluate(`(() => { ${code} })()`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForSelector('canvas');
await sleep(1000);

// 1. The builder: Masakhane, Ubuntu village in view, its church selected.
await run(`
  const b = window.communityLab.builder;
  b.enter(); b.newFromTemplate('masakhane');
  const c = b.plan.buildings.find((x) => x.asset === 'church' && x.settlement === 'ubuntu');
  b.select([{ kind: 'building', id: c.id }]);
  b.camera.tx = 420; b.camera.ty = 330; b.camera.tzoom = 1.35;
`);
await sleep(1500);
await page.screenshot({ path: `${OUT}/builder.png` });
console.log('shot builder');

// 2. The world running: the Sunday service in Ubuntu's church, the flat map.
await run(`
  const b = window.communityLab.builder; b.select([]); b.run();
  const s = window.communityLab.store; s.set('view3d', false);
  s.sim.advance(10 * 60 + 5 - s.sim.world.minuteOfDay);
  s.camera.tx = 400; s.camera.ty = 330; s.camera.tzoom = 1.9; s.bump();
`);
await sleep(2500);
await page.screenshot({ path: `${OUT}/built-world.png` });
console.log('shot built-world');

console.log(errors.length ? `console errors: ${errors.slice(0, 5).join(' | ')}` : 'no console errors');
await browser.close();
