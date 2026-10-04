import { ARCHETYPE_LABEL, SHAPE_FOR } from '../../sim/personality';
import type { Archetype } from '../../sim/types';
import { store, useStore } from '../lib/simStore';
import { svgPath } from '../render/shapes';

const ARCHES: Archetype[] = ['harmoniser', 'organiser', 'driver', 'thinker', 'sentinel', 'balanced'];

export function Glyph({ archetype, sex, size = 16, neutral = false }: { archetype: Archetype; sex: 'M' | 'F'; size?: number; neutral?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className="glyph" aria-hidden="true">
      <path d={svgPath(SHAPE_FOR[archetype])} fill={neutral ? 'var(--bg-3)' : sex === 'M' ? 'var(--male)' : 'var(--female)'} stroke={neutral ? 'var(--fg-2)' : 'var(--fg)'} strokeWidth="1" />
    </svg>
  );
}

export function Legend() {
  useStore();
  return (
    <div className="legend legend-strip">
      <span className="title">legend</span>
      {/* The shape carries the personality; it is drawn neutral here so it cannot be read as a colour. */}
      <span className="grp">shape — personality</span>
      {ARCHES.map((a) => (
        <span className="item" key={a}>
          <Glyph archetype={a} sex="M" size={13} neutral /> {ARCHETYPE_LABEL[a]}
        </span>
      ))}
      <span className="sep" />
      {/* The fill carries the sex; a plain chip so it cannot be read as a shape. */}
      <span className="grp">colour — sex</span>
      <span className="item"><i className="swatch" style={{ background: 'var(--male)' }} /> male</span>
      <span className="item"><i className="swatch" style={{ background: 'var(--female)' }} /> female</span>
      <span className="sep" />
      <span className="grp">vehicles</span>
      <span className="item"><i className="swatch" style={{ background: '#E9C24C' }} /> minibus taxi</span>
      <span className="item"><i className="swatch" style={{ background: '#2F6DB5' }} /> bus</span>
      <span className="item"><i className="swatch" style={{ background: '#2E8B7A' }} /> Hamba e-hailing (roof sign: green online, amber surge)</span>
      <span className="sep" />
      <span className="item muted">size = age · ticks = education · red ring = ill · dashed = grieving · top dot = mood · bottom badge = household (plot colour) · code = profession</span>
      <button className="ghost" onClick={() => store.set('legendOpen', false)} style={{ padding: '0 6px' }}>hide</button>
    </div>
  );
}
