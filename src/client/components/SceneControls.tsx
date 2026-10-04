import { useEffect, useState } from 'react';
import { MONTHS, WEEKDAYS, fmtClock } from '../../sim/time';
import type { Season } from '../../sim/time';
import type { WeatherCondition } from '../../sim/types';
import { weatherPresetFor } from '../../sim/weather';
import { store, useStore } from '../lib/simStore';
import { Close, Weather } from './Icons';

const CONDITIONS: Array<{ id: WeatherCondition; label: string }> = [
  { id: 'clear', label: 'Clear' },
  { id: 'cloudy', label: 'Cloudy' },
  { id: 'rain', label: 'Rain' },
  { id: 'storm', label: 'Storm' },
  { id: 'fog', label: 'Fog' },
  { id: 'heatwave', label: 'Heat wave' },
  { id: 'cold-snap', label: 'Cold snap' },
  { id: 'snow', label: 'Snow' },
];

const SEASONS: Season[] = ['summer', 'autumn', 'winter', 'spring'];

/** Jump straight to the moments worth watching, instead of waiting for them. */
const MOMENTS: Array<{ label: string; hint: string; go: () => string | null }> = [
  { label: 'Sunday service', hint: 'the next Sunday at 09:00, as the congregation gathers', go: () => store.jumpToWeekday(0, 9 * 60) },
  { label: 'Fellowship', hint: 'after the next service, when the congregation mingles', go: () => store.jumpToWeekday(0, 11 * 60 + 5) },
  { label: 'School morning', hint: 'the next school day at 07:30', go: () => store.jumpToWeekday(1, 7 * 60 + 30) },
  { label: 'Market day', hint: 'Saturday morning at the market', go: () => store.jumpToWeekday(6, 10 * 60) },
  { label: 'Bible study', hint: 'Wednesday evening at the church hall', go: () => store.jumpToWeekday(3, 18 * 60 + 30) },
  { label: 'Late night', hint: 'tonight at 01:00, when the village is asleep', go: () => store.jumpBy(((25 * 60 - store.sim.world.minuteOfDay) % 1440) || 1440) },
];

/** One-click times. The browser draws its own clock in whatever format its
 *  locale uses; these are always the 24-hour labels the rest of the app shows. */
const TIMES: Array<{ label: string; minute: number; hint: string }> = [
  { label: '06:00', minute: 360, hint: 'dawn, the village waking' },
  { label: '08:00', minute: 480, hint: 'work and school' },
  { label: '10:00', minute: 600, hint: 'mid-morning' },
  { label: '13:00', minute: 780, hint: 'after lunch' },
  { label: '16:00', minute: 960, hint: 'school out' },
  { label: '19:00', minute: 1140, hint: 'dinner at home' },
  { label: '22:00', minute: 1320, hint: 'the village settling' },
  { label: '02:00', minute: 120, hint: 'the small hours' },
];

const HOPS: Array<{ label: string; minutes: number }> = [
  { label: '+1 h', minutes: 60 },
  { label: '+6 h', minutes: 360 },
  { label: '+1 day', minutes: 1440 },
  { label: '+1 week', minutes: 1440 * 7 },
  { label: '+1 month', minutes: 1440 * 30 },
  { label: '+1 year', minutes: 1440 * 365 },
];

/** Move an HH:MM string by a number of minutes, wrapping around midnight. */
function shiftTime(hhmm: string, deltaMinutes: number): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  const base = m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  return fmtClock(((base + deltaMinutes) % 1440 + 1440) % 1440);
}

