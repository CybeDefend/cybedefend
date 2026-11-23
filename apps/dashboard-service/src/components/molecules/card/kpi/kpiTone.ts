/** What a delta says: good news, bad news, or nothing. */
export type AsDeltaTone = 'good' | 'bad' | 'neutral';

/**
 * Which way a measure is good news. More solved findings is good, more new
 * findings is bad, an average scan time says nothing on its own.
 */
export type KpiDirection = 'moreIsGood' | 'moreIsBad' | 'neutral';

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * The tone of a delta by what it means, never by its sign alone:
 * mint when it is good news, red when it is bad, zinc when
 * nothing moved or the figure could not be read.
 */
export function deltaTone(value: number | null | undefined, direction: KpiDirection): AsDeltaTone {
  if (!isNumber(value) || value === 0 || direction === 'neutral') return 'neutral';
  const up = value > 0;
  if (direction === 'moreIsGood') return up ? 'good' : 'bad';
  return up ? 'bad' : 'good';
}

/**
 * The move over a series the page already holds: its last reading minus its
 * first, skipping what is not a number. Null below two readings.
 */
export function seriesDelta(series: readonly (number | null | undefined)[] | null | undefined): number | null {
  const values = (series ?? []).filter(isNumber);
  if (values.length < 2) return null;
  return values[values.length - 1] - values[0];
}
