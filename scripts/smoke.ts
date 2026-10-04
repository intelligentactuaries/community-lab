import { Simulation } from '../src/sim/engine';
import { alivePeople } from '../src/sim/ctx';
import { aeTable, realisedFertility } from '../src/sim/stats';

const t0 = performance.now();
const sim = new Simulation({ seed: 'smoke-1' });
const w = sim.world;
console.log(`built in ${(performance.now() - t0).toFixed(0)}ms: ${Object.keys(w.households).length} households, ${alivePeople(w).length} people, ${Object.keys(w.buildings).length} buildings, ${Object.keys(w.roads.nodes).length} road nodes`);
const jobs: Record<string, number> = {};
for (const p of alivePeople(w)) jobs[p.job] = (jobs[p.job] ?? 0) + 1;
console.log('jobs', jobs);
const ages = alivePeople(w).map((p) => p.age).sort((a, b) => a - b);
console.log('ages', ages.join(','));
console.log('roles', w.roles);
const years = Number(process.argv[2] ?? 5);
const t1 = performance.now();
sim.runDays(Math.round(365.25 * years));
const dt = performance.now() - t1;
console.log(`macro: ${years} years in ${dt.toFixed(0)}ms (${(365.25 * years / (dt / 1000)).toFixed(0)} days/s)`);
const s = w.stats;
console.log({ pop: alivePeople(w).length, births: s.births, deaths: s.deaths, marriages: s.marriages, divorces: s.divorces, emig: s.emigrations, immig: s.immigrations, incidents: s.incidents, arrests: s.arrests, disputes: s.disputes, fights: s.fights, mediations: s.mediations, illnesses: s.illnesses, hosp: s.hospitalisations, court: s.courtCases, convictions: s.convictions, roadAcc: s.roadAccidents, funerals: s.funerals, weddings: s.weddings, reserve: Math.round(w.insurance.reserve), claims: w.insurance.claimCount, ruined: w.insurance.ruined });
console.log('deaths by cause', s.deathsByCause);
console.log('illness by kind', s.illnessByKind);
console.log('incidents by kind', s.incidentsByKind);
console.log('yearly', s.yearly.map((y) => `${y.year}: pop ${y.population} b${y.births} d${y.deaths} cbr ${y.cbr.toFixed(1)} cdr ${y.cdr.toFixed(1)} tfr ${y.tfr.toFixed(2)} e0 ${y.e0M?.toFixed(1)}/${y.e0F?.toFixed(1)} A/E ${y.aeRatio?.toFixed(2)}`).join('\n'));
const ae = aeTable(s.exposures).filter((r) => r.sex === 'all' || r.band === 'all');
console.log('A/E', ae.map((r) => `${r.band}/${r.sex}: E=${r.exposure.toFixed(1)}py A=${r.actual} X=${r.expected.toFixed(2)} ratio=${r.ratio?.toFixed(2)} [${r.lo?.toFixed(2)}, ${r.hi?.toFixed(2)}]`).join('\n'));
console.log('fertility', realisedFertility(s));
console.log('events tail', w.events.slice(-12).map((e) => `${e.day} ${e.kind}: ${e.text}`).join('\n'));
// Micro mode for one day
sim.setMicro(true);
const t2 = performance.now();
let steps = 0;
for (let i = 0; i < 1440 * 60; i++) {
  sim.advance(1 / 60);
  steps++;
}
const dt2 = performance.now() - t2;
console.log(`micro: 1 day at 1/60-min steps (${steps} steps) in ${dt2.toFixed(0)}ms → ${(steps / (dt2 / 1000)).toFixed(0)} steps/s`);
const t3 = performance.now();
for (let i = 0; i < 1440; i++) sim.advance(1);
console.log(`micro: 1 day at 1-min steps in ${(performance.now() - t3).toFixed(0)}ms; conversations so far ${w.stats.conversations}; live convs ${Object.keys(w.conversations).length}; intruders ${Object.keys(w.intruders).length}`);
const moving = alivePeople(w).filter((p) => p.path.length).length;
console.log('people with paths now', moving, 'minuteOfDay', w.minuteOfDay, 'day', w.day);
const sample = alivePeople(w).slice(0, 3).map((p) => `${p.firstName} ${p.surname} ${p.age}${p.sex} ${p.job} ${p.shape} at ${p.loc.buildingId}/${p.loc.roomId} (${p.loc.x.toFixed(0)},${p.loc.y.toFixed(0)}) plan[${p.planIdx}]=${p.plan[p.planIdx]?.label}`);
console.log(sample.join('\n'));
