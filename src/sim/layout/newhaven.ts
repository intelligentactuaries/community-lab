// Newhaven: the secular city, 3000..4400 × 0..1120 — Emmaus mirrored east to
// west, with its own amenities. There is no church, mosque or temple in it: a
// library and a memorial hall stand where the congregations would, weddings
// are civil ceremonies at the court, and Sunday belongs to the park.
//
//   Bellevue Heights (affluent, W 3020..3540 × 60..470)
//   Oakdale (middle-class, E 3740..4380 × 40..520)
//   Westbrook (working-class, S 3340..4040 × 760..1100)
//   Newhaven Central (civic centre, 3500..3760 × 550..810):
//     municipal council · commercial bank · medical centre · magistrate's court · square
//
// Progress Road (x=3630) is the spine. Gates: west (3000,300) meets the N1 to
// Emmaus, east (4400,280) is a region exit, south (3690,1120) the eastern ring road.

import type { Building } from '../types';
import { bank, busstop, cemetery, clinic, council, court, farm, hall, library, medical, office, park, plaza, police, school, shop, sportsCentre, taxirank, workshop } from './builders';
import { houseBuilding, plotRow, type PlotSpec, type Segment } from './plots';

export const NEWHAVEN_SEGMENTS: Segment[] = [
  // ── Oakdale ──
  { name: 'Oak Avenue', x1: 3740, y1: 280, x2: 4400, y2: 280 }, // east region exit
  { name: 'Sycamore Lane', x1: 3820, y1: 160, x2: 4300, y2: 160 },
  { name: 'Maple Road', x1: 3820, y1: 400, x2: 4300, y2: 400 },
  { name: 'Acorn Link', x1: 3820, y1: 160, x2: 3820, y2: 400 },
  { name: 'Birch Link', x1: 4060, y1: 160, x2: 4060, y2: 400 },
  { name: 'Elm Link', x1: 4300, y1: 160, x2: 4300, y2: 400 },
  { name: 'Mill Lane', x1: 3820, y1: 400, x2: 3820, y2: 480 },
  // ── Arterials ──
  { name: 'Progress Road', x1: 3630, y1: 280, x2: 3740, y2: 280 }, // Oakdale approach
  { name: 'Progress Road', x1: 3630, y1: 280, x2: 3630, y2: 760 }, // the spine
  { name: 'Bellevue Approach', x1: 3540, y1: 300, x2: 3630, y2: 300 },
  { name: 'Westbrook Approach', x1: 3630, y1: 760, x2: 3690, y2: 760 },
  // ── Bellevue Heights ──
  { name: 'Bellevue Drive', x1: 3000, y1: 300, x2: 3020, y2: 300 }, // meets the N1
  { name: 'Bellevue Drive', x1: 3020, y1: 300, x2: 3540, y2: 300 },
  { name: 'Willow Lane', x1: 3060, y1: 160, x2: 3500, y2: 160 },
  { name: 'Camellia Close', x1: 3060, y1: 160, x2: 3060, y2: 300 },
  { name: 'Jacaranda Close', x1: 3500, y1: 160, x2: 3500, y2: 300 },
  // ── Westbrook ──
  { name: 'Cosmos Street', x1: 3390, y1: 850, x2: 3990, y2: 850 },
  { name: 'Aloe Street', x1: 3390, y1: 1010, x2: 3990, y2: 1010 },
  { name: 'Fynbos Link', x1: 3420, y1: 850, x2: 3420, y2: 1010 },
  { name: 'Progress Road', x1: 3690, y1: 760, x2: 3690, y2: 850 },
  { name: 'Marula Link', x1: 3690, y1: 850, x2: 3690, y2: 1010 },
  { name: 'Bluegum Link', x1: 3940, y1: 850, x2: 3940, y2: 1010 },
  { name: 'Progress Road', x1: 3690, y1: 1010, x2: 3690, y2: 1120 }, // south gate: the eastern ring road
  { name: 'Station Road', x1: 3330, y1: 556, x2: 3630, y2: 556 }, // west from Progress Road to the Hyperline station
];

/** Bellevue 101–110, Oakdale 111–126, Westbrook 131–144. */
export function newhavenPlots(): PlotSpec[] {
  return [
    ...plotRow(101, 5, 3096, 78, 64, 'south', 'bellevue', 'large'),
    ...plotRow(106, 5, 3096, 78, 190, 'south', 'bellevue', 'large'),
    ...plotRow(111, 8, 3843, 55, 175, 'south', 'oakdale', 'standard'),
    ...plotRow(119, 8, 3843, 55, 415, 'north', 'oakdale', 'standard'),
    ...plotRow(131, 7, 3443, 64, 764, 'south', 'westbrook', 'small'),
    ...plotRow(138, 7, 3443, 64, 866, 'north', 'westbrook', 'small'),
  ];
}

