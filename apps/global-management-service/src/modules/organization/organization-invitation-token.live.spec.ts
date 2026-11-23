import { randomBytes, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { dialectApi, isUniqueViolation, run } from '@cybedefend/db-dialect';
import {
  createLiveDatabase,
  liveEnabled,
  type LiveDatabase,
} from 'src/core/db/live-database';
import { HashOrganizationInvitationTokens1786470000000 } from 'src/core/migrations-common/1786470000000-HashOrganizationInvitationTokens';
import { OrganizationInvitation } from 'src/entities/organization-invitation.entity';
import { tokenHash } from 'src/modules/local-auth/token-hash';

/**
 * LIVE spec of the invitation-token hashing on a real engine: the common
 * migration 1786470000000 turns the plaintext tokens an older version stored
 * into their SHA-256 (so a link already sent keeps working) and empties the
 * plaintext; an invitation is then found by its hash only, the hash is
 * unique, and a new row needs no plaintext token.
 *
 * Skipped unless GM_LIVE=1. One run per engine, both must pass:
 *
 *   GM_LIVE=1 LIVE_DB_TYPE=mysql GM_MYSQL_URL=mysql://root:<password>@127.0.0.1:<port> \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=organization-invitation-token.live
 *   GM_LIVE=1 LIVE_DB_TYPE=postgres GM_PG_URL=postgres://postgres:<password>@127.0.0.1:<port> \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=organization-invitation-token.live
 */
const describeLive = liveEnabled('GM') ? describe : describe.skip;

describeLive('invitation tokens on a real database', () => {
  jest.setTimeout(300_000);

  let live: LiveDatabase;
  let dataSource: DataSource;
  const migration = new HashOrganizationInvitationTokens1786470000000();

  beforeAll(async () => {
    live = await createLiveDatabase({
      prefix: 'gm_invitation_token',
      envPrefix: 'GM',
    });
    dataSource = live.dataSource;
  });

  afterAll(async () => {
    await live?.drop();
  });

  async function withRunner<T>(
    fn: (runner: ReturnType<DataSource['createQueryRunner']>) => Promise<T>,
  ): Promise<T> {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    try {
      return await fn(runner);
    } finally {
      await runner.release();
    }
  }

  it('hashes the tokens stored before it, empties the plaintext, and finds them by hash', async () => {
    const { sql, ident } = dialectApi(live.dialect);
    // Back to the schema before the migration: token NOT NULL, no hash.
    await withRunner((runner) => migration.down(runner));

    const legacy = [0, 1, 2].map(() => ({
      id: randomUUID(),
      token: randomBytes(32).toString('hex'),
    }));
    for (const row of legacy) {
      await run(
        dataSource,
        sql`INSERT INTO ${ident('organization_invitations')} (${ident('id')}, ${ident('token')}, ${ident('email')}, ${ident('role')}) VALUES (${row.id}, ${row.token}, ${'invitee@example.test'}, ${'member'})`,
      );
    }

    await withRunner((runner) => migration.up(runner));

    const { rows } = await run(
      dataSource,
      sql`SELECT ${ident('id')}, ${ident('token')}, ${ident('tokenHash')} FROM ${ident('organization_invitations')}`,
    );
    expect(rows).toHaveLength(legacy.length);
    for (const row of legacy) {
      const stored = rows.find((r) => r.id === row.id);
      expect(stored.token).toBeNull();
      expect(stored.tokenHash).toBe(tokenHash(row.token));
      expect(JSON.stringify(rows)).not.toContain(row.token);
    }

    // The acceptance's lookup: the hash of the token the link carries.
    const repo = dataSource.getRepository(OrganizationInvitation);
    const found = await repo.findOne({
      where: { tokenHash: tokenHash(legacy[1].token) },
    });
    expect(found?.id).toBe(legacy[1].id);
  });

  it('stores a new invitation without a plaintext token, and refuses a second row of the same hash', async () => {
    const { sql, ident } = dialectApi(live.dialect);
    const repo = dataSource.getRepository(OrganizationInvitation);
    const token = randomBytes(32).toString('hex');
    const created = await repo.save(
      repo.create({
        email: 'new@example.test',
        role: 'member',
        tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() + 3600_000),
      }),
    );

    const { rows } = await run(
      dataSource,
      sql`SELECT ${ident('token')} FROM ${ident('organization_invitations')} WHERE ${ident('id')} = ${created.id}`,
    );
    expect(rows[0].token).toBeNull();

    let error: unknown;
    try {
      await repo.save(
        repo.create({
          email: 'other@example.test',
          role: 'member',
          tokenHash: tokenHash(token),
        }),
      );
    } catch (e) {
      error = e;
    }
    expect(isUniqueViolation(error)).toBe(true);
  });
});
