// The builder's chrome: its top bar (the world's name, undo, saving, and the
// way back to the simulation), the tool rail over the canvas, and the dialog
// that starts a world (from a template, a saved world or a file).

import { useRef, useState } from 'react';
import { TEMPLATES } from '../../sim/plan/templates';
import { Cursor, Download, Eraser, Fit, Folder, Frame, Grid, Hammer, Help, Layers, Play, Rail, Redo, Road, Rotate, Save, Settings, Street, Trash, Undo, Upload, Zone } from '../components/Icons';
import { store } from '../lib/simStore';
import { builder, useBuilder, type Tool } from './builderStore';
import { deleteSelection, turnSelection } from './BuilderCanvas';

export function BuilderBar() {
  const b = useBuilder();
  const fileRef = useRef<HTMLInputElement>(null);
  const errors = b.issues.filter((i) => i.level === 'error').length;
  return (
    <header className="topbar b-topbar">
      <div className="wordmark">
        <span className="mark">C<sub>1.0</sub></span>
        <span className="b-wordmark-name">Community Lab</span>
        <span className="b-mode"><Hammer size={13} /> Builder</span>
      </div>
      <div className="b-title">
        {b.plan ? (
          <>
            <input className="b-name-input" value={b.plan.name} onChange={(e) => builder.plan && (builder.plan = { ...builder.plan, name: e.target.value }, builder.bump())} onBlur={() => builder.saveDraft()} aria-label="The world's name" />
            <span className={`b-saved ${b.dirty ? 'dirty' : ''}`} title={b.dirty ? 'Changes not saved yet (the draft is kept in this browser)' : 'Saved'}>{b.saving ? 'saving…' : b.dirty ? 'not saved' : 'saved'}</span>
            <button className="icon" title="Undo (Ctrl+Z)" disabled={!b.canUndo} onClick={() => builder.undo()}><Undo size={15} /></button>
            <button className="icon" title="Redo (Ctrl+Y)" disabled={!b.canRedo} onClick={() => builder.redo()}><Redo size={15} /></button>
          </>
        ) : (
          <span className="muted">No world open</span>
        )}
      </div>
      <div className="b-actions-top">
        <button className="ghost" onClick={() => (builder.dialog = 'plans', builder.refreshSaved(), builder.bump())} title="Start a new world or open a saved one"><Folder size={13} /> New / open</button>
        <button className="ghost" disabled={!b.plan || b.saving} onClick={() => builder.save()} title="Save into the lab, as a .sce file in data/worlds (Ctrl+S)"><Save size={13} /> Save</button>
        <button className="ghost" onClick={() => fileRef.current?.click()} title="Open a world saved as a .sce file"><Upload size={13} /> Open .sce</button>
        <button className="ghost" disabled={!b.plan} onClick={() => builder.exportFile()} title="Download the world as a .sce file, to keep or share (Scelo opens it too, as a table of its buildings)"><Download size={13} /> Download .sce</button>
        <input ref={fileRef} type="file" accept=".sce,application/vnd.scelo.project+json,application/json" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) builder.importFile(f);
          e.target.value = '';
        }} />
        <button className="primary b-run" disabled={!b.plan} onClick={() => builder.run()} title={errors ? 'Fix what the checks found first' : 'Build this world and run it from day 0'}>
          <Play size={12} /> Run this world
        </button>
      </div>
      <div className="status-cluster">
        <button className="ghost" onClick={() => builder.leave()} title="Back to the simulation, unchanged">Back to the simulation</button>
        <button className="icon" title="Settings (the scenario's assumptions apply to every world)" onClick={() => store.set('settingsOpen', true)}><Settings /></button>
        <button className="icon" title="Help" onClick={() => store.set('helpOpen', true)}><Help /></button>
      </div>
    </header>
  );
}

const TOOLS: Array<{ id: Tool; label: string; key: string; Icon: typeof Cursor }> = [
  { id: 'select', label: 'Select and move', key: 'V', Icon: Cursor },
  { id: 'road', label: 'Road', key: 'R', Icon: Road },
  { id: 'street', label: 'Street of houses', key: 'S', Icon: Street },
  { id: 'settlement', label: 'Settlement', key: 'Z', Icon: Zone },
  { id: 'city', label: 'City', key: 'C', Icon: Frame },
  { id: 'track', label: 'Hyperline guideway', key: 'T', Icon: Rail },
  { id: 'erase', label: 'Erase', key: 'X', Icon: Eraser },
];

