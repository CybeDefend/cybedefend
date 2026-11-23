/**
 * « 8h ago » / « il y a 8 h »: a relative time short enough for the right
 * column of a dense row (the landing's live stream).
 *
 * `Intl.RelativeTimeFormat`, narrow in English; French reads « -8 h » in its
 * narrow style, so it takes the short one. As in `formatRelativeTime`, any
 * language other than French reads in English, the interface's fallback. Under
 * a minute is « now », the day before is « yesterday ». A date that cannot be
 * read gives null; a date in the future reads as « now » (clock skew).
 */
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

export function formatCompactRelativeTime(
  iso: string | null | undefined,
  language: string,
  now: number = Date.now(),
): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  const french = language.toLowerCase().startsWith('fr');
  const locale = french ? 'fr' : 'en';
  const style: Intl.RelativeTimeFormatStyle = french ? 'short' : 'narrow';
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return new Intl.RelativeTimeFormat(locale, { style, numeric: 'auto' }).format(0, 'second');
  for (const [unit, size] of UNITS) {
    const value = Math.floor(seconds / size);
    if (value < 1) continue;
    if (unit === 'day' && value === 1) {
      return new Intl.RelativeTimeFormat(locale, { style, numeric: 'auto' }).format(-1, 'day');
    }
    return new Intl.RelativeTimeFormat(locale, { style, numeric: 'always' }).format(-value, unit);
  }
  return null;
}
