import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatRelativeTime } from './relativeTime';

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T10:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['2026-10-02T09:48:00.000Z', 'en', '12 minutes ago'],
    ['2026-10-02T09:48:00.000Z', 'fr', 'il y a 12 minutes'],
    ['2026-10-02T07:00:00.000Z', 'en', 'about 3 hours ago'],
    ['2026-10-02T07:00:00.000Z', 'fr', 'il y a environ 3 heures'],
    ['2026-09-29T10:00:00.000Z', 'en', '3 days ago'],
    ['2026-09-29T10:00:00.000Z', 'fr', 'il y a 3 jours'],
    // A regional tag is still French.
    ['2026-10-02T09:48:00.000Z', 'fr-FR', 'il y a 12 minutes'],
    // Any other language reads in English, the fallback of the interface.
    ['2026-10-02T09:48:00.000Z', 'de', '12 minutes ago'],
  ])('%s in %s ⇒ %s', (iso, language, expected) => {
    expect(formatRelativeTime(iso, language)).toBe(expected);
  });

  it.each([[null], [undefined], [''], ['not a date']])('gives nothing for %s', (value) => {
    expect(formatRelativeTime(value, 'en')).toBeNull();
  });
});
