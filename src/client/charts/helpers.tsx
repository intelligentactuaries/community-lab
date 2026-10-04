// Shared chart scaffolding for the analytics drawer and the finance workspace.
import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EChart } from './EChart';
import { baseOption, chartTheme } from './theme';
import { useStore } from '../lib/simStore';

export type VizSize = 'square' | 'wide' | 'big' | 'beside' | 'banner' | 'row';

const ExpandIcon = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
    <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/**
 * A card in the analytics grid. Charts are squares by default; `wide` makes a
 * full-width rectangle, `big` a 2×2 square, `beside` a table that sits to the
 * right of a big chart, `banner` a full-width chart two cards tall. Every
 * card can be enlarged into a lightbox for a closer look.
 */
export function Viz({ title, note, info, wide, size, empty, summary, summaryLabel, children }: { title: string; note?: string; info?: string; wide?: boolean; size?: VizSize; empty?: string | false | null; summary?: React.ReactNode; summaryLabel?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  const cls = size && size !== 'square' ? size : wide ? 'big' : '';
  const head = (enlarged: boolean) => (
    <div className="viz-title">
      <h4>
        {title}
        {info && <span className="info" title={info} aria-label="About this chart">i</span>}
      </h4>
      {note && <span className="note">{note}</span>}
      {!empty && (enlarged || !summary) && (
        <button type="button" className="icon expand" title={enlarged ? 'Close (Esc)' : 'Enlarge'} aria-label={enlarged ? 'Close' : 'Enlarge'} onClick={() => setOpen(!enlarged)}>
          {enlarged ? <CloseIcon /> : <ExpandIcon />}
        </button>
      )}
    </div>
  );
  const chartSum = !!summary && summaryLabel === 'full chart';
  // A mini chart summary carries its own footer: the key and the button that opens the full chart or table.
  const mini = isValidElement<MiniProps>(summary) && summary.type === Mini ? summary : null;
  return (
    <>
      <div className={`viz ${cls}${chartSum ? ' chart-sum' : ''}`}>
        {head(false)}
        {empty ? (
          <div className="empty">{empty}</div>
        ) : mini ? (
          cloneElement(mini, { onOpen: () => setOpen(true), openLabel: summaryLabel ?? 'full table' })
        ) : summary ? (
          <div className="summary">
            {summary}
            <button type="button" className="ghost sum-open" onClick={() => setOpen(true)}>
              {summaryLabel ?? 'full table'} <ExpandIcon />
            </button>
          </div>
        ) : (
          children
        )}
      </div>
      {open &&
        createPortal(
          <div className="lightbox" onClick={() => setOpen(false)} role="dialog" aria-label={title}>
            <div className="viz lightbox-panel" onClick={(e) => e.stopPropagation()}>
              {head(true)}
              {children}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** One entry of a mini chart's key: a mark in the series colour, the name, and the figure it stands for. */
export interface MiniKey {
  label: string;
  value?: React.ReactNode;
  color?: string;
  mark?: 'line' | 'dash' | 'bar' | 'dot';
  tone?: 'ok' | 'warn' | 'err';
}

interface MiniProps {
  option?: Record<string, unknown> | null;
  keys?: MiniKey[];
  /** Controls the summary needs (an account picker, a download). */
  controls?: React.ReactNode;
  /** Plot height in a full-width row (a single split bar needs far less than a trend). */
  height?: number;
  onOpen?: () => void;
  openLabel?: string;
}

/**
 * A card's summary drawn as a minimal chart (see charts/mini.ts): the plot,
 * then a key naming each mark with its latest figure, and the button that
 * opens the full chart or table. Pass it as a Viz `summary`.
 */
export function Mini({ option, keys, controls, height, onOpen, openLabel }: MiniProps) {
  return (
    <div className="mini">
      {controls && <div className="mini-controls">{controls}</div>}
      {option && <EChart option={option} className="minichart" height={height} />}
      {(!!keys?.length || onOpen) && (
        <div className="mini-foot">
          {keys?.map((k, i) => (
            <span key={i} className="mk">
              {k.color && <i className={`sw ${k.mark ?? 'line'}`} style={{ '--c': k.color } as React.CSSProperties} />}
              <span className="kl">{k.label}</span>
              {k.value !== undefined && k.value !== null && <b className={k.tone ?? ''}>{k.value}</b>}
            </span>
          ))}
          {onOpen && (
            <button type="button" className="ghost sum-open" onClick={onOpen}>
              {openLabel ?? 'full chart'} <ExpandIcon />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Tables must not be direct flex children (Chrome under-reports their height in a grid row). */
export function Tbl({ children }: { children: React.ReactNode }) {
  return <div className="tbl">{children}</div>;
}

export function useSeries() {
  const st = useStore();
  return st.sim.world.stats.series;
}

/** One figure of a card's summary line. */
export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'ok' | 'warn' | 'err' }) {
  return (
    <span className="sumstat">
      <span className="l">{label}</span>
      <span className={`v ${tone ?? ''}`}>{value}</span>
    </span>
  );
}

/** Money on an axis: compact, whatever the era's price level. */
export function moneyAxis(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1e9) return `${s}R${(a / 1e9).toFixed(1)}bn`;
  if (a >= 1e6) return `${s}R${(a / 1e6).toFixed(1)}m`;
  if (a >= 1e3) return `${s}R${Math.round(a / 1e3)}k`;
  return `${s}R${Math.round(a)}`;
}

/** Room for the legend above the plot: legends wrap on narrow cards, so estimate the rows from the text. */
export function legendTop(names: string[], width = 250): number {
  const px = names.reduce((s, n) => s + n.length * 6.2 + 28, 0);
  const rows = Math.max(1, Math.ceil(px / width));
  return 14 + rows * 18;
}

export function lineOption(th: ReturnType<typeof chartTheme>, x: string[], series: Array<{ name: string; data: number[]; color?: string }>, fmt?: (v: number) => string) {
  const b = baseOption(th);
  return {
    ...b,
    grid: { ...(b.grid as object), top: legendTop(series.map((s) => s.name)) },
    xAxis: { ...(b.xAxis as object), type: 'category', data: x, boundaryGap: false },
    yAxis: { ...(b.yAxis as object), type: 'value', axisLabel: { color: th.muted, fontSize: 10, formatter: fmt } },
    series: series.map((s, i) => ({ name: s.name, type: 'line', data: s.data, showSymbol: s.data.length < 4, symbol: 'circle', symbolSize: 7, lineStyle: { width: 2 }, color: s.color ?? th.categorical[i % th.categorical.length] })),
  };
}

export function barOption(th: ReturnType<typeof chartTheme>, cats: string[], series: Array<{ name: string; data: number[]; color?: string; stack?: string }>, horizontal = false) {
  const b = baseOption(th);
  const cat = { ...(b.xAxis as object), type: 'category', data: cats, axisLabel: { color: th.muted, fontSize: 10, interval: horizontal ? 0 : 'auto', hideOverlap: !horizontal, width: horizontal ? 120 : undefined, overflow: horizontal ? 'truncate' : undefined } };
  const val = { ...(b.yAxis as object), type: 'value' };
  return {
    ...b,
    grid: { ...(b.grid as object), top: legendTop(series.map((s) => s.name)) },
    tooltip: { ...(b.tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: th.grid } } },
    xAxis: horizontal ? val : cat,
    yAxis: horizontal ? { ...cat, inverse: true } : val,
    series: series.map((s, i) => ({ name: s.name, type: 'bar', data: s.data, stack: s.stack, barMaxWidth: 26, itemStyle: { color: s.color ?? th.categorical[i % th.categorical.length], borderRadius: horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0] } })),
  };
}


// ─── Card grid ───────────────────────────────────────────────────────────────
// Chart cards are squares (the key diagrams a 2×2 square) so a plot is never
// stretched or crushed; tables, statements and text are full-width rows that
// wrap rather than scroll sideways, capped at 1.6 card heights with vertical
// scrolling. Docked, the side is fixed and the body scrolls; in full screen the
// side is the largest that lets every card fit the screen at once (CSS
// auto-placement is simulated to count the rows), falling back to a readable
// minimum with scrolling when a tab simply has too many cards.

const GAP = 12;
const DOCKED_SIDE = 240;
const MIN_SIDE = 280;

type Item = { kind: 'sq' | 'big' | 'wide' | 'beside' | 'banner' | 'row'; h: number };

/** What each card takes in the grid: its explicit size class, else a square for a chart and a full-width row for anything else. */
function classify(el: HTMLElement): Item {
  const c = el.classList;
  const tbl = el.querySelector('.tbl') as HTMLElement | null;
  const natural = el.offsetHeight + (tbl ? Math.max(0, tbl.scrollHeight - tbl.clientHeight) : 0);
  if (!c.contains('viz')) return { kind: 'row', h: natural };
  if (c.contains('beside')) return { kind: 'beside', h: natural };
  // Size classes only shape cards that hold a chart (or a chart collapsed to a
  // square summary, .chart-sum); a table summary is a row whatever it asked for.
  const hasChart = !!el.querySelector('.chart') || c.contains('chart-sum');
  if (!hasChart) return { kind: 'row', h: natural };
  if (c.contains('big')) return { kind: 'big', h: 0 };
  if (c.contains('wide')) return { kind: 'wide', h: 0 };
  if (c.contains('banner')) return { kind: 'banner', h: 0 };
  return { kind: 'sq', h: 0 };
}

/** Rows of the sparse auto-placement of `items` into `cols` columns; returns each row's kind and height. */
function placeRows(items: Item[], cols: number, side: number): number {
  const occ: boolean[][] = [];
  const rowH: number[] = [];
  const ensure = (r: number) => {
    while (occ.length <= r) {
      occ.push(new Array(cols).fill(false));
      rowH.push(0);
    }
  };
  let cr = 0;
  let cc = 0;
  const fullRow = (h: number) => {
    let r = occ[cr]?.some(Boolean) ? cr + 1 : cr;
    ensure(r);
    while (occ[r].some(Boolean)) {
      r++;
      ensure(r);
    }
    occ[r].fill(true);
    rowH[r] = h;
    cr = r + 1;
    cc = 0;
  };
  for (const it of items) {
    if (it.kind === 'row') {
      fullRow(Math.min(it.h, 1.6 * side + GAP));
      continue;
    }
    if (it.kind === 'wide') {
      fullRow(1.3 * side);
      continue;
    }
    if (it.kind === 'banner') {
      fullRow(2 * side);
      continue;
    }
    if (it.kind === 'beside') {
      if (cols < 3) {
        fullRow(Math.min(it.h, 1.6 * side + GAP));
        continue;
      }
      // Locked to column 3 onwards, two rows tall: the first row pair with those columns free.
      let r = cr;
      for (;;) {
        ensure(r + 1);
        let free = true;
        for (let dr = 0; dr < 2 && free; dr++) for (let c = 2; c < cols; c++) if (occ[r + dr][c]) free = false;
        if (free) break;
        r++;
      }
      for (let dr = 0; dr < 2; dr++) {
        for (let c = 2; c < cols; c++) occ[r + dr][c] = true;
        rowH[r + dr] = side;
      }
      cr = r;
      cc = cols;
      continue;
    }
    const span = it.kind === 'big' && cols >= 2 ? 2 : 1;
    let placed = false;
    let r = cr;
    let c = cc;
    while (!placed) {
      ensure(r + span - 1);
      if (c + span <= cols) {
        let free = true;
        for (let dr = 0; dr < span && free; dr++) for (let dc = 0; dc < span; dc++) if (occ[r + dr][c + dc]) free = false;
        if (free) {
          for (let dr = 0; dr < span; dr++) {
            for (let dc = 0; dc < span; dc++) occ[r + dr][c + dc] = true;
            rowH[r + dr] = side;
          }
          cr = r;
          cc = c + span;
          if (cc >= cols) {
            cr = r + 1;
            cc = 0;
          }
          placed = true;
          break;
        }
      }
      c++;
      if (c + span > cols) {
        c = 0;
        r++;
      }
    }
  }
  let total = 0;
  let rows = 0;
  for (let r = 0; r < occ.length; r++) {
    if (!occ[r].some(Boolean)) continue;
    total += rowH[r];
    rows++;
  }
  return total + Math.max(0, rows - 1) * GAP;
}

/** Sizes the cards of a grid container: `--card` (side) and `--span` (2, or 1 when only one column fits). */
export function useCardGrid(ref: React.RefObject<HTMLDivElement | null>, full: boolean, deps: unknown[], maxCols = 12): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const cs = getComputedStyle(el);
      const W = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const H = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const items = Array.from(el.children).map((k) => classify(k as HTMLElement));
      if (W <= 0) return;
      const colsFor = (s: number) => Math.max(1, Math.min(maxCols, Math.floor((W + GAP) / (s + GAP))));
      let side = DOCKED_SIDE;
      if (full && H > 0) {
        const fits = (s: number) => placeRows(items, colsFor(s), s) <= H;
        let lo = MIN_SIDE;
        let hi = Math.floor(Math.min(W, H));
        if (hi < lo || !fits(lo)) side = MIN_SIDE;
        else {
          while (hi - lo > 1) {
            const mid = Math.floor((lo + hi) / 2);
            if (fits(mid)) lo = mid;
            else hi = mid;
          }
          side = fits(hi) ? hi : lo;
        }
      }
      const cols = colsFor(side);
      el.style.setProperty('--card', `${side}px`);
      el.style.setProperty('--cols', String(cols));
      el.style.setProperty('--span', cols >= 2 ? '2' : '1');
      el.classList.toggle('few-cols', cols < 3);
    };
    compute();
    const ro = new ResizeObserver(() => compute());
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, full, maxCols, ...deps]);
}

/** A grid of square cards; see useCardGrid. */
export function CardGrid({ className, full, deps, maxCols, children }: { className?: string; full: boolean; deps?: unknown[]; maxCols?: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useCardGrid(ref, full, deps ?? [], maxCols);
  return (
    <div ref={ref} className={`cards ${className ?? ''}`}>
      {children}
    </div>
  );
}

