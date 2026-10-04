// Theme handler. `ia.theme` = "light" | "dark" | "system" for a static view;
// absent = "sim": the theme follows the simulation's daylight (the default),
// blending through dawn and dusk via the --night variable. Inside Scelo IDE,
// "system" means the IDE's theme: it posts `{ type: "ia:theme", theme }` into
// this frame, as it does into the swarm's.
import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'sim' | 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
const KEY = 'ia.theme';

let cached: ThemeChoice = 'sim';
/** The embedding window's theme (Scelo IDE), when there is one: it stands in for the OS under "system". */
let hostTheme: ResolvedTheme | null = null;

/** Whether the day-night driver owns the theme (checked every frame; no storage read). */
export function isSimTheme(): boolean {
  return cached === 'sim';
}

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') {
      cached = v;
      return v;
    }
  } catch {
    /* no storage */
  }
  cached = 'sim';
  return 'sim';
}

export function resolveTheme(choice: ThemeChoice = getThemeChoice()): ResolvedTheme {
  if (choice === 'light' || choice === 'dark') return choice;
  if (choice === 'sim') return (document.documentElement.getAttribute('data-theme') as ResolvedTheme) ?? 'light';
  if (hostTheme) return hostTheme;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Accept `{ type: "ia:theme", theme }` from the embedding window only. */
function listenForHostTheme(): void {
  if (window.parent === window) return;
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window.parent) return;
    const d = e.data as { type?: unknown; theme?: unknown } | null;
    if (!d || d.type !== 'ia:theme' || (d.theme !== 'light' && d.theme !== 'dark')) return;
    if (hostTheme === d.theme) return;
    hostTheme = d.theme;
    if (getThemeChoice() === 'system') {
      paint(resolveTheme());
      window.dispatchEvent(new CustomEvent('ia:theme-change'));
    }
  });
}

/** A static choice pins both the attribute and the blend variable. */
function paint(t: ResolvedTheme): void {
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.style.setProperty('--night', t === 'dark' ? '1' : '0');
}

export function setThemeChoice(c: ThemeChoice): void {
  try {
    if (c === 'sim') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, c);
  } catch {
    /* ignore */
  }
  cached = c;
  if (c !== 'sim') paint(resolveTheme(c)); // 'sim': the day-night driver repaints on the next frame
  window.dispatchEvent(new CustomEvent('ia:theme-change'));
}

export function initTheme(): void {
  listenForHostTheme();
  const c = getThemeChoice();
  if (c !== 'sim') paint(resolveTheme(c));
  else paint('light'); // the driver takes over on the first frame
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener?.('change', () => {
    if (getThemeChoice() === 'system') {
      paint(resolveTheme());
      window.dispatchEvent(new CustomEvent('ia:theme-change'));
    }
  });
}

export function useTheme(): { choice: ThemeChoice; resolved: ResolvedTheme; setChoice: (c: ThemeChoice) => void; cycle: () => void } {
  const [choice, setC] = useState<ThemeChoice>(getThemeChoice);
  const [resolved, setR] = useState<ResolvedTheme>(() => resolveTheme());
  useEffect(() => {
    const on = () => {
      setC(getThemeChoice());
      setR(resolveTheme());
    };
    window.addEventListener('ia:theme-change', on);
    return () => window.removeEventListener('ia:theme-change', on);
  }, []);
  const setChoice = useCallback((c: ThemeChoice) => setThemeChoice(c), []);
  const cycle = useCallback(() => {
    const order: ThemeChoice[] = ['sim', 'light', 'dark', 'system'];
    setThemeChoice(order[(order.indexOf(getThemeChoice()) + 1) % order.length]);
  }, []);
  return { choice, resolved, setChoice, cycle };
}

/** Resolved token values for canvas / ECharts (they cannot read CSS variables). */
export function tokens(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement);
  const get = (n: string) => cs.getPropertyValue(n).trim();
  return {
    bg: get('--bg'),
    bg2: get('--bg-2'),
    fg: get('--fg'),
    fg2: get('--fg-2'),
    muted: get('--muted'),
    grid: get('--grid'),
    border: get('--border'),
    accent: get('--accent'),
    warn: get('--dissent'),
    error: get('--adversarial'),
    link: get('--link'),
    male: get('--male'),
    female: get('--female'),
    road: get('--road'),
    ground: get('--ground'),
    water: get('--water'),
    roof: get('--roof'),
    roofCivic: get('--roof-civic'),
    roofChurch: get('--roof-church'),
    grass: get('--grass'),
    tree: get('--tree'),
  };
}
