// Ithemba ("hope"): the poor, church-going city, 1500..2900 × 2300..3420 —
// Emmaus turned upside down, so its civic centre and the township of
// Nazareth face the road up to Unity Centre, and every settlement has its
// own congregation.
//
//   Nazareth (low-income, N 1900..2560 × 2320..2660)
//   Ithemba Crossroads (civic centre, 2140..2400 × 2662..2862):
//     local council · post office & SASSA pay point · medical centre · magistrate's court · square
//   Bethesda (working-class, SW 1520..2160 × 2900..3380)
//   Siyakha (low-income, SE 2360..2880 × 2950..3360)
//
// Ithemba Road (x=2270, and x=2210 through Nazareth) is the spine. Gates: north
// (2210,2300) is Central Avenue from the centre, west (1500,3140) and east
// (2900,3120) the ring roads, south (1600,3420) a region exit.

import type { Building } from '../types';
import { bank, busstop, cemetery, church, clinic, council, court, farm, hall, medical, office, park, plaza, police, school, shop, taxirank, workshop } from './builders';
import { houseBuilding, plotRow, type PlotSpec, type Segment } from './plots';

export const ITHEMBA_SEGMENTS: Segment[] = [
  // ── Bethesda ──
  { name: 'Bethesda Road', x1: 1500, y1: 3140, x2: 1520, y2: 3140 }, // west gate: the western ring road
  { name: 'Bethesda Road', x1: 1520, y1: 3140, x2: 2160, y2: 3140 },
  { name: 'Jordan Lane', x1: 1600, y1: 3260, x2: 2080, y2: 3260 },
  { name: 'Zion Road', x1: 1600, y1: 3020, x2: 2080, y2: 3020 },
  { name: 'Gilead Link', x1: 1600, y1: 3020, x2: 1600, y2: 3260 },
  { name: 'Canaan Link', x1: 1840, y1: 3020, x2: 1840, y2: 3260 },
  { name: 'Gilead Link', x1: 1600, y1: 3260, x2: 1600, y2: 3420 }, // south region exit
  { name: 'Jericho Link', x1: 2080, y1: 3020, x2: 2080, y2: 3260 },
  { name: 'Olive Lane', x1: 2080, y1: 2940, x2: 2080, y2: 3020 },
  { name: 'Olive Lane', x1: 2080, y1: 2800, x2: 2080, y2: 2940 }, // on north to the Hyperline station
  // ── Arterials ──
  { name: 'Ithemba Road', x1: 2160, y1: 3140, x2: 2270, y2: 3140 }, // Bethesda approach
  { name: 'Ithemba Road', x1: 2270, y1: 2660, x2: 2270, y2: 3140 }, // the spine
  { name: 'Siyakha Approach', x1: 2270, y1: 3120, x2: 2360, y2: 3120 },
  { name: 'Nazareth Approach', x1: 2210, y1: 2660, x2: 2270, y2: 2660 },
  // ── Siyakha ──
  { name: 'Sinethemba Street', x1: 2360, y1: 3120, x2: 2880, y2: 3120 },
  { name: 'Sinethemba Street', x1: 2880, y1: 3120, x2: 2900, y2: 3120 }, // east gate: the eastern ring road
  { name: 'Themba Lane', x1: 2400, y1: 3260, x2: 2840, y2: 3260 },
  { name: 'Mpumelelo Close', x1: 2400, y1: 3120, x2: 2400, y2: 3260 },
  { name: 'Vukani Close', x1: 2840, y1: 3120, x2: 2840, y2: 3260 },
  // ── Nazareth ──
  { name: 'Galilee Street', x1: 1910, y1: 2570, x2: 2510, y2: 2570 },
  { name: 'Bethel Street', x1: 1910, y1: 2410, x2: 2510, y2: 2410 },
  { name: 'Shiloh Link', x1: 1940, y1: 2410, x2: 1940, y2: 2570 },
  { name: 'Ithemba Road', x1: 2210, y1: 2570, x2: 2210, y2: 2660 },
  { name: 'Emmanuel Link', x1: 2210, y1: 2410, x2: 2210, y2: 2570 },
  { name: 'Zola Link', x1: 2460, y1: 2410, x2: 2460, y2: 2570 },
  { name: 'Ithemba Road', x1: 2210, y1: 2300, x2: 2210, y2: 2410 }, // north gate: Central Avenue
];

/** Bethesda 201–216, Siyakha 221–234, Nazareth 241–254. */
export function ithembaPlots(): PlotSpec[] {
  return [
    ...plotRow(201, 8, 1620, 55, 3155, 'north', 'bethesda', 'standard'),
    ...plotRow(209, 8, 1620, 55, 2915, 'south', 'bethesda', 'standard'),
    ...plotRow(221, 7, 2420, 60, 3274, 'north', 'siyakha', 'small'),
    ...plotRow(228, 7, 2420, 60, 3138, 'north', 'siyakha', 'small'),
    ...plotRow(241, 7, 1963, 64, 2574, 'north', 'nazareth', 'small'),
    ...plotRow(248, 7, 1963, 64, 2472, 'south', 'nazareth', 'small'),
  ];
}

