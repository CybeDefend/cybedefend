import {
  SHA_ZERO,
  isBranchRef,
  isBranchCreation,
  isBranchDeletion,
  extractBranchName,
} from './gitlab-branch.util';

describe('gitlab-branch.util', () => {
  describe('SHA_ZERO', () => {
    it('is forty zeros (GitLab sentinel for empty SHA)', () => {
      expect(SHA_ZERO).toBe('0000000000000000000000000000000000000000');
      expect(SHA_ZERO.length).toBe(40);
    });
  });

  describe('isBranchRef', () => {
    it('returns true for a refs/heads/* ref', () => {
      expect(isBranchRef('refs/heads/foo')).toBe(true);
    });

    it('returns true for a nested branch ref like refs/heads/feature/x', () => {
      expect(isBranchRef('refs/heads/feature/foo')).toBe(true);
    });

    it('returns false for refs/tags/*', () => {
      expect(isBranchRef('refs/tags/v1')).toBe(false);
    });

    it('returns false for undefined input (non-string graceful)', () => {
      expect(isBranchRef(undefined as any)).toBe(false);
    });

    it('returns false for null input (non-string graceful)', () => {
      expect(isBranchRef(null as any)).toBe(false);
    });

    it('returns false for an empty string', () => {
      expect(isBranchRef('')).toBe(false);
    });

    it('returns false for a number (non-string graceful)', () => {
      expect(isBranchRef(42 as any)).toBe(false);
    });
  });

  describe('isBranchCreation', () => {
    it('returns true when before is SHA_ZERO and after is a non-zero SHA', () => {
      expect(
        isBranchCreation({ before: SHA_ZERO, after: 'abc123def456' }),
      ).toBe(true);
    });

    it('returns false for a normal push (both non-zero)', () => {
      expect(isBranchCreation({ before: 'abc', after: 'def' })).toBe(false);
    });

    it('returns false when both before and after are SHA_ZERO (no-op push)', () => {
      expect(isBranchCreation({ before: SHA_ZERO, after: SHA_ZERO })).toBe(
        false,
      );
    });

    it('returns false when payload is undefined (graceful)', () => {
      expect(isBranchCreation(undefined as any)).toBe(false);
    });

    it('returns false when only after is provided', () => {
      expect(isBranchCreation({ after: 'abc' } as any)).toBe(false);
    });
  });

  describe('isBranchDeletion', () => {
    it('returns true when after is SHA_ZERO regardless of before', () => {
      expect(isBranchDeletion({ before: 'abc', after: SHA_ZERO })).toBe(true);
      expect(isBranchDeletion({ before: SHA_ZERO, after: SHA_ZERO })).toBe(
        true,
      );
    });

    it('returns false when after is a non-zero SHA', () => {
      expect(isBranchDeletion({ before: 'abc', after: 'def' })).toBe(false);
    });

    it('returns false when after is missing (graceful)', () => {
      expect(isBranchDeletion({ before: 'abc' } as any)).toBe(false);
    });

    it('returns false when payload is undefined (graceful)', () => {
      expect(isBranchDeletion(undefined as any)).toBe(false);
    });
  });

  describe('extractBranchName', () => {
    it('strips the refs/heads/ prefix from a simple branch', () => {
      expect(extractBranchName('refs/heads/main')).toBe('main');
    });

    it('handles nested branches like refs/heads/feature/foo', () => {
      expect(extractBranchName('refs/heads/feature/foo')).toBe('feature/foo');
    });

    it('only strips ONE refs/heads/ prefix (pathological branch name)', () => {
      expect(extractBranchName('refs/heads/refs/heads/foo')).toBe(
        'refs/heads/foo',
      );
    });

    it('returns the input unchanged when there is no refs/heads/ prefix', () => {
      expect(extractBranchName('feature/foo')).toBe('feature/foo');
    });

    it('returns an empty string unchanged', () => {
      expect(extractBranchName('')).toBe('');
    });
  });
});
