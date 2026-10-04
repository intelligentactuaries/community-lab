// Building builders shared by the city layouts. Each takes a footprint and
// which side its door faces, and lays out rooms and furniture spots to fit,
// so a layout file reads as a plan ("a school here, a clinic there") rather
// than a table of coordinates. Emmaus, the original village, keeps its
// hand-drawn interiors in emmaus.ts; the newer cities and the centre are
// built from these.

import type { Building, BuildingKind, CommunityId, Room, Spot } from '../types';

export type Facing = 'N' | 'S' | 'E' | 'W';

let spotSeq = 0;

/** Spot ids run in one sequence across every layout, so a rebuild reproduces them. */
export function resetSpots(): void {
  spotSeq = 0;
}

export function spot(kind: Spot['kind'], x: number, y: number): Spot {
  spotSeq++;
  return { id: `s${spotSeq}`, kind, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

/** A double bed. */
export function double(x: number, y: number): Spot {
  return { ...spot('bed', x, y), double: true };
}

export function room(id: string, name: string, kind: Room['kind'], x: number, y: number, w: number, h: number, spots: Spot[]): Room {
  return { id, name, kind, x, y, w, h, spots };
}

/** Grid of spots inside a rectangle. */
export function grid(kind: Spot['kind'], x: number, y: number, w: number, h: number, cols: number, rows: number): Spot[] {
  const out: Spot[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push(spot(kind, x + ((c + 0.5) * w) / cols, y + ((r + 0.5) * h) / rows));
    }
  }
  return out;
}

/**
 * Chairs round a table centred at (cx, cy): half along the north side and half along the south,
 * facing each other across it, a place's width apart (a household's dining table).
 */
export function dining(cx: number, cy: number, n: number): Spot[] {
  const north = Math.ceil(n / 2);
  const out: Spot[] = [];
  for (let i = 0; i < n; i++) {
    const row = i < north ? -1 : 1;
    const k = i < north ? i : i - north;
    const m = i < north ? north : n - north;
    out.push(spot('table', cx + (k - (m - 1) / 2) * 0.62, cy + row * 0.9));
  }
  return out;
}

/** Easy chairs facing each other across a coffee table at (cx, cy), two by two. */
export function lounge(cx: number, cy: number, n: number): Spot[] {
  const north = Math.ceil(n / 2);
  const out: Spot[] = [];
  for (let i = 0; i < n; i++) {
    const row = i < north ? -1 : 1;
    const k = i < north ? i : i - north;
    const m = i < north ? north : n - north;
    out.push(spot('seat', cx + (k - (m - 1) / 2) * 1.0, cy + row * 1.0));
  }
  return out;
}

export function mkBuilding(id: string, kind: BuildingKind, name: string, community: CommunityId, x: number, y: number, w: number, h: number, entrance: { x: number; y: number }, rooms: Room[], plot: number | null = null): Building {
  return { id, kind, name, x, y, w, h, entrance, roadNode: '', rooms, community, householdId: null, plot, lit: false };
}

export function entranceFor(x: number, y: number, w: number, h: number, facing: Facing): { x: number; y: number } {
  switch (facing) {
    case 'N':
      return { x: x + w / 2, y };
    case 'S':
      return { x: x + w / 2, y: y + h };
    case 'W':
      return { x, y: y + h / 2 };
    case 'E':
      return { x: x + w, y: y + h / 2 };
  }
}

/** A strip of yard outside the footprint on the door side (churchyards, market squares). */
function apron(id: string, name: string, x: number, y: number, w: number, h: number, facing: Facing, depth: number, benches: number): Room {
  switch (facing) {
    case 'S':
      return room(id, name, 'yard', x - 4, y + h, w + 8, depth, grid('bench-out', x, y + h + 1, w, depth - 2, benches, 1));
    case 'N':
      return room(id, name, 'yard', x - 4, y - depth, w + 8, depth, grid('bench-out', x, y - depth + 1, w, depth - 2, benches, 1));
    case 'E':
      return room(id, name, 'yard', x + w, y - 4, depth, h + 8, grid('bench-out', x + w + 1, y, depth - 2, h, 1, benches));
    case 'W':
      return room(id, name, 'yard', x - depth, y - 4, depth, h + 8, grid('bench-out', x - depth + 1, y, depth - 2, h, 1, benches));
  }
}

interface Box {
  id: string;
  name: string;
  com: CommunityId;
  x: number;
  y: number;
  w: number;
  h: number;
  facing: Facing;
}

const M = 4; // interior margin

/** Church: nave with pulpit and pews, a fellowship hall beside it (or a tent hall below it when small), a churchyard at the door. */
export function church(o: Box & { size: 'large' | 'medium' | 'small' }): Building {
  const { id, x, y, w, h } = o;
  const rooms: Room[] = [];
  if (o.size === 'small') {
    const naveH = h - M * 2 - 12;
    const naveW = w - M * 2;
    const cols = Math.max(4, Math.floor((naveW - 8) / 8));
    const rows = Math.max(3, Math.floor((naveH - 16) / 6));
    rooms.push(room(`${id}-nave`, 'Nave', 'nave', x + M, y + M, naveW, naveH, [spot('pulpit', x + w / 2, y + M + 5), ...grid('pew', x + M + 4, y + M + 12, naveW - 8, naveH - 16, cols, rows)]));
    rooms.push(room(`${id}-hall`, 'Tent hall', 'hall', x + M, y + M + naveH + 2, naveW, 10, grid('bench', x + M + 2, y + M + naveH + 3, naveW - 4, 8, Math.max(3, Math.floor(naveW / 14)), 1)));
  } else {
    const hallW = o.size === 'large' ? Math.round(w * 0.3) : Math.round(w * 0.28);
    const naveW = w - M * 3 - hallW;
    const naveH = h - M * 2;
    const nx = x + M;
    const ny = y + M;
    const cols = Math.max(5, Math.floor((naveW - 12) / 7));
    const rows = Math.max(4, Math.floor((naveH - 26) / 7));
    rooms.push(room(`${id}-nave`, 'Nave', 'nave', nx, ny, naveW, naveH, [spot('pulpit', nx + naveW / 2, ny + 8), spot('altar', nx + naveW / 2 - 12, ny + 9), spot('altar', nx + naveW / 2 + 12, ny + 9), ...grid('pew', nx + 6, ny + 22, naveW - 12, naveH - 26, cols, rows)]));
    const hx = nx + naveW + M;
    rooms.push(room(`${id}-hall`, 'Fellowship hall', 'hall', hx, ny, hallW, naveH, grid('bench', hx + 3, ny + 4, hallW - 6, naveH - 8, Math.max(2, Math.floor(hallW / 12)), Math.max(4, Math.floor(naveH / 12)))));
  }
  const b = mkBuilding(id, 'church', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), rooms);
  b.rooms.push(apron(`${id}-yard`, 'Churchyard', x, y, w, h, o.facing, 10, Math.max(3, Math.floor(w / 20))));
  return b;
}

