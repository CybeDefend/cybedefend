import { mergeDetectionBounds } from './detection-bounds.util';

/**
 * The string half of this rule is covered by `backfill-lifecycle.spec.ts`, which
 * has exercised it since task 5. What is pinned here is the DATE half, used by
 * the ingestion path's line-drift repair — a merge that gets `last` wrong there
 * makes a finding that is still present export as though it had not been seen
 * for weeks.
 */
describe('mergeDetectionBounds — Date bounds', () => {
  const born = new Date('2020-01-01T00:00:00Z');
  const june = new Date('2026-06-01T00:00:00Z');
  const today = new Date('2026-08-06T09:00:00Z');

  it('keeps the earlier first and the later last', () => {
    const out = mergeDetectionBounds(
      { first: born, last: june },
      { first: today, last: today },
    );
    expect(out.first).toBe(born);
    expect(out.last).toBe(today);
    expect(out.changed).toBe(true);
  });

  it('never moves a bound inward', () => {
    const out = mergeDetectionBounds(
      { first: born, last: today },
      { first: june, last: june },
    );
    expect(out.first).toBe(born);
    expect(out.last).toBe(today);
    expect(out.changed).toBe(false);
  });

  it('takes the other side when a bound is null, in either direction', () => {
    expect(
      mergeDetectionBounds(
        { first: null, last: null },
        { first: today, last: today },
      ),
    ).toEqual({ first: today, last: today, changed: true });

    expect(
      mergeDetectionBounds(
        { first: born, last: june },
        { first: null, last: null },
      ),
    ).toEqual({ first: born, last: june, changed: false });
  });

  // `changed` must be a VALUE comparison: two `Date` objects for one instant are
  // never reference-equal, so a `!==` here would report every merge as a change
  // and, in the backfill, rewrite `updateAt` on the whole corpus.
  it('reports changed=false for an equal instant held in a different object', () => {
    const out = mergeDetectionBounds(
      { first: born, last: june },
      { first: new Date(born.getTime()), last: new Date(june.getTime()) },
    );
    expect(out.changed).toBe(false);
  });
});
