import { levelFromScore, CyberRiskLevel } from './level-from-score';

describe('levelFromScore', () => {
  it.each<[number, CyberRiskLevel]>([
    [0, 'low'],
    [4, 'low'],
    [4.99, 'low'],
    [5, 'low'],
    [10, 'low'],
    [19, 'low'],
    [20, 'medium'],
    [35, 'medium'],
    [49, 'medium'],
    [50, 'high'],
    [65, 'high'],
    [79, 'high'],
    [80, 'critical'],
    [100, 'critical'],
    [19999, 'critical'],
    [Number.MAX_SAFE_INTEGER, 'critical'],
  ])('score=%i → level=%s', (score, expected) => {
    expect(levelFromScore(score)).toBe(expected);
  });

  it('treats a zero or negative score as the low floor (never none)', () => {
    expect(levelFromScore(0)).toBe('low');
    expect(levelFromScore(-1)).toBe('low');
  });
});
