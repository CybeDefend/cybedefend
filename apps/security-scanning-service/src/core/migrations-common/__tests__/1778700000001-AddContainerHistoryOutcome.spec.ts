import { QueryRunner, TableColumn } from 'typeorm';
import { AddContainerHistoryOutcome1778700000001 as Migration } from '../1778700000001-AddContainerHistoryOutcome';

const fakeRunner = (existing: string[]) =>
  ({
    hasColumn: jest.fn(async (_t: string, c: string) => existing.includes(c)),
    addColumn: jest.fn(),
    dropColumn: jest.fn(),
    query: jest.fn(),
  }) as unknown as QueryRunner & Record<string, jest.Mock>;

describe('AddContainerHistoryOutcome1778700000001', () => {
  it('adds a nullable varchar(16) historyOutcome when absent', async () => {
    const qr = fakeRunner([]);
    await new Migration().up(qr);
    expect(qr.addColumn).toHaveBeenCalledWith(
      'container',
      new TableColumn({
        name: 'historyOutcome',
        type: 'varchar',
        length: '16',
        isNullable: true,
      }),
    );
  });

  it('adds nothing when the column exists, drops it only when present', async () => {
    const present = fakeRunner(['historyOutcome']);
    await new Migration().up(present);
    expect(present.addColumn).not.toHaveBeenCalled();
    await new Migration().down(present);
    expect(present.dropColumn).toHaveBeenCalledWith(
      'container',
      'historyOutcome',
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
