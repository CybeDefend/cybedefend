import { describe, it, expect } from 'vitest';
import { severityTone, WORD_TONE } from './wordTone';

describe('severityTone: the colour a severity word is written in', () => {
  it('reads the severity whatever its case', () => {
    expect(severityTone('CRITICAL')).toBe('critical');
    expect(severityTone('High')).toBe('high');
    expect(severityTone('medium')).toBe('medium');
    expect(severityTone('LOW')).toBe('low');
  });

  it('leaves an unknown or missing severity in zinc', () => {
    expect(severityTone('INFO')).toBe('neutral');
    expect(severityTone(undefined)).toBe('neutral');
    expect(severityTone(null)).toBe('neutral');
  });

  it('gives every tone a light and a dark text shade, never a fill', () => {
    for (const classes of Object.values(WORD_TONE)) {
      expect(classes).toMatch(/^text-\S+ dark:text-\S+$/);
    }
  });
});
