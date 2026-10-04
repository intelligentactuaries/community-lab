// Headless visual check: drives the running dev app through its main states
// and saves screenshots under data/shots. Usage: bun scripts/shot.ts [url]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5175/';
mkdirSync('data/shots', { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,1000', '--font-render-hinting=none'] });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('ia.theme', 'light'); } catch {} });
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${(e as Error).message}`));
const shot = async (name: string, ms = 800) => { await new Promise((r) => setTimeout(r, ms)); await page.screenshot({ path: `data/shots/${name}.png` }); console.log('shot', name); };
const run = (code: string) => page.evaluate(`(() => { ${code} })()`);

await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForSelector('canvas');
await new Promise((r) => setTimeout(r, 1500));
await shot('01-initial');
// The province on a Saturday mid-morning: the mall run, the taxis and buses on the highways, the Hyperline between the cities.
await run(`const s=window.communityLab.store; s.pause(); const w=s.sim.world; const cal=s.cal(); const d=(6-cal.weekday+7)%7||7; s.sim.advance(d*1440 + (10*60+40) - w.minuteOfDay); s.setSpeed('x60'); s.play();`);
await shot('00-region', 2500);
const flyTo = (i: number) => run(`document.querySelectorAll('button.fly')[${i}].click()`);
await flyTo(0); await shot('00a-emmaus', 2500);
await flyTo(1); await shot('00b-newhaven', 2500);
await flyTo(2); await shot('00c-ithemba', 2500);
await flyTo(3); await shot('00d-airport', 2500);
await flyTo(4); await shot('00e-unity-centre', 2500);
await flyTo(5); await shot('00f-unity-park', 2500);
await flyTo(6); await shot('00g-hospital', 2500);
// The Hyperline: a train at speed, followed for a moment
await run(`const s=window.communityLab.store; const w=s.sim.world; const v=Object.values(w.vehicles).find(v=>v.kind==='train'&&v.moving); if(v){ s.followId=null; s.camera.tx=v.x; s.camera.ty=v.y; s.camera.tzoom=3; s.bump(); }`);
await shot('00h-hyperline', 1200);
// A minibus taxi with fares aboard, followed
await run(`const s=window.communityLab.store; const w=s.sim.world; const v=Object.values(w.vehicles).find(v=>v.kind==='taxi'&&v.moving&&v.occupantIds.length); if(v) s.select({kind:'person', id:v.occupantIds[0]},{focus:true, follow:true});`);
await shot('00i-taxi', 1500);
await run(`const s=window.communityLab.store; s.pause(); s.select(null); s.resetCamera(); s.sim.advance(1440*8 - s.sim.world.minuteOfDay + 8*60); s.play();`);
// Play at 1 min/s for a few seconds
await run(`window.communityLab.store.setSpeed('x60'); window.communityLab.store.play();`);
await shot('02-running-1minps', 4000);
// Jump the clock to 08:00 so people are up and about
await run(`const s=window.communityLab.store; s.pause(); s.sim.advance(8*60 - s.sim.world.minuteOfDay); s.play();`);
await shot('03-morning', 3000);
// Drill into the pastor's house then follow the pastor
await run(`const s=window.communityLab.store; const w=s.sim.world; const id=w.roles.pastorId; s.select({kind:'household', id:w.people[id].householdId},{focus:true});`);
await shot('04-house-drill', 1500);
await run(`const s=window.communityLab.store; const id=s.sim.world.roles.pastorId; s.select({kind:'person', id},{focus:true, follow:true});`);
await shot('05-person-follow', 1500);
// Find a live conversation and zoom to it
const convId = await run(`const s=window.communityLab.store; const w=s.sim.world; const c=Object.values(w.conversations).find(c=>c.participantIds.length>1 && c.participantIds.every(id=>w.people[id]?.conversationId===c.id)); if(c){ s.select({kind:'conversation', id:c.id},{focus:true}); return c.id;} return null;`);
console.log('conversation', convId);
await shot('06-conversation', 1800);
// Sunday church: advance to next Sunday 09:40
await run(`const s=window.communityLab.store; s.pause(); const w=s.sim.world; const cal=s.cal(); const daysToSunday=(7-cal.weekday)%7||7; s.sim.advance((daysToSunday*1440) + (9*60+40) - w.minuteOfDay); s.select({kind:'building', id:'church'},{focus:true}); s.play();`);
await shot('07-church-sunday', 2500);
// Time-lapse: 1 yr/s for 3 seconds, bird's-eye
await run(`const s=window.communityLab.store; s.resetCamera(); s.setSpeed('year'); s.play();`);
await shot('08-timelapse', 3500);
await run(`const s=window.communityLab.store; s.pause();`);
// Analytics drawer: mortality
await run(`window.communityLab.store.openDrawer('mortality')`);
await shot('09-drawer-mortality', 1500);
await run(`window.communityLab.store.openDrawer('population')`);
await shot('10-drawer-population', 1500);
await run(`window.communityLab.store.openDrawer('insurance')`);
await shot('11-drawer-scheme', 1500);
await run(`window.communityLab.store.openDrawer(null); window.communityLab.store.set('settingsOpen', true)`);
await shot('12-settings', 1000);
await run(`window.communityLab.store.set('settingsOpen', false); localStorage.setItem('ia.theme','dark'); document.documentElement.setAttribute('data-theme','dark'); window.dispatchEvent(new CustomEvent('ia:theme-change'));`);
await run(`const s=window.communityLab.store; s.setSpeed('x60'); s.sim.advance(20*60 - s.sim.world.minuteOfDay); s.play();`);
await shot('13-dark-evening', 2500);
await run(`localStorage.removeItem('ia.theme');`);
const stats = await run(`const w=window.communityLab.store.sim.world; return JSON.stringify({day:w.day, pop:Object.values(w.people).filter(p=>p.alive&&!p.emigrated).length, births:w.stats.births, deaths:w.stats.deaths, convs:w.stats.conversations, events:w.events.length});`);
console.log('state', stats);
console.log('console errors/warnings:', errors.length);
for (const e of errors.slice(0, 20)) console.log('  ', e.slice(0, 300));
await browser.close();
