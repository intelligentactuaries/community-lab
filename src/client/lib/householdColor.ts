// Household identity colour: one fixed hue per PLOT (1–16), evenly spaced in
// OKLCH so neighbours differ. The colour follows the plot (the house), so a
// household keeps its colour for as long as it lives there and a newcomer
// inherits the plot's colour. Light and dark steps were generated at OKLCH
// L 0.58 / C 0.13 and L 0.74 / C 0.12 respectively.
const LIGHT = ['#BA5661', '#BA5B3E', '#B16512', '#A07100', '#867D00', '#658827', '#348F4F', '#009272', '#009192', '#008BAC', '#0C82BF', '#4F78C7', '#736DC3', '#8F63B5', '#A45B9F', '#B35682'];
const DARK = ['#EC8A92', '#EB8F73', '#E29858', '#D0A348', '#B6AF4D', '#96B963', '#6FC082', '#46C3A3', '#25C2C2', '#35BDDC', '#5CB4EF', '#82AAF7', '#A3A0F3', '#BF96E6', '#D58ECF', '#E58AB2'];
// Interleave so plots side by side on a street (1,2,3…) get well-separated hues.
const ORDER = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];

export function plotColor(plot: number | null | undefined, dark: boolean): string {
  if (!plot) return dark ? '#978F82' : '#605A51';
  const pal = dark ? DARK : LIGHT;
  return pal[ORDER[(plot - 1) % 16]];
}

export function isDarkTheme(): boolean {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';
}
