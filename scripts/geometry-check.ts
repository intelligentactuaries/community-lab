// Geometry audit of the province: overlaps, containment, entrance-to-road
// distances, buildings on the roadway, dangling road ends, full connectivity
// (every building to every other and to every exit), landmark coherence, plot
// uniqueness — and the transport: the Hyperline clear of every building and
// beside each of its stations, every bus line drivable stop to stop, the
// airport's runway and stands where the planes expect them. Run after
// touching any layout file.
import { AMBULANCE_BASES, BUS_LINES, CHURCH_IDS, CITIES, CLINIC_IDS, COMMUNITIES, COMMUNITY, COURT_IDS, EXITS, POLICE_IDS, ROAD_WIDTH, RUNWAY, STATIONS, TAXI_RANK_IDS, TRACK, TRACK_WIDTH, buildBuildings, buildRoadGraph, communityAt, landmark, nearestRoadPoint, roadDistance, roadPath, trackPoint } from '../src/sim/world';
import type { LandmarkKind } from '../src/sim/world';

const b = buildBuildings();
const ids = Object.keys(b);
let fail = 0;
const err = (m: string) => { console.log('FAIL', m); fail++; };

// 1. building-vs-building overlap (bounding boxes, 1m tolerance for shared yards)
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const a = b[ids[i]], c = b[ids[j]];
    const ox = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x);
    const oy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
    if (ox > 1 && oy > 1) err(`overlap ${a.id} × ${c.id} (${ox.toFixed(0)}×${oy.toFixed(0)}m)`);
  }
}
// 2. every building inside its community rectangle, every community inside its city
for (const id of ids) {
  const x = b[id];
  const c = COMMUNITY[x.community];
  const slack = 8; // church/market yards poke out slightly
  if (x.x < c.x - slack || x.y < c.y - slack || x.x + x.w > c.x + c.w + slack || x.y + x.h > c.y + c.h + slack)
    err(`${id} outside ${c.id} box: bld(${x.x},${x.y},${x.w},${x.h}) vs (${c.x},${c.y},${c.w},${c.h})`);
  for (const r of x.rooms) {
    for (const s of r.spots) if (s.x < r.x - 0.5 || s.x > r.x + r.w + 0.5 || s.y < r.y - 0.5 || s.y > r.y + r.h + 0.5) err(`${id}: spot ${s.id} (${s.kind}) outside room ${r.id}`);
  }
}
for (const c of COMMUNITIES) {
  const city = CITIES.find((k) => k.id === c.city)!;
  if (c.x < city.x || c.y < city.y || c.x + c.w > city.x + city.w || c.y + c.h > city.y + city.h) err(`community ${c.id} outside city ${city.id}`);
  for (const d of COMMUNITIES) {
    if (d === c || d.id < c.id) continue;
    const ox = Math.min(c.x + c.w, d.x + d.w) - Math.max(c.x, d.x);
    const oy = Math.min(c.y + c.h, d.y + d.h) - Math.max(c.y, d.y);
    if (ox > 0 && oy > 0) err(`communities overlap: ${c.id} × ${d.id}`);
  }
}
// 3. entrances near a road
for (const id of ids) {
  const e = b[id].entrance;
  const np = nearestRoadPoint(e.x, e.y);
  if (np.d > 40) err(`${id} entrance ${np.d.toFixed(0)}m from nearest road (${np.seg.name})`);
}
// 4. buildings not sitting on a road
for (const id of ids) {
  const x = b[id];
  const cnp = nearestRoadPoint(x.x + x.w / 2, x.y + x.h / 2);
  if (cnp.d < ROAD_WIDTH / 2) err(`${id} centre sits on ${cnp.seg.name}`);
}
// 5. connectivity: one graph; every building's road node reaches every other + all exits
const g = buildRoadGraph(b);
for (const e of EXITS) if (!g.nodes[e.node]) err(`exit node ${e.node} missing from graph`);
const origin = b.church.roadNode;
for (const id of ids) if (!roadPath(g, origin, b[id].roadNode)) err(`no path church → ${id}`);
for (const e of EXITS) if (!roadPath(g, origin, e.node)) err(`no path church → exit ${e.id}`);
// dangling road ends: every node with a single edge must be an exit or a building's node
const degree: Record<string, number> = {};
for (const e of g.edges) { degree[e.a] = (degree[e.a] ?? 0) + 1; degree[e.b] = (degree[e.b] ?? 0) + 1; }
const nodeOf = new Set(ids.map((id) => b[id].roadNode));
const exitNodes = new Set<string>(EXITS.map((e) => e.node));
// (a street may run a few metres past its last gate — a cul-de-sac — but not further)
for (const n in degree) {
  if (degree[n] !== 1 || exitNodes.has(n) || nodeOf.has(n)) continue;
  const e = g.edges.find((x) => x.a === n || x.b === n)!;
  if (e.length > 60) err(`dangling road end at ${n} (${e.name}, ${e.length.toFixed(0)} m of dead road)`);
}
// 6. community lookup coherence
for (const id of ids) {
  const x = b[id];
  const at = communityAt(x.x + x.w / 2, x.y + x.h / 2);
  if (at !== x.community) err(`${id} declared ${x.community} but centre falls in ${at}`);
}
// 7. plot uniqueness
const plots = ids.map((id) => b[id].plot).filter((p): p is number => p !== null);
if (new Set(plots).size !== plots.length) err('duplicate plot numbers');
// 8. landmarks exist
const KINDS: LandmarkKind[] = ['shop', 'bank', 'park', 'busstop', 'hall', 'cemetery', 'school', 'clinic', 'police', 'court', 'council', 'medical', 'taxi', 'workshop', 'office', 'farm'];
for (const c of COMMUNITIES) {
  for (const k of KINDS) {
    const id = landmark(c.id, k as 'shop');
    if (!b[id]) err(`landmark ${k} of ${c.id} → ${id} does not exist`);
  }
  const ch = landmark(c.id, 'church');
  if (ch && !b[ch]) err(`church of ${c.id} → ${ch} does not exist`);
  if (!ch && CITIES.find((k) => k.id === c.city)!.religious && c.tier !== 'civic') err(`${c.id} has no church but its city is religious`);
}
for (const list of [CHURCH_IDS, CLINIC_IDS, COURT_IDS, POLICE_IDS, TAXI_RANK_IDS, AMBULANCE_BASES.map((a) => a.id)]) for (const id of list) if (!b[id]) err(`registry id ${id} missing`);
for (const id of CLINIC_IDS) if (!b[id].rooms.some((r) => r.kind === 'ward')) err(`${id} has no ward`);
for (const a of AMBULANCE_BASES) if (a.id !== 'clinic' && a.id !== 'nh-clinic' && a.id !== 'it-clinic' && !b[a.id].rooms.some((r) => r.kind === 'garage')) err(`${a.id} has no ambulance bay`);
// 9. the Hyperline: the guideway crosses roads, never buildings; each station stands beside it with its platform nearest the rail; the stations lie in line order
const segs = TRACK.slice(1).map((p, i) => ({ a: TRACK[i], b: p }));
for (const id of ids) {
  const x = b[id];
  for (const s of segs) {
    const hor = s.a.y === s.b.y;
    const lo = hor ? Math.min(s.a.x, s.b.x) : Math.min(s.a.y, s.b.y);
    const hi = hor ? Math.max(s.a.x, s.b.x) : Math.max(s.a.y, s.b.y);
    const at = hor ? s.a.y : s.a.x;
    const half = TRACK_WIDTH / 2;
    const crosses = hor ? at + half > x.y && at - half < x.y + x.h && hi > x.x && lo < x.x + x.w : at + half > x.x && at - half < x.x + x.w && hi > x.y && lo < x.y + x.h;
    if (crosses) err(`the Hyperline runs through ${id}`);
  }
}
let lastT = -1;
for (const st of STATIONS) {
  const sb = b[st.id];
  if (!sb) { err(`station ${st.id} missing`); continue; }
  if (sb.kind !== 'station') err(`${st.id} is not a station`);
  const pt = trackPoint(st.t);
  if (Math.hypot(pt.x - st.x, pt.y - st.y) > 0.5) err(`station ${st.id}'s stop is ${Math.hypot(pt.x - st.x, pt.y - st.y).toFixed(1)} m off the guideway`);
  const gap = Math.max(sb.x - st.x, st.x - (sb.x + sb.w), sb.y - st.y, st.y - (sb.y + sb.h));
  if (gap > 20 || gap < 2) err(`station ${st.id} is ${gap.toFixed(0)} m from its stop (want 2–20)`);
  const plat = sb.rooms.find((r) => r.kind === 'stop');
  if (!plat) err(`${st.id} has no platform`);
  else {
    const pc = { x: plat.x + plat.w / 2, y: plat.y + plat.h / 2 };
    const cc = { x: sb.x + sb.w / 2, y: sb.y + sb.h / 2 };
    if (Math.hypot(pc.x - st.x, pc.y - st.y) > Math.hypot(cc.x - st.x, cc.y - st.y)) err(`${st.id}'s platform is on the wrong side`);
  }
  if (st.t <= lastT) err(`stations out of line order at ${st.id}`);
  lastT = st.t;
}
// 10. bus lines: every stop a stop, in a place a bus can drive to from the last
for (const line of BUS_LINES) {
  for (let i = 0; i < line.stops.length; i++) {
    const s = b[line.stops[i]];
    if (!s) { err(`bus line ${line.id}: stop ${line.stops[i]} missing`); continue; }
    if (s.kind !== 'busstop' && s.kind !== 'terminus') err(`bus line ${line.id}: ${s.id} is a ${s.kind}, not a stop`);
    if (!s.rooms.some((r) => r.kind === 'stop')) err(`bus line ${line.id}: ${s.id} has no shelter`);
    if (i && !roadPath(g, b[line.stops[i - 1]].roadNode, s.roadNode)) err(`bus line ${line.id}: no road from ${line.stops[i - 1]} to ${s.id}`);
  }
}
// 11. the airport: a runway the planes' paths stay on, stands on the apron, a station and a stop by the terminal
{
  const rw = b['ap-runway'];
  const term = b['ap-terminal'];
  if (!rw || rw.kind !== 'runway') err('no runway');
  else {
    if (RUNWAY.x < rw.x || RUNWAY.x > rw.x + rw.w) err('runway centreline is off the runway');
    if (RUNWAY.north < rw.y || RUNWAY.south > rw.y + rw.h) err('thresholds are off the runway');
    if (rw.h < 1500) err(`runway is only ${rw.h} m`);
  }
  if (!term || term.kind !== 'terminal') err('no terminal');
  else {
    const apron = term.rooms.find((r) => r.name === 'Apron');
    if (!apron || apron.spots.length < 2) err('the apron has fewer than two stands');
    for (const s of apron?.spots ?? []) for (const id of ids) if (id !== term.id && s.x > b[id].x && s.x < b[id].x + b[id].w && s.y > b[id].y && s.y < b[id].y + b[id].h) err(`stand at ${s.x},${s.y} is inside ${id}`);
    // the taxiway from the stands to the runway crosses nothing
    for (const id of ids) {
      const x = b[id];
      if (id === 'ap-runway') continue;
      if (RUNWAY.taxiwayX > x.x && RUNWAY.taxiwayX < x.x + x.w && x.y < RUNWAY.taxiwayY && x.y + x.h > (apron?.y ?? 0)) err(`taxiway runs through ${id}`);
    }
  }
  for (const id of ['st-airport', 'ap-busstop', 'ap-tower', 'ap-hangar', 'ap-fire']) if (!b[id]) err(`airport: ${id} missing`);
  if (term && b['st-airport'] && Math.hypot(term.entrance.x - b['st-airport'].entrance.x, term.entrance.y - b['st-airport'].entrance.y) > 200) err('the airport station is too far from the terminal');
}
// spot lengths for sanity
const show = (a: string, c: string) => console.log(`  route ${a.padEnd(12)} → ${c.padEnd(12)}: ${(roadDistance(g, b[a].roadNode, b[c].roadNode) / 1000).toFixed(2)} km`);
show('church', 'rchurch'); show('church', 'nh-library'); show('church', 'it-church'); show('nh-school', 'it-school'); show('house1', 'mall'); show('house41', 'hospital'); show('house131', 'stadium'); show('house241', 'govt'); show('house21', 'nh-court'); show('house21', 'ap-terminal'); show('terminus', 'ap-terminal');
console.log(`  Hyperline: ${(STATIONS[STATIONS.length - 1].t / 1000).toFixed(2)} km, stations at ${STATIONS.map((s) => `${s.name} ${(s.t / 1000).toFixed(2)}`).join(' · ')} km`);
console.log(`\n${ids.length} buildings, ${Object.keys(g.nodes).length} road nodes, ${g.edges.length} edges, ${plots.length} plots`);
console.log(fail === 0 ? 'GEOMETRY OK' : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
