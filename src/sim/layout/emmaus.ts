// Emmaus: the original district, hand-drawn. Three settlements around a civic
// centre, all coordinates in metres of the region:
//
//   Ebenezer (affluent, NW 20..660 × 40..520)        — the original village
//   Hebron Heights (the estates, NE 860..1380 × 60..470)
//   Kanana (comfortable, S 400..1020 × 760..1100)
//   Emmaus Crossing (civic centre, middle 640..900 × 550..810):
//     council chamber · commercial bank · district medical centre ·
//     magistrate's court · Emmaus Square
//
// Unity Road (x=770) is the spine: Ebenezer joins it from the west at y=280,
// Hebron from the east at y=300, Kanana from the south at y=760. The city's
// gates: west (0,280) is a region exit, east (1400,300) meets the highway to
// Newhaven, south (710,1120) the western ring road to the centre.

import type { Building, Room } from '../types';
import { grid, mkBuilding, room, spot } from './builders';
import { PLOT_H, PLOT_W, houseBuilding, type PlotSpec, type Segment } from './plots';

// Ebenezer's streets are the original village translated by (+20, +40).
const MX = 20;
const MY = 40;

export const EMMAUS_SEGMENTS: Segment[] = [
  // ── Ebenezer ──
  { name: 'Church Street', x1: MX + 0, y1: MY + 240, x2: MX + 640, y2: MY + 240 },
  { name: 'Ebenezer Lane', x1: MX + 80, y1: MY + 120, x2: MX + 560, y2: MY + 120 },
  { name: 'Market Road', x1: MX + 80, y1: MY + 360, x2: MX + 560, y2: MY + 360 },
  { name: 'West Link', x1: MX + 80, y1: MY + 120, x2: MX + 80, y2: MY + 360 },
  { name: 'Centre Link', x1: MX + 320, y1: MY + 120, x2: MX + 320, y2: MY + 360 },
  { name: 'East Link', x1: MX + 560, y1: MY + 120, x2: MX + 560, y2: MY + 360 },
  { name: 'Co-op Lane', x1: MX + 560, y1: MY + 360, x2: MX + 560, y2: MY + 440 },
  // ── Arterials ──
  { name: 'Church Street', x1: 0, y1: 280, x2: MX, y2: 280 }, // west world exit stub
  { name: 'Unity Road', x1: 660, y1: 280, x2: 770, y2: 280 }, // Ebenezer approach
  { name: 'Unity Road', x1: 770, y1: 280, x2: 770, y2: 760 }, // the spine
  { name: 'Hebron Approach', x1: 770, y1: 300, x2: 860, y2: 300 },
  { name: 'Kanana Approach', x1: 710, y1: 760, x2: 770, y2: 760 },
  // ── Hebron Heights ──
  { name: 'Protea Avenue', x1: 860, y1: 300, x2: 1380, y2: 300 },
  { name: 'Vineyard Lane', x1: 900, y1: 160, x2: 1340, y2: 160 },
  { name: 'Stellenberg Close', x1: 900, y1: 160, x2: 900, y2: 300 },
  { name: 'Stellenberg Close', x1: 900, y1: 300, x2: 900, y2: 640 }, // on south to the Hyperline station
  { name: 'Constantia Close', x1: 1340, y1: 160, x2: 1340, y2: 300 },
  { name: 'Protea Avenue', x1: 1380, y1: 300, x2: 1400, y2: 300 }, // east world exit stub
  // ── Kanana ──
  { name: 'Thabo Street', x1: 410, y1: 850, x2: 1010, y2: 850 },
  { name: 'Moria Street', x1: 410, y1: 1010, x2: 1010, y2: 1010 },
  { name: 'Jordan Link', x1: 460, y1: 850, x2: 460, y2: 1010 },
  { name: 'Unity Road', x1: 710, y1: 760, x2: 710, y2: 850 },
  { name: 'Bethel Link', x1: 710, y1: 850, x2: 710, y2: 1010 },
  { name: 'Shiloh Link', x1: 960, y1: 850, x2: 960, y2: 1010 },
  { name: 'Unity Road', x1: 710, y1: 1010, x2: 710, y2: 1120 }, // south world exit stub
];