export function newhavenBuildings(): Record<string, Building> {
  const b: Record<string, Building> = {};
  for (const p of newhavenPlots()) b[`house${p.plot}`] = houseBuilding(p);
  const add = (x: Building) => (b[x.id] = x);
  // ════ OAKDALE (middle-class) ════
  add(cemetery({ id: 'nh-cemetery', name: 'Newhaven Cemetery', com: 'oakdale', x: 3906, y: 80, w: 78, h: 72, facing: 'S' }));
  add(library({ id: 'nh-library', name: 'Newhaven Public Library', com: 'oakdale', x: 4002, y: 68, w: 116, h: 84, facing: 'S' }));
  add(hall({ id: 'nh-hall', name: 'Newhaven Memorial Hall', com: 'oakdale', x: 4132, y: 88, w: 90, h: 64, facing: 'S' }));
  // The civic spine along Oak Avenue
  add(shop({ id: 'nh-market', name: 'Oakdale General Dealer', com: 'oakdale', x: 3820, y: 302, w: 84, h: 76, facing: 'N', front: true, stalls: [3, 3] }));
  add(busstop({ id: 'nh-rank', name: 'Newhaven Bus Station', com: 'oakdale', x: 3914, y: 302, w: 64, h: 40, facing: 'N' }));
  add(police({ id: 'nh-police', name: 'SAPS Newhaven', com: 'oakdale', x: 3988, y: 302, w: 64, h: 76, facing: 'N' }));
  add(clinic({ id: 'nh-clinic', name: 'Oakdale Clinic', com: 'oakdale', x: 4070, y: 302, w: 84, h: 76, facing: 'N' }));
  add(school({ id: 'nh-school', name: 'Newhaven Primary & High School', com: 'oakdale', x: 4168, y: 302, w: 112, h: 76, facing: 'N' }));
  add(farm({ id: 'nh-farm', name: 'Oakdale Market Garden', com: 'oakdale', x: 3744, y: 168, w: 62, h: 104, facing: 'E' }));
  add(office({ id: 'nh-office', name: 'Newhaven Business Park', com: 'oakdale', x: 3744, y: 412, w: 62, h: 52, facing: 'E' }));
  add(workshop({ id: 'nh-workshop', name: 'Mill Lane Panelbeaters', com: 'oakdale', x: 3744, y: 468, w: 62, h: 36, facing: 'E' }));
  add(park({ id: 'nh-park', name: 'Oakdale Park', com: 'oakdale', x: 4306, y: 168, w: 66, h: 104, facing: 'W' }));
  add(bank({ id: 'nh-bank', name: 'Oakdale branch', com: 'oakdale', x: 4310, y: 332, w: 58, h: 50, facing: 'W' }));
  add(busstop({ id: 'nh-busstop', name: 'Oak Avenue bus stop', com: 'oakdale', x: 4340, y: 288, w: 30, h: 14, facing: 'N' }));
  // ════ BELLEVUE HEIGHTS (affluent) ════
  add(sportsCentre({ id: 'nh-club', name: 'Bellevue Club & Gym', com: 'bellevue', x: 3146, y: 330, w: 104, h: 74, facing: 'N' }));
  add(shop({ id: 'nh-deli', name: 'Bellevue Fine Foods', com: 'bellevue', x: 3274, y: 330, w: 76, h: 60, facing: 'N', stalls: [3, 2] }));
  add(office({ id: 'nh-chambers', name: 'Newhaven Chambers', com: 'bellevue', x: 3374, y: 330, w: 96, h: 62, facing: 'N' }));
  add(bank({ id: 'nh-rbank', name: 'Bellevue branch', com: 'bellevue', x: 3054, y: 336, w: 66, h: 50, facing: 'N' }));
  add(park({ id: 'nh-green', name: 'Bellevue Green', com: 'bellevue', x: 3492, y: 66, w: 40, h: 226, facing: 'W' }));
  add(busstop({ id: 'nh-rbusstop', name: 'Bellevue bus stop', com: 'bellevue', x: 3480, y: 310, w: 30, h: 14, facing: 'N' }));
  // ════ WESTBROOK (working-class) ════
  add(hall({ id: 'nh-youth', name: 'Westbrook Youth Centre', com: 'westbrook', x: 3932, y: 866, w: 64, h: 58, facing: 'N' }));
  add(shop({ id: 'nh-spaza', name: 'Westbrook Superette', com: 'westbrook', x: 3940, y: 940, w: 56, h: 44, facing: 'S', stalls: [3, 1] }));
  add(taxirank({ id: 'nh-taxi', name: 'Newhaven Cabs', com: 'westbrook', x: 3356, y: 866, w: 60, h: 60, facing: 'E' }));
  add(bank({ id: 'nh-pbank', name: 'Westbrook counter', com: 'westbrook', x: 3356, y: 944, w: 60, h: 44, facing: 'E' }));
  add(park({ id: 'nh-grounds', name: 'Westbrook Grounds', com: 'westbrook', x: 3530, y: 1030, w: 110, h: 62, facing: 'N' }));
  add(busstop({ id: 'nh-pbusstop', name: 'Westbrook bus stop', com: 'westbrook', x: 3704, y: 1060, w: 30, h: 14, facing: 'W' }));
  // ════ NEWHAVEN CENTRAL (civic centre) ════
  add(council({ id: 'nh-council', name: 'Newhaven Municipal Council', com: 'central', x: 3648, y: 566, w: 92, h: 70, facing: 'W' }));
  add(bank({ id: 'nh-combank', name: 'Newhaven Commercial Bank', com: 'central', x: 3518, y: 566, w: 96, h: 66, facing: 'E', kind: 'combank' }));
  add(medical({ id: 'nh-medical', name: 'Newhaven Medical Centre', com: 'central', x: 3656, y: 650, w: 84, h: 60, facing: 'W' }));
  add(court({ id: 'nh-court', name: "Newhaven Magistrate's Court", com: 'central', x: 3528, y: 646, w: 90, h: 76, facing: 'E' }));
  add(plaza({ id: 'nh-plaza', name: 'Newhaven Square', com: 'central', x: 3636, y: 722, w: 108, h: 34, facing: 'W' }));
  return b;
}
