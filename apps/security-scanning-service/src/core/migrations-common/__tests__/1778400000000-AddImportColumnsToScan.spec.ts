import { QueryRunner, TableColumn } from 'typeorm';
import { AddImportColumnsToScan1778400000000 as Migration } from '../1778400000000-AddImportColumnsToScan';

/**
 * The import columns of `scan` are a COMMON migration, so
 * they land on MySQL after the frozen track and on PostgreSQL after the
 * baseline, written with TypeORM's schema API only. `hasColumn` reads the
 * current database's schema on both engines, which replaces the MySQL-only
 * `TABLE_SCHEMA = DATABASE()` guard of the frozen track. The fake runner
 * below records the calls; no SQL text is involved at all.
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

describe('AddImportColumnsToScan1778400000000', () => {
  it('adds importFormat and importTool through the schema API when they are absent', async () => {
    const qr = fakeRunner([]);

    await new Migration().up(qr);

    expect(qr.hasColumn).toHaveBeenCalledWith('scan', 'importFormat');
    expect(qr.hasColumn).toHaveBeenCalledWith('scan', 'importTool');
    expect(qr.addColumn).toHaveBeenCalledTimes(2);
    expect(qr.addColumn).toHaveBeenNthCalledWith(
      1,
      'scan',
      new TableColumn({
        name: 'importFormat',
        type: 'varchar',
        length: '16',
        isNullable: true,
      }),
    );
    expect(qr.addColumn).toHaveBeenNthCalledWith(
      2,
      'scan',
      new TableColumn({
        name: 'importTool',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );
  });

  it('adds nothing when the columns already exist', async () => {
    const qr = fakeRunner(['importFormat', 'importTool']);

    await new Migration().up(qr);

    expect(qr.addColumn).not.toHaveBeenCalled();
  });

  it('drops both columns on down, only when present', async () => {
    const present = fakeRunner(['importFormat', 'importTool']);
    await new Migration().down(present);
    expect(present.dropColumn).toHaveBeenCalledTimes(2);
    expect(present.dropColumn).toHaveBeenNthCalledWith(
      1,
      'scan',
      'importFormat',
    );
    expect(present.dropColumn).toHaveBeenNthCalledWith(2, 'scan', 'importTool');

    const absent = fakeRunner([]);
    await new Migration().down(absent);
    expect(absent.dropColumn).not.toHaveBeenCalled();
  });

  it('runs no SQL text', async () => {
    const up = fakeRunner([]);
    await new Migration().up(up);
    await new Migration().down(up);
    expect(up.query).not.toHaveBeenCalled();
  });
});
