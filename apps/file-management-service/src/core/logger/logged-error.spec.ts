import Pino from 'pino';
import * as loggedError from './logged-error';
import { scrubErrorMessage, serializeLoggedError } from './logged-error';

/**
 * The logged form of an error keeps what an operator needs (class, message
 * without the value an engine's message quotes, codes, constraint and table
 * names, the statement's verb and tables, stack frames) and drops the
 * statement's text, its parameters and the driver's own detail, on the error
 * shapes of both database drivers: mysql2 and pg, bare or wrapped by TypeORM.
 * These errors are built by hand with the fields each driver sets; the
 * engine messages of the table are the ones MySQL 8.4 and PostgreSQL 18 return
 * (the corpus live spec provokes them).
 */

const R = '[redacted]';
const EMAIL = 'jane.doe+private@example.test';
const DIGEST = 'f'.repeat(64);
const SECRET_TEXT = 'my confidential finding text';
const SQL = 'INSERT INTO `user` (`id`, `email`) VALUES (?, ?)';

/** TypeORM's wrapper: the statement, the parameters, the driver error, and a copy of its fields. */
class QueryFailedError extends Error {
  constructor(
    readonly query: string,
    readonly parameters: unknown[],
    readonly driverError: Error,
  ) {
    super(driverError.message);
    const { name: _name, ...fields } = driverError as unknown as Record<
      string,
      unknown
    >;
    void _name;
    Object.assign(this, fields);
  }
}

/** pg's DatabaseError, with the fields the protocol fills. */
class DatabaseError extends Error {
  severity = 'ERROR';
  code: string;
  detail?: string;
  hint?: string;
  position?: string;
  where?: string;
  schema?: string;
  table?: string;
  column?: string;
  constraint?: string;
  internalQuery?: string;
  file = 'nbtinsert.c';
  line = '666';
  routine = '_bt_check_unique';
  constructor(message: string, fields: Partial<DatabaseError>) {
    super(message);
    Object.assign(this, fields);
  }
}

function mysqlDuplicate(): Error {
  const message = `Duplicate entry '${EMAIL}' for key 'user.IDX_user_email_unique'`;
  return Object.assign(new Error(message), {
    code: 'ER_DUP_ENTRY',
    errno: 1062,
    sqlState: '23000',
    sqlMessage: message,
    sql: `INSERT INTO \`user\` (\`id\`, \`email\`) VALUES ('u1', '${EMAIL}')`,
    fatal: false,
  });
}

function pgDuplicate(): DatabaseError {
  return new DatabaseError(
    'duplicate key value violates unique constraint "IDX_user_email_unique"',
    {
      code: '23505',
      detail: `Key (email)=(${EMAIL}) already exists.`,
      schema: 'public',
      table: 'user',
      constraint: 'IDX_user_email_unique',
      where: `SQL statement "INSERT INTO user VALUES ('${EMAIL}')"`,
      internalQuery: `SELECT 1 FROM user WHERE email = '${EMAIL}'`,
    },
  );
}

function logged(value: unknown): string {
  return JSON.stringify(serializeLoggedError(value));
}

function expectNoValue(out: string): void {
  expect(out).not.toContain(EMAIL);
  expect(out).not.toContain(DIGEST);
  expect(out).not.toContain(SECRET_TEXT);
  expect(out).not.toContain('VALUES');
  expect(out).not.toContain('sqlMessage');
  expect(out).not.toContain('"sql"');
  expect(out).not.toContain('parameters');
  expect(out).not.toContain('detail');
  expect(out).not.toContain('internalQuery');
  expect(out).not.toContain('"where"');
}

