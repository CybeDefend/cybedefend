import {
  DEFAULT_GIT_HISTORY_BUDGET_BYTES,
  DEFAULT_GIT_HISTORY_DEADLINE_MS,
  DEFAULT_GIT_HISTORY_TIMEOUT_MS,
  GIT_HISTORY_BUDGET_ENV,
  GIT_HISTORY_DEADLINE_ENV,
  GIT_HISTORY_TIMEOUT_ENV,
  resolveGitHistoryBudgetBytes,
  resolveGitHistoryDeadlineMs,
  resolveGitHistoryTimeoutMs,
} from './history-budget';

describe('history budget', () => {
  it('defaults to 2 GiB, read from GIT_HISTORY_BUDGET_BYTES', () => {
    expect(DEFAULT_GIT_HISTORY_BUDGET_BYTES).toBe(2 * 1024 ** 3);
    expect(GIT_HISTORY_BUDGET_ENV).toBe('GIT_HISTORY_BUDGET_BYTES');
    expect(resolveGitHistoryBudgetBytes({})).toBe(2 * 1024 ** 3);
  });

  it('takes a valid override', () => {
    expect(
      resolveGitHistoryBudgetBytes({ GIT_HISTORY_BUDGET_BYTES: '1048576' }),
    ).toBe(1048576);
  });

  it.each(['', '   ', 'abc', '0', '-5', 'NaN', 'Infinity'])(
    'falls back to the default for %p',
    (raw) => {
      expect(
        resolveGitHistoryBudgetBytes({ GIT_HISTORY_BUDGET_BYTES: raw }),
      ).toBe(DEFAULT_GIT_HISTORY_BUDGET_BYTES);
    },
  );
});

describe('history git call timeout', () => {
  it('defaults to 600 s, read from GIT_HISTORY_TIMEOUT_MS', () => {
    expect(DEFAULT_GIT_HISTORY_TIMEOUT_MS).toBe(600_000);
    expect(GIT_HISTORY_TIMEOUT_ENV).toBe('GIT_HISTORY_TIMEOUT_MS');
    expect(resolveGitHistoryTimeoutMs({})).toBe(600_000);
  });

  it('takes a valid override', () => {
    expect(resolveGitHistoryTimeoutMs({ GIT_HISTORY_TIMEOUT_MS: '1500' })).toBe(
      1500,
    );
  });

  it.each(['', 'soon', '0', '-1', 'Infinity'])(
    'falls back to the default for %p',
    (raw) => {
      expect(resolveGitHistoryTimeoutMs({ GIT_HISTORY_TIMEOUT_MS: raw })).toBe(
        DEFAULT_GIT_HISTORY_TIMEOUT_MS,
      );
    },
  );
});

describe('history fetch deadline', () => {
  it('defaults to 20 min, read from GIT_HISTORY_DEADLINE_MS', () => {
    expect(DEFAULT_GIT_HISTORY_DEADLINE_MS).toBe(1_200_000);
    expect(GIT_HISTORY_DEADLINE_ENV).toBe('GIT_HISTORY_DEADLINE_MS');
    expect(resolveGitHistoryDeadlineMs({})).toBe(1_200_000);
  });

  it('takes a valid override', () => {
    expect(
      resolveGitHistoryDeadlineMs({ GIT_HISTORY_DEADLINE_MS: '300000' }),
    ).toBe(300_000);
  });

  it.each(['', 'later', '0', '-1', 'Infinity'])(
    'falls back to the default for %p',
    (raw) => {
      expect(
        resolveGitHistoryDeadlineMs({ GIT_HISTORY_DEADLINE_MS: raw }),
      ).toBe(DEFAULT_GIT_HISTORY_DEADLINE_MS);
    },
  );
});