/** Community hall or memorial hall: a main hall with benches and a kitchen. */
export function hall(o: Box): Building {
  const { id, x, y, w, h } = o;
  const kw = Math.max(14, Math.round(w * 0.2));
  const mw = w - M * 3 - kw;
  const mh = h - M * 2;
  return mkBuilding(id, 'hall', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [
    room(`${id}-main`, 'Hall', 'hall', x + M, y + M, mw, mh, grid('bench', x + M + 4, y + M + 6, mw - 8, mh - 12, Math.max(3, Math.floor(mw / 12)), Math.max(3, Math.floor(mh / 11)))),
    room(`${id}-kitchen`, 'Kitchen', 'kitchen', x + M * 2 + mw, y + M, kw, mh, [spot('stove', x + M * 2 + mw + kw / 2, y + M + 8), spot('table', x + M * 2 + mw + kw / 2, y + M + mh * 0.45), spot('table', x + M * 2 + mw + kw / 2, y + M + mh * 0.75)]),
  ]);
}

/** Library and reading rooms — the secular city's meeting place. */
export function library(o: Box): Building {
  const { id, x, y, w, h } = o;
  const rw = Math.round(w * 0.45);
  const sw = w - M * 3 - rw;
  const ih = h - M * 2;
  const rx = x + M;
  const sx = rx + rw + M;
  return mkBuilding(id, 'library', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [
    room(`${id}-reading`, 'Reading room', 'library', rx, y + M, rw, ih, [spot('counter', rx + rw / 2, y + M + 5), ...grid('desk', rx + 4, y + M + 12, rw - 8, ih - 16, Math.max(2, Math.floor(rw / 12)), Math.max(2, Math.floor((ih - 16) / 12)))]),
    room(`${id}-stacks`, 'Stacks', 'library', sx, y + M, sw, ih * 0.62, grid('generic', sx + 4, y + M + 4, sw - 8, ih * 0.62 - 8, Math.max(2, Math.floor(sw / 12)), 2)),
    room(`${id}-office`, 'Office', 'office', sx, y + M + ih * 0.62 + 2, sw, ih * 0.38 - 2, [spot('desk', sx + sw / 2, y + M + ih * 0.8)]),
  ]);
}

/** School: classrooms and a staff room across the top, the playground below. */
export function school(o: Box): Building {
  const { id, x, y, w, h } = o;
  const topH = Math.round(h * 0.42);
  const staffW = Math.max(24, Math.round(w * 0.26));
  const classW = Math.round((w - M * 4 - staffW) / 2);
  const c1x = x + M;
  const c2x = c1x + classW + M;
  const sx = c2x + classW + M;
  const cls = (cx: number, rid: string, name: string) => room(`${id}-${rid}`, name, 'classroom', cx, y + M, classW, topH, [spot('desk', cx + classW / 2, y + M + 4), ...grid('desk', cx + 3, y + M + 9, classW - 6, topH - 12, Math.max(3, Math.floor(classW / 8)), 3)]);
  const py = y + M + topH + M;
  const ph = h - topH - M * 3;
  return mkBuilding(id, 'school', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [
    cls(c1x, 'c1', 'Foundation class'),
    cls(c2x, 'c2', 'Senior class'),
    room(`${id}-office`, 'Staff room', 'office', sx, y + M, staffW, topH, grid('desk', sx + 4, y + M + 6, staffW - 8, topH - 12, 2, 2)),
    room(`${id}-yard`, 'Playground', 'yard', x + M, py, w - M * 2, ph, [...grid('generic', x + M + 6, py + 4, w - M * 2 - 12, ph - 8, 5, 2), spot('goal', x + M + 4, py + ph / 2), spot('goal', x + w - M - 4, py + ph / 2)]),
  ]);
}

