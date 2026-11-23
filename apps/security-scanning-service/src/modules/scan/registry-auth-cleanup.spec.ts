import {
  RegistryAuthCleanupDb,
  applyRequested,
  clearLeftoverRegistryAuth,
  databaseSettings,
} from './registry-auth-cleanup';

/**
 * A database that answers the cleanup's three statements: the count per
 * state, the list of ids to clear, and the UPDATE of one batch.
 */
function fakeDb(answers: {
  counts: Array<Array<Record<string, unknown>>>;
  ids?: string[];
  affected?: (ids: string[]) => number;
}): RegistryAuthCleanupDb & { sent: Array<[string, unknown[]?]> } {
  const counts = [...answers.counts];
  const sent: Array<[string, unknown[]?]> = [];
  return {
    sent,
    async query(sql: string, params?: unknown[]) {
      sent.push([sql, params]);
      if (/^SELECT `state`/.test(sql)) return counts.shift() ?? [];
      if (/^SELECT `id`/.test(sql)) {
        return (answers.ids ?? []).map((id) => ({ id }));
      }
      if (/^UPDATE `scan`/.test(sql)) {
        const ids = (params?.[0] as string[]) ?? [];
        return { affectedRows: (answers.affected ?? ((b) => b.length))(ids) };
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
  };
}

// mysql2 answers SUM() as a DECIMAL string.
const holders = (state: string, encrypted: number, notEncrypted: number) => ({
  state,
  encrypted: String(encrypted),
  notEncrypted: String(notEncrypted),
});

describe('clearLeftoverRegistryAuth', () => {
  let lines: string[];
  const log = (line: string) => lines.push(line);

  beforeEach(() => {
    lines = [];
  });

  it('a dry run counts the rows outside the queue that hold credentials and changes nothing', async () => {
    const db = fakeDb({
      counts: [
        [
          holders('queued', 1, 0),
          holders('running', 2, 0),
          holders('completed', 5, 1),
          holders('cancelled', 0, 2),
        ],
      ],
    });

    const report = await clearLeftoverRegistryAuth({ db, apply: false, log });

    expect(report).toEqual({
      outsideQueue: { encrypted: 7, notEncrypted: 3 },
      queued: 1,
      cleared: 0,
      remaining: 10,
      exitCode: 0,
    });
    expect(db.sent.map(([sql]) => sql)).toEqual([
      expect.stringMatching(/^SELECT `state`/),
    ]);
    expect(lines).toEqual([
      'state=running encrypted=2 not_encrypted=0',
      'state=completed encrypted=5 not_encrypted=1',
      'state=cancelled encrypted=0 not_encrypted=2',
      'state=queued encrypted=1 not_encrypted=0 (kept: the dequeue still reads them)',
      'SUMMARY: 10 scan row(s) outside the queue hold registry credentials (7 encrypted, 3 not encrypted). Dry run: nothing changed; run again with --apply.',
    ]);
  });

  it('--apply removes them in batches, never from a queued scan, and checks none is left', async () => {
    const db = fakeDb({
      counts: [
        [holders('queued', 1, 0), holders('completed', 4, 1)],
        [holders('queued', 1, 0)],
      ],
      ids: ['a', 'b', 'c', 'd', 'e'],
    });

    const report = await clearLeftoverRegistryAuth({
      db,
      apply: true,
      log,
      batchSize: 2,
    });

    expect(report).toEqual({
      outsideQueue: { encrypted: 4, notEncrypted: 1 },
      queued: 1,
      cleared: 5,
      remaining: 0,
      exitCode: 0,
    });
    const [list] = db.sent.filter(([sql]) => /^SELECT `id`/.test(sql));
    expect(list[0]).toMatch(/`state` <> 'queued'/);
    expect(list[0]).toMatch(
      /JSON_CONTAINS_PATH\(`metadata`, 'one', '\$\.registryAuth'\)/,
    );
    const updates = db.sent.filter(([sql]) => /^UPDATE `scan`/.test(sql));
    expect(updates.map(([, params]) => params)).toEqual([
      [['a', 'b']],
      [['c', 'd']],
      [['e']],
    ]);
    for (const [sql] of updates) {
      // The credentials alone, and the row's updatedAt kept as it was.
      expect(sql).toMatch(
        /SET `metadata` = JSON_REMOVE\(`metadata`, '\$\.registryAuth'\), `updatedAt` = `updatedAt`/,
      );
      // A scan queued since the list was read keeps them.
      expect(sql).toMatch(/`state` <> 'queued'/);
      expect(sql).toMatch(
        /JSON_CONTAINS_PATH\(`metadata`, 'one', '\$\.registryAuth'\)/,
      );
    }
    expect(lines.at(-1)).toBe(
      'SUMMARY: cleared 5 scan row(s); 0 outside the queue still hold registry credentials.',
    );
  });

  it('--apply exits 1 when rows outside the queue still hold them afterwards', async () => {
    const db = fakeDb({
      counts: [[holders('failed', 2, 0)], [holders('failed', 1, 0)]],
      ids: ['a', 'b'],
      affected: () => 1,
    });

    const report = await clearLeftoverRegistryAuth({ db, apply: true, log });

    expect(report.cleared).toBe(1);
    expect(report.remaining).toBe(1);
    expect(report.exitCode).toBe(1);
    expect(lines.at(-1)).toBe(
      'ERROR: cleared 1 scan row(s); 1 outside the queue still hold registry credentials. Run the script again.',
    );
  });

  it('--apply sends no UPDATE when there is nothing to clear', async () => {
    const db = fakeDb({ counts: [[holders('queued', 2, 0)], []] });

    const report = await clearLeftoverRegistryAuth({ db, apply: true, log });

    expect(db.sent.some(([sql]) => /^UPDATE/.test(sql))).toBe(false);
    expect(report).toMatchObject({ cleared: 0, remaining: 0, exitCode: 0 });
  });
});

describe('applyRequested', () => {
  it('is read-only unless --apply, and the dry run wins over both flags', () => {
    expect(applyRequested([])).toBe(false);
    expect(applyRequested(['--dry-run'])).toBe(false);
    expect(applyRequested(['--apply'])).toBe(true);
    expect(applyRequested(['--apply', '--dry-run'])).toBe(false);
  });
});

describe('databaseSettings', () => {
  it("reads security-scanning's database variables, its own database by default", () => {
    expect(
      databaseSettings({
        DB_HOST: 'db',
        DB_PORT: '3308',
        DB_USERNAME: 'u',
        DB_PASSWORD: 'p',
      }),
    ).toEqual({
      host: 'db',
      port: 3308,
      user: 'u',
      password: 'p',
      database: 'cybedefend_scanning',
      ssl: undefined,
    });
  });

  it('verifies the server with the CA when TLS is on, and refuses TLS without one', () => {
    expect(
      databaseSettings({ DB_SSL_ENABLED: 'true', DB_SSL_CA_CERT: 'PEM' }).ssl,
    ).toEqual({ ca: 'PEM', rejectUnauthorized: true });
    expect(() => databaseSettings({ DB_SSL_ENABLED: 'true' })).toThrow(
      /DB_SSL_CA_CERT/,
    );
  });
});
