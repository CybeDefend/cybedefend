import type { QueryRunner } from 'typeorm';
import { AdvisoryLockTimeoutError, withAdvisoryLock } from '../index';

type FakeRunner = {
  query: jest.Mock;
  manager: { connection: { options: { type: string } } };
};

function fakeRunner(type: 'mysql' | 'postgres'): FakeRunner {
  return { query: jest.fn(), manager: { connection: { options: { type } } } };
}

describe('withAdvisoryLock', () => {
  it('mysql: GET_LOCK, fn, then RELEASE_LOCK in finally', async () => {
    const runner = fakeRunner('mysql');
    runner.query.mockResolvedValueOnce({ records: [{ acquired: 1 }], affected: 0 });
    const fn = jest.fn(async () => 'done');
    const out = await withAdvisoryLock(runner as unknown as QueryRunner, 'mylock', 5, fn);
    expect(out).toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(runner.query.mock.calls[0][0]).toBe('SELECT GET_LOCK(?, ?) AS acquired');
    expect(runner.query.mock.calls[0][1]).toEqual(['mylock', 5]);
    expect(runner.query.mock.calls[1][0]).toBe('SELECT RELEASE_LOCK(?)');
    expect(runner.query.mock.calls[1][1]).toEqual(['mylock']);
  });

  it('mysql: a lock never granted throws and still releases', async () => {
    const runner = fakeRunner('mysql');
    runner.query.mockResolvedValue({ records: [{ acquired: 0 }], affected: 0 });
    const fn = jest.fn(async () => 'never');
    await expect(
      withAdvisoryLock(runner as unknown as QueryRunner, 'mylock', 1, fn),
    ).rejects.toThrow(AdvisoryLockTimeoutError);
    expect(fn).not.toHaveBeenCalled();
    expect(runner.query.mock.calls.some((c) => c[0] === 'SELECT RELEASE_LOCK(?)')).toBe(true);
  });

  it('mysql: releases the lock when fn throws', async () => {
    const runner = fakeRunner('mysql');
    runner.query.mockResolvedValueOnce({ records: [{ acquired: 1 }], affected: 0 });
    const err = new Error('fn failed');
    await expect(
      withAdvisoryLock(runner as unknown as QueryRunner, 'mylock', 5, async () => {
        throw err;
      }),
    ).rejects.toBe(err);
    expect(runner.query.mock.calls[1][0]).toBe('SELECT RELEASE_LOCK(?)');
  });

  it('postgres: polls pg_try_advisory_lock until granted, then unlocks', async () => {
    jest.useFakeTimers();
    try {
      const runner = fakeRunner('postgres');
      runner.query
        .mockResolvedValueOnce({ records: [{ acquired: false }], affected: 0 })
        .mockResolvedValueOnce({ records: [{ acquired: false }], affected: 0 })
        .mockResolvedValueOnce({ records: [{ acquired: true }], affected: 0 });
      const fn = jest.fn(async () => 'ok');
      const p = withAdvisoryLock(runner as unknown as QueryRunner, 'pglock', 30, fn);
      await jest.advanceTimersByTimeAsync(500);
      await expect(p).resolves.toBe('ok');
      const texts = runner.query.mock.calls.map((c) => c[0]);
      expect(texts[0]).toBe('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired');
      expect(runner.query.mock.calls[0][1]).toEqual(['pglock']);
      expect(texts.filter((t) => t.includes('pg_try_advisory_lock'))).toHaveLength(3);
      expect(texts[texts.length - 1]).toBe('SELECT pg_advisory_unlock(hashtextextended($1, 0))');
      expect(runner.query.mock.calls[runner.query.mock.calls.length - 1][1]).toEqual(['pglock']);
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('postgres: a lock never granted throws after timeoutS and never calls fn', async () => {
    jest.useFakeTimers();
    try {
      const runner = fakeRunner('postgres');
      runner.query.mockResolvedValue({ records: [{ acquired: false }], affected: 0 });
      const fn = jest.fn(async () => 'never');
      const p = withAdvisoryLock(runner as unknown as QueryRunner, 'pglock', 1, fn);
      const assertion = expect(p).rejects.toThrow(AdvisoryLockTimeoutError);
      await jest.advanceTimersByTimeAsync(10000);
      await assertion;
      expect(fn).not.toHaveBeenCalled();
      const texts = runner.query.mock.calls.map((c) => c[0]);
      expect(texts[texts.length - 1]).toBe('SELECT pg_advisory_unlock(hashtextextended($1, 0))');
      await expect(p).rejects.toMatchObject({ code: 'ADVISORY_LOCK_TIMEOUT' });
    } finally {
      jest.useRealTimers();
    }
  });
});