/** Clinic: reception and consulting room in front, a six-bed ward and dispensary behind. */
export function clinic(o: Box): Building {
  const { id, x, y, w, h } = o;
  const topH = Math.round(h * 0.4);
  const halfW = Math.round((w - M * 3) / 2);
  const rx = x + M;
  const cx = rx + halfW + M;
  const wy = y + M + topH + M;
  const wh = h - topH - M * 3;
  const wardW = Math.round(w * 0.7) - M;
  const dx = rx + wardW + M;
  return mkBuilding(id, 'clinic', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [
    room(`${id}-reception`, 'Reception', 'reception', rx, y + M, halfW, topH, [spot('counter', rx + halfW / 2, y + M + 4), ...grid('seat', rx + 3, y + M + 10, halfW - 6, topH - 14, 3, 2)]),
    room(`${id}-consult`, 'Consulting room', 'consult', cx, y + M, halfW, topH, [spot('desk', cx + halfW * 0.3, y + M + 6), spot('exam', cx + halfW * 0.72, y + M + topH * 0.6), spot('seat', cx + halfW * 0.2, y + M + topH * 0.75)]),
    room(`${id}-ward`, 'Ward', 'ward', rx, wy, wardW, wh, grid('ward', rx + 4, wy + 4, wardW - 8, wh - 8, 3, 2)),
    room(`${id}-pharmacy`, 'Dispensary', 'shop', dx, wy, w - M - (dx - x), wh, [spot('counter', dx + (w - M - (dx - x)) / 2, wy + 8), spot('desk', dx + (w - M - (dx - x)) / 2, wy + wh - 8)]),
  ]);
}

/** Police station: charge office in front, holding cells and the vehicle bay behind. */
export function police(o: Box & { cells?: number }): Building {
  const { id, x, y, w, h } = o;
  const topH = Math.round(h * 0.38);
  const iw = w - M * 2;
  const by = y + M + topH + M;
  const bh = h - topH - M * 3;
  const cellW = Math.round(iw * 0.42);
  const cells = o.cells ?? 2;
  return mkBuilding(id, 'police', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [
    room(`${id}-charge`, 'Charge office', 'reception', x + M, y + M, iw, topH, [spot('counter', x + w / 2, y + M + 5), ...grid('desk', x + M + 4, y + M + 10, iw - 8, topH - 12, Math.max(2, Math.floor(iw / 24)), 1), spot('seat', x + w / 2, y + M + topH - 4)]),
    room(`${id}-cells`, 'Holding cells', 'cell', x + M, by, cellW, bh, grid('cell', x + M + 3, by + 4, cellW - 6, bh - 8, 1, cells)),
    room(`${id}-garage`, 'Vehicle bay', 'garage', x + M + cellW + M, by, iw - cellW - M, bh, grid('generic', x + M + cellW + M + 4, by + 4, iw - cellW - M - 8, bh - 8, 1, 2)),
  ]);
}

/** A shop of any size: a floor with counter and stalls, a storeroom, and a square out front for the market-sized ones. */
export function shop(o: Box & { front?: boolean; stalls?: [number, number] }): Building {
  const { id, x, y, w, h } = o;
  const storeW = w >= 70 ? Math.round(w * 0.2) : 0;
  const fw = w - M * 2 - (storeW ? storeW + M : 0);
  const fh = h - M * 2;
  const [sc, sr] = o.stalls ?? [Math.max(2, Math.floor(fw / 18)), Math.max(1, Math.floor((fh - 14) / 16))];
  const rooms: Room[] = [room(`${id}-floor`, 'Shop floor', 'shop', x + M, y + M, fw, fh, [spot('counter', x + M + fw / 2, y + M + 6), ...grid('stall', x + M + 4, y + M + 14, fw - 8, fh - 18, sc, sr)])];
  if (storeW) rooms.push(room(`${id}-store`, 'Storeroom', 'workshop', x + M * 2 + fw, y + M, storeW, fh, [spot('generic', x + M * 2 + fw + storeW / 2, y + M + fh * 0.3), spot('generic', x + M * 2 + fw + storeW / 2, y + M + fh * 0.7)]));
  const b = mkBuilding(id, 'market', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), rooms);
  if (o.front) b.rooms.push(apron(`${id}-front`, 'Market square', x, y, w, h, o.facing, 10, 4));
  return b;
}

/** Bank counter or branch: a banking hall with counters and seats, a manager's office and a strongroom. */
export function bank(o: Box & { kind?: 'bank' | 'combank' | 'reservebank' }): Building {
  const { id, x, y, w, h } = o;
  const kind = o.kind ?? 'bank';
  const hallW = Math.round((w - M * 3) * 0.62);
  const sideW = w - M * 3 - hallW;
  const ih = h - M * 2;
  const hx = x + M;
  const sx = hx + hallW + M;
  const counters = kind === 'bank' ? 2 : 3;
  const rooms: Room[] = [
    room(`${id}-hall`, kind === 'reservebank' ? 'Banking hall' : 'Banking hall', 'reception', hx, y + M, hallW, ih, [...grid('counter', hx + hallW - 8, y + M + 6, 6, ih - 12, 1, counters), ...grid('seat', hx + 4, y + M + 6, hallW * 0.5, ih - 12, 2, Math.max(2, Math.floor(ih / 12)))]),
  ];
  if (kind === 'bank') {
    rooms.push(room(`${id}-office`, "Manager's office", 'office', sx, y + M, sideW, ih * 0.5 - 1, [spot('desk', sx + sideW / 2, y + M + ih * 0.25)]));
    rooms.push(room(`${id}-strong`, 'Strongroom', 'office', sx, y + M + ih * 0.5 + 1, sideW, ih * 0.5 - 1, [spot('generic', sx + sideW / 2, y + M + ih * 0.75)]));
  } else {
    rooms.push(room(`${id}-dealing`, kind === 'reservebank' ? 'Monetary policy & markets' : 'Treasury & settlements', 'office', sx, y + M, sideW, ih * 0.6 - 1, grid('desk', sx + 4, y + M + 4, sideW - 8, ih * 0.6 - 9, 2, 2)));
    rooms.push(room(`${id}-strong`, 'Vault', 'office', sx, y + M + ih * 0.6 + 1, sideW, ih * 0.4 - 1, [spot('generic', sx + sideW / 2, y + M + ih * 0.8)]));
  }
  return mkBuilding(id, kind, o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), rooms);
}