/** Plot numbers are unique across the region: Ebenezer 1–16, Hebron 21–30, Kanana 41–54 (the other cities count from 101 and 201). */
export function emmausPlots(): PlotSpec[] {
  const plots: PlotSpec[] = [];
  // Ebenezer: two rows of eight (as the original village)
  for (let i = 0; i < 8; i++) plots.push({ plot: i + 1, x: MX + 100 + i * 55, y: MY + 135, w: PLOT_W, h: PLOT_H, facing: 'south', community: 'ebenezer', tier: 'standard' });
  for (let i = 0; i < 8; i++) plots.push({ plot: i + 9, x: MX + 100 + i * 55, y: MY + 375, w: PLOT_W, h: PLOT_H, facing: 'north', community: 'ebenezer', tier: 'standard' });
  // Hebron Heights: two rows of five generous plots
  for (let i = 0; i < 5; i++) plots.push({ plot: 21 + i, x: 920 + i * 78, y: 64, w: 72, h: 92, facing: 'south', community: 'hebron', tier: 'large' });
  for (let i = 0; i < 5; i++) plots.push({ plot: 26 + i, x: 920 + i * 78, y: 190, w: 72, h: 92, facing: 'south', community: 'hebron', tier: 'large' });
  // Kanana: two dense rows of seven, the fourth of each set back from Unity Road and Bethel Link (x = 710), which
  // run between it and the fifth.
  const kx = (i: number) => 480 + i * 64 - (i === 3 ? 12 : 0);
  for (let i = 0; i < 7; i++) plots.push({ plot: 41 + i, x: kx(i), y: 764, w: 46, h: 82, facing: 'south', community: 'kanana', tier: 'small' });
  for (let i = 0; i < 7; i++) plots.push({ plot: 48 + i, x: kx(i), y: 866, w: 46, h: 82, facing: 'north', community: 'kanana', tier: 'small' });
  return plots;
}