export function SceneControls() {
  const st = useStore();
  const w = st.sim.world;
  const cal = st.cal();
  const wx = w.weather;
  const [date, setDate] = useState(cal.isoDate);
  const [time, setTime] = useState(fmtClock(w.minuteOfDay));
  const [msg, setMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => ({ ...weatherPresetFor(wx.condition, wx), hold: false }));

  // Reopening picks up wherever the community has got to.
  useEffect(() => {
    if (!st.sceneOpen) return;
    setDate(cal.isoDate);
    setTime(fmtClock(w.minuteOfDay));
    setMsg(null);
    setDraft(w.weatherOverride ? { ...w.weatherOverride } : { ...weatherPresetFor(wx.condition, wx), hold: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.sceneOpen]);

  if (!st.sceneOpen) return null;
  const close = () => store.setScene(false);
  const run = (r: string | null) => {
    setMsg(r);
    if (!r) {
      setDate(store.cal().isoDate);
      setTime(fmtClock(store.sim.world.minuteOfDay));
    }
  };
  const goToDateTime = () => {
    if (!date) {
      setMsg('Pick a date to go to.');
      return;
    }
    const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
    if (!m) {
      setMsg('Pick a time from the clock, or type one like 09:30.');
      return;
    }
    run(store.jumpTo(date, Number(m[1]) * 60 + Number(m[2])));
  };
  const forced = w.weatherOverride;

  return (
    <>
      <div className="scene-scrim" onClick={close} />
      <div className="scene" role="dialog" aria-label="Scene controls">
        <div className="scene-head">
          <span className="panel-label">Set the scene</span>
          <span className="muted small">every day in between is still simulated</span>
          <span className="grow" />
          <button className="icon" title="Close" onClick={close}>
            <Close size={13} />
          </button>
        </div>

        <div className="scene-body">
          <section>
            <div className="panel-label">Go to a moment</div>
            <div className="chipset">
              {MOMENTS.map((m) => (
                <button key={m.label} className="chip" title={m.hint} onClick={() => run(m.go())}>
                  {m.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="panel-label">Jump forward</div>
            <div className="chipset">
              {HOPS.map((h) => (
                <button key={h.label} className="chip" onClick={() => run(store.jumpBy(h.minutes))}>
                  {h.label}
                </button>
              ))}
            </div>
            <div className="row" style={{ marginTop: 6, gap: 6 }}>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
              <input className="time-input" type="time" step={60} value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time of day" title="Pick a time from the clock, or type it" />
              <span className="nudge">
                <button title="An hour earlier" aria-label="An hour earlier" onClick={() => setTime(shiftTime(time, -60))}>
                  −
                </button>
                <button title="An hour later" aria-label="An hour later" onClick={() => setTime(shiftTime(time, 60))}>
                  +
                </button>
              </span>
              <button className="primary" onClick={goToDateTime}>
                Go
              </button>
              <span className="muted small">now {WEEKDAYS[cal.weekday].slice(0, 3)} {cal.day} {MONTHS[cal.month - 1]} {cal.year}, {fmtClock(w.minuteOfDay)}</span>
            </div>
            <div className="chipset">
              {TIMES.map((t) => (
                <button key={t.label} className={`chip ${time === t.label ? 'on' : ''}`} title={t.hint} onClick={() => setTime(t.label)}>
                  {t.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="panel-label">Season</div>
            <div className="chipset">
              {SEASONS.map((s) => (
                <button key={s} className={`chip ${wx.season === s ? 'on' : ''}`} title={`Jump to the start of the next ${s}`} onClick={() => run(store.jumpToSeason(s))}>
                  {s}
                </button>
              ))}
            </div>
            <div className="muted small">The season follows the calendar, so this moves the date rather than faking it.</div>
          </section>

          <section>
            <div className="panel-label row" style={{ gap: 6 }}>
              <Weather cond={draft.condition} size={13} /> Weather
              {forced && <span className="tag warn">forced{forced.hold ? ' · held' : ' · today'}</span>}
            </div>
            <div className="chipset">
              {CONDITIONS.map((c) => (
                <button key={c.id} className={`chip ${draft.condition === c.id ? 'on' : ''}`} onClick={() => setDraft((d) => ({ ...weatherPresetFor(c.id, wx), hold: d.hold }))}>
                  {c.label}
                </button>
              ))}
            </div>
            <div className="scene-sliders">
              <label>High</label>
              <input type="range" min={-10} max={45} step={1} value={draft.tempMax} onChange={(e) => setDraft((d) => ({ ...d, tempMax: Number(e.target.value) }))} />
              <span className="v">{draft.tempMax}°C</span>
              <label>Low</label>
              <input type="range" min={-15} max={35} step={1} value={draft.tempMin} onChange={(e) => setDraft((d) => ({ ...d, tempMin: Number(e.target.value) }))} />
              <span className="v">{draft.tempMin}°C</span>
              <label>Rain</label>
              <input type="range" min={0} max={80} step={1} value={draft.rainMm} onChange={(e) => setDraft((d) => ({ ...d, rainMm: Number(e.target.value) }))} />
              <span className="v">{draft.rainMm} mm</span>
              <label>Wind</label>
              <input type="range" min={0} max={90} step={1} value={draft.windKmh} onChange={(e) => setDraft((d) => ({ ...d, windKmh: Number(e.target.value) }))} />
              <span className="v">{draft.windKmh} km/h</span>
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              <label className="row small" style={{ gap: 5 }}>
                <input type="checkbox" checked={draft.hold} onChange={(e) => setDraft((d) => ({ ...d, hold: e.target.checked }))} style={{ width: 'auto' }} />
                hold until released
              </label>
              <span className="grow" />
              {forced && (
                <button className="ghost" onClick={() => store.releaseWeather()}>
                  release
                </button>
              )}
              <button className="primary" onClick={() => store.forceWeather(draft)}>
                Apply weather
              </button>
            </div>
            <div className="muted small">
              Forcing the weather is an intervention, not an assumption: it is written into the event ledger so a run's history stays honest. Heat, cold and storms feed illness, mortality and whether people go outdoors.
            </div>
          </section>
        </div>
        {msg && <div className="scene-msg">{msg}</div>}
      </div>
    </>
  );
}