describe('serializeLoggedError', () => {
  it('keeps the code, state and key of a MySQL duplicate entry, never the value or the statement', () => {
    const parsed = JSON.parse(logged(mysqlDuplicate()));

    expectNoValue(JSON.stringify(parsed));
    expect(parsed.type).toBe('Error');
    expect(parsed.code).toBe('ER_DUP_ENTRY');
    expect(parsed.errno).toBe('1062');
    expect(parsed.sqlState).toBe('23000');
    expect(parsed.constraint).toBe('user.IDX_user_email_unique');
    expect(parsed.message).toBe(
      `Duplicate entry '${R}' for key 'user.IDX_user_email_unique'`,
    );
    expect(parsed.stack).toContain('logged-error.spec');
  });

  it('keeps the code, constraint and statement shape of a TypeORM-wrapped MySQL error, never its text or parameters', () => {
    const err = new QueryFailedError(
      SQL,
      ['u1', EMAIL, DIGEST],
      mysqlDuplicate(),
    );

    const out = logged(err);

    expectNoValue(out);
    const parsed = JSON.parse(out);
    expect(parsed.type).toBe('QueryFailedError');
    expect(parsed.code).toBe('ER_DUP_ENTRY');
    expect(parsed.constraint).toBe('user.IDX_user_email_unique');
    expect(parsed.statement).toEqual({ verb: 'INSERT', tables: ['user'] });
  });

  it('keeps the code, constraint and table of a PostgreSQL unique violation, never its detail', () => {
    const err = new QueryFailedError(SQL, [EMAIL], pgDuplicate());

    const out = logged(err);

    expectNoValue(out);
    const parsed = JSON.parse(out);
    expect(parsed.code).toBe('23505');
    expect(parsed.constraint).toBe('IDX_user_email_unique');
    expect(parsed.table).toBe('user');
    expect(parsed.message).toBe(
      'duplicate key value violates unique constraint "IDX_user_email_unique"',
    );
  });

  it('reads the codes from the nested driver error when the wrapper did not copy them', () => {
    const out = logged({
      name: 'QueryFailedError',
      message: 'value too long for type character varying(32)',
      query: 'UPDATE "user" SET "onboardingPersona" = $1 WHERE "id" = $2',
      parameters: [SECRET_TEXT],
      driverError: {
        code: '22001',
        detail: `Failing row contains (${SECRET_TEXT}).`,
        routine: 'varchar',
      },
    });

    expectNoValue(out);
    const parsed = JSON.parse(out);
    expect(parsed.type).toBe('QueryFailedError');
    expect(parsed.code).toBe('22001');
    expect(parsed.routine).toBe('varchar');
    expect(parsed.statement).toEqual({ verb: 'UPDATE', tables: ['user'] });
  });

  it('summarises a nested cause and the inner errors of an aggregate the same way', () => {
    const err = new Error('could not save the user', {
      cause: new QueryFailedError(SQL, [EMAIL], mysqlDuplicate()),
    });
    const aggregate = new AggregateError([err, pgDuplicate()], 'two failed');

    const out = logged(aggregate);

    expectNoValue(out);
    const parsed = JSON.parse(out);
    expect(parsed.type).toBe('AggregateError');
    expect(parsed.errors[0].message).toBe('could not save the user');
    expect(parsed.errors[0].cause.code).toBe('ER_DUP_ENTRY');
    expect(parsed.errors[1].code).toBe('23505');
  });

  it('gives the same result on the plain object pino makes of the error, and when applied twice', () => {
    const err = new QueryFailedError(SQL, [EMAIL], pgDuplicate());
    const viaPino = serializeLoggedError(Pino.stdSerializers.err(err));
    const twice = serializeLoggedError(serializeLoggedError(err));

    expectNoValue(JSON.stringify(viaPino));
    expect((viaPino as { code: string }).code).toBe('23505');
    expect(twice).toEqual(serializeLoggedError(err));
  });

  it('keeps the message and stack of an ordinary error', () => {
    const err = new TypeError(
      "Cannot read properties of undefined (reading 'id')",
    );

    const parsed = JSON.parse(logged(err));

    expect(parsed.type).toBe('TypeError');
    expect(parsed.message).toBe(
      "Cannot read properties of undefined (reading 'id')",
    );
    expect(parsed.stack).toContain('logged-error.spec');
  });

  it('passes a string, undefined and a plain object through, with the errors it holds summarized', () => {
    expect(serializeLoggedError('UserService')).toBe('UserService');
    expect(serializeLoggedError(undefined)).toBeUndefined();
    const plain = { reason: 'quota', remaining: 0 };
    expect(serializeLoggedError(plain)).toBe(plain);

    const out = logged({ reason: 'quota', failure: mysqlDuplicate() });

    expectNoValue(out);
    expect(JSON.parse(out).reason).toBe('quota');
    expect(JSON.parse(out).failure.code).toBe('ER_DUP_ENTRY');
  });
});

