import { QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';
import { AddSecretValueHash1846300000000 as Migration } from '../1846300000000-AddSecretValueHash';

const TABLE = 'vulnerability_detections_secret';
const INDEX = 'IDX_vd_secret_proj_branch_valuehash';

/**
 * Common migration: TypeORM's schema API only, so it runs on MySQL and
 * PostgreSQL. The fake runner records the calls; no SQL text is involved.
 */
const fakeRunner = (opts: { column: boolean; index: boolean }) => {
  const runner = {
    hasColumn: jest.fn(async (table: string, column: string) => {
      expect(table).toBe(TABLE);
      return opts.column && column === 'secretValueHash';
    }),
    getTable: jest.fn(async (table: string) => {
      expect(table).toBe(TABLE);
      return new Table({
        name: TABLE,
        indices: opts.index
          ? [new TableIndex({ name: INDEX, columnNames: [] })]
          : [],
      });
    }),
    addColumn: jest.fn(async () => undefined),
    createIndex: jest.fn(async () => undefined),
    dropColumn: jest.fn(async () => undefined),
    dropIndex: jest.fn(async () => undefined),
    query: jest.fn(async () => []),
  };
  return runner as unknown as QueryRunner & typeof runner;
};

describe('AddSecretValueHash1846300000000', () => {
  it('adds the column and the index when absent', async () => {
    const qr = fakeRunner({ column: false, index: false });
    await new Migration().up(qr);

    expect(qr.addColumn).toHaveBeenCalledWith(
      TABLE,
      new TableColumn({
        name: 'secretValueHash',
        type: 'varchar',
        length: '64',
        isNullable: true,
      }),
    );
    expect(qr.createIndex).toHaveBeenCalledWith(
      TABLE,
      new TableIndex({
        name: INDEX,
        columnNames: ['projectId', 'branch', 'secretValueHash'],
      }),
    );
    expect(qr.query).not.toHaveBeenCalled();
  });

  it('adds nothing when present', async () => {
    const qr = fakeRunner({ column: true, index: true });
    await new Migration().up(qr);
    expect(qr.addColumn).not.toHaveBeenCalled();
    expect(qr.createIndex).not.toHaveBeenCalled();
  });

  it('down drops both only when present', async () => {
    const present = fakeRunner({ column: true, index: true });
    await new Migration().down(present);
    expect(present.dropIndex).toHaveBeenCalledWith(TABLE, INDEX);
    expect(present.dropColumn).toHaveBeenCalledWith(TABLE, 'secretValueHash');

    const absent = fakeRunner({ column: false, index: false });
    await new Migration().down(absent);
    expect(absent.dropIndex).not.toHaveBeenCalled();
    expect(absent.dropColumn).not.toHaveBeenCalled();
  });
});
