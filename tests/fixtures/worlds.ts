// Small worlds for the tests: a bare street (houses and a spaza, nothing
// else), and two towns joined by a Hyperline, with a terminus and an airfield.

import { airfield, civicCentre, place, street, villageCore, type Pieces } from '../../src/sim/plan/prefabs';
import { PLAN_FORMAT, type PlanBuilding, type WorldPlan } from '../../src/sim/plan/types';

function assemble(add: (p: Pieces) => void) {
  const buildings: PlanBuilding[] = [];
  const roads: WorldPlan['roads'] = [];
  const taken = new Set<string>();
  const plots = new Set<number>();
  add = (p: Pieces) => {
    for (const b of p.buildings) {
      buildings.push(b);
      taken.add(b.id);
      if (b.plot) plots.add(b.plot);
    }
    roads.push(...p.roads);
  };
  return { buildings, roads, taken, plots, add };
}

/** One street of standard houses with a spaza: everything else missing. */
export function bareStreet(): WorldPlan {
  const w = assemble(() => {});
  w.add(street({ x1: 0, y1: 200, x2: 900, y2: 200, name: 'Long Street', tier: 'standard', sides: 'both', settlement: 'street', taken: w.taken, plotsUsed: w.plots, withRoad: true }));
  // The spaza takes the place of the houses at the east end of the south side.
  const clash = w.buildings.filter((b) => b.asset === 'house' && b.y > 200 && b.x < 876 && b.x + b.w > 816);
  for (const c of clash) w.buildings.splice(w.buildings.indexOf(c), 1);
  w.add({ roads: [], buildings: [place('spaza', 820, 200 + 15, 'N', 'street', w.taken, 'Corner spaza')] });
  return {
    format: PLAN_FORMAT,
    id: 'bare-street',
    name: 'Long Street',
    region: 'Long',
    size: { w: 900, h: 400 },
    cities: [{ id: 'town', name: 'Long Street', short: 'Long', kind: 'city', x: 0, y: 0, w: 900, h: 400 }],
    settlements: [{ id: 'street', city: 'town', name: 'Long Street', short: 'Street', tier: 'working', x: 0, y: 0, w: 900, h: 400 }],
    roads: w.roads,
    buildings: w.buildings,
  };
}

/** Two towns on a Hyperline, a bus & taxi terminus between them, and an airfield to the east. */
export function twoTowns(): WorldPlan {
  const w = assemble(() => {});
  // West town
  w.add(street({ x1: 40, y1: 160, x2: 720, y2: 160, name: 'West Street', tier: 'standard', sides: 'both', settlement: 'west', taken: w.taken, plotsUsed: w.plots, withRoad: true }));
  w.add(villageCore(40, 380, 'west', w.taken, 'Westvale'));
  w.roads.push({ name: 'West Link', x1: 40, y1: 160, x2: 40, y2: 600 }, { name: 'West Ridge', x1: 720, y1: 160, x2: 720, y2: 380 });
  // East town (300 m further east than the west town is wide)
  w.add(street({ x1: 1700, y1: 160, x2: 2380, y2: 160, name: 'East Street', tier: 'small', sides: 'both', settlement: 'east', taken: w.taken, plotsUsed: w.plots, withRoad: true }));
  w.add({ roads: [], buildings: [place('church', 1720, 380 - 15 - 58, 'S', 'east', w.taken, 'Eastvale Church', { size: 'small' }), place('market', 1800, 380 - 15 - 76, 'S', 'east', w.taken, 'Eastvale Market'), place('school', 1900, 380 - 15 - 76, 'S', 'east', w.taken, 'Eastvale School'), place('clinic', 2030, 380 - 15 - 76, 'S', 'east', w.taken, 'Eastvale Clinic'), place('busstop', 2140, 380 + 6, 'N', 'east', w.taken, 'Eastvale bus stop'), place('busstop', 1760, 380 + 6, 'N', 'east', w.taken, 'Eastvale church stop')] });
  w.roads.push({ name: 'Eastvale Road', x1: 1700, y1: 380, x2: 2380, y2: 380 }, { name: 'East Link', x1: 2380, y1: 160, x2: 2380, y2: 600 }, { name: 'Church Link', x1: 1700, y1: 160, x2: 1700, y2: 380 });
  // The main road and the centre: a terminus and a mall on Terminus Way, a civic centre beside them
  w.roads.push({ name: 'Main Road', x1: 0, y1: 600, x2: 2900, y2: 600, width: 9 });
  w.add({ roads: [{ name: 'Terminus Way', x1: 960, y1: 600, x2: 960, y2: 1000 }], buildings: [place('terminus', 975, 640, 'W', 'centre', w.taken, 'Central Terminus'), place('mall', 975, 760, 'W', 'centre', w.taken, 'Central Mall')] });
  w.add(civicCentre(1380, 620, 'centre', w.taken, 'Central'));
  w.roads.push({ name: 'Civic Link', x1: 1380, y1: 600, x2: 1380, y2: 610 });
  // The Hyperline along y = 520, a station at each town and at the centre
  const track = [{ x: 200, y: 520 }, { x: 2200, y: 520 }];
  w.add({ roads: [], buildings: [place('station', 300, 528, 'S', 'west', w.taken, 'Westvale Station', { platform: 'N' }), place('station', 1100, 528, 'S', 'centre', w.taken, 'Central Station', { platform: 'N' }), place('station', 2100, 528, 'S', 'east', w.taken, 'Eastvale Station', { platform: 'N' })] });
  // The airfield, its access road from the main road's end
  w.add(airfield(2900, 100, 'airfield', w.taken, 'Two Towns'));
  w.roads.push({ name: 'Airport Link', x1: 2900, y1: 600, x2: 2900, y2: 800 });
  return {
    format: PLAN_FORMAT,
    id: 'two-towns',
    name: 'Two Towns',
    region: 'Valley',
    size: { w: 3500, h: 1800 },
    cities: [
      { id: 'westvale', name: 'Westvale', short: 'Westvale', kind: 'city', x: 0, y: 0, w: 900, h: 620 },
      { id: 'eastvale', name: 'Eastvale', short: 'Eastvale', kind: 'city', x: 1600, y: 0, w: 900, h: 620 },
      { id: 'middle', name: 'Valley Centre', short: 'Centre', kind: 'centre', x: 900, y: 500, w: 700, h: 600 },
      { id: 'air', name: 'Valley Airport', short: 'Airport', kind: 'airport', x: 2860, y: 80, w: 640, h: 1700 },
    ],
    settlements: [
      { id: 'west', city: 'westvale', name: 'Westvale', short: 'West', tier: 'comfortable', x: 0, y: 0, w: 900, h: 590 },
      { id: 'east', city: 'eastvale', name: 'Eastvale', short: 'East', tier: 'working', x: 1600, y: 0, w: 900, h: 590 },
      { id: 'centre', city: 'middle', name: 'Valley Centre', short: 'Centre', tier: 'civic', x: 900, y: 500, w: 700, h: 600 },
      { id: 'airfield', city: 'air', name: 'Valley Airport', short: 'Airport', tier: 'civic', x: 2860, y: 80, w: 640, h: 1700 },
    ],
    roads: w.roads,
    buildings: w.buildings,
    track,
  };
}