/** Park or sports ground: a pitch with goals and a strip of benches. */
export function park(o: Box & { benches?: 'bottom' | 'right' }): Building {
  const { id, x, y, w, h } = o;
  const side = o.benches ?? (w > h ? 'bottom' : 'bottom');
  const bh = 14;
  const ph = h - M * 2 - bh - 2;
  const pw = w - M * 2;
  const rooms: Room[] = [];
  if (side === 'bottom') {
    rooms.push(room(`${id}-pitch`, 'Pitch', 'pitch', x + M, y + M, pw, ph, [spot('goal', x + M + 4, y + M + ph / 2), spot('goal', x + M + pw - 4, y + M + ph / 2), ...grid('generic', x + M + 8, y + M + 6, pw - 16, ph - 12, Math.max(3, Math.floor(pw / 22)), Math.max(2, Math.floor(ph / 22)))]));
    rooms.push(room(`${id}-benches`, 'Benches', 'yard', x + M, y + M + ph + 2, pw, bh, grid('bench-out', x + M + 2, y + M + ph + 3, pw - 4, bh - 2, Math.max(3, Math.floor(pw / 22)), 1)));
  }
  return mkBuilding(id, 'park', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), rooms);
}

/** Farm: barn and office, fields, a livestock pen. */
export function farm(o: Box): Building {
  const { id, x, y, w, h } = o;
  const iw = w - M * 2;
  const barnH = Math.round(h * 0.22);
  const penH = Math.round(h * 0.18);
  const fieldY = y + M + barnH + M;
  const fieldH = h - barnH - penH - M * 4;
  return mkBuilding(id, 'farm', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [
    room(`${id}-barn`, 'Barn & office', 'workshop', x + M, y + M, iw, barnH, [spot('desk', x + M + 8, y + M + barnH / 2), spot('generic', x + M + iw * 0.5, y + M + barnH / 2), spot('generic', x + M + iw * 0.85, y + M + barnH / 2)]),
    room(`${id}-field`, 'Fields', 'field', x + M, fieldY, iw, fieldH, grid('generic', x + M + 4, fieldY + 4, iw - 8, fieldH - 8, 3, Math.max(2, Math.floor(fieldH / 20)))),
    room(`${id}-pen`, 'Livestock pen', 'pen', x + M, fieldY + fieldH + M, iw, penH, [spot('generic', x + M + iw * 0.3, fieldY + fieldH + M + penH / 2), spot('generic', x + M + iw * 0.7, fieldY + fieldH + M + penH / 2)]),
  ]);
}

/** Workshop floor. */
export function workshop(o: Box): Building {
  const { id, x, y, w, h } = o;
  return mkBuilding(id, 'workshop', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [
    room(`${id}-floor`, 'Workshop', 'workshop', x + M, y + M, w - M * 2, h - M * 2, grid('generic', x + M + 4, y + M + 4, w - M * 2 - 8, h - M * 2 - 8, 3, 1)),
  ]);
}

/** Open-plan offices; `floors` splits the footprint into side-by-side floors for a tower. */
export function office(o: Box & { floors?: number; kind?: 'office' | 'towers' | 'govt' }): Building {
  const { id, x, y, w, h } = o;
  const floors = o.floors ?? 1;
  const iw = (w - M * (floors + 1)) / floors;
  const ih = h - M * 2;
  const rooms: Room[] = [];
  for (let f = 0; f < floors; f++) {
    const fx = x + M + f * (iw + M);
    rooms.push(room(`${id}-f${f + 1}`, floors > 1 ? `Floor ${f + 1}` : 'Open-plan office', 'office', fx, y + M, iw, ih, grid('desk', fx + 4, y + M + 4, iw - 8, ih - 8, Math.max(2, Math.floor(iw / 14)), Math.max(2, Math.floor(ih / 14)))));
  }
  return mkBuilding(id, o.kind ?? 'office', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), rooms);
}

/** Cemetery: graves are added as people are buried. */
export function cemetery(o: Box): Building {
  const { id, x, y, w, h } = o;
  return mkBuilding(id, 'cemetery', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [room(`${id}-graves`, 'Graves', 'graves', x + M, y + M, w - M * 2, h - M * 2, [])]);
}

/** Bus shelter. */
export function busstop(o: Omit<Box, 'facing'> & { facing?: Facing }): Building {
  const { id, x, y, w, h } = o;
  return mkBuilding(id, 'busstop', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing ?? 'N'), [room(`${id}-stop`, 'Shelter', 'stop', x, y, w, h, grid('seat', x + 2, y + 2, w - 4, h - 4, 3, 1))]);
}

/** Taxi rank / association: a yard for the minibuses and the association office. */
export function taxirank(o: Box & { bays?: number }): Building {
  const { id, x, y, w, h } = o;
  const iw = w - M * 2;
  const officeH = 14;
  const yardH = h - M * 3 - officeH;
  return mkBuilding(id, 'workshop', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [
    room(`${id}-yard`, 'Taxi yard', 'garage', x + M, y + M, iw, yardH, grid('generic', x + M + 4, y + M + 4, iw - 8, yardH - 8, o.bays ?? 2, 1)),
    room(`${id}-office`, 'Association office', 'office', x + M, y + M + yardH + M, iw, officeH, [spot('desk', x + M + iw * 0.3, y + M + yardH + M + officeH / 2), spot('counter', x + M + iw * 0.7, y + M + yardH + M + officeH / 2)]),
  ]);
}

