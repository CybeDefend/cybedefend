import { isCommitSha } from './commit-sha.util';

describe('isCommitSha', () => {
  it.each([
    ['a SHA-1', 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'],
    ['a SHA-256', 'f'.repeat(64)],
    ['upper-case hex', 'ABCDEF0123456789ABCDEF0123456789ABCDEF01'],
  ])('accepts %s', (_label, value) => {
    expect(isCommitSha(value)).toBe(true);
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['a number', 42],
    ['a branch name', 'main'],
    ['a short id', 'a1b2c3d'],
    ['39 hex', 'a'.repeat(39)],
    ['41 hex', 'a'.repeat(41)],
    ['non-hex', 'g'.repeat(40)],
    ['an injection', `${'a'.repeat(40)}&sha=main`],
    // The "no commit" id GitHub and GitLab send for a created or deleted
    // branch: nothing to scan.
    ['the null SHA-1', '0'.repeat(40)],
    ['the null SHA-256', '0'.repeat(64)],
  ])('refuses %s', (_label, value) => {
    expect(isCommitSha(value)).toBe(false);
  });
});
