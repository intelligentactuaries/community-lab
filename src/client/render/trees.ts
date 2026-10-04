// Deterministic street trees along the road graph, plus stands in the parks and
// the cemetery. Shared by the flat map and the 3D scene so both plant the same trees.
import type { World } from '../../sim/types';

export interface TreeSeed {
  x: number;
  y: number;
  /** Canopy radius in metres. */
  r: number;
}

export function treeSeeds(world: World): TreeSeed[] {
  const out: TreeSeed[] = [];
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const arterial = new Set(['Unity Road', 'Hebron Approach', 'Kanana Approach', 'Progress Road', 'Ithemba Road', 'Central Avenue', 'Unity Boulevard']);
  const highway = new Set(['N1 Unity Highway', 'Western Ring Road', 'Eastern Ring Road']);
  for (const e of world.roads.edges) {
    if (e.name === 'Airside Road') continue; // nothing grows on the apron
    const a = world.roads.nodes[e.a];
    const b = world.roads.nodes[e.b];
    const step = highway.has(e.name) ? 48 : arterial.has(e.name) ? 30 : 16;
    const n = Math.floor(e.length / step);
    const dx = (b.x - a.x) / e.length;
    const dy = (b.y - a.y) / e.length;
    for (let i = 0; i < n; i++) {
      if (rnd() < 0.35) continue;
      const d = (i + 0.4 + rnd() * 0.4) * step;
      const side = i % 2 === 0 ? 1 : -1;
      const off = 6 + rnd() * 3;
      out.push({ x: a.x + dx * d - dy * side * off, y: a.y + dy * d + dx * side * off, r: 2 + rnd() * 1.4 });
    }
  }
  for (const id in world.buildings) {
    const b = world.buildings[id];
    if (b.kind !== 'park' && b.kind !== 'cemetery') continue;
    const n = id === 'ppitch' ? 3 : b.kind === 'cemetery' ? 4 : 8;
    for (let i = 0; i < n; i++) out.push({ x: b.x + 4 + rnd() * (b.w - 8), y: b.y + 4 + rnd() * (b.h - 8), r: 2 + rnd() * 1.6 });
  }
  return out;
}
