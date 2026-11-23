import { describe, it, expect } from 'vitest';
import { shouldOfferFocusTop5 } from './focusTop5Logic';

// The "Focus Top 5" entry point must not be offered on an empty
// vulnerability list. This predicate is the single source of truth shared by
// the 6 listing pages, so the rule can't drift between them.
describe('shouldOfferFocusTop5', () => {
  it('offers the focus when there is at least one issue', () => {
    expect(shouldOfferFocusTop5(1)).toBe(true);
    expect(shouldOfferFocusTop5(42)).toBe(true);
  });

  it('does not offer the focus when the list is empty (total = 0)', () => {
    expect(shouldOfferFocusTop5(0)).toBe(false);
  });

  it('does not offer the focus for negative totals', () => {
    expect(shouldOfferFocusTop5(-3)).toBe(false);
  });

  it('does not offer the focus while the total is still unknown', () => {
    expect(shouldOfferFocusTop5(undefined)).toBe(false);
    expect(shouldOfferFocusTop5(null)).toBe(false);
    expect(shouldOfferFocusTop5(NaN)).toBe(false);
  });
});
