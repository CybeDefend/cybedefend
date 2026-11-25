import { assignDriftPairs } from './sast-iac.utils';

/**
 * The line-drift repair assigns the rows a scan created at new positions to
 * the rows that vanished. The assignment must not depend on the order of the
 * rows, and a row holding a dismissal only takes a new row it is strictly the
 * closest to.
 */
describe('assignDriftPairs', () => {
  type Row = Parameters<typeof assignDriftPairs>[0][number]['old'];
  const open = (id: string): Row => ({
    id,
    currentState: 'to_verify',
    stateManuallyModified: false,
    triagedAt: null,
    triagedBy: null,
    triagedByType: null,
    resolvedAt: null,
    dismissalReason: null,
  });
  const dismissed = (id: string): Row => ({
    ...open(id),
    currentState: 'ignored',
    stateManuallyModified: true,
    triagedAt: new Date('2026-01-01T00:00:00Z'),
    triagedByType: 'user',
    triagedBy: 'u1',
  });
  const created = (id: string) => ({ id });

  const permutations = <T>(items: T[]): T[][] =>
    items.length <= 1
      ? [items]
      : items.flatMap((item, i) =>
          permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(
            (rest) => [item, ...rest],
          ),
        );

  it('pairs by smallest distance across the group, whatever the order', () => {
    const upperDismissed = dismissed('a');
    const lowerOpen = open('b');
    const at19 = created('n');
    const pairs = [
      { old: upperDismissed, candidate: at19, dist: 9 },
      { old: lowerOpen, candidate: at19, dist: 1 },
    ];
    for (const order of permutations(pairs)) {
      const result = assignDriftPairs(order);
      expect(result.get(lowerOpen)).toBe(at19);
      expect(result.has(upperDismissed)).toBe(false);
    }
  });

  it('gives a tie to the row nobody decided on, never to the dismissed one', () => {
    const d = dismissed('a');
    const u = open('z');
    const n = created('n');
    const pairs = [
      { old: d, candidate: n, dist: 5 },
      { old: u, candidate: n, dist: 5 },
    ];
    for (const order of permutations(pairs)) {
      const result = assignDriftPairs(order);
      expect(result.get(u)).toBe(n);
      expect(result.has(d)).toBe(false);
    }
  });

  it('pairs a dismissed row only with a new row it is strictly the closest to', () => {
    const d = dismissed('a');
    const u = open('b');
    const near = created('n1');
    const far = created('n2');
    // `d` is strictly the closest to `near`; `u` takes the row left.
    const result = assignDriftPairs([
      { old: d, candidate: near, dist: 1 },
      { old: u, candidate: near, dist: 4 },
      { old: u, candidate: far, dist: 6 },
    ]);
    expect(result.get(d)).toBe(near);
    expect(result.get(u)).toBe(far);
  });

  it('leaves a dismissed row unpaired when another vanished row is as close', () => {
    const d = dismissed('a');
    const u = open('b');
    const n = created('n');
    // `u` is already paired with a closer row; the dismissed row still does
    // not take `n`, for which `u` was as close.
    const m = created('m');
    const result = assignDriftPairs([
      { old: u, candidate: m, dist: 0 },
      { old: u, candidate: n, dist: 2 },
      { old: d, candidate: n, dist: 2 },
    ]);
    expect(result.get(u)).toBe(m);
    expect(result.has(d)).toBe(false);
  });
});
