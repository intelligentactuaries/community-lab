// Headless visual check of the finance workspace. Usage: bun scripts/shot-finance.ts [url]
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
const shot = async (name: string, ms = 900) => { await new Promise((r) => setTimeout(r, ms)); await page.screenshot({ path: `data/shots/${name}.png` }); console.log('shot', name); };
const run = (code: string) => page.evaluate(`(() => { ${code} })()`);

await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForSelector('canvas');
await new Promise((r) => setTimeout(r, 1200));
// Run four years of time-lapse so the books have history (quarters, closes, tax seasons)
await run(`const s=window.communityLab.store; s.pause(); s.sim.runDays(4*365+40); s.bump();`);
await new Promise((r) => setTimeout(r, 800));
await shot('70-strip-finance');
await run(`window.communityLab.store.openFinance('overview')`);
await shot('71-finance-overview', 1500);
await run(`window.communityLab.store.setDrawerFull(true)`);
await shot('72-finance-overview-full', 1500);
await run(`window.communityLab.store.setFinance({section:'micro'})`);
await shot('73-finance-micro', 1500);
await run(`window.communityLab.store.setFinance({section:'macro'})`);
await shot('74-finance-macro', 1500);
await run(`window.communityLab.store.setFinance({section:'books', entity:'market'})`);
await shot('75-finance-books-income', 1200);
await run(`document.querySelectorAll('.books-head .tab')[1].click()`);
await shot('76-finance-books-balance', 1200);
await run(`document.querySelectorAll('.books-head .tab')[6].click()`);
await shot('77-finance-books-journal', 1200);
await run(`window.communityLab.store.setFinance({section:'bank'})`);
await shot('78-finance-bank', 1500);
await run(`window.communityLab.store.setFinance({section:'tax'})`);
await shot('79-finance-tax', 1500);
await run(`window.communityLab.store.setFinance({section:'audit'}); setTimeout(()=>{ const b=[...document.querySelectorAll('button.primary')].find(b=>b.textContent.includes('verify')); b && b.click(); }, 300);`);
await shot('80-finance-audit', 1500);
await run(`window.communityLab.store.setDrawerFull(false); window.communityLab.store.openDrawer(null);`);
// Household accounts in the inspector, and the bank building
await run(`const s=window.communityLab.store; const w=s.sim.world; const hh=Object.values(w.households).filter(h=>!h.dissolvedDay).sort((a,b)=>b.monthlyIncome-a.monthlyIncome)[2]; s.select({kind:'household', id:hh.id},{focus:false}); s.set('inspectorOpen', true);`);
await shot('81-household-accounts', 1200);
await run(`const s=window.communityLab.store; s.select({kind:'building', id:'bank'},{focus:true});`);
await shot('82-bank-building', 1500);
await run(`const s=window.communityLab.store; const w=s.sim.world; const p=Object.values(w.people).find(p=>p.alive && !p.emigrated && p.income>20000); s.select({kind:'person', id:p.id},{focus:false});`);
await shot('83-person-payslip', 1200);
// Dark theme, macro
await run(`localStorage.setItem('ia.theme','dark'); document.documentElement.setAttribute('data-theme','dark'); window.dispatchEvent(new CustomEvent('ia:theme-change')); window.communityLab.store.openFinance('micro'); window.communityLab.store.setDrawerFull(true);`);
await shot('84-finance-micro-dark', 1800);
await run(`localStorage.removeItem('ia.theme');`);
console.log('console errors/warnings:', errors.length);
for (const e of errors.slice(0, 20)) console.log('  ', e.slice(0, 300));
await browser.close();
