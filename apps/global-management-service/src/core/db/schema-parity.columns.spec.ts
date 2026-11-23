import type { NormalisedSchema } from '@cybedefend/db-dialect';
import { restrictToColumns } from './schema-parity.columns';

describe('restrictToColumns', () => {
  const schema: NormalisedSchema = {
    account: {
      columns: {
        id: { type: 'varchar(36)', nullable: false, default: null },
        name: { type: 'varchar(255)', nullable: false, default: null },
        extra: { type: 'varchar(64)', nullable: true, default: null },
      },
      primaryKey: ['id'],
      uniques: [['extra'], ['name']],
      indexes: [['name', 'extra'], ['name']],
      foreignKeys: [
        { columns: ['extra'], refTable: 'other', refColumns: ['id'] },
        { columns: ['name'], refTable: 'other', refColumns: ['name'] },
      ],
    },
    other: {
      columns: { id: { type: 'int', nullable: false, default: null } },
      primaryKey: ['id'],
      uniques: [],
      indexes: [],
      foreignKeys: [],
    },
  };

  it('keeps the listed tables and columns, and what involves them only', () => {
    expect(
      restrictToColumns(
        schema,
        new Map([['account', new Set(['id', 'name'])]]),
      ),
    ).toEqual({
      account: {
        columns: {
          id: { type: 'varchar(36)', nullable: false, default: null },
          name: { type: 'varchar(255)', nullable: false, default: null },
        },
        primaryKey: ['id'],
        uniques: [['name']],
        indexes: [['name']],
        foreignKeys: [
          { columns: ['name'], refTable: 'other', refColumns: ['name'] },
        ],
      },
    });
  });
});
