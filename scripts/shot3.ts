// Checks the drawer at the standard card size, across tabs, plus the strip.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
mkdirSync('data/shots', { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('ia.theme', 'light'); } catch {} });
await page.setViewport({ width: 1900, height: 1000, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String((e as Error).message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const run = (code: string) => page.evaluate(`(() => { ${code} })()`);
const shot = async (name: string, ms = 900) => { await new Promise((r) => setTimeout(r, ms)); await page.screenshot({ path: `data/shots/${name}.png` }); console.log('shot', name); };
await page.goto('http://localhost:5175/', { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForSelector('canvas');
await run(`const s=window.communityLab.store; s.sim.runDays(1500); s.bump();`);
for (const tab of ['health', 'economy', 'mortality', 'safety', 'basis', 'weather']) {
  await run(`window.communityLab.store.openDrawer('${tab}')`);
  await shot(`30-${tab}`, 1200);
  const m = await run(`const b=document.querySelector('.drawer-body'); const cards=[...b.querySelectorAll(':scope > .viz')].map(el=>Math.round(el.getBoundingClientRect().height)); return JSON.stringify({tab:'${tab}', cards, bodyH:Math.round(b.getBoundingClientRect().height), scrollH:b.scrollHeight});`);
  console.log(m);
}
await run(`window.communityLab.store.setDrawerFull(true); window.communityLab.store.openDrawer('health')`);
await shot('31-health-full', 1300);
await run(`window.communityLab.store.setDrawerFull(false); window.communityLab.store.openDrawer(null)`);
await shot('32-strip', 900);
console.log('errors', errors.length, errors.slice(0, 4));
await browser.close();
