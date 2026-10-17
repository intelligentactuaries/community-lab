// Starting points for the builder: an empty world, a small town to build on,
// and the built-in province to customise.

import { villageCore, civicCentre, street, place, type Pieces } from './prefabs';
import { provincePlan } from './province';
import { PLAN_FORMAT, type PlanBuilding, type WorldPlan } from './types';

export interface TemplateSpec {
  id: string;
  label: string;
  blurb: string;
  make: () => WorldPlan;
}

function stamp(origin: string): WorldPlan['meta'] {
  const now = new Date().toISOString();
  return { createdAt: now, updatedAt: now, origin, version: 1 };
}

function newId(slug: string): string {
  return `${slug}-${Math.random().toString(36).slice(2, 8)}`;
}

/** An empty world: one city and one settlement to draw in. */
export function blankPlan(name = 'New community', size = { w: 1600, h: 1200 }): WorldPlan {
  return {
    format: PLAN_FORMAT,
    id: newId('world'),
    name,
    region: name.split(' ')[0] || 'New',
    size,
    cities: [{ id: 'town', name, short: name.split(' ')[0] || 'Town', kind: 'city', x: 0, y: 0, w: size.w, h: size.h }],
    settlements: [{ id: 'village', city: 'town', name: 'The village', short: 'Village', tier: 'middle', x: 40, y: 40, w: size.w - 80, h: size.h - 80 }],
    roads: [],
    buildings: [],
    meta: stamp('blank'),
  };
}

/**
 * Masakhane ("let us build together"): a small town of about forty households
 * in three settlements around a civic centre, on a main road with a way out at
 * each end. Everything a community needs is here; build from it.
 */
export function masakhanePlan(): WorldPlan {
  const taken = new Set<string>();
  const plots = new Set<number>();
  const buildings: PlanBuilding[] = [];
  const roads: WorldPlan['roads'] = [];
  const add = (p: Pieces) => {
    for (const b of p.buildings) {
      buildings.push(b);
      taken.add(b.id);
      if (b.plot) plots.add(b.plot);
    }
    roads.push(...p.roads);
  };
  // The main road, a way out at each end.
  roads.push({ name: 'Main Road', x1: 0, y1: 600, x2: 1600, y2: 600, width: 9 });
  // ── Ubuntu, the village (middle-class) ──
  add(street({ x1: 60, y1: 160, x2: 740, y2: 160, name: 'Acacia Street', tier: 'standard', sides: 'both', settlement: 'ubuntu', taken, plotsUsed: plots, withRoad: true }));
  add(villageCore(60, 380, 'ubuntu', taken, 'Masakhane'));
  roads.push({ name: 'Ubuntu Link', x1: 60, y1: 160, x2: 60, y2: 600 }, { name: 'Ridge Link', x1: 740, y1: 160, x2: 740, y2: 600 });
  // ── Thembisa, the township (low-income) ──
  add(street({ x1: 100, y1: 760, x2: 700, y2: 760, name: 'Thabo Street', tier: 'small', sides: 'both', settlement: 'thembisa', taken, plotsUsed: plots, withRoad: true }));
  roads.push({ name: 'Jordan Link', x1: 100, y1: 600, x2: 100, y2: 760 }, { name: 'Thembisa Road', x1: 700, y1: 600, x2: 700, y2: 960 });
  add({
    roads: [{ name: 'Zion Lane', x1: 700, y1: 960, x2: 980, y2: 960 }],
    buildings: [
      place('church', 720, 960 - 15 - 58, 'S', 'thembisa', taken, 'Thembisa Zion Church', { size: 'small' }),
      place('spaza', 800, 960 - 15 - 44, 'S', 'thembisa', taken, 'Spaza shop'),
      place('park', 870, 960 - 15 - 104, 'S', 'thembisa', taken, 'Thembisa Grounds'),
      place('busstop', 940, 960 + 6, 'N', 'thembisa', taken, 'Thembisa bus stop'),
      place('bank', 720, 960 + 15, 'N', 'thembisa', taken, 'Thembisa counter'),
    ],
  });
  // ── Hillside, the estates (affluent) ──
  add(street({ x1: 840, y1: 240, x2: 1540, y2: 240, name: 'Protea Drive', tier: 'large', sides: 'left', settlement: 'hillside', taken, plotsUsed: plots, withRoad: true }));
  roads.push({ name: 'Hillside Road', x1: 1200, y1: 240, x2: 1200, y2: 600 });
  add({
    roads: [],
    buildings: [
      place('church', 880, 240 + 15, 'N', 'hillside', taken, 'Hillside Chapel', { size: 'medium' }),
      place('deli', 1000, 240 + 15, 'N', 'hillside', taken, 'Hillside Deli & Trading'),
      place('park', 1090, 240 + 15, 'N', 'hillside', taken, 'Hillside Green', undefined),
      place('chambers', 1220, 240 + 15, 'N', 'hillside', taken, 'Hillside Chambers'),
      place('bank', 1330, 240 + 15, 'N', 'hillside', taken, 'Hillside branch'),
      place('busstop', 1410, 240 + 6, 'N', 'hillside', taken, 'Hillside bus stop'),
    ],
  });
  // ── Masakhane Centre (civic) ──
  roads.push({ name: 'Civic Link', x1: 1300, y1: 600, x2: 1300, y2: 640 });
  add(civicCentre(1300, 650, 'centre', taken, 'Masakhane'));
  return {
    format: PLAN_FORMAT,
    id: newId('masakhane'),
    name: 'Masakhane',
    region: 'Masakhane',
    description: 'A small town to build on: a village, a township and a hillside estate around a civic centre.',
    size: { w: 1600, h: 1200 },
    cities: [{ id: 'masakhane', name: 'Masakhane', short: 'Masakhane', kind: 'city', x: 0, y: 0, w: 1600, h: 1200, blurb: 'a small town: Ubuntu village, the Thembisa township and the Hillside estates around a civic centre', tagline: 'a town to build on' }],
    settlements: [
      { id: 'ubuntu', city: 'masakhane', name: 'Ubuntu', short: 'Ubuntu', tier: 'middle', x: 40, y: 40, w: 740, h: 545 },
      { id: 'thembisa', city: 'masakhane', name: 'Thembisa', short: 'Thembisa', tier: 'low-income', x: 40, y: 615, w: 960, h: 545 },
      { id: 'hillside', city: 'masakhane', name: 'Hillside', short: 'Hillside', tier: 'affluent', x: 820, y: 40, w: 740, h: 545 },
      { id: 'centre', city: 'masakhane', name: 'Masakhane Centre', short: 'Centre', tier: 'civic', x: 1040, y: 615, w: 520, h: 545 },
    ],
    roads,
    buildings,
    meta: stamp('template:masakhane'),
  };
}

export const TEMPLATES: TemplateSpec[] = [
  { id: 'blank', label: 'Blank canvas', blurb: 'An empty world with one city and one settlement: build from the ground up.', make: () => blankPlan() },
  { id: 'masakhane', label: 'Masakhane, a small town', blurb: 'About forty households in a village, a township and a hillside estate around a civic centre.', make: () => masakhanePlan() },
  { id: 'province', label: 'Unity Province', blurb: 'The built-in province, every building as drawn: customise it.', make: () => ({ ...provincePlan(), id: newId('unity'), name: 'Unity Province (edited)', meta: stamp('province') }) },
];
