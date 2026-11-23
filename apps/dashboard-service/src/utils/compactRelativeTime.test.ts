import { describe, expect, it } from 'vitest';

import { formatCompactRelativeTime } from './compactRelativeTime';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();
const narrow = (value: number, unit: Intl.RelativeTimeFormatUnit) =>
  new Intl.RelativeTimeFormat('en', { style: 'narrow', numeric: 'always' }).format(-value, unit);

describe('formatCompactRelativeTime', () => {
  it('picks the largest whole unit', () => {
    expect(formatCompactRelativeTime(ago(5 * 60), 'en', NOW)).toBe(narrow(5, 'minute'));
    expect(formatCompactRelativeTime(ago(8 * 3600 + 59 * 60), 'en', NOW)).toBe(narrow(8, 'hour'));
    expect(formatCompactRelativeTime(ago(3 * 86400), 'en', NOW)).toBe(narrow(3, 'day'));
    expect(formatCompactRelativeTime(ago(15 * 86400), 'en', NOW)).toBe(narrow(2, 'week'));
  });

  it('says now under a minute (and for a date slightly ahead), yesterday for one day', () => {
    const auto = new Intl.RelativeTimeFormat('en', { style: 'narrow', numeric: 'auto' });
    expect(formatCompactRelativeTime(ago(20), 'en', NOW)).toBe(auto.format(0, 'second'));
    expect(formatCompactRelativeTime(ago(-30), 'en', NOW)).toBe(auto.format(0, 'second'));
    expect(formatCompactRelativeTime(ago(30 * 3600), 'en', NOW)).toBe(auto.format(-1, 'day'));
  });

  it('reads French in the short style, any other language in English', () => {
    expect(formatCompactRelativeTime(ago(8 * 3600), 'fr-FR', NOW)).toBe(
      new Intl.RelativeTimeFormat('fr', { style: 'short', numeric: 'always' }).format(-8, 'hour'),
    );
    expect(formatCompactRelativeTime(ago(8 * 3600), 'de', NOW)).toBe(narrow(8, 'hour'));
  });

  it('gives null for a missing or unreadable date', () => {
    expect(formatCompactRelativeTime(null, 'en', NOW)).toBeNull();
    expect(formatCompactRelativeTime('not a date', 'en', NOW)).toBeNull();
  });
});