/** Council chamber and registry. */
export function council(o: Box): Building {
  const { id, x, y, w, h } = o;
  const regW = Math.max(18, Math.round(w * 0.24));
  const cw = w - M * 3 - regW;
  const ih = h - M * 2;
  const cx = x + M;
  const rx = cx + cw + M;
  return mkBuilding(id, 'council', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [
    room(`${id}-chamber`, 'Council chamber', 'courtroom', cx, y + M, cw, ih, [spot('bench', cx + cw / 2, y + M + 6), ...grid('desk', cx + 6, y + M + 14, cw - 12, ih * 0.4, 4, 2), ...grid('seat', cx + 6, y + M + ih * 0.7, cw - 12, ih * 0.25, 5, 1)]),
    room(`${id}-office`, 'Registry', 'office', rx, y + M, regW, ih, [spot('desk', rx + regW / 2, y + M + ih * 0.2), spot('desk', rx + regW / 2, y + M + ih * 0.55), spot('counter', rx + regW / 2, y + M + ih * 0.85)]),
  ]);
}

/** Medical centre: reception, consulting rooms, the medical officer's office. */
export function medical(o: Box): Building {
  const { id, x, y, w, h } = o;
  const rw = Math.round((w - M * 3) * 0.42);
  const cw = w - M * 3 - rw;
  const ih = h - M * 2;
  const rx = x + M;
  const cx = rx + rw + M;
  const ch = Math.round(ih * 0.58);
  return mkBuilding(id, 'medical', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [
    room(`${id}-reception`, 'Reception', 'reception', rx, y + M, rw, ih, [spot('counter', rx + rw / 2, y + M + 6), ...grid('seat', rx + 4, y + M + 14, rw - 8, ih - 20, 2, 3)]),
    room(`${id}-consult`, 'Consulting rooms', 'consult', cx, y + M, cw, ch, [spot('desk', cx + cw * 0.25, y + M + 8), spot('exam', cx + cw * 0.72, y + M + ch * 0.55), spot('seat', cx + cw * 0.12, y + M + ch * 0.75)]),
    room(`${id}-office`, "DMO's office", 'office', cx, y + M + ch + M, cw, ih - ch - M, [spot('desk', cx + cw / 2, y + M + ch + M + (ih - ch - M) / 2)]),
  ]);
}

/** Magistrate's court: courtroom and the clerk's office. */
export function court(o: Box): Building {
  const { id, x, y, w, h } = o;
  const iw = w - M * 2;
  const clerkH = 12;
  const ch = h - M * 3 - clerkH;
  const cx = x + M;
  const cy = y + M;
  return mkBuilding(id, 'court', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [
    room(`${id}-room`, 'Courtroom', 'courtroom', cx, cy, iw, ch, [spot('bench', cx + iw / 2, cy + 6), spot('desk', cx + iw * 0.22, cy + 18), spot('desk', cx + iw * 0.78, cy + 18), spot('generic', cx + iw / 2, cy + 20), ...grid('seat', cx + 8, cy + 28, iw - 16, ch - 32, 6, 2)]),
    room(`${id}-clerk`, "Clerk's office", 'office', cx, cy + ch + M, iw, clerkH, [spot('desk', cx + iw * 0.25, cy + ch + M + clerkH / 2), spot('desk', cx + iw * 0.75, cy + ch + M + clerkH / 2)]),
  ]);
}

/** A civic square. */
export function plaza(o: Box): Building {
  const { id, x, y, w, h } = o;
  return mkBuilding(id, 'park', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [
    room(`${id}-square`, 'Square', 'yard', x + M, y + M, w - M * 2, h - M * 2, [...grid('bench-out', x + M + 4, y + M + 2, w - M * 2 - 8, h - M * 2 - 4, 4, 2), spot('generic', x + w / 2, y + h / 2)]),
  ]);
}

// ─── The centre ─────────────────────────────────────────────────────────────

/** The central hospital: outpatients and theatres in front, the wards, ICU, pharmacy and administration behind. */
export function hospital(o: Box): Building {
  const { id, x, y, w, h } = o;
  const iw = w - M * 2;
  const topH = Math.round(h * 0.34);
  const midH = Math.round(h * 0.2);
  const botY = y + M + topH + M + midH + M;
  const botH = h - topH - midH - M * 4;
  const rx = x + M;
  const recW = Math.round(iw * 0.24);
  const outW = Math.round(iw * 0.34);
  const thW = iw - recW - outW - M * 2;
  const ox = rx + recW + M;
  const tx = ox + outW + M;
  const icuW = Math.round(iw * 0.34);
  const admW = Math.round(iw * 0.3);
  const phW = iw - icuW - admW - M * 2;
  const wardW = Math.round((iw - M) / 2);
  return mkBuilding(id, 'hospital', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [
    room(`${id}-reception`, 'Reception & casualty', 'reception', rx, y + M, recW, topH, [spot('counter', rx + recW / 2, y + M + 6), ...grid('seat', rx + 4, y + M + 14, recW - 8, topH - 20, 3, 3)]),
    room(`${id}-outpatients`, 'Outpatients & specialists', 'consult', ox, y + M, outW, topH, [spot('desk', ox + outW * 0.2, y + M + 8), spot('exam', ox + outW * 0.42, y + M + topH * 0.55), spot('desk', ox + outW * 0.65, y + M + 8), spot('exam', ox + outW * 0.85, y + M + topH * 0.55), spot('seat', ox + outW * 0.15, y + M + topH * 0.8), spot('seat', ox + outW * 0.6, y + M + topH * 0.8)]),
    room(`${id}-theatre`, 'Operating theatres', 'theatre', tx, y + M, thW, topH, [spot('exam', tx + thW * 0.3, y + M + topH * 0.5), spot('exam', tx + thW * 0.7, y + M + topH * 0.5), spot('desk', tx + thW * 0.5, y + M + topH * 0.85)]),
    room(`${id}-icu`, 'Intensive care', 'ward', rx, y + M + topH + M, icuW, midH, grid('ward', rx + 4, y + M + topH + M + 3, icuW - 8, midH - 6, 3, 2)),
    room(`${id}-admin`, 'Administration', 'office', rx + icuW + M, y + M + topH + M, admW, midH, grid('desk', rx + icuW + M + 4, y + M + topH + M + 3, admW - 8, midH - 6, 3, 2)),
    room(`${id}-pharmacy`, 'Pharmacy', 'shop', rx + icuW + admW + M * 2, y + M + topH + M, phW, midH, [spot('counter', rx + icuW + admW + M * 2 + phW / 2, y + M + topH + M + 6), spot('desk', rx + icuW + admW + M * 2 + phW / 2, y + M + topH + M + midH - 6)]),
    room(`${id}-warda`, 'Ward A (surgical)', 'ward', rx, botY, wardW, botH, grid('ward', rx + 4, botY + 4, wardW - 8, botH - 8, 4, 3)),
    room(`${id}-wardb`, 'Ward B (medical)', 'ward', rx + wardW + M, botY, wardW, botH, grid('ward', rx + wardW + M + 4, botY + 4, wardW - 8, botH - 8, 4, 3)),
  ]);
}

