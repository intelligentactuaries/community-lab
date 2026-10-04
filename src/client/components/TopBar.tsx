import { SPEED_PRESETS } from '../../sim/params';
import { MONTHS, WEEKDAYS, fmtClock } from '../../sim/time';
import type { ProvidersInfo } from '../lib/api';
import { useBridge } from '../lib/sceloBridge';
import { store, useStore } from '../lib/simStore';
import { Chevron, Help, Pause, Play, Rewind, Settings, Sparkle, StepFwd, Weather } from './Icons';

export function TopBar({ info, aiBusy }: { info: ProvidersInfo | null; aiBusy: boolean }) {
  const st = useStore();
  const bridge = useBridge();
  // A supplied basis or a stress in force is worth a word on the chip (the tooltip says which).
  const outside = st.params.mortalityOverride ? 'a Scelo basis' : st.params.shocks?.length ? 'a stress' : null;
  const w = st.sim.world;
  const cal = st.cal();
  const wx = w.weather;
  const eff = info?.effective;
  return (
    <header className="topbar">
      <div className="wordmark">
        <span className="mark">S<sub>0.1</sub></span>
        Community Lab
        <span className="by">· {w.meta.placeName}</span>
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
          <Weather cond={wx.condition} /> {wx.tempMax}°C {wx.condition}
        </span>
        {w.weatherOverride && <span className="pill warn" title="Weather forced from the scene controls">forced</span>}
        <span className="pill">{wx.season}</span>
        {w.holiday && <span className="pill">{w.holiday}</span>}
        <span className="pill" title="Simulated years elapsed">yr {(w.day / 365.25).toFixed(1)}</span>
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
        <div className="seg" title="Simulated time per real second">
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
        <span
          className={`chip ${st.drawerTab === 'scelo' ? 'on' : ''}`}
          onClick={() => store.openDrawer(st.drawerTab === 'scelo' ? null : 'scelo')}
          title={
            bridge.connected
              ? `Linked to Scelo (${bridge.host}): send the province's experience, panel, book or economy into the pipeline; bases and stresses come back${outside ? `. Living on ${outside}` : ''}`
              : `Export the province's data with its provenance${bridge.embedded ? ' (waiting for Scelo to answer)' : '. Open Community Lab from Scelo IDE to send it straight into the pipeline'}${outside ? `. Living on ${outside}` : ''}`
          }
        >
          <span className={`led ${bridge.connected ? 'live' : bridge.embedded ? 'busy' : ''}`} />
          Scelo{outside ? ' · basis' : ''}
        </span>
        <span className="chip" onClick={() => store.set('settingsOpen', true)} title={info ? (eff ? `${eff.provider} · ${eff.model}` : 'no AI provider — click to configure') : 'connecting to the API…'}>
          <span className={`led ${aiBusy ? 'busy' : eff ? 'live' : info ? 'down' : ''}`} />
          <Sparkle size={12} /> {eff ? eff.model : info ? 'no model' : '…'} · {st.aiMode}
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
