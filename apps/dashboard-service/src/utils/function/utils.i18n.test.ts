import { afterAll, describe, it, expect } from 'vitest';
import i18n from '@/i18n';
import { convertDate, getPriorityLabel } from './utils';

/*
  Every results list prints a finding's priority through `getPriorityLabel`
  and its first detection through `convertDate`. Both answered in English
  whatever the interface language: « Critical Urgent », « 8 October 2026 » on
  a French page.
*/

describe('labels of the results lists, in the interface language', () => {
  afterAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('names a priority in English', async () => {
    await i18n.changeLanguage('en');
    expect(['critical_urgent', 'urgent', 'normal', 'low', 'very_low'].map(getPriorityLabel)).toEqual([
      'Critical Urgent',
      'Urgent',
      'Normal',
      'Low',
      'Very Low',
    ]);
    expect(getPriorityLabel('CRITICAL_URGENT')).toBe('Critical Urgent');
  });

  it('names a priority in French', async () => {
    await i18n.changeLanguage('fr');
    expect(['critical_urgent', 'urgent', 'normal', 'low', 'very_low'].map(getPriorityLabel)).toEqual([
      'Critique urgent',
      'Urgent',
      'Normal',
      'Faible',
      'Très faible',
    ]);
  });

  it('keeps an unknown priority as the API sent it, never a dotted key', async () => {
    await i18n.changeLanguage('fr');
    expect(getPriorityLabel('blocker')).toBe('blocker');
  });

  it('writes a date in the interface language', async () => {
    await i18n.changeLanguage('en');
    expect(convertDate('2026-10-08T09:30:00Z')).toBe('8 October 2026');
    await i18n.changeLanguage('fr');
    expect(convertDate('2026-10-08T09:30:00Z')).toBe('8 octobre 2026');
  });
});