export function emmausBuildings(): Record<string, Building> {
  const b: Record<string, Building> = {};

  // ════ EBENEZER (middle) — the original village at +20, +40 ════
  // ── Church ──
  {
    const x = MX + 262, y = MY + 28, w = 116, h = 84;
    const naveX = x + 4, naveY = y + 4, naveW = 72, naveH = 76;
    const pews = grid('pew', naveX + 6, naveY + 22, naveW - 12, 50, 10, 7);
    const nave = room('church-nave', 'Nave', 'nave', naveX, naveY, naveW, naveH, [spot('pulpit', naveX + naveW / 2, naveY + 8), spot('altar', naveX + naveW / 2 - 12, naveY + 9), spot('altar', naveX + naveW / 2 + 12, naveY + 9), ...pews]);
    const hallX = x + 80, hallW = 32;
    const hall = room('church-hall', 'Fellowship hall', 'hall', hallX, y + 4, hallW, 76, grid('bench', hallX + 3, y + 8, hallW - 6, 68, 3, 6));
    b.church = mkBuilding('church', 'church', 'Ebenezer Community Church', 'ebenezer', x, y, w, h, { x: x + 40, y: y + h }, [nave, hall]);
    b.church.rooms.push(room('church-yard', 'Churchyard', 'yard', x - 6, y + h, w + 12, 8, grid('bench-out', x, y + h + 1, w, 6, 6, 1)));
  }
  // ── Cemetery (the district's) ──
  b.cemetery = mkBuilding('cemetery', 'cemetery', 'District Cemetery', 'ebenezer', MX + 396, MY + 40, 78, 72, { x: MX + 435, y: MY + 112 }, [room('cemetery-graves', 'Graves', 'graves', MX + 400, MY + 44, 70, 64, [])]);
  // ── Community hall ──
  {
    const x = MX + 168, y = MY + 48, w = 80, h = 64;
    b.hall = mkBuilding('hall', 'hall', 'Community Hall', 'ebenezer', x, y, w, h, { x: x + 40, y: y + h }, [
      room('hall-main', 'Hall', 'hall', x + 4, y + 4, 56, 56, grid('bench', x + 8, y + 10, 48, 44, 4, 5)),
      room('hall-kitchen', 'Kitchen', 'kitchen', x + 60, y + 4, 16, 56, [spot('stove', x + 68, y + 12), spot('table', x + 68, y + 30), spot('table', x + 68, y + 44)]),
    ]);
  }
  // ── Houses (all communities) ──
  for (const p of emmausPlots()) b[`house${p.plot}`] = houseBuilding(p);
  // ── Ebenezer civic spine (facing Church Street) ──
  {
    const y = MY + 262, h = 76;
    // School (the district's)
    {
      const x = MX + 100, w = 112;
      b.school = mkBuilding('school', 'school', 'Ebenezer District School', 'ebenezer', x, y, w, h, { x: x + 56, y }, [
        room('school-c1', 'Foundation class', 'classroom', x + 4, y + 4, 34, 30, [spot('desk', x + 21, y + 8), ...grid('desk', x + 7, y + 13, 28, 18, 4, 3)]),
        room('school-c2', 'Senior class', 'classroom', x + 40, y + 4, 34, 30, [spot('desk', x + 57, y + 8), ...grid('desk', x + 43, y + 13, 28, 18, 4, 3)]),
        room('school-office', 'Staff room', 'office', x + 76, y + 4, 32, 30, grid('desk', x + 80, y + 10, 24, 18, 2, 2)),
        room('school-yard', 'Playground', 'yard', x + 4, y + 38, 104, 34, [...grid('generic', x + 10, y + 42, 90, 26, 5, 2), spot('goal', x + 8, y + 55), spot('goal', x + 102, y + 55)]),
      ]);
    }
    // Clinic / district hospital
    {
      const x = MX + 226, w = 84;
      b.clinic = mkBuilding('clinic', 'clinic', 'Ebenezer Clinic', 'ebenezer', x, y, w, h, { x: x + 42, y }, [
        room('clinic-reception', 'Reception', 'reception', x + 4, y + 4, 36, 28, [spot('counter', x + 22, y + 8), ...grid('seat', x + 7, y + 14, 30, 14, 3, 2)]),
        room('clinic-consult', 'Consulting room', 'consult', x + 44, y + 4, 36, 28, [spot('desk', x + 56, y + 10), spot('exam', x + 70, y + 20), spot('seat', x + 50, y + 22)]),
        room('clinic-ward', 'Ward', 'ward', x + 4, y + 36, 60, 36, grid('ward', x + 8, y + 40, 52, 28, 3, 2)),
        room('clinic-pharmacy', 'Dispensary', 'shop', x + 68, y + 36, 12, 36, [spot('counter', x + 74, y + 44), spot('desk', x + 74, y + 62)]),
      ]);
    }
    // Police station (the district's)
    {
      const x = MX + 328, w = 64;
      b.police = mkBuilding('police', 'police', 'SAPS Ebenezer', 'ebenezer', x, y, w, h, { x: x + 32, y }, [
        room('police-charge', 'Charge office', 'reception', x + 4, y + 4, 56, 26, [spot('counter', x + 32, y + 9), spot('desk', x + 14, y + 20), spot('desk', x + 50, y + 20), spot('seat', x + 32, y + 24)]),
        room('police-cells', 'Holding cells', 'cell', x + 4, y + 34, 26, 38, [spot('cell', x + 11, y + 44), spot('cell', x + 11, y + 62)]),
        room('police-garage', 'Vehicle bay', 'garage', x + 34, y + 34, 26, 38, [spot('generic', x + 47, y + 53)]),
      ]);
    }
    // Taxi rank (where the court used to stand — the court sits at Emmaus Crossing now)
    {
      const x = MX + 402, w = 64;
      b.rank = mkBuilding('rank', 'busstop', 'Ebenezer Taxi Rank', 'ebenezer', x, y, w, 40, { x: x + 32, y }, [
        room('rank-bays', 'Rank', 'stop', x + 4, y + 4, 56, 32, grid('seat', x + 8, y + 8, 48, 24, 4, 2)),
      ]);
    }
    // Market
    {
      const x = MX + 476, w = 84;
      b.market = mkBuilding('market', 'market', 'Ebenezer Market', 'ebenezer', x, y, w, h, { x: x + 42, y }, [
        room('market-floor', 'Shop floor', 'shop', x + 4, y + 4, 56, 68, [spot('counter', x + 32, y + 10), ...grid('stall', x + 8, y + 18, 48, 50, 3, 3)]),
        room('market-store', 'Storeroom', 'workshop', x + 64, y + 4, 16, 68, [spot('generic', x + 72, y + 20), spot('generic', x + 72, y + 50)]),
      ]);
      b.market.rooms.push(room('market-front', 'Market square', 'yard', x - 4, y - 10, w + 8, 10, grid('bench-out', x, y - 9, w, 8, 4, 1)));
    }
  }
  // ── Farm (east) ──
  {
    const x = MX + 574, y = MY + 128, w = 62, h = 104;
    b.farm = mkBuilding('farm', 'farm', 'Van der Merwe Farm', 'ebenezer', x, y, w, h, { x, y: y + 52 }, [
      room('farm-barn', 'Barn & office', 'workshop', x + 4, y + 4, 54, 24, [spot('desk', x + 12, y + 12), spot('generic', x + 30, y + 16), spot('generic', x + 48, y + 16)]),
      room('farm-field', 'Fields', 'field', x + 4, y + 32, 54, 44, grid('generic', x + 8, y + 36, 46, 36, 3, 3)),
      room('farm-pen', 'Livestock pen', 'pen', x + 4, y + 80, 54, 20, [spot('generic', x + 16, y + 90), spot('generic', x + 40, y + 90)]),
    ]);
  }
  // ── Office & workshop (east, south) ──
  {
    const x = MX + 574, y = MY + 372, w = 62, h = 92;
    b.office = mkBuilding('office', 'office', 'Ebenezer Co-op Offices', 'ebenezer', x, y, w, 52, { x, y: y + 26 }, [
      room('office-open', 'Open-plan office', 'office', x + 4, y + 4, 54, 44, grid('desk', x + 8, y + 8, 46, 36, 3, 3)),
    ]);
    b.workshop = mkBuilding('workshop', 'workshop', "Botha's Workshop", 'ebenezer', x, y + 56, w, 36, { x, y: y + 74 }, [
      room('workshop-floor', 'Workshop', 'workshop', x + 4, y + 60, 54, 28, [spot('generic', x + 14, y + 74), spot('generic', x + 30, y + 74), spot('generic', x + 46, y + 74)]),
    ]);
  }
  // ── Park (west) ──
  {
    const x = MX + 8, y = MY + 128, w = 66, h = 104;
    b.park = mkBuilding('park', 'park', 'Sports Park', 'ebenezer', x, y, w, h, { x: x + w, y: y + 52 }, [
      room('park-pitch', 'Pitch', 'pitch', x + 4, y + 4, 58, 76, [spot('goal', x + 33, y + 8), spot('goal', x + 33, y + 76), ...grid('generic', x + 10, y + 16, 46, 56, 3, 4)]),
      room('park-benches', 'Benches', 'yard', x + 4, y + 84, 58, 16, grid('bench-out', x + 6, y + 86, 54, 12, 4, 1)),
    ]);
  }
  // ── Ebenezer Mutual Bank ──
  {
    const x = MX + 12, y = MY + 292, w = 58, h = 50;
    b.bank = mkBuilding('bank', 'bank', 'Ebenezer Mutual Bank', 'ebenezer', x, y, w, h, { x: x + w, y: y + 26 }, [
      room('bank-hall', 'Banking hall', 'reception', x + 4, y + 4, 34, 42, [spot('counter', x + 30, y + 12), spot('counter', x + 30, y + 26), ...grid('seat', x + 8, y + 10, 14, 30, 2, 4)]),
      room('bank-office', "Manager's office", 'office', x + 40, y + 4, 14, 20, [spot('desk', x + 47, y + 14)]),
      room('bank-strong', 'Strongroom', 'office', x + 40, y + 26, 14, 20, [spot('generic', x + 47, y + 36)]),
    ]);
  }
  // ── Bus stop (the way out west) ──
  b.busstop = mkBuilding('busstop', 'busstop', 'Bus stop', 'ebenezer', MX + 10, MY + 248, 30, 14, { x: MX + 25, y: MY + 248 }, [room('busstop-stop', 'Shelter', 'stop', MX + 10, MY + 248, 30, 14, grid('seat', MX + 12, MY + 250, 26, 10, 3, 1))]);

  // ════ HEBRON HEIGHTS (affluent) ════
  // ── Church ──
  {
    const x = 1150, y = 330, w = 104, h = 74;
    const naveX = x + 4, naveY = y + 4, naveW = 64, naveH = 66;
    const nave = room('rchurch-nave', 'Nave', 'nave', naveX, naveY, naveW, naveH, [spot('pulpit', naveX + naveW / 2, naveY + 7), spot('altar', naveX + naveW / 2 - 10, naveY + 8), spot('altar', naveX + naveW / 2 + 10, naveY + 8), ...grid('pew', naveX + 5, naveY + 18, naveW - 10, 44, 8, 6)]);
    const hall = room('rchurch-hall', 'Fellowship hall', 'hall', x + 72, y + 4, 28, 66, grid('bench', x + 75, y + 8, 22, 58, 2, 5));
    b.rchurch = mkBuilding('rchurch', 'church', 'Hebron Chapel', 'hebron', x, y, w, h, { x: x + 36, y }, [nave, hall]);
    b.rchurch.rooms.push(room('rchurch-yard', 'Churchyard', 'yard', x - 4, y - 10, w + 8, 10, grid('bench-out', x, y - 9, w, 8, 5, 1)));
  }
  // ── Deli / boutique shop ──
  {
    const x = 1050, y = 330, w = 76, h = 60;
    b.rshop = mkBuilding('rshop', 'market', 'Hebron Deli & Trading', 'hebron', x, y, w, h, { x: x + 38, y }, [
      room('rshop-floor', 'Shop floor', 'shop', x + 4, y + 4, 52, 52, [spot('counter', x + 30, y + 9), ...grid('stall', x + 8, y + 18, 44, 34, 3, 2)]),
      room('rshop-store', 'Storeroom', 'workshop', x + 58, y + 4, 14, 52, [spot('generic', x + 65, y + 20)]),
    ]);
  }
  // ── Professional chambers (attorneys, accountants, engineers) ──
  {
    const x = 930, y = 330, w = 96, h = 62;
    b.rpractice = mkBuilding('rpractice', 'office', 'Hebron Chambers', 'hebron', x, y, w, h, { x: x + 48, y }, [
      room('rpractice-suites', 'Professional suites', 'office', x + 4, y + 4, 88, 34, grid('desk', x + 8, y + 8, 80, 26, 4, 2)),
      room('rpractice-boardroom', 'Boardroom', 'office', x + 4, y + 42, 56, 16, grid('seat', x + 8, y + 44, 48, 12, 4, 1)),
      room('rpractice-reception', 'Reception', 'reception', x + 64, y + 42, 28, 16, [spot('counter', x + 78, y + 46), spot('seat', x + 70, y + 54), spot('seat', x + 86, y + 54)]),
    ]);
  }
  // ── Hebron Mutual Bank ──
  {
    const x = 1280, y = 336, w = 66, h = 50;
    b.rbank = mkBuilding('rbank', 'bank', 'Hebron Mutual Bank', 'hebron', x, y, w, h, { x: x + 33, y }, [
      room('rbank-hall', 'Banking hall', 'reception', x + 4, y + 4, 40, 42, [spot('counter', x + 36, y + 12), spot('counter', x + 36, y + 28), ...grid('seat', x + 8, y + 10, 16, 30, 2, 3)]),
      room('rbank-office', "Manager's office", 'office', x + 48, y + 4, 14, 42, [spot('desk', x + 55, y + 14), spot('generic', x + 55, y + 34)]),
    ]);
  }
  // ── Bus stop on Protea Avenue, beyond the bank ──
  b.rbusstop = mkBuilding('rbusstop', 'busstop', 'Hebron bus stop', 'hebron', 1350, 310, 30, 14, { x: 1365, y: 310 }, [room('rbusstop-stop', 'Shelter', 'stop', 1350, 310, 30, 14, grid('seat', 1352, 312, 26, 10, 3, 1))]);
  // ── Green ──
  {
    const x = 868, y = 66, w = 40, h = 226;
    b.rpark = mkBuilding('rpark', 'park', 'Hebron Green', 'hebron', x, y, w, h, { x: x + w, y: y + 113 }, [
      room('rpark-lawn', 'Lawn', 'pitch', x + 4, y + 4, 32, 190, grid('generic', x + 8, y + 10, 24, 178, 2, 5)),
      room('rpark-benches', 'Benches', 'yard', x + 4, y + 198, 32, 24, grid('bench-out', x + 6, y + 202, 28, 16, 2, 2)),
    ]);
  }

  // ════ KANANA (low-income) ════
  // ── Church ──
  {
    const x = 404, y = 866, w = 64, h = 58;
    const nave = room('pchurch-nave', 'Nave', 'nave', x + 4, y + 4, 56, 40, [spot('pulpit', x + 32, y + 9), ...grid('pew', x + 8, y + 16, 48, 24, 6, 4)]);
    const hall = room('pchurch-hall', 'Tent hall', 'hall', x + 4, y + 46, 56, 10, grid('bench', x + 6, y + 47, 52, 8, 4, 1));
    b.pchurch = mkBuilding('pchurch', 'church', 'Kanana Zion Church', 'kanana', x, y, w, h, { x: x + 32, y }, [nave, hall]);
    b.pchurch.rooms.push(room('pchurch-yard', 'Churchyard', 'yard', x - 4, y - 10, w + 8, 10, grid('bench-out', x, y - 9, w, 8, 4, 1)));
  }
  // ── Spaza shop ──
  {
    const x = 404, y = 940, w = 56, h = 44;
    b.pshop = mkBuilding('pshop', 'market', "Mama Grace's Spaza", 'kanana', x, y, w, h, { x: x + 28, y: y + h }, [
      room('pshop-floor', 'Shop', 'shop', x + 4, y + 4, 48, 36, [spot('counter', x + 28, y + 10), ...grid('stall', x + 8, y + 18, 40, 18, 3, 1)]),
    ]);
  }
  // ── Taxi association ──
  {
    const x = 984, y = 866, w = 60, h = 60;
    b.ptaxi = mkBuilding('ptaxi', 'workshop', 'Kanana Taxi Association', 'kanana', x, y, w, h, { x, y: y + 30 }, [
      room('ptaxi-yard', 'Taxi yard', 'garage', x + 4, y + 4, 52, 34, [spot('generic', x + 16, y + 20), spot('generic', x + 40, y + 20)]),
      room('ptaxi-office', 'Association office', 'office', x + 4, y + 42, 52, 14, [spot('desk', x + 16, y + 49), spot('counter', x + 40, y + 49)]),
    ]);
  }
  // ── Kanana Mutual Bank ──
  {
    const x = 984, y = 944, w = 60, h = 44;
    b.pbank = mkBuilding('pbank', 'bank', 'Kanana Mutual Bank', 'kanana', x, y, w, h, { x, y: y + 22 }, [
      room('pbank-hall', 'Banking hall', 'reception', x + 4, y + 4, 38, 36, [spot('counter', x + 34, y + 12), spot('counter', x + 34, y + 26), ...grid('seat', x + 8, y + 10, 14, 24, 2, 3)]),
      room('pbank-office', 'Office', 'office', x + 44, y + 4, 12, 36, [spot('desk', x + 50, y + 14)]),
    ]);
  }
  // ── Dust pitch ──
  {
    const x = 760, y = 1030, w = 110, h = 62;
    b.ppitch = mkBuilding('ppitch', 'park', 'Kanana Grounds', 'kanana', x, y, w, h, { x: x + 55, y }, [
      room('ppitch-pitch', 'Pitch', 'pitch', x + 4, y + 4, 102, 44, [spot('goal', x + 8, y + 26), spot('goal', x + 102, y + 26), ...grid('generic', x + 16, y + 10, 78, 32, 4, 2)]),
      room('ppitch-benches', 'Benches', 'yard', x + 4, y + 50, 102, 10, grid('bench-out', x + 8, y + 51, 94, 8, 5, 1)),
    ]);
  }
  // ── Bus shelter at the south exit ──
  b.pbusstop = mkBuilding('pbusstop', 'busstop', 'Kanana bus stop', 'kanana', 676, 1060, 30, 14, { x: 691, y: 1060 }, [room('pbusstop-stop', 'Shelter', 'stop', 676, 1060, 30, 14, grid('seat', 678, 1062, 26, 10, 3, 1))]);

  // ════ EMMAUS CROSSING (civic centre) ════
  // ── Council chamber ──
  {
    const x = 660, y = 566, w = 92, h = 70;
    b.council = mkBuilding('council', 'council', 'Emmaus District Council', 'crossing', x, y, w, h, { x: x + w, y: y + 35 }, [
      room('council-chamber', 'Council chamber', 'courtroom', x + 4, y + 4, 60, 62, [spot('bench', x + 34, y + 10), ...grid('desk', x + 10, y + 20, 48, 24, 4, 2), ...grid('seat', x + 10, y + 48, 48, 14, 5, 1)]),
      room('council-office', 'Registry', 'office', x + 66, y + 4, 22, 62, [spot('desk', x + 77, y + 16), spot('desk', x + 77, y + 40), spot('counter', x + 77, y + 58)]),
    ]);
  }
  // ── Commercial bank (the bankers' bank; reports to the SARB) ──
  {
    const x = 786, y = 566, w = 96, h = 66;
    b.combank = mkBuilding('combank', 'combank', 'Emmaus Commercial Bank', 'crossing', x, y, w, h, { x, y: y + 33 }, [
      room('combank-hall', 'Banking hall', 'reception', x + 4, y + 4, 52, 58, [spot('counter', x + 46, y + 14), spot('counter', x + 46, y + 32), spot('counter', x + 46, y + 50), ...grid('seat', x + 8, y + 12, 22, 42, 2, 4)]),
      room('combank-dealing', 'Treasury & settlements', 'office', x + 60, y + 4, 32, 34, grid('desk', x + 64, y + 8, 24, 26, 2, 2)),
      room('combank-strong', 'Vault', 'office', x + 60, y + 42, 32, 20, [spot('generic', x + 76, y + 52)]),
    ]);
  }
  // ── District medical centre ──
  {
    const x = 660, y = 650, w = 84, h = 60;
    b.medical = mkBuilding('medical', 'medical', 'Emmaus Medical Centre', 'crossing', x, y, w, h, { x: x + w, y: y + 30 }, [
      room('medical-reception', 'Reception', 'reception', x + 4, y + 4, 34, 52, [spot('counter', x + 22, y + 10), ...grid('seat', x + 8, y + 20, 26, 30, 2, 3)]),
      room('medical-consult', 'Consulting rooms', 'consult', x + 42, y + 4, 38, 32, [spot('desk', x + 52, y + 12), spot('exam', x + 70, y + 20), spot('seat', x + 46, y + 26)]),
      room('medical-office', "DMO's office", 'office', x + 42, y + 40, 38, 16, [spot('desk', x + 60, y + 48)]),
    ]);
  }
  // ── Magistrate's court (moved to the centre; keeps its id so every case still finds it) ──
  {
    const x = 782, y = 646, w = 90, h = 76;
    b.court = mkBuilding('court', 'court', "Magistrate's Court", 'crossing', x, y, w, h, { x, y: y + 38 }, [
      room('court-room', 'Courtroom', 'courtroom', x + 4, y + 4, 82, 52, [spot('bench', x + 45, y + 10), spot('desk', x + 20, y + 22), spot('desk', x + 70, y + 22), spot('generic', x + 45, y + 24), ...grid('seat', x + 12, y + 32, 66, 20, 6, 2)]),
      room('court-clerk', "Clerk's office", 'office', x + 4, y + 60, 82, 12, [spot('desk', x + 24, y + 66), spot('desk', x + 64, y + 66)]),
    ]);
  }
  // ── Emmaus Square ──
  {
    const x = 656, y = 722, w = 108, h = 34;
    b.plaza = mkBuilding('plaza', 'park', 'Emmaus Square', 'crossing', x, y, w, h, { x: x + w, y: y + 17 }, [
      room('plaza-square', 'Square', 'yard', x + 4, y + 4, 100, 26, [...grid('bench-out', x + 8, y + 6, 88, 20, 4, 2), spot('generic', x + 54, y + 17)]),
    ]);
  }

  return b;
}
