import { QueryRunner, TableColumn } from 'typeorm';
import { columnType } from '@cybedefend/db-dialect';
import { AddScanUploadFilterSummary1778800000000 as Migration } from '../1778800000000-AddScanUploadFilterSummary';

const fakeRunner = (existing: string[]) =>
  ({
    hasColumn: jest.fn(async (_t: string, c: string) => existing.includes(c)),
    addColumn: jest.fn(),
    dropColumn: jest.fn(),
    query: jest.fn(),
  }) as unknown as QueryRunner & Record<string, jest.Mock>;

describe('AddScanUploadFilterSummary1778800000000', () => {
  it('adds a nullable json uploadFilterSummary to scan when absent', async () => {
    const qr = fakeRunner([]);
    await new Migration().up(qr);
    expect(qr.hasColumn).toHaveBeenCalledWith('scan', 'uploadFilterSummary');
    expect(qr.addColumn).toHaveBeenCalledWith(
      'scan',
      new TableColumn({
        name: 'uploadFilterSummary',
        type: columnType('json') as string,
        isNullable: true,
      }),
    );
  });

  // No default: adding a nullable column without one rewrites no row on
  // either engine.
  it('gives the column no default', async () => {
    const qr = fakeRunner([]);
    await new Migration().up(qr);
    const column = (
      (qr.addColumn as unknown as jest.Mock).mock.calls[0] as [
        string,
        TableColumn,
      ]
    )[1];
    expect(column.default).toBeUndefined();
  });

  it('adds nothing when the column exists, drops it only when present', async () => {
    const present = fakeRunner(['uploadFilterSummary']);
    await new Migration().up(present);
    expect(present.addColumn).not.toHaveBeenCalled();
    await new Migration().down(present);
    expect(present.dropColumn).toHaveBeenCalledWith(
      'scan',
      'uploadFilterSummary',
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
