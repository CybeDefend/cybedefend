import { QueryRunner, Table, TableIndex } from 'typeorm';
import { CreateGitHistoryCursor1778700000000 as Migration } from '../1778700000000-CreateGitHistoryCursor';

const fakeRunner = (tableExists: boolean) => {
  const runner = {
    hasTable: jest.fn(async () => tableExists),
    createTable: jest.fn(async (...args: [Table]) => void args),
    createIndex: jest.fn(async (...args: [string, TableIndex]) => void args),
    dropTable: jest.fn(async () => undefined),
    query: jest.fn(async () => []),
  };
  return runner as unknown as QueryRunner & typeof runner;
};

describe('CreateGitHistoryCursor1778700000000', () => {
  it('creates the table and its unique (projectId, branch) index', async () => {
    const qr = fakeRunner(false);
    await new Migration().up(qr);

    const table = qr.createTable.mock.calls[0][0];
    expect(table).toBeInstanceOf(Table);
    expect(table.name).toBe('git_history_cursor');
    expect(table.columns.map((c) => c.name)).toEqual([
      'id',
      'projectId',
      'branch',
      'repositoryKey',
      'tipSha',
      'coveredSince',
      'complete',
      'gaps',
      'consecutiveFailures',
      'lastPassOutcome',
      'updatedAt',
    ]);
    const [name, index] = qr.createIndex.mock.calls[0] as unknown as [
      string,
      TableIndex,
    ];
    expect(name).toBe('git_history_cursor');
    expect(index.name).toBe('UQ_git_history_cursor_project_branch');
    expect(index.isUnique).toBe(true);
    expect(index.columnNames).toEqual(['projectId', 'branch']);
  });

  it('is idempotent: nothing when the table exists', async () => {
    const qr = fakeRunner(true);
    await new Migration().up(qr);
    expect(qr.createTable).not.toHaveBeenCalled();
    expect(qr.createIndex).not.toHaveBeenCalled();
  });

  it('drops the table on down, only when present', async () => {
    const present = fakeRunner(true);
    await new Migration().down(present);
    expect(present.dropTable).toHaveBeenCalledWith('git_history_cursor');
    const absent = fakeRunner(false);
    await new Migration().down(absent);
    expect(absent.dropTable).not.toHaveBeenCalled();
    expect(present.query).not.toHaveBeenCalled();
  });
});
