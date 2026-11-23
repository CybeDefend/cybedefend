import { resolveDefaultBranch } from './resolve-default-branch.util';

const branch = (name: string, lastParsedAt = '2026-01-01T00:00:00.000Z') => ({
  branch: name,
  lastParsedAt,
});

describe('resolveDefaultBranch', () => {
  it('returns empty string when no parsed branches exist', () => {
    expect(resolveDefaultBranch([])).toBe('');
  });

  it('returns referenceBranch when it is in parsedBranches', () => {
    const branches = [branch('develop'), branch('master')];
    expect(resolveDefaultBranch(branches, 'master')).toBe('master');
  });

  it('ignores referenceBranch if it has not been parsed', () => {
    const branches = [branch('develop'), branch('main')];
    expect(resolveDefaultBranch(branches, 'feature-x')).toBe('main');
  });

  it('prefers main over master when no referenceBranch', () => {
    const branches = [branch('master'), branch('main')];
    expect(resolveDefaultBranch(branches)).toBe('main');
  });

  it('prefers master over staging when no main', () => {
    const branches = [branch('staging'), branch('master')];
    expect(resolveDefaultBranch(branches)).toBe('master');
  });

  it('prefers staging over dev', () => {
    const branches = [branch('dev'), branch('staging')];
    expect(resolveDefaultBranch(branches)).toBe('staging');
  });

  it('prefers dev over last-parsed fallback', () => {
    const branches = [
      branch('feature-x', '2026-04-01T00:00:00.000Z'),
      branch('dev', '2026-01-01T00:00:00.000Z'),
    ];
    expect(resolveDefaultBranch(branches)).toBe('dev');
  });

  it('falls back to most recently parsed branch when no priority match', () => {
    const branches = [
      branch('feature-x', '2026-01-01T00:00:00.000Z'),
      branch('fix-y', '2026-04-29T09:08:00.000Z'),
    ];
    expect(resolveDefaultBranch(branches)).toBe('fix-y');
  });

  it('handles single parsed branch as last resort', () => {
    expect(resolveDefaultBranch([branch('release-1.0')])).toBe('release-1.0');
  });
});