/** Government House: the legislature's chamber, the executive's offices and the departments. */
export function govt(o: Box): Building {
  const { id, x, y, w, h } = o;
  const iw = w - M * 2;
  const ih = h - M * 2;
  const chW = Math.round(iw * 0.4);
  const cx = x + M;
  const dx = cx + chW + M;
  const dw = iw - chW - M;
  const recH = 14;
  const dh = (ih - recH - M * 2) / 2;
  return mkBuilding(id, 'govt', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [
    room(`${id}-chamber`, 'Legislature', 'courtroom', cx, y + M, chW, ih, [spot('bench', cx + chW / 2, y + M + 6), ...grid('desk', cx + 6, y + M + 14, chW - 12, ih * 0.45, 4, 3), ...grid('seat', cx + 6, y + M + ih * 0.72, chW - 12, ih * 0.22, 5, 1)]),
    room(`${id}-reception`, 'Reception', 'reception', dx, y + M, dw, recH, [spot('counter', dx + dw / 2, y + M + recH / 2), spot('seat', dx + dw * 0.2, y + M + recH / 2), spot('seat', dx + dw * 0.8, y + M + recH / 2)]),
    room(`${id}-executive`, "Premier's office & cabinet", 'office', dx, y + M + recH + M, dw, dh, [spot('desk', dx + dw * 0.5, y + M + recH + M + dh * 0.3), ...grid('seat', dx + 4, y + M + recH + M + dh * 0.55, dw - 8, dh * 0.35, 4, 1)]),
    room(`${id}-departments`, 'Departments', 'office', dx, y + M + recH + M * 2 + dh, dw, dh, grid('desk', dx + 4, y + M + recH + M * 2 + dh + 3, dw - 8, dh - 6, Math.max(3, Math.floor(dw / 14)), 2)),
  ]);
}

/** The mall: a concourse with a food court and four shops off it. */
export function mall(o: Box & { shops: Array<{ id: string; name: string }> }): Building {
  const { id, x, y, w, h } = o;
  const iw = w - M * 2;
  const ih = h - M * 2;
  const concH = Math.round(ih * 0.3);
  const shopH = (ih - concH - M * 2) / 2;
  const n = o.shops.length;
  const shopW = (iw - M * (Math.ceil(n / 2) - 1)) / Math.ceil(n / 2);
  const rooms: Room[] = [room(`${id}-concourse`, 'Concourse & food court', 'hall', x + M, y + M + shopH + M, iw, concH, [...grid('table', x + M + 8, y + M + shopH + M + 3, iw - 16, concH - 6, Math.max(4, Math.floor(iw / 24)), 2), ...grid('bench', x + M + 4, y + M + shopH + M + concH - 4, iw - 8, 2, 4, 1)])];
  o.shops.forEach((s, i) => {
    const col = i % Math.ceil(n / 2);
    const rowTop = i < Math.ceil(n / 2);
    const sx = x + M + col * (shopW + M);
    const sy = rowTop ? y + M : y + M + shopH + M + concH + M;
    rooms.push(room(`${id}-${s.id}`, s.name, 'shop', sx, sy, shopW, shopH, [spot('counter', sx + shopW / 2, rowTop ? sy + shopH - 6 : sy + 6), ...grid('stall', sx + 4, rowTop ? sy + 4 : sy + 12, shopW - 8, shopH - 16, Math.max(2, Math.floor(shopW / 16)), 2)]));
  });
  return mkBuilding(id, 'mall', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), rooms);
}

/** The stadium: a pitch between two stands. */
export function stadium(o: Box): Building {
  const { id, x, y, w, h } = o;
  const iw = w - M * 2;
  const ih = h - M * 2;
  const standH = Math.round(ih * 0.24);
  const px = x + M + 10;
  const pw = iw - 20;
  const py = y + M + standH + M;
  const ph = ih - standH * 2 - M * 2;
  return mkBuilding(id, 'stadium', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [
    room(`${id}-north`, 'North stand', 'stand', x + M, y + M, iw, standH, grid('seat', x + M + 6, y + M + 3, iw - 12, standH - 6, Math.max(8, Math.floor(iw / 6)), 3)),
    room(`${id}-pitch`, 'Pitch', 'pitch', px, py, pw, ph, [spot('goal', px + 6, py + ph / 2), spot('goal', px + pw - 6, py + ph / 2), ...grid('generic', px + 14, py + 6, pw - 28, ph - 12, 6, 3)]),
    room(`${id}-south`, 'South stand', 'stand', x + M, y + M + ih - standH, iw, standH, grid('seat', x + M + 6, y + M + ih - standH + 3, iw - 12, standH - 6, Math.max(8, Math.floor(iw / 6)), 3)),
  ]);
}

