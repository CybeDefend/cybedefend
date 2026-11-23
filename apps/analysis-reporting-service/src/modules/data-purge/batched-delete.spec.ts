import { DataSource } from 'typeorm';
import { deleteInBatches, purgeDeleteSql } from './batched-delete';

const ID = '11111111-2222-4333-8444-555555555555';
const LATER = () => Date.now() + 60_000;

describe('purgeDeleteSql', () => {
  it('keeps the MySQL statement of an equality purge', () => {
    const q = purgeDeleteSql('sca_detected_packages', 'projectId', ID, 1000);
    expect(q.text).toBe(
      'DELETE FROM `sca_detected_packages` WHERE `projectId` = ? LIMIT ?',
    );
    expect(q.params).toEqual([ID, 1000]);
  });

  it('keeps the MySQL statement of a comma-separated purge with its extra condition', () => {
    const q = purgeDeleteSql(
      'aggregated_reports',
      'scope_id',
      ID,
      1000,
      "`scope_type` = 'batch' AND `organization_id` IS NULL",
      'find_in_set',
    );
    expect(q.text).toBe(
      "DELETE FROM `aggregated_reports` WHERE FIND_IN_SET(?, `scope_id`) > 0 AND `scope_type` = 'batch' AND `organization_id` IS NULL LIMIT ?",
    );
    expect(q.params).toEqual([ID, 1000]);
  });

  it('deletes a bounded batch by ctid on PostgreSQL', () => {
    const q = purgeDeleteSql(
      'sca_detected_packages',
      'projectId',
      ID,
      1000,
      undefined,
      'equals',
      'postgres',
    );
    expect(q.text).toBe(
      'DELETE FROM "sca_detected_packages" WHERE ctid IN (SELECT ctid FROM "sca_detected_packages" WHERE "projectId" = $1 LIMIT $2)',
    );
    expect(q.params).toEqual([ID, 1000]);
  });

  it('matches one item of a comma-separated column on PostgreSQL', () => {
    const q = purgeDeleteSql(
      'aggregated_reports',
      'scope_id',
      ID,
      500,
      `"scope_type" = 'batch'`,
      'find_in_set',
      'postgres',
    );
    expect(q.text).toBe(
      'DELETE FROM "aggregated_reports" WHERE ctid IN (SELECT ctid FROM "aggregated_reports" WHERE ' +
        `($1 = ANY(string_to_array("scope_id", ','))) AND "scope_type" = 'batch' LIMIT $2)`,
    );
    expect(q.params).toEqual([ID, 500]);
  });

  it('refuses a table or column that is not a plain identifier', () => {
    expect(() => purgeDeleteSql('t; DROP', 'projectId', ID, 1000)).toThrow(
      'Invalid SQL identifier: t; DROP',
    );
    expect(() =>
      purgeDeleteSql('t', 'a`b', ID, 1000, undefined, 'equals', 'postgres'),
    ).toThrow('Invalid SQL identifier: a`b');
  });
});

describe('deleteInBatches', () => {
  function dataSource(affected: number[]) {
    const query = jest.fn(async () => ({
      records: [],
      affected: affected.shift() ?? 0,
    }));
    const release = jest.fn(async () => undefined);
    const ds = {
      createQueryRunner: () => ({ query, release }),
    } as unknown as DataSource;
    return { ds, query, release };
  }

  it('reads the affected rows through run() and loops while a batch is full', async () => {
    const { ds, query, release } = dataSource([2, 2, 1]);
    const res = await deleteInBatches(ds, 't', 'projectId', ID, LATER(), 2);
    expect(res).toEqual({ deleted: 5, complete: true });
    expect(query).toHaveBeenCalledTimes(3);
    expect(query).toHaveBeenCalledWith(
      'DELETE FROM `t` WHERE `projectId` = ? LIMIT ?',
      [ID, 2],
      true,
    );
    expect(release).toHaveBeenCalledTimes(3);
  });

  it('stops at the deadline after one full batch', async () => {
    const { ds, query } = dataSource([2, 2]);
    const res = await deleteInBatches(ds, 't', 'projectId', ID, 0, 2);
    expect(res).toEqual({ deleted: 2, complete: false });
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('the extra conditions of purge-tables', () => {
  function loadTables(dbType: string) {
    const previous = process.env.DB_TYPE;
    process.env.DB_TYPE = dbType;
    try {
      let tables: typeof import('./purge-tables') | undefined;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        tables = require('./purge-tables');
      });
      return tables;
    } finally {
      if (previous === undefined) delete process.env.DB_TYPE;
      else process.env.DB_TYPE = previous;
    }
  }

  function wheres(t: typeof import('./purge-tables')): string[] {
    return [
      ...t.PROJECT_PURGE_TABLES,
      ...t.TEAM_PURGE_TABLES,
      ...t.ORGANIZATION_PURGE_TABLES,
    ]
      .map((row) => row.where)
      .filter((w): w is string => !!w);
  }

  it('keeps the backticks of the cloud statements on MySQL', () => {
    expect(wheres(loadTables('mysql'))).toContain(
      "`scope_type` = 'batch' AND `organization_id` IS NULL",
    );
  });

  it('quotes its identifiers for PostgreSQL', () => {
    const list = wheres(loadTables('postgres'));
    expect(list).toContain(
      `"scope_type" = 'batch' AND "organization_id" IS NULL`,
    );
    expect(list.filter((w) => w.includes('`'))).toEqual([]);
  });
});
