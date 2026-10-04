// Unity Centre: what the three cities share, laid out between them along
// Central Avenue (x=2210) and Unity Boulevard (y=1450), and the roads that
// join everything up.
//
//   Hospital campus (1880..2340 × 400..720): the central hospital, its
//     ambulance station and pharmacy, on Central Avenue below the N1
//   The CBD (1690..2730 × 1230..1720): Government House, the Reserve Bank,
//     the provincial police headquarters, Unity Square, the mall, the towers,
//     the chambers and the bus & taxi terminus, either side of the boulevard
//   Unity Park (1650..2770 × 1810..2290): the stadium, the concert hall, Grand
//     Park, the sports centre and the botanical gardens along Stadium Way
//
// The region's roads: the N1 (y=300) joins Emmaus and Newhaven across the top;
// Central Avenue runs from the north exit through the campus, the CBD and the
// park down to Ithemba; Unity Boulevard joins the western and eastern ring
// roads through the CBD; the ring roads drop from the two northern cities to
// Ithemba's gates. Every city reaches every other both directly and through
// the centre.

import type { Building } from '../types';
import { ambulanceStation, bank, busstop, concertHall, govt, grandPark, hospital, mall, office, park, plaza, police, sportsCentre, stadium, terminus, shop } from './builders';
import type { Segment } from './plots';

export const CENTRAL_X = 2210;

export const UNITY_SEGMENTS: Segment[] = [
  // ── The highways ──
  { name: 'N1 Unity Highway', x1: 1400, y1: 300, x2: 3000, y2: 300, width: 11 },
  { name: 'Central Avenue', x1: CENTRAL_X, y1: 0, x2: CENTRAL_X, y2: 300, width: 9 }, // north region exit
  { name: 'Central Avenue', x1: CENTRAL_X, y1: 300, x2: CENTRAL_X, y2: 1450, width: 9 },
  { name: 'Central Avenue', x1: CENTRAL_X, y1: 1450, x2: CENTRAL_X, y2: 2300, width: 9 },
  { name: 'Unity Boulevard', x1: 710, y1: 1450, x2: 3690, y2: 1450, width: 9 },
  { name: 'Western Ring Road', x1: 710, y1: 1120, x2: 710, y2: 3140, width: 9 },
  { name: 'Western Ring Road', x1: 710, y1: 3140, x2: 1500, y2: 3140, width: 9 },
  { name: 'Eastern Ring Road', x1: 3690, y1: 1120, x2: 3690, y2: 3120, width: 9 },
  { name: 'Eastern Ring Road', x1: 3690, y1: 3120, x2: 2900, y2: 3120, width: 9 },
  { name: 'Stadium Way', x1: 1790, y1: 2050, x2: 2560, y2: 2050 },
  // ── CBD streets ──
  { name: 'Government Row', x1: 1700, y1: 1250, x2: CENTRAL_X, y2: 1250 },
  { name: 'Exchange Street', x1: 1700, y1: 1250, x2: 1700, y2: 1450 },
  { name: 'Market Street', x1: 1700, y1: 1700, x2: CENTRAL_X, y2: 1700 }, // west to Unity Central Station
  { name: 'Market Street', x1: CENTRAL_X, y1: 1700, x2: 2720, y2: 1700 },
  { name: 'Commerce Street', x1: 2720, y1: 1450, x2: 2720, y2: 1700 },
];

export function unityBuildings(): Record<string, Building> {
  const b: Record<string, Building> = {};
  const add = (x: Building) => (b[x.id] = x);
  // ════ HOSPITAL CAMPUS ════
  add(hospital({ id: 'hospital', name: 'Unity Central Hospital', com: 'campus', x: 1900, y: 420, w: 280, h: 260, facing: 'E' }));
  add(ambulanceStation({ id: 'un-ambulance', name: 'Emergency Medical Services', com: 'campus', x: 2240, y: 420, w: 70, h: 44, facing: 'W' }));
  add(shop({ id: 'un-pharmacy', name: 'Campus Pharmacy', com: 'campus', x: 2240, y: 480, w: 70, h: 50, facing: 'W', stalls: [2, 1] }));
  add(busstop({ id: 'un-hstop', name: 'Hospital bus stop', com: 'campus', x: 2220, y: 560, w: 14, h: 30, facing: 'W' }));
  // ════ THE CBD ════
  add(govt({ id: 'govt', name: 'Unity Government House', com: 'cbd', x: 1730, y: 1280, w: 200, h: 150, facing: 'S' }));
  add(bank({ id: 'reservebank', name: 'Reserve Bank of Unity', com: 'cbd', x: 1960, y: 1290, w: 160, h: 140, facing: 'S', kind: 'reservebank' }));
  add(police({ id: 'un-police', name: 'SAPS Provincial Headquarters', com: 'cbd', x: 2250, y: 1300, w: 120, h: 130, facing: 'S', cells: 3 }));
  add(plaza({ id: 'un-square', name: 'Unity Square', com: 'cbd', x: 2400, y: 1330, w: 140, h: 100, facing: 'S' }));
  add(terminus({ id: 'terminus', name: 'Unity Bus & Taxi Terminus', com: 'cbd', x: 1730, y: 1480, w: 180, h: 90, facing: 'N', bays: 4 }));
  add(office({ id: 'un-chambers', name: 'Unity Chambers', com: 'cbd', x: 1940, y: 1480, w: 110, h: 80, facing: 'N' }));
  add(office({ id: 'towers', name: 'Unity Towers', com: 'cbd', x: 2240, y: 1480, w: 150, h: 110, facing: 'W', floors: 2, kind: 'towers' }));
  add(mall({ id: 'mall', name: 'Unity Mall', com: 'cbd', x: 2420, y: 1480, w: 290, h: 200, facing: 'N', shops: [
    { id: 'super', name: 'Unity Supermarket' },
    { id: 'dept', name: 'Department store' },
    { id: 'fashion', name: 'Fashion & footwear' },
    { id: 'tech', name: 'Electronics & phones' },
  ] }));
  // ════ UNITY PARK ════
  add(stadium({ id: 'stadium', name: 'Unity Stadium', com: 'precinct', x: 1700, y: 1830, w: 300, h: 190, facing: 'S' }));
  add(concertHall({ id: 'concert', name: 'Unity Concert Hall', com: 'precinct', x: 2040, y: 1860, w: 140, h: 160, facing: 'S' }));
  add(grandPark({ id: 'grandpark', name: 'Grand Park', com: 'precinct', x: 2260, y: 1830, w: 480, h: 190, facing: 'S' }));
  add(sportsCentre({ id: 'un-sports', name: 'Unity Sports Centre', com: 'precinct', x: 1700, y: 2080, w: 220, h: 160, facing: 'N' }));
  add(park({ id: 'un-gardens', name: 'Unity Botanical Gardens', com: 'precinct', x: 2260, y: 2080, w: 300, h: 170, facing: 'N' }));
  add(busstop({ id: 'un-pstop', name: 'Unity Park bus stop', com: 'precinct', x: 2220, y: 1900, w: 14, h: 30, facing: 'W' }));
  return b;
}
