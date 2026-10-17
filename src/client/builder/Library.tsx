// The library: everything a world can be built from. Sets (a street of
// houses, a village core, a civic centre, the airfield), roads and areas,
// then every building by kind, each with its footprint and what it does in
// the simulation. Picking one puts it in hand.

import { useMemo, useState } from 'react';
import { ASSETS, CATEGORIES } from '../../sim/plan/assets';
import { Frame, Plane, Rail, Road, Search, Street, Zone } from '../components/Icons';
import { builder, useBuilder, type PrefabId } from './builderStore';
import { iconFor } from './icons';

const SETS: Array<{ id: PrefabId; label: string; blurb: string }> = [
  { id: 'village', label: 'Village core', blurb: 'A high street with a church, school, clinic, police station, general dealer and the Mutual Bank on one side; a sports field, hall, cemetery, workshop, farm, co-op offices, taxi rank and a bus stop on the other.' },
  { id: 'civic', label: 'Civic centre', blurb: "A council chamber, medical centre, magistrate's court, commercial bank and a square, two by two either side of a street." },
  { id: 'airfield', label: 'Airfield', blurb: 'Terminal and apron, control tower, hangar, fire and rescue, a 1.6 km runway and the airside roads (560 × 1,600 m). Connect Airport Road to the network.' },
];

const ROADS: Array<{ width: number; label: string; blurb: string }> = [
  { width: 7, label: 'Street', blurb: 'A 7 m street: most of the network.' },
  { width: 9, label: 'Avenue', blurb: 'A 9 m arterial: main roads and ring roads.' },
  { width: 11, label: 'Highway', blurb: 'An 11 m highway between towns.' },
];

export function Library() {
  const b = useBuilder();
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const assets = useMemo(() => ASSETS.filter((a) => !a.hidden && (!query || a.label.toLowerCase().includes(query) || a.blurb.toLowerCase().includes(query) || a.category.includes(query))), [query]);
  const match = (s: string) => !query || s.toLowerCase().includes(query);
  return (
    <aside className="sidebar b-library">
      <div className="panel b-search">
        <label className="b-searchbox">
          <Search size={14} />
          <input type="search" placeholder="Search the library" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="scroll b-lib-body">
        {(match('street houses road') || SETS.some((s) => match(s.label + s.blurb))) && (
          <section className="b-section">
            <div className="panel-label">Sets</div>
            {match('street of houses road plots') && (
              <div className={`b-item ${b.tool === 'street' ? 'on' : ''}`} onClick={() => builder.setTool('street')} title="Drag a road; plots line it">
                <span className="b-glyph"><Street size={18} /></span>
                <span className="b-text">
                  <span className="b-name">Street of houses</span>
                  <span className="b-blurb">Drag a road and houses line it, gates to the street.</span>
                </span>
              </div>
            )}
            {b.tool === 'street' && (
              <div className="b-sub">
                <div className="seg mini">
                  {(['small', 'standard', 'large'] as const).map((t) => (
                    <button key={t} className={b.street.tier === t ? 'on' : ''} onClick={() => ((builder.street = { ...builder.street, tier: t }), builder.bump())}>
                      {t === 'small' ? 'Small' : t === 'standard' ? 'Standard' : 'Large'}
                    </button>
                  ))}
                </div>
                <div className="seg mini">
                  {(['both', 'left', 'right'] as const).map((s) => (
                    <button key={s} className={b.street.sides === s ? 'on' : ''} onClick={() => ((builder.street = { ...builder.street, sides: s }), builder.bump())} title={s === 'left' ? 'North (or west) side only' : s === 'right' ? 'South (or east) side only' : 'Both sides'}>
                      {s === 'both' ? 'Both sides' : s === 'left' ? 'North / west' : 'South / east'}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {SETS.filter((s) => match(s.label + s.blurb)).map((s) => {
              const Icon = s.id === 'airfield' ? Plane : s.id === 'civic' ? iconFor('council') : iconFor('church');
              return (
                <div key={s.id} className={`b-item ${b.tool === 'prefab' && b.prefab === s.id ? 'on' : ''}`} onClick={() => builder.armPrefab(s.id)} title={s.blurb}>
                  <span className="b-glyph"><Icon size={18} /></span>
                  <span className="b-text">
                    <span className="b-name">{s.label}</span>
                    <span className="b-blurb">{s.blurb}</span>
                  </span>
                </div>
              );
            })}
          </section>
        )}
        {match('roads areas settlement city hyperline guideway street avenue highway') && (
          <section className="b-section">
            <div className="panel-label">Roads & areas</div>
            {ROADS.map((r) => (
              <div key={r.width} className={`b-item ${b.tool === 'road' && b.roadWidth === r.width ? 'on' : ''}`} onClick={() => ((builder.roadWidth = r.width), builder.setTool('road'))} title={r.blurb}>
                <span className="b-glyph"><Road size={18} /></span>
                <span className="b-text">
                  <span className="b-name">{r.label}</span>
                  <span className="b-blurb">{r.blurb}</span>
                </span>
                <span className="b-size">{r.width} m</span>
              </div>
            ))}
            <div className={`b-item ${b.tool === 'track' ? 'on' : ''}`} onClick={() => builder.setTool('track')} title="Click each bend of the guideway; stations stand beside it">
              <span className="b-glyph"><Rail size={18} /></span>
              <span className="b-text">
                <span className="b-name">Hyperline guideway</span>
                <span className="b-blurb">Click each bend; place stations beside it. Two stations or more run trains.</span>
              </span>
            </div>
            <div className={`b-item ${b.tool === 'settlement' ? 'on' : ''}`} onClick={() => builder.setTool('settlement')}>
              <span className="b-glyph"><Zone size={18} /></span>
              <span className="b-text">
                <span className="b-name">Settlement</span>
                <span className="b-blurb">A neighbourhood with its own wealth profile, church, shop and park. Drag out its zone.</span>
              </span>
            </div>
            <div className={`b-item ${b.tool === 'city' ? 'on' : ''}`} onClick={() => builder.setTool('city')}>
              <span className="b-glyph"><Frame size={18} /></span>
              <span className="b-text">
                <span className="b-name">City</span>
                <span className="b-blurb">Settlements that share a school, clinic, police, court and an elected council.</span>
              </span>
            </div>
          </section>
        )}
        {CATEGORIES.map((c) => {
          const list = assets.filter((a) => a.category === c.id);
          if (!list.length) return null;
          return (
            <section key={c.id} className="b-section">
              <div className="panel-label">{c.label}</div>
              {list.map((a) => {
                const Icon = iconFor(a.icon);
                const on = b.tool === 'place' && b.placing?.asset === a.id;
                return (
                  <div key={a.id} className={`b-item ${on ? 'on' : ''}`} onClick={() => builder.arm(a.id)} title={a.blurb} draggable={false}>
                    <span className="b-glyph"><Icon size={18} /></span>
                    <span className="b-text">
                      <span className="b-name">{a.label}</span>
                      <span className="b-blurb">{a.blurb}</span>
                    </span>
                    <span className="b-size">{a.size.w}×{a.size.h}</span>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
