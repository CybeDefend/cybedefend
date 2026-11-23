import { describe, it, expect } from 'vitest';
import { deltaTone, seriesDelta } from './kpiTone';

describe('deltaTone: what a change means, never its sign alone', () => {
  it('reads more of a good thing as good news, and less of it as bad news', () => {
    expect(deltaTone(64, 'moreIsGood')).toBe('good');
    expect(deltaTone(-3, 'moreIsGood')).toBe('bad');
  });

  it('reads more of a bad thing as bad news, and less of it as good news', () => {
    expect(deltaTone(38, 'moreIsBad')).toBe('bad');
    expect(deltaTone(-2, 'moreIsBad')).toBe('good');
  });

  it('says nothing about no change, nor about a figure it could not read', () => {
    expect(deltaTone(0, 'moreIsBad')).toBe('neutral');
    expect(deltaTone(0, 'moreIsGood')).toBe('neutral');
    expect(deltaTone(null, 'moreIsGood')).toBe('neutral');
    expect(deltaTone(undefined, 'moreIsBad')).toBe('neutral');
    expect(deltaTone(Number.NaN, 'moreIsBad')).toBe('neutral');
  });

  it('keeps a neutral measure neutral whatever it does', () => {
    expect(deltaTone(12, 'neutral')).toBe('neutral');
    expect(deltaTone(-12, 'neutral')).toBe('neutral');
  });
});

describe('seriesDelta: the move over a series the page already holds', () => {
  it('is the last reading minus the first', () => {
    expect(seriesDelta([45, 46.2, 52.8])).toBeCloseTo(7.8);
    expect(seriesDelta([6, 5, 4, 6, 2])).toBe(-4);
  });

  it('skips the readings that are not numbers', () => {
    expect(seriesDelta([null, 3, Number.NaN, 7, undefined])).toBe(4);
  });

  it('is unknown with fewer than two readings', () => {
    expect(seriesDelta([])).toBeNull();
    expect(seriesDelta([5])).toBeNull();
    expect(seriesDelta(undefined)).toBeNull();
  });
});
