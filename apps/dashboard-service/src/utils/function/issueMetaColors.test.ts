import { describe, it, expect } from 'vitest';
import { cvssScoreColorClass, priorityColorClass, statusColorClass } from './issueMetaColors';

describe('cvssScoreColorClass', () => {
  it('bands the score into the risk palette', () => {
    expect(cvssScoreColorClass(9.3)).toBe('text-critical-risk');
    expect(cvssScoreColorClass(7)).toBe('text-high-risk');
    expect(cvssScoreColorClass(4)).toBe('text-medium-risk');
    expect(cvssScoreColorClass(2.1)).toBe('text-low-risk');
  });
});

describe('priorityColorClass', () => {
  it('colours by priority keyword', () => {
    expect(priorityColorClass('urgent')).toBe('text-critical-risk');
    expect(priorityColorClass('Important')).toBe('text-high-risk');
    expect(priorityColorClass('normal')).toBe('text-medium-risk');
    expect(priorityColorClass('low')).toBe('text-low-risk');
  });
  it('falls back to neutral for unknown / empty', () => {
    expect(priorityColorClass('whatever')).toBe('text-gray-700 dark:text-gray-300');
    expect(priorityColorClass(undefined)).toBe('text-gray-700 dark:text-gray-300');
  });
});

describe('statusColorClass', () => {
  it('greens resolved/false-positive states', () => {
    expect(statusColorClass('false_positive')).toBe('text-fixed');
    expect(statusColorClass('resolved')).toBe('text-fixed');
    expect(statusColorClass('fixed')).toBe('text-fixed');
  });
  it('reds confirmed/true-positive states', () => {
    expect(statusColorClass('confirmed')).toBe('text-critical-risk');
    expect(statusColorClass('true_positive')).toBe('text-critical-risk');
  });
  it('uses the brand colour for in-progress states', () => {
    expect(statusColorClass('to_verify')).toBe('text-secondary');
    expect(statusColorClass('in_review')).toBe('text-secondary');
  });
  it('falls back to neutral otherwise', () => {
    expect(statusColorClass('')).toBe('text-gray-700 dark:text-gray-300');
  });
});
