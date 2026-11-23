/** The drawing box of a KPI sparkline; the SVG stretches it to the size the caller gives. */
export const SPARK_WIDTH = 64;
export const SPARK_HEIGHT = 20;
/** Room for the stroke at the top and the bottom. */
const PAD = 2;

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * A series as the `points` of one polyline in a 64 × 20 box: the first
 * reading on the left edge, the last on the right, the highest at the top.
 * A flat series is a flat line in the middle. Readings that are not numbers
 * are left out; below two readings there is nothing to draw (null).
 */
export function sparklinePoints(series: readonly (number | null | undefined)[] | null | undefined): string | null {
  const values = (series ?? []).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const x = (i: number) => (i / (values.length - 1)) * SPARK_WIDTH;
  const y = (v: number) => (span === 0 ? SPARK_HEIGHT / 2 : SPARK_HEIGHT - PAD - ((v - min) / span) * (SPARK_HEIGHT - 2 * PAD));
  return values.map((v, i) => `${round(x(i))},${round(y(v))}`).join(' ');
}
