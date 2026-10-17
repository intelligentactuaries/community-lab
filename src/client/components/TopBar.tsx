import { SPEED_PRESETS } from '../../sim/params';
import { MONTHS, WEEKDAYS, fmtClock } from '../../sim/time';
import { APP_VERSION } from '../../shared/exports';
import type { ProvidersInfo } from '../lib/api';
import { store, useStore } from '../lib/simStore';
import { builder } from '../builder/builderStore';
import { isProvince, wholeName } from '../lib/worldNames';
import { Chevron, Hammer, Help, Pause, Play, Rewind, Settings, Sparkle, StepFwd, Weather } from './Icons';

export function TopBar({ info, aiBusy }: { info: ProvidersInfo | null; aiBusy: boolean }) {
  const st = useStore();
  // A supplied basis or a stress in force is worth a word on the chip (the tooltip says which).
  const outside = st.params.mortalityOverride ? `the basis "${st.params.mortalityOverride.label}"` : st.params.shocks?.length ? 'a stress' : null;
  const bench = st.view === 'workbench';
  const w = st.sim.world;
  const cal = st.cal();
  const wx = w.weather;
  const eff = info?.effective;
  return (
    <header className="topbar">
      <div className="wordmark">
        <span className="mark" title={`Community Lab IDE ${APP_VERSION}`}>
          C<sub>{APP_VERSION.split('.').slice(0, 2).join('.')}</sub>
        </span>
        <span className="name">Community Lab</span>
        {/* A world from the builder goes by its name; the province needs no caption. */}
        {!isProvince() && <span className="by">· {w.meta.placeName}</span>}
        <div className="viewseg" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={!bench} className={!bench ? 'on' : ''} onClick={() => store.setView('province')} title="The province (Ctrl+1)">
            Province
          </button>
          <button type="button" role="tab" aria-selected={bench} className={bench ? 'on' : ''} onClick={() => store.setView('workbench')} title="The workbench: files, editor, console (Ctrl+2)">
            Workbench
          </button>
        </div>
      </div>
      <button
        className={`clock ${st.sceneOpen ? 'on' : ''}`}
        title="Set the scene: jump to a moment, a date, a season, or force the weather"
        aria-haspopup="dialog"
        aria-expanded={st.sceneOpen}
        onClick={() => store.setScene(!st.sceneOpen)}
      >
        <span className="date">{WEEKDAYS[cal.weekday].slice(0, 3)} {cal.day} {MONTHS[cal.month - 1]} {cal.year}</span>
        <span className="time">{st.jumping ? '…' : fmtClock(w.minuteOfDay)}</span>
        <span className="wx row" title={`${wx.tempMin}–${wx.tempMax}°C · ${wx.rainMm} mm · wind ${wx.windKmh} km/h`}>
          <Weather cond={wx.condition} /> {wx.tempMax}°C <span className="wx-cond">{wx.condition}</span>
        </span>
        {w.weatherOverride && <span className="pill warn" title="Weather forced from the scene controls">forced</span>}
        <span className="pill season">{wx.season}</span>
        {w.holiday && <span className="pill">{w.holiday}</span>}
        <span className="pill years" title="Simulated years elapsed">yr {(w.day / 365.25).toFixed(1)}</span>
        <Chevron size={12} open />
      </button>
      <div className="timectl">
        <button className="icon" title="Rewind to day 0 (rebuild with the same seed)" onClick={() => store.rebuild(store.params)}>
          <Rewind size={15} />
        </button>
        <button className={`play ${st.running ? 'on' : ''}`} title="Play / pause (space)" onClick={() => store.toggle()}>
          {st.running ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button className="icon" title="Step one hour" onClick={() => store.step(60)}>
          <StepFwd size={14} />
        </button>
        <div className={`seg ${bench ? 'compact' : ''}`} title="Simulated time per real second">
          {SPEED_PRESETS.map((s) => (
            <button key={s.id} className={st.speedId === s.id ? 'on' : ''} onClick={() => store.setSpeed(s.id)} title={s.hint}>
              {s.label}
            </button>
          ))}
          <label className={`custom-speed ${st.speedId === 'custom' ? 'on' : ''}`} title="Custom time-lapse: simulated years per real minute — any horizon you like">
            <input
              type="number"
              min={0.1}
              step={1}
              placeholder="any"
              value={st.customYrsPerMin ?? ''}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v > 0) store.setCustomSpeed(v);
              }}
            />
            yrs/min
          </label>
        </div>
      </div>
      <div className="status-cluster">
        <button className="ghost b-enter" onClick={() => builder.enter()} title="Build or change a community: place homes, churches, schools, shops, roads and whole settlements, then run it">
          <Hammer size={13} /> <span className="b-enter-label">Build</span>
        </button>
        <span
          className={`chip ${st.drawerTab === 'exports' && !bench ? 'on' : ''}`}
          onClick={() => {
            store.setView('province');
            store.openDrawer(st.drawerTab === 'exports' && !bench ? null : 'exports');
          }}
          title={`Export ${wholeName()}'s data with its provenance (experience, the person-year panel, the burial society's book, the economy), or live it on a mortality table of your own${outside ? `. Living on ${outside}` : ''}`}
        >
          <span className={`led ${outside ? 'basis' : ''}`} />
          Exports{outside ? ' · basis' : ''}
        </span>
        <span className="chip" onClick={() => store.set('settingsOpen', true)} title={info ? (eff ? `${eff.provider} · ${eff.model}` : 'no AI provider — click to configure') : 'connecting to the API…'}>
          <span className={`led ${aiBusy ? 'busy' : eff ? 'live' : info ? 'down' : ''}`} />
          <Sparkle size={12} /> <span className="model">{eff ? eff.model : info ? 'no model' : '…'}</span>
          <span className="mode"> · {st.aiMode}</span>
        </span>
        <button className="icon" title="Settings" onClick={() => store.set('settingsOpen', true)}>
          <Settings />
        </button>
        <button className="icon" title="Help (?)" onClick={() => store.set('helpOpen', true)}>
          <Help />
        </button>
      </div>
    </header>
  );
}