export function ithembaBuildings(): Record<string, Building> {
  const b: Record<string, Building> = {};
  for (const p of ithembaPlots()) b[`house${p.plot}`] = houseBuilding(p);
  const add = (x: Building) => (b[x.id] = x);
  // ════ BETHESDA (working-class) ════
  add(hall({ id: 'it-hall', name: 'Bethesda Community Hall', com: 'bethesda', x: 1688, y: 3268, w: 80, h: 64, facing: 'N' }));
  add(church({ id: 'it-church', name: 'Bethesda Full Gospel Church', com: 'bethesda', x: 1782, y: 3268, w: 116, h: 84, facing: 'N', size: 'large' }));
  add(cemetery({ id: 'it-cemetery', name: 'Ithemba Cemetery', com: 'bethesda', x: 1916, y: 3268, w: 78, h: 72, facing: 'N' }));
  // The civic spine along Bethesda Road
  add(school({ id: 'it-school', name: 'Ithemba Primary School', com: 'bethesda', x: 1620, y: 3042, w: 112, h: 76, facing: 'S' }));
  add(clinic({ id: 'it-clinic', name: 'Bethesda Clinic', com: 'bethesda', x: 1746, y: 3042, w: 84, h: 76, facing: 'S' }));
  add(police({ id: 'it-police', name: 'SAPS Ithemba', com: 'bethesda', x: 1848, y: 3042, w: 64, h: 76, facing: 'S' }));
  add(busstop({ id: 'it-rank', name: 'Bethesda taxi stop', com: 'bethesda', x: 1922, y: 3078, w: 64, h: 40, facing: 'S' }));
  add(shop({ id: 'it-market', name: 'Bethesda Market', com: 'bethesda', x: 1996, y: 3042, w: 84, h: 76, facing: 'S', front: true, stalls: [3, 3] }));
  add(farm({ id: 'it-farm', name: 'Ithemba Communal Farm', com: 'bethesda', x: 2094, y: 3148, w: 62, h: 104, facing: 'W' }));
  add(office({ id: 'it-office', name: 'Ithemba Development Trust', com: 'bethesda', x: 2094, y: 2956, w: 62, h: 52, facing: 'W' }));
  add(workshop({ id: 'it-workshop', name: 'Olive Lane Welding & Repairs', com: 'bethesda', x: 2094, y: 2916, w: 62, h: 36, facing: 'W' }));
  add(park({ id: 'it-park', name: 'Bethesda Sports Field', com: 'bethesda', x: 1528, y: 3148, w: 66, h: 104, facing: 'E' }));
  add(bank({ id: 'it-bank', name: 'Bethesda counter', com: 'bethesda', x: 1532, y: 3038, w: 58, h: 50, facing: 'E' }));
  add(busstop({ id: 'it-busstop', name: 'Bethesda bus stop', com: 'bethesda', x: 1530, y: 3118, w: 30, h: 14, facing: 'S' }));
  // ════ SIYAKHA (low-income) ════
  add(church({ id: 'it-schurch', name: 'Siyakha Apostolic Church', com: 'siyakha', x: 2650, y: 3016, w: 104, h: 74, facing: 'S', size: 'medium' }));
  add(shop({ id: 'it-sspaza', name: "Gogo's Spaza", com: 'siyakha', x: 2550, y: 3030, w: 76, h: 60, facing: 'S', stalls: [3, 2] }));
  add(hall({ id: 'it-skills', name: 'Siyakha Skills & Crèche Centre', com: 'siyakha', x: 2430, y: 3028, w: 96, h: 62, facing: 'S' }));
  add(bank({ id: 'it-sbank', name: 'Siyakha counter', com: 'siyakha', x: 2780, y: 3034, w: 66, h: 50, facing: 'S' }));
  add(park({ id: 'it-sgrounds', name: 'Siyakha Grounds', com: 'siyakha', x: 2368, y: 3128, w: 40, h: 226, facing: 'E' }));
  add(busstop({ id: 'it-sbusstop', name: 'Siyakha bus stop', com: 'siyakha', x: 2850, y: 3100, w: 30, h: 14, facing: 'S' }));
  // ════ NAZARETH (low-income) ════
  add(church({ id: 'it-nchurch', name: 'Nazareth Zion Church', com: 'nazareth', x: 1904, y: 2496, w: 56, h: 58, facing: 'S', size: 'small' }));
  add(shop({ id: 'it-nspaza', name: "Mama Nomsa's Spaza", com: 'nazareth', x: 1904, y: 2436, w: 56, h: 44, facing: 'N', stalls: [3, 1] }));
  add(taxirank({ id: 'it-taxi', name: 'Ithemba Taxi Association', com: 'nazareth', x: 2484, y: 2494, w: 60, h: 60, facing: 'W' }));
  add(bank({ id: 'it-nbank', name: 'Nazareth counter', com: 'nazareth', x: 2484, y: 2432, w: 60, h: 44, facing: 'W' }));
  add(park({ id: 'it-ngrounds', name: 'Nazareth Grounds', com: 'nazareth', x: 2260, y: 2328, w: 110, h: 62, facing: 'S' }));
  add(busstop({ id: 'it-nbusstop', name: 'Nazareth bus stop', com: 'nazareth', x: 2176, y: 2346, w: 30, h: 14, facing: 'E' }));
  // ════ ITHEMBA CROSSROADS (civic centre) ════
  add(council({ id: 'it-council', name: 'Ithemba Local Council', com: 'crossroads', x: 2160, y: 2784, w: 92, h: 70, facing: 'E' }));
  add(office({ id: 'it-post', name: 'Ithemba Post Office & SASSA pay point', com: 'crossroads', x: 2286, y: 2788, w: 96, h: 66, facing: 'W', kind: 'govt' }));
  add(medical({ id: 'it-medical', name: 'Ithemba Medical Centre', com: 'crossroads', x: 2160, y: 2710, w: 84, h: 60, facing: 'E' }));
  add(court({ id: 'it-court', name: "Ithemba Magistrate's Court", com: 'crossroads', x: 2282, y: 2698, w: 90, h: 76, facing: 'W' }));
  add(plaza({ id: 'it-plaza', name: 'Crossroads Square', com: 'crossroads', x: 2156, y: 2664, w: 108, h: 34, facing: 'E' }));
  return b;
}
