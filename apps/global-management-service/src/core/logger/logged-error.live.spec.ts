import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import Pino from 'pino';
import type { Repository } from 'typeorm';
import {
  createLiveDatabase,
  liveEnabled,
  type LiveDatabase,
} from 'src/core/db/live-database';
import { User } from 'src/entities/user.entity';
import { REDACTED_VALUE, serializeLoggedError } from './logged-error';
import { createLoggerOptions } from './logger';

/**
 * LIVE spec of the logged form of an error, on the errors a REAL MySQL or
 * PostgreSQL returns through TypeORM: a unique violation (a second user with
 * the same e-mail) and a value too long for its column. The serialized error
 * keeps the engine's code and the constraint name, and holds none of the
 * statement, its parameters or the values; the raw error is checked to hold
 * them, so the spec proves the serializer removed them.
 *
 * Skipped unless GM_LIVE=1, so `pnpm run test` stays hermetic. The engine is
 * LIVE_DB_TYPE (mysql by default). It creates a throwaway database and drops
 * it at the end. One run per engine, both must pass:
 *
 *   GM_LIVE=1 LIVE_DB_TYPE=mysql GM_MYSQL_URL=mysql://root:<password>@127.0.0.1:3306 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=logged-error.live
 *   GM_LIVE=1 LIVE_DB_TYPE=postgres GM_PG_URL=postgres://postgres:<password>@127.0.0.1:5432 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=logged-error.live
 */
const describeLive = liveEnabled('GM') ? describe : describe.skip;

describeLive('serializeLoggedError on real driver errors', () => {
  jest.setTimeout(300_000);

  let live: LiveDatabase;
  let users: Repository<User>;

  beforeAll(async () => {
    live = await createLiveDatabase({
      prefix: 'gm_logged_error',
      envPrefix: 'GM',
    });
    users = live.dataSource.getRepository(User);
  });

  afterAll(async () => {
    await live?.drop();
  });

  function newUser(email: string): User {
    return users.create({
      id: randomUUID(),
      email,
      firstName: 'Private',
      lastName: 'Person',
      picture: '',
    } as Partial<User>);
  }

  /** The error the statement fails with. */
  async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
    try {
      await run();
    } catch (err) {
      return err;
    }
    throw new Error('the statement did not fail');
  }

  function expectWithout(err: unknown, values: string[]): string {
    const raw = JSON.stringify(Pino.stdSerializers.err(err as Error));
    const out = JSON.stringify(serializeLoggedError(err));
    // pino-http hands the serializer pino's own form of the error.
    const viaPino = JSON.stringify(
      serializeLoggedError(Pino.stdSerializers.err(err as Error)),
    );
    for (const value of values) {
      expect(raw).toContain(value);
      expect(out).not.toContain(value);
      expect(viaPino).not.toContain(value);
    }
    // The statement's text: its verb and tables are kept, never the rest.
    for (const text of [
      'VALUES',
      ' SET ',
      'INSERT INTO',
      'parameters',
      'detail',
      'sqlMessage',
    ]) {
      expect(out).not.toContain(text);
      expect(viaPino).not.toContain(text);
    }
    return out;
  }

  it('keeps the code and constraint of a unique violation, never the e-mail or the statement', async () => {
    const email = `private.person.${randomUUID()}@example.test`;
    await users.insert(newUser(email));

    const err = await failureOf(() => users.insert(newUser(email)));

    const out = expectWithout(err, [email]);
    const parsed = JSON.parse(out);
    expect(parsed.type).toBe('QueryFailedError');
    expect(parsed.code).toBe(
      live.dialect === 'postgres' ? '23505' : 'ER_DUP_ENTRY',
    );
    expect(parsed.constraint).toContain('IDX_user_email_unique');
    expect(parsed.statement).toEqual({ verb: 'INSERT', tables: ['user'] });
  });

  it('logs a unique violation passed alone without the e-mail in the message', async () => {
    const email = `private.person.${randomUUID()}@example.test`;
    await users.insert(newUser(email));
    const err = await failureOf(() => users.insert(newUser(email)));
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const options = createLoggerOptions();
    delete options.transport;

    Pino(options, sink).error(err);

    const line = lines.join('');
    expect(JSON.stringify(Pino.stdSerializers.err(err as Error))).toContain(
      email,
    );
    expect(line).not.toContain(email);
    // MySQL quotes the duplicated value in the message; PostgreSQL does not.
    expect(JSON.parse(line).msg).toContain(
      live.dialect === 'postgres' ? 'IDX_user_email_unique' : REDACTED_VALUE,
    );
  });

  it('keeps the code of a value too long for its column, never the value or the statement', async () => {
    const user = newUser(`private.person.${randomUUID()}@example.test`);
    await users.insert(user);
    const tooLong = `persona-${'x'.repeat(40)}-${randomUUID()}`;

    const err = await failureOf(() =>
      users.update({ id: user.id }, { onboardingPersona: tooLong }),
    );

    const out = expectWithout(err, [tooLong, user.id]);
    const parsed = JSON.parse(out);
    expect(parsed.type).toBe('QueryFailedError');
    expect(parsed.code).toBe(
      live.dialect === 'postgres' ? '22001' : 'ER_DATA_TOO_LONG',
    );
    // mysql2's stack holds no application frame: the verb and the table are
    // what tells an operator which statement failed.
    expect(parsed.statement).toEqual({ verb: 'UPDATE', tables: ['user'] });
  });
});
