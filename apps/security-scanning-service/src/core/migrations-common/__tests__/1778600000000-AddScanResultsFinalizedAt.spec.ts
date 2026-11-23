import { QueryRunner, TableColumn } from 'typeorm';
import { AddScanResultsFinalizedAt1778600000000 as Migration } from '../1778600000000-AddScanResultsFinalizedAt';

/**
 * Common migration: TypeORM's schema API only, so it runs on MySQL and
 * PostgreSQL. The fake runner records the calls; no SQL text is involved.
 */
const fakeRunner = (existingColumns: string[]) => {
  const runner = {
    hasColumn: jest.fn(async (table: string, column: string) => {
      expect(table).toBe('scan');
      return existingColumns.includes(column);
    }),
    addColumn: jest.fn(async (table: string, column: TableColumn) => {
      expect(table).toBe('scan');
      expect(column).toBeInstanceOf(TableColumn);
    }),
    dropColumn: jest.fn(async (table: string, column: string) => {
      expect(table).toBe('scan');
      expect(typeof column).toBe('string');
    }),
    query: jest.fn(async () => []),
  };
  return runner as unknown as QueryRunner & typeof runner;
};

describe('AddScanResultsFinalizedAt1778600000000', () => {
  it('adds resultsFinalizedAt and progressHighWater when absent', async () => {
    const qr = fakeRunner([]);

    await new Migration().up(qr);

    expect(qr.addColumn).toHaveBeenCalledTimes(2);
    // Precision pinned: MySQL's timestamp keeps seconds, PostgreSQL's would
    // default to microseconds. To the second on both, like endTime.
    expect(qr.addColumn).toHaveBeenNthCalledWith(
      1,
      'scan',
      new TableColumn({
        name: 'resultsFinalizedAt',
        type: 'timestamp',
        precision: 0,
        isNullable: true,
      }),
    );
    expect(qr.addColumn).toHaveBeenNthCalledWith(
      2,
      'scan',
      new TableColumn({
        name: 'progressHighWater',
        type: 'int',
        isNullable: false,
        default: 0,
      }),
    );
  });

  it('adds nothing when the columns already exist', async () => {
    const qr = fakeRunner(['resultsFinalizedAt', 'progressHighWater']);

    await new Migration().up(qr);

    expect(qr.addColumn).not.toHaveBeenCalled();
  });

  it('drops both columns on down, only when present', async () => {
    const present = fakeRunner(['resultsFinalizedAt', 'progressHighWater']);
    await new Migration().down(present);
    expect(present.dropColumn).toHaveBeenCalledTimes(2);
    expect(present.dropColumn).toHaveBeenNthCalledWith(
      1,
      'scan',
      'resultsFinalizedAt',
    );
    expect(present.dropColumn).toHaveBeenNthCalledWith(
      2,
      'scan',
      'progressHighWater',
    );

    const absent = fakeRunner([]);
    await new Migration().down(absent);
    expect(absent.dropColumn).not.toHaveBeenCalled();
  });

  it('runs no SQL text', async () => {
    const qr = fakeRunner([]);
    await new Migration().up(qr);
    await new Migration().down(qr);
    expect(qr.query).not.toHaveBeenCalled();
  });
});