/** The concert hall: foyer, auditorium and stage. */
export function concertHall(o: Box): Building {
  const { id, x, y, w, h } = o;
  const iw = w - M * 2;
  const ih = h - M * 2;
  const foyerH = 14;
  const stageH = Math.round(ih * 0.22);
  const audH = ih - foyerH - stageH - M * 2;
  const fy = o.facing === 'S' ? y + M + ih - foyerH : y + M;
  const ay = o.facing === 'S' ? y + M + stageH + M : y + M + foyerH + M;
  const sy = o.facing === 'S' ? y + M : y + M + ih - stageH;
  return mkBuilding(id, 'concert', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [
    room(`${id}-foyer`, 'Foyer', 'reception', x + M, fy, iw, foyerH, [spot('counter', x + M + iw * 0.5, fy + foyerH / 2), ...grid('seat', x + M + 6, fy + 3, iw * 0.35, foyerH - 6, 3, 1)]),
    room(`${id}-auditorium`, 'Auditorium', 'auditorium', x + M, ay, iw, audH, grid('seat', x + M + 8, ay + 4, iw - 16, audH - 8, Math.max(8, Math.floor(iw / 6)), Math.max(4, Math.floor(audH / 6)))),
    room(`${id}-stage`, 'Stage', 'stage', x + M, sy, iw, stageH, grid('generic', x + M + iw * 0.25, sy + 4, iw * 0.5, stageH - 8, 3, 1)),
  ]);
}

/** Sports centre: courts, the pool and benches. */
export function sportsCentre(o: Box): Building {
  const { id, x, y, w, h } = o;
  const iw = w - M * 2;
  const ih = h - M * 2;
  const bh = 12;
  const halfW = (iw - M) / 2;
  const ph = ih - bh - M;
  return mkBuilding(id, 'sports', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [
    room(`${id}-courts`, 'Courts', 'pitch', x + M, y + M, halfW, ph, [spot('goal', x + M + 4, y + M + ph / 2), spot('goal', x + M + halfW - 4, y + M + ph / 2), ...grid('generic', x + M + 8, y + M + 6, halfW - 16, ph - 12, 3, 2)]),
    room(`${id}-pool`, 'Pool', 'pitch', x + M + halfW + M, y + M, halfW, ph, grid('generic', x + M + halfW + M + 8, y + M + 6, halfW - 16, ph - 12, 3, 2)),
    room(`${id}-benches`, 'Benches', 'yard', x + M, y + M + ph + M, iw, bh, grid('bench-out', x + M + 4, y + M + ph + M + 2, iw - 8, bh - 4, 5, 1)),
  ]);
}

/** The grand park: lawns, a lake, a playground and benches along the paths. */
export function grandPark(o: Box): Building {
  const { id, x, y, w, h } = o;
  const iw = w - M * 2;
  const ih = h - M * 2;
  const lakeW = Math.round(iw * 0.26);
  const lakeH = Math.round(ih * 0.4);
  const lawnW = iw - lakeW - M;
  const playH = Math.round(ih * 0.3);
  const benchH = 12;
  return mkBuilding(id, 'park', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [
    room(`${id}-lawn`, 'Great lawn', 'pitch', x + M, y + M, lawnW, ih - playH - benchH - M * 2, [spot('goal', x + M + 6, y + M + (ih - playH - benchH - M * 2) / 2), spot('goal', x + M + lawnW - 6, y + M + (ih - playH - benchH - M * 2) / 2), ...grid('generic', x + M + 10, y + M + 8, lawnW - 20, ih - playH - benchH - M * 2 - 16, 6, 3)]),
    room(`${id}-lake`, 'Lake', 'field', x + M + lawnW + M, y + M, lakeW, lakeH, []),
    room(`${id}-picnic`, 'Picnic lawns', 'yard', x + M + lawnW + M, y + M + lakeH + M, lakeW, ih - lakeH - M, grid('bench-out', x + M + lawnW + M + 4, y + M + lakeH + M + 4, lakeW - 8, ih - lakeH - M - 8, 2, 4)),
    room(`${id}-playground`, 'Playground', 'yard', x + M, y + M + ih - playH - benchH - M, lawnW, playH, grid('generic', x + M + 6, y + M + ih - playH - benchH - M + 4, lawnW - 12, playH - 8, 6, 2)),
    room(`${id}-benches`, 'Benches', 'yard', x + M, y + M + ih - benchH, lawnW, benchH, grid('bench-out', x + M + 4, y + M + ih - benchH + 2, lawnW - 8, benchH - 4, 6, 1)),
  ]);
}

/** The bus and taxi terminus: shelters and the bays. */
export function terminus(o: Box & { bays?: number }): Building {
  const { id, x, y, w, h } = o;
  const iw = w - M * 2;
  const ih = h - M * 2;
  const shelterH = Math.round(ih * 0.4);
  return mkBuilding(id, 'terminus', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [
    room(`${id}-stop`, 'Shelters', 'stop', x + M, y + M, iw, shelterH, grid('seat', x + M + 4, y + M + 3, iw - 8, shelterH - 6, Math.max(4, Math.floor(iw / 12)), 2)),
    room(`${id}-bays`, 'Bays', 'garage', x + M, y + M + shelterH + M, iw, ih - shelterH - M, grid('generic', x + M + 4, y + M + shelterH + M + 4, iw - 8, ih - shelterH - M - 8, o.bays ?? 4, 1)),
  ]);
}