export function ToolRail() {
  const b = useBuilder();
  const hasSel = b.selection.some((s) => s.kind === 'building');
  return (
    <div className="b-rail">
      {TOOLS.map((t) => (
        <button key={t.id} className={`icon ${b.tool === t.id ? 'on' : ''}`} onClick={() => builder.setTool(t.id)} title={`${t.label} (${t.key})`} aria-label={t.label}>
          <t.Icon size={17} />
        </button>
      ))}
      <span className="b-rail-sep" />
      <button className="icon" disabled={!hasSel && b.tool !== 'place'} onClick={turnSelection} title="Turn the door (F)"><Rotate size={16} /></button>
      <button className="icon" disabled={!b.selection.length} onClick={deleteSelection} title="Delete (Del)"><Trash size={16} /></button>
      <span className="b-rail-sep" />
      <button className={`icon ${b.snap ? 'on' : ''}`} onClick={() => builder.setSnap(!b.snap)} title={`Snap to a ${b.grid} m grid (G)`}><Grid size={16} /></button>
      <LayersMenu />
      <button className="icon" onClick={() => builder.fit()} title="Fit the world (0)"><Fit size={16} /></button>
    </div>
  );
}

function LayersMenu() {
  const b = useBuilder();
  const rows: Array<[keyof typeof b.layers, string]> = [
    ['zones', 'Cities and settlements'],
    ['labels', 'Names'],
    ['interiors', 'Rooms (close up)'],
    ['grid', 'Grid'],
    ['issues', 'Marks on problems'],
  ];
  return (
    <details className="b-layers">
      <summary className="icon" title="What to show"><Layers size={16} /></summary>
      <div className="b-layers-pop">
        <div className="panel-label">Show</div>
        {rows.map(([k, label]) => (
          <label key={k} className="row">
            <input type="checkbox" checked={b.layers[k]} onChange={(e) => builder.setLayer(k, e.target.checked)} />
            {label}
          </label>
        ))}
        <div className="panel-label" style={{ marginTop: 6 }}>Snap step</div>
        <div className="seg mini">
          {[1, 2, 5, 10].map((g) => (
            <button key={g} className={b.grid === g ? 'on' : ''} onClick={() => builder.setSnap(true, g)}>{g} m</button>
          ))}
        </div>
      </div>
    </details>
  );
}

export function PlansDialog() {
  const b = useBuilder();
  if (!b.dialog) return null;
  const close = () => {
    if (!builder.plan) builder.leave();
    builder.dialog = null;
    builder.bump();
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="modal b-plans" role="dialog" aria-label="Start a world">
        <div className="modal-header">
          <strong>Build a community</strong>
          <button className="ghost" onClick={close}>Close</button>
        </div>
        <div className="modal-body">
          <section className="modal-section">
            <div className="panel-label">Start from</div>
            <div className="b-templates">
              {TEMPLATES.map((t) => (
                <button key={t.id} className="b-template" onClick={() => builder.newFromTemplate(t.id)}>
                  <span className="b-template-name">{t.label}</span>
                  <span className="muted small">{t.blurb}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="modal-section">
            <div className="panel-label">Your worlds</div>
            {b.savedPlans.length === 0 ? (
              <span className="muted small">None saved yet. Worlds you save appear here: each is a .sce file in the worlds folder of the lab's data, which Scelo opens too.</span>
            ) : (
              <div className="b-saved-list">
                {b.savedPlans.map((p) => (
                  <SavedRow key={p.id} p={p} />
                ))}
              </div>
            )}
          </section>
          {store.params.plan && (
            <section className="modal-section">
              <div className="panel-label">The world running now</div>
              <button className="b-template" onClick={() => (builder.load(structuredClone(store.params.plan!), ''), (builder.dialog = null), builder.bump())}>
                <span className="b-template-name">{store.params.plan.name}</span>
                <span className="muted small">Open the world the simulation is running, to change it.</span>
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** A saved world: open it, or delete it with a second click (no browser dialog). */
function SavedRow({ p }: { p: (typeof builder.savedPlans)[number] }) {
  const [arm, setArm] = useState(false);
  return (
    <div className="b-saved-row">
      <span className="grow">
        <strong>{p.name}</strong>
        <span className="muted small"> · {p.file} · {Number(p.summary.buildings ?? 0)} buildings, {Number(p.summary.houses ?? 0)} houses · {new Date(p.updated_at).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}{Number(p.summary.errors ?? 0) ? ` · ${p.summary.errors} to fix` : ''}</span>
      </span>
      <button className="ghost" onClick={() => builder.openSaved(p.id)}>Open</button>
      {arm ? (
        <button className="ghost danger on" onClick={() => (builder.deleteSaved(p.id), builder.say(`Deleted ${p.name} (data/worlds/${p.file}).`))} onMouseLeave={() => setArm(false)}>Delete it for good</button>
      ) : (
        <button className="ghost danger" onClick={() => setArm(true)}>Delete</button>
      )}
    </div>
  );
}
