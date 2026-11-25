import { Writable } from 'node:stream';
import Pino from 'pino';
import { QueryFailedError } from 'typeorm';
import { createLoggerOptions } from './logger';

/**
 * An error that reaches the logger whole (Nest's RPC exception handler logs
 * every unexpected error as `{ err }`; a service may pass one as the context
 * argument) is serialized without the values of a failed statement: a
 * driver error keeps its class, code, constraint and table names, its message
 * with any quoted value replaced and its stack frames, never its parameters,
 * statement or detail, which can carry a password hash, a token digest, an
 * e-mail address or a whole user-supplied text.
 */

const VALUE = 'user-supplied-value-4f1c';

function failedQuery(): QueryFailedError {
  const driverError = Object.assign(
    // PostgreSQL's message names the type only; the value is in `detail`.
    new Error('value too long for type character varying(255)'),
    {
      code: '22001',
      detail: `Failing row contains (${VALUE}).`,
      table: 'team',
    },
  );
  return new QueryFailedError(
    'UPDATE "team" SET "description" = $1 WHERE "id" = $2',
    [VALUE, 'team-1'],
    driverError,
  );
}

function logged(write: (logger: Pino.Logger) => void): string {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk));
      done();
    },
  });
  // Without the transports: the lines go to the sink above.
  const options = createLoggerOptions();
  delete options.transport;
  write(Pino(options, sink));
  return lines.join('');
}

describe('createLoggerOptions: error serialization', () => {
  it('logs a failed statement without its values', () => {
    const out = logged((l) => l.error({ err: failedQuery() }, 'boom'));

    expect(out).not.toContain(VALUE);
    expect(out).not.toContain('team-1');
    expect(out).toContain('QueryFailedError');
    expect(out).toContain('22001');
  });

  it('logs a failed statement passed as the context argument without its values', () => {
    const out = logged((l) => l.error({ context: failedQuery() }, 'boom'));

    expect(out).not.toContain(VALUE);
    expect(out).toContain('QueryFailedError');
  });

  it('keeps the message of an ordinary error', () => {
    const out = logged((l) =>
      l.error({ err: new Error('permission service unreachable') }, 'boom'),
    );

    expect(out).toContain('permission service unreachable');
  });

  it('keeps a plain string context', () => {
    const out = logged((l) => l.info({ context: 'TeamService' }, 'hello'));

    expect(out).toContain('"context":"TeamService"');
  });
});
