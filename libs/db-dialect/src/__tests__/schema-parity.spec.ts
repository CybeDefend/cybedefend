import {
  diffSchemas,
  normaliseColumnType,
  normaliseDefault,
  type NormalisedSchema,
  type ParityAllowance,
} from '../testing/schema-parity';

function schema(nullable = false): NormalisedSchema {
  return {
    user: {
      columns: {
        id: { type: 'varchar(36)', nullable: false, default: null },
        email: { type: 'varchar(255)', nullable, default: null },
      },
      primaryKey: ['id'],
      uniques: [['email']],
      indexes: [],
      foreignKeys: [],
    },
    team: {
      columns: {
        id: { type: 'varchar(36)', nullable: false, default: null },
        ownerId: { type: 'varchar(36)', nullable: true, default: null },
      },
      primaryKey: ['id'],
      uniques: [],
      indexes: [['ownerId']],
      foreignKeys: [{ columns: ['ownerId'], refTable: 'user', refColumns: ['id'] }],
    },
  };
}

describe('diffSchemas', () => {
  it('equal schemas have no difference', () => {
    expect(diffSchemas(schema(), schema(), [])).toEqual({
      differences: [],
      unusedAllowances: [],
    });
  });

  it('names a nullable mismatch', () => {
    expect(diffSchemas(schema(false), schema(true), []).differences).toEqual([
      'user.email nullable: mysql=false postgres=true',
    ]);
  });

  it('an allowance absorbs the difference it names', () => {
    const allow: ParityAllowance[] = [
      { table: 'user', column: 'email', aspect: 'nullable', reason: 'x' },
    ];
    expect(diffSchemas(schema(false), schema(true), allow)).toEqual({
      differences: [],
      unusedAllowances: [],
    });
  });

  it('an allowance that matches nothing is reported unused', () => {
    const allow: ParityAllowance[] = [
      { table: 'user', column: 'email', aspect: 'type', reason: 'x' },
    ];
    expect(diffSchemas(schema(), schema(), allow).unusedAllowances).toEqual(allow);
  });

  it("'*' matches any table and any column", () => {
    const a = schema();
    const b = schema();
    b.user.columns.id.default = 'gen_random_uuid()::text';
    b.team.columns.id.default = 'gen_random_uuid()::text';
    const allow: ParityAllowance[] = [
      { table: '*', column: 'id', aspect: 'default', reason: 'x' },
    ];
    expect(diffSchemas(a, b, allow)).toEqual({ differences: [], unusedAllowances: [] });
    expect(diffSchemas(a, b, []).differences).toEqual([
      "team.id default: mysql=null postgres='gen_random_uuid()::text'",
      "user.id default: mysql=null postgres='gen_random_uuid()::text'",
    ]);
  });

  it('names a missing table, column, key and index', () => {
    const a = schema();
    const b = schema();
    delete b.team;
    delete b.user.columns.email;
    b.user.uniques = [];
    b.user.indexes = [['email']];
    expect(diffSchemas(a, b, []).differences).toEqual([
      'team table: mysql=present postgres=missing',
      'user index: mysql=[] postgres=[(email)]',
      'user unique: mysql=[(email)] postgres=[]',
      "user.email type: mysql='varchar(255)' postgres=missing",
    ]);
  });

  it('compares keys and indexes by their column lists, never by order of declaration', () => {
    const a = schema();
    const b = schema();
    a.team.indexes = [['ownerId'], ['id', 'ownerId']];
    b.team.indexes = [['id', 'ownerId'], ['ownerId']];
    expect(diffSchemas(a, b, []).differences).toEqual([]);
  });

  it('names a foreign key mismatch', () => {
    const a = schema();
    const b = schema();
    b.team.foreignKeys = [];
    expect(diffSchemas(a, b, []).differences).toEqual([
      'team foreignKey: mysql=[(ownerId)->user(id)] postgres=[]',
    ]);
  });
});

describe('type and default normalisation', () => {
  it.each([
    ['varchar(255)', 'varchar(255)'],
    ['character varying(255)', 'varchar(255)'],
    ['int', 'int'],
    ['integer', 'int'],
    ['datetime(3)', 'timestamp(3)'],
    ['timestamp(6)', 'timestamp(6)'],
    ['timestamp(6) without time zone', 'timestamp(6)'],
    ['datetime', 'timestamp(0)'],
    ['timestamp without time zone', 'timestamp(6)'],
    ['text', 'text'],
    ['longtext', 'text'],
    ['mediumtext', 'text'],
    ['tinyint(1)', 'boolean'],
    ['boolean', 'boolean'],
    ['tinyint', 'smallint'],
    ['smallint', 'smallint'],
    ['json', 'json'],
    ['jsonb', 'jsonb'],
    ["enum('a','b')", 'enum(a,b)'],
  ])('%s → %s', (raw, expected) => {
    expect(normaliseColumnType(raw)).toBe(expected);
  });

  it.each([
    ['CURRENT_TIMESTAMP(3)', 'timestamp(3)', 'CURRENT_TIMESTAMP(3)'],
    ['now()', 'timestamp(3)', 'CURRENT_TIMESTAMP(3)'],
    ['CURRENT_TIMESTAMP', 'timestamp(6)', 'CURRENT_TIMESTAMP(6)'],
    ["'x'::character varying", 'varchar(10)', "'x'"],
    ["'a'::\"t_c_enum\"", 'enum(a,b)', "'a'"],
    ['x', 'varchar(10)', "'x'"],
    ["('now'::text)::timestamp(6) with time zone", 'timestamp(6)', 'CURRENT_TIMESTAMP(6)'],
    ["('now'::text)::timestamp(3) with time zone", 'timestamp(3)', 'CURRENT_TIMESTAMP(3)'],
    ['(gen_random_uuid())::text', 'varchar(36)', '(gen_random_uuid())::text'],
    ['gen_random_uuid()::text', 'varchar(36)', 'gen_random_uuid()::text'],
    ['0', 'boolean', 'false'],
    ['false', 'boolean', 'false'],
    ['1', 'boolean', 'true'],
    ['true', 'boolean', 'true'],
    ['5', 'int', '5'],
    ['NULL', 'varchar(10)', null],
    [null, 'int', null],
  ])('default %s on %s → %s', (raw, type, expected) => {
    expect(normaliseDefault(raw, type)).toBe(expected);
  });
});
