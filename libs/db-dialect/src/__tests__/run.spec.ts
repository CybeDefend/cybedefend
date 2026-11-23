import type { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { dialectApi, run } from '../index';

const q = dialectApi('postgres').sql`SELECT ${1}`;

type Target = QueryRunner | DataSource | EntityManager;

it('reads rows and affected from a structured TypeORM result', async () => {
  const runner = {
    query: jest.fn().mockResolvedValue({ records: [{ a: 1 }], affected: undefined }),
  };
  const res = await run(runner as unknown as Target, q);
  expect(res).toEqual({ rows: [{ a: 1 }], affected: 0 });
  expect(runner.query).toHaveBeenCalledWith('SELECT $1', [1], true);
});

it('reads affectedRows from a mysql2 header inside records', async () => {
  const runner = {
    query: jest.fn().mockResolvedValue({ records: { affectedRows: 2 }, affected: 2 }),
  };
  const res = await run(runner as unknown as Target, q);
  expect(res).toEqual({ rows: [], affected: 2 });
});

it('reads affectedRows when the raw driver result is passed directly', async () => {
  const runner = { query: jest.fn().mockResolvedValue({ affectedRows: 5 }) };
  const res = await run(runner as unknown as Target, q);
  expect(res).toEqual({ rows: [], affected: 5 });
});

it('opens and releases a runner for a DataSource', async () => {
  const inner = {
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue({ records: [{ ok: 1 }], affected: 1 }),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const ds = { createQueryRunner: jest.fn(() => inner), query: jest.fn() };
  const res = await run(ds as unknown as Target, q);
  expect(res).toEqual({ rows: [{ ok: 1 }], affected: 1 });
  expect(inner.connect).toHaveBeenCalledTimes(1);
  expect(inner.release).toHaveBeenCalledTimes(1);
});

it('releases the DataSource runner even when the query rejects', async () => {
  const inner = {
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockRejectedValue(new Error('boom')),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const ds = { createQueryRunner: jest.fn(() => inner), query: jest.fn() };
  await expect(run(ds as unknown as Target, q)).rejects.toThrow('boom');
  expect(inner.release).toHaveBeenCalledTimes(1);
});

it('uses the EntityManager transaction runner when there is one', async () => {
  const txRunner = { query: jest.fn().mockResolvedValue({ records: [{ ok: 1 }], affected: 0 }) };
  const em = { query: jest.fn(), queryRunner: txRunner };
  const res = await run(em as unknown as Target, q);
  expect(res).toEqual({ rows: [{ ok: 1 }], affected: 0 });
  expect(txRunner.query).toHaveBeenCalledWith('SELECT $1', [1], true);
  expect(em.query).not.toHaveBeenCalled();
});

it('does not release a QueryRunner it was given', async () => {
  const runner = {
    query: jest.fn().mockResolvedValue({ records: [], affected: 3 }),
    release: jest.fn(),
    isTransactionActive: false,
  };
  const res = await run(runner as unknown as Target, q);
  expect(res).toEqual({ rows: [], affected: 3 });
  expect(runner.release).not.toHaveBeenCalled();
});

it('routes an EntityManager without a transaction runner through its connection', async () => {
  // EntityManager.query drops the `structured` argument, so on PostgreSQL an
  // UPDATE would report affected: 0; the connection's own runner keeps it.
  const inner = {
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue({ records: [], affected: 4 }),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const connection = { createQueryRunner: jest.fn(() => inner) };
  const em = { query: jest.fn(), connection, queryRunner: undefined };
  const res = await run(em as unknown as Target, q);
  expect(res).toEqual({ rows: [], affected: 4 });
  expect(inner.query).toHaveBeenCalledWith('SELECT $1', [1], true);
  expect(inner.release).toHaveBeenCalledTimes(1);
  expect(em.query).not.toHaveBeenCalled();
});

it('runs a QueryRunner on itself even though it carries a connection', async () => {
  const connection = { createQueryRunner: jest.fn() };
  const runner = {
    query: jest.fn().mockResolvedValue({ records: [], affected: 2 }),
    release: jest.fn(),
    connection,
    manager: {},
    isTransactionActive: true,
  };
  const res = await run(runner as unknown as Target, q);
  expect(res).toEqual({ rows: [], affected: 2 });
  expect(runner.query).toHaveBeenCalledWith('SELECT $1', [1], true);
  expect(connection.createQueryRunner).not.toHaveBeenCalled();
  expect(runner.release).not.toHaveBeenCalled();
});
