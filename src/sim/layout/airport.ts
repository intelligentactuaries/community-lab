// Unity Provincial Airport: the province's airfield on the open ground east
// of the Eastern Ring Road, south of Newhaven.
//
//   Airport Road (y=2000) leaves the ring road for Terminal Drive, the short
//   street in front of the terminal; the Airside Road runs from there past
//   the control tower, the hangar and the fire station to the runway.
//   The terminal (3820..4000 × 1940..2060) faces the drive, its apron and
//   two stands on the airside; the Hyperline's Airport station stands across
//   the drive from it, on the guideway that runs down the airfield's west
//   edge; Runway 18/36 (1.6 km) lies along the eastern boundary.

import type { Building } from '../types';
import { ambulanceStation, busstop, hangar, office, runway, station, terminal } from './builders';
import type { Segment } from './plots';

export const AIRPORT_SEGMENTS: Segment[] = [
  { name: 'Airport Road', x1: 3690, y1: 2000, x2: 3800, y2: 2000, width: 9 }, // from the Eastern Ring Road
  { name: 'Terminal Drive', x1: 3800, y1: 1960, x2: 3800, y2: 2120 },
  { name: 'Airside Road', x1: 3800, y1: 2120, x2: 4170, y2: 2120 },
];

/** The runway centreline and thresholds, for the planes' taxi, take-off and landing paths. */
export const RUNWAY = { x: 4222.5, north: 1340, south: 2860, taxiwayX: 4160, taxiwayY: 2120 } as const;

export function airportBuildings(): Record<string, Building> {
  const b: Record<string, Building> = {};
  const add = (x: Building) => (b[x.id] = x);
  add(terminal({ id: 'ap-terminal', name: 'Airport Terminal', com: 'airfield', x: 3820, y: 1940, w: 180, h: 120, facing: 'W', stands: 2 }));
  add(station({ id: 'st-airport', name: 'Airport Station', com: 'airfield', x: 3730, y: 2080, w: 60, h: 60, facing: 'E', platform: 'W' }));
  add(busstop({ id: 'ap-busstop', name: 'Airport bus stop', com: 'airfield', x: 3806, y: 2080, w: 30, h: 14, facing: 'W' }));
  add(office({ id: 'ap-tower', name: 'Control tower', com: 'airfield', x: 3840, y: 2140, w: 30, h: 30, facing: 'N' }));
  add(hangar({ id: 'ap-hangar', name: 'Hangar', com: 'airfield', x: 3900, y: 2150, w: 120, h: 80, facing: 'N' }));
  add(ambulanceStation({ id: 'ap-fire', name: 'Airport Fire & Rescue', com: 'airfield', x: 4060, y: 2150, w: 60, h: 40, facing: 'N' }));
  add(runway({ id: 'ap-runway', name: 'Runway 18/36', com: 'airfield', x: 4200, y: 1300, w: 45, h: 1600, facing: 'W' }));
  return b;
}
