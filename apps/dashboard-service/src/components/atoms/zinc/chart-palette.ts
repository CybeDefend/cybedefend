/**
 * The colours a zinc-kit chart may use: the semantic
 * palette, one colour per meaning, the same on every chart of the space.
 *
 * - `scans` mint (the brand green): an agent checking its own changes, the
 *   good routine;
 * - `guards` amber-500: a guard that warned;
 * - `denied` red-500: a guard that blocked;
 * - `rulesServed` iris (the brand violet): the Brain's light, the series the
 *   product exists for;
 * - `live` mint (the brand green): something happening now.
 *
 * Nothing else is coloured: grid and axes come from `CHART_CHROME`, legends
 * are words with a 6 px dot (`dot`), never coloured squares. No gradient fill
 * under a line; an area, if any, is the series colour at low opacity.
 *
 * `light` / `dark` are literals for SVG and canvas (`chartColor(series,
 * isDark)`); `dot`, `stroke`, `fill` and `text` are Tailwind classes carrying
 * their dark twin, for markup.
 */
export type ChartSeries = 'scans' | 'guards' | 'denied' | 'rulesServed' | 'live';

export interface ChartSeriesColour {
  /** On the light panel (`#ffffff`). */
  readonly light: string;
  /** On the dark panel (`vd-surface`). */
  readonly dark: string;
  /** A 6 px legend dot's background. */
  readonly dot: string;
  readonly stroke: string;
  readonly fill: string;
  readonly text: string;
}

export const CHART_PALETTE: Readonly<Record<ChartSeries, ChartSeriesColour>> = Object.freeze({
  scans: {
    light: '#047857',
    dark: '#34d399',
    dot: 'bg-mint',
    stroke: 'stroke-mint',
    fill: 'fill-mint',
    text: 'text-mint',
  },
  guards: {
    light: '#f59e0b',
    dark: '#f59e0b',
    dot: 'bg-amber-500',
    stroke: 'stroke-amber-500',
    fill: 'fill-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
  },
  denied: {
    light: '#ef4444',
    dark: '#ef4444',
    dot: 'bg-red-500',
    stroke: 'stroke-red-500',
    fill: 'fill-red-500',
    text: 'text-red-600 dark:text-red-400',
  },
  rulesServed: {
    light: 'rgb(var(--vd-iris-rgb))',
    dark: 'rgb(var(--vd-iris-rgb))',
    dot: 'bg-iris',
    stroke: 'stroke-iris',
    fill: 'fill-iris',
    text: 'text-iris',
  },
  live: {
    light: '#047857',
    dark: '#34d399',
    dot: 'bg-mint',
    stroke: 'stroke-mint',
    fill: 'fill-mint',
    text: 'text-mint',
  },
});

/** The order series are drawn and listed in a legend: the baseline first, the Brain's light last (on top). */
export const CHART_SERIES_ORDER: readonly ChartSeries[] = ['scans', 'guards', 'denied', 'live', 'rulesServed'];

/** Everything around the data: hairline grid, 12 px zinc axis labels, the hover cursor. */
export const CHART_CHROME = Object.freeze({
  grid: { light: 'rgb(228 228 231 / 0.6)', dark: 'rgb(255 255 255 / 0.06)' },
  axis: { light: '#a1a1aa', dark: '#71717a' },
  cursor: { light: 'rgb(24 24 27 / 0.04)', dark: 'rgb(255 255 255 / 0.04)' },
  axisFontSize: 12,
});

/** The literal colour of a series in the current theme, for SVG `stroke` / `fill` or a canvas. */
export const chartColor = (series: ChartSeries, dark: boolean): string =>
  dark ? CHART_PALETTE[series].dark : CHART_PALETTE[series].light;