/** Ambulance station beside a hospital. */
export function ambulanceStation(o: Box): Building {
  const { id, x, y, w, h } = o;
  return mkBuilding(id, 'workshop', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [
    room(`${id}-bays`, 'Ambulance bays', 'garage', x + M, y + M, w - M * 2, h - M * 2, grid('generic', x + M + 4, y + M + 4, w - M * 2 - 8, h - M * 2 - 8, 2, 1)),
  ]);
}

// ─── The Hyperline and the airport ──────────────────────────────────────────

/**
 * A Hyperline station: a concourse and the platform along the side that
 * faces the guideway. `platform` names that side; the train draws up just
 * beyond it.
 */
export function station(o: Box & { platform: Facing }): Building {
  const { id, x, y, w, h } = o;
  const pw = 12; // platform depth
  const rooms: Room[] = [];
  const plat = (px: number, py: number, pwid: number, phei: number, cols: number, rows: number) => room(`${id}-platform`, 'Platform', 'stop', px, py, pwid, phei, grid('seat', px + 2, py + 2, pwid - 4, phei - 4, cols, rows));
  const conc = (cx: number, cy: number, cw: number, ch: number) => room(`${id}-hall`, 'Concourse', 'hall', cx, cy, cw, ch, grid('seat', cx + 4, cy + 4, cw - 8, ch - 8, Math.max(2, Math.floor(cw / 14)), Math.max(1, Math.floor(ch / 14))));
  switch (o.platform) {
    case 'S':
      rooms.push(conc(x + M, y + M, w - M * 2, h - M * 3 - pw), plat(x + M, y + h - M - pw, w - M * 2, pw, Math.max(4, Math.floor(w / 12)), 1));
      break;
    case 'N':
      rooms.push(plat(x + M, y + M, w - M * 2, pw, Math.max(4, Math.floor(w / 12)), 1), conc(x + M, y + M * 2 + pw, w - M * 2, h - M * 3 - pw));
      break;
    case 'W':
      rooms.push(plat(x + M, y + M, pw, h - M * 2, 1, Math.max(4, Math.floor(h / 12))), conc(x + M * 2 + pw, y + M, w - M * 3 - pw, h - M * 2));
      break;
    case 'E':
      rooms.push(conc(x + M, y + M, w - M * 3 - pw, h - M * 2), plat(x + w - M - pw, y + M, pw, h - M * 2, 1, Math.max(4, Math.floor(h / 12))));
      break;
  }
  return mkBuilding(id, 'station', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), rooms);
}

/** The airport terminal: departures and arrivals halls, the crew room and airline desks, a kiosk — and the apron outside its airside wall with the aircraft stands. */
export function terminal(o: Box & { stands: number }): Building {
  const { id, x, y, w, h } = o;
  const iw = w - M * 2;
  const ih = h - M * 2;
  const depW = Math.round(iw * 0.46);
  const arrW = Math.round(iw * 0.27);
  const sideW = iw - depW - arrW - M * 2;
  const ax = x + M;
  const rooms: Room[] = [
    room(`${id}-departures`, 'Departures hall', 'hall', ax, y + M, depW, ih, grid('seat', ax + 6, y + M + 10, depW - 12, ih - 20, Math.max(4, Math.floor(depW / 12)), Math.max(3, Math.floor(ih / 16)))),
    room(`${id}-arrivals`, 'Arrivals hall', 'hall', ax + depW + M, y + M, arrW, ih, grid('seat', ax + depW + M + 4, y + M + 10, arrW - 8, ih - 20, Math.max(2, Math.floor(arrW / 12)), Math.max(2, Math.floor(ih / 20)))),
    room(`${id}-crew`, 'Crew room & airline offices', 'office', ax + depW + arrW + M * 2, y + M, sideW, Math.round(ih * 0.45), grid('desk', ax + depW + arrW + M * 2 + 3, y + M + 3, sideW - 6, Math.round(ih * 0.45) - 6, 2, 2)),
    room(`${id}-kiosk`, 'Café & kiosk', 'shop', ax + depW + arrW + M * 2, y + M * 2 + Math.round(ih * 0.45), sideW, ih - M - Math.round(ih * 0.45), [spot('counter', ax + depW + arrW + M * 2 + sideW / 2, y + M * 2 + Math.round(ih * 0.45) + 6), ...grid('table', ax + depW + arrW + M * 2 + 3, y + M * 2 + Math.round(ih * 0.45) + 12, sideW - 6, ih - M - Math.round(ih * 0.45) - 16, 2, 2)]),
  ];
  // The apron lies on the side away from the door: the stands are where the planes wait.
  const apronW = 120;
  const apronX = o.facing === 'W' ? x + w : x - apronW;
  rooms.push(room(`${id}-apron`, 'Apron', 'yard', apronX, y - 10, apronW, h + 20, grid('generic', apronX + 20, y, apronW - 40, h, 1, o.stands)));
  return mkBuilding(id, 'terminal', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), rooms);
}

/** A hangar: one open floor with the maintenance bays. */
export function hangar(o: Box): Building {
  const { id, x, y, w, h } = o;
  return mkBuilding(id, 'hangar', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [
    room(`${id}-floor`, 'Hangar floor', 'workshop', x + M, y + M, w - M * 2, h - M * 2, grid('generic', x + M + 10, y + M + 6, w - M * 2 - 20, h - M * 2 - 12, 2, 1)),
  ]);
}

/** The runway: a strip nobody walks on, with a threshold at each end. */
export function runway(o: Box): Building {
  const { id, x, y, w, h } = o;
  return mkBuilding(id, 'runway', o.name, o.com, x, y, w, h, entranceFor(x, y, w, h, o.facing), [room(`${id}-strip`, 'Runway', 'field', x, y, w, h, [])]);
}