describe('scrubErrorMessage: the engines’ messages that quote a value', () => {
  const P = 'MRKPARAM';
  it.each([
    // MySQL 8.4
    [
      `Duplicate entry '${P}@x.io' for key 'q1_c.uq_q1_email'`,
      `Duplicate entry '${R}' for key 'q1_c.uq_q1_email'`,
    ],
    [
      `Duplicate entry 'O'${P}' for key 'q1_c.uq_q1_email'`,
      `Duplicate entry '${R}' for key 'q1_c.uq_q1_email'`,
    ],
    [
      `Duplicate entry 'a${P}' for key 'x' for key 'q1_c.uq_q1_email'`,
      `Duplicate entry '${R}' for key 'q1_c.uq_q1_email'`,
    ],
    [
      `Duplicate entry '${P}\nline2' for key 'q1_c.uq_q1_email'`,
      `Duplicate entry '${R}' for key 'q1_c.uq_q1_email'`,
    ],
    [
      `Duplicate entry '"${P}"' for key 'q1_c.uq_q1_email'`,
      `Duplicate entry '${R}' for key 'q1_c.uq_q1_email'`,
    ],
    [
      `Duplicate entry 'z${P}-42' for key 'q1_c.PRIMARY'`,
      `Duplicate entry '${R}' for key 'q1_c.PRIMARY'`,
    ],
    [
      `Incorrect string value: '\\xF0\\x9F\\x98\\x80' for column 'legacy' at row 1`,
      `Incorrect string value: '${R}' for column 'legacy' at row 1`,
    ],
    [
      `Incorrect integer value: '${P}' for column 'n' at row 1`,
      `Incorrect integer value: '${R}' for column 'n' at row 1`,
    ],
    [
      `Incorrect integer value: '${P}' for column 'x' for column 'n' at row 1`,
      `Incorrect integer value: '${R}' for column 'n' at row 1`,
    ],
    [
      `Incorrect datetime value: '2020-13-45 ${P}' for column 'd' at row 1`,
      `Incorrect datetime value: '${R}' for column 'd' at row 1`,
    ],
    [
      `Incorrect decimal value: '${P}' for column 'amount' at row 1`,
      `Incorrect decimal value: '${R}' for column 'amount' at row 1`,
    ],
    [
      `Truncated incorrect DOUBLE value: '${P}'`,
      `Truncated incorrect DOUBLE value: '${R}'`,
    ],
    [
      `Truncated incorrect INTEGER value: 'a'b ${P}'`,
      `Truncated incorrect INTEGER value: '${R}'`,
    ],
    [
      `You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '${P}' x ORDER' at line 1`,
      `You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '${R}' at line 1`,
    ],
    // PostgreSQL 18
    [
      `invalid input syntax for type uuid: "${P}"`,
      `invalid input syntax for type uuid: "${R}"`,
    ],
    [
      `invalid input syntax for type uuid: "${P}" tail "x"`,
      `invalid input syntax for type uuid: "${R}"`,
    ],
    [
      `invalid input syntax for type integer: "${P}"`,
      `invalid input syntax for type integer: "${R}"`,
    ],
    [
      `invalid input syntax for type integer: "${P}\nsecond "q" line"`,
      `invalid input syntax for type integer: "${R}"`,
    ],
    [
      `invalid input syntax for type timestamp: "2020-13-45 ${P}"`,
      `invalid input syntax for type timestamp: "${R}"`,
    ],
    [
      `invalid input syntax for type boolean: "${P}"`,
      `invalid input syntax for type boolean: "${R}"`,
    ],
    [
      `invalid input syntax for type interval: "${P}"`,
      `invalid input syntax for type interval: "${R}"`,
    ],
    [
      `invalid input syntax for type numeric: "${P}"`,
      `invalid input syntax for type numeric: "${R}"`,
    ],
    [
      `invalid input syntax for type inet: "${P}"`,
      `invalid input syntax for type inet: "${R}"`,
    ],
    [
      `invalid input syntax for type double precision: "${P}"`,
      `invalid input syntax for type double precision: "${R}"`,
    ],
    [
      `invalid input value for enum q1e: "${P}"`,
      `invalid input value for enum q1e: "${R}"`,
    ],
    [
      `value "99999999999" is out of range for type integer`,
      `value "${R}" is out of range for type integer`,
    ],
    [
      `date/time field value out of range: "2020-13-45 ${P}"`,
      `date/time field value out of range: "${R}"`,
    ],
    [`syntax error at or near "${P}"`, `syntax error at or near "${R}"`],
    [
      `unterminated quoted string at or near "'${P}"`,
      `unterminated quoted string at or near "${R}"`,
    ],
    [`invalid value "MRKP" for "YYYY"`, `invalid value "${R}" for "YYYY"`],
    [`invalid hexadecimal digit: "M"`, `invalid hexadecimal digit: "${R}"`],
    [
      `invalid byte sequence for encoding "UTF8": 0x00`,
      `invalid byte sequence for encoding "UTF8": ${R}`,
    ],
    [
      `Key (email)=(${P}@x.io) already exists.`,
      `Key (email)=(${R}) already exists.`,
    ],
    [
      `Key (pid)=(999${P}) is not present in table "q1_p".`,
      `Key (pid)=(${R}) is not present in table "q1_p".`,
    ],
    [
      `Failing row contains (1, ${P}@x.io, null, -1).`,
      `Failing row contains (${R}).`,
    ],
    [
      `Could not find any entity of type "User" matching: {\n    "email": "${P}@x.io"\n}`,
      `Could not find any entity of type "User" matching: ${R}`,
    ],
  ])('%s', (input, expected) => {
    expect(scrubErrorMessage(input)).toBe(expected);
  });

  it.each([
    // The engines' messages that hold no value are kept as they are.
    `Data too long for column 'nm' at row 1`,
    `Invalid JSON text in argument 1 to function cast_as_json: "Invalid value." at position 6.`,
    'Cannot add or update a child row: a foreign key constraint fails (`db`.`q1_c`, CONSTRAINT `fk_q1` FOREIGN KEY (`pid`) REFERENCES `q1_p` (`id`))',
    `Check constraint 'ck_q1' is violated.`,
    `Column 'email' cannot be null`,
    'Deadlock found when trying to get lock; try restarting transaction',
    `duplicate key value violates unique constraint "uq_q1_email"`,
    `invalid input syntax for type json`,
    `invalid regular expression: parentheses () not balanced`,
    `value too long for type character varying(8)`,
    `new row for relation "q1_c" violates check constraint "ck_q1"`,
    `null value in column "email" of relation "user" violates not-null constraint`,
  ])('keeps the engine message without a value: %s', (message) => {
    expect(scrubErrorMessage(message)).toBe(message);
  });

  it.each([
    // Messages that are not an engine's are left alone.
    `ENOENT: no such file or directory, open '/var/data/projects/abc/report.pdf'`,
    `Project 'b6f1c8e0-1234-4cde-9f00-aaaaaaaaaaaa' not found`,
    `Cannot read properties of undefined (reading 'id')`,
    `relation "users" does not exist`,
    `getaddrinfo ENOTFOUND 'redis-master'`,
    `connect ECONNREFUSED 10.0.0.5:5432`,
    `Unexpected token 'M', "MRK is"... is not valid JSON`,
    `Queue "analysis-queue" job 123 failed: timeout`,
    `Bucket 'uploads' not found`,
    `Invalid value "abc" for header "x-org"`,
    `Unknown column 'x' in 'field list'`,
    `It's a 'quoted' thing with "abc"`,
    `Unexpected token M in JSON at position 3`,
    `User doesn't own project 'X' (id 5)`,
  ])('keeps an ordinary message as it is: %s', (message) => {
    expect(scrubErrorMessage(message)).toBe(message);
  });

  it('replaces control characters and cuts a long message', () => {
    const out = scrubErrorMessage(`bad\u0000byte ${'x'.repeat(2000)}`);

    expect(out).not.toContain('\u0000');
    expect(out.length).toBeLessThanOrEqual(513);
  });

  it.each([
    `': "a`,
    "value: 'a",
    "Duplicate entry 'a",
    `Key (a)=(`,
    'Incorrect aaaa value: ',
  ])('scrubs a 1 MB message made of %j quickly', (unit) => {
    const message = unit.repeat(Math.ceil(1_048_576 / unit.length));
    const started = Date.now();

    scrubErrorMessage(message);
    loggedError.redactEngineValues(message);

    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('statementShape', () => {
  it.each([
    [
      'INSERT INTO `user` (`id`, `email`) VALUES (?, ?)',
      { verb: 'INSERT', tables: ['user'] },
    ],
    [
      `INSERT INTO \`user\` (\`id\`, \`email\`) VALUES ('u1', '${EMAIL}')`,
      { verb: 'INSERT', tables: ['user'] },
    ],
    [
      'UPDATE "team" SET "description" = $1 WHERE "id" = $2',
      { verb: 'UPDATE', tables: ['team'] },
    ],
    [
      `SELECT p.id FROM "project" p INNER JOIN "team" t ON t.id = p.team_id WHERE p.name = 'FROM secret_table' AND x = "a FROM other"`,
      { verb: 'SELECT', tables: ['project', 'team'] },
    ],
    [
      `DELETE FROM \`cybedefend\`.\`api_key\` WHERE \`token_hash\` = '${DIGEST}'`,
      { verb: 'DELETE', tables: ['cybedefend.api_key'] },
    ],
  ])('%s', (sql, expected) => {
    const shape = loggedError.statementShape(sql);

    expect(shape).toEqual(expected);
    expect(JSON.stringify(shape)).not.toContain(EMAIL);
    expect(JSON.stringify(shape)).not.toContain('secret');
    expect(JSON.stringify(shape)).not.toContain(DIGEST);
  });
});
