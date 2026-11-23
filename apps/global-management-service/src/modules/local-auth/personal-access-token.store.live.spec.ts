import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { RpcException } from '@nestjs/microservices';
import type { DataSource } from 'typeorm';
import { dialectApi, run } from '@cybedefend/db-dialect';
import {
  createLiveDatabase,
  liveDialect,
  liveEnabled,
  type LiveDatabase,
} from 'src/core/db/live-database';
import { LIVE_ENTITIES_GLOB } from 'src/core/db/typeorm-options';
import { Organization } from 'src/entities/organization.entity';
import { User } from 'src/entities/user.entity';
import {
  MAX_ACTIVE_PATS_PER_USER,
  PersonalAccessTokenStore,
} from './personal-access-token.store';

/**
 * LIVE spec of the personal access token store against a REAL MySQL
 * or PostgreSQL, built by the real migrations of global-management (both
 * engines). The unit spec pins the statements; only the
 * real engines prove what they do under concurrency: 15 parallel creates cap
 * at 10 active tokens with PAT_LIMIT_REACHED, a second active token of one
 * name is refused PAT_NAME_TAKEN on both engines and leaves no row, a revoked
 * token frees its name, and the organisation-wide count and revocation touch
 * the members' tokens only.
 *
 * Skipped unless LOCAL_AUTH_LIVE=1, so `pnpm run test` stays hermetic. The
 * engine is LIVE_DB_TYPE (mysql by default). It creates a throwaway database
 * and drops it at the end. One run per engine, both must pass:
 *
 *   LOCAL_AUTH_LIVE=1 LIVE_DB_TYPE=mysql GM_MYSQL_URL=mysql://root:<password>@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=personal-access-token.store.live
 *   LOCAL_AUTH_LIVE=1 LIVE_DB_TYPE=postgres GM_PG_URL=postgres://postgres:<password>@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=personal-access-token.store.live
 */
const LIVE = liveEnabled('LOCAL_AUTH');
const describeLive = LIVE ? describe : describe.skip;

/** The service root (`src/`), where the entity globs point. */
const ROOT = join(__dirname, '..', '..');
const LOCAL_AUTH_ENTITIES = join(
  ROOT,
  'modules',
  'local-auth',
  'entities',
  '*.entity{.ts,.js}',
);

describeLive('PersonalAccessTokenStore on a real database', () => {
  jest.setTimeout(300_000);

  let live: LiveDatabase;
  let dataSource: DataSource;
  let store: PersonalAccessTokenStore;

  beforeAll(async () => {
    const dialect = liveDialect('GM');
    live = await createLiveDatabase({
      prefix: 'gm_pat',
      envPrefix: 'GM',
      entities: [LIVE_ENTITIES_GLOB, LOCAL_AUTH_ENTITIES],
      // the engine's own pool option, 20 connections for the 15 concurrent
      // creates (contract issue 15)
      extra: dialect === 'postgres' ? { max: 20 } : { connectionLimit: 20 },
    });
    dataSource = live.dataSource;
    store = new PersonalAccessTokenStore(dataSource);
  });

  afterAll(async () => {
    await live?.drop();
  });

  async function createUser(): Promise<string> {
    const repo = dataSource.getRepository(User);
    const user = await repo.save(
      repo.create({
        id: randomUUID(),
        email: `pat-${randomUUID()}@example.test`,
        firstName: 'Pat',
        lastName: 'Store',
        picture: '',
      } as Partial<User>),
    );
    return user.id;
  }

  async function createOrganization(): Promise<string> {
    const repo = dataSource.getRepository(Organization);
    const org = await repo.save(
      repo.create({
        id: randomUUID(),
        name: `Org ${randomUUID()}`,
        industry: 'tech',
        country: 'FR',
      } as Partial<Organization>),
    );
    return org.id;
  }

  async function addMember(
    organizationId: string,
    userId: string,
  ): Promise<void> {
    const db = dialectApi(live.dialect);
    await run(
      dataSource,
      db.sql`INSERT INTO ${db.ident('users_organizations_members')} (${db.ident('id')}, ${db.ident('role')}, ${db.ident('userId')}, ${db.ident('organizationId')})
        VALUES (${randomUUID()}, 'member', ${userId}, ${organizationId})`,
    );
  }

  const T = new Date('2026-11-03T10:00:00.000Z');

  async function refusalOf(promise: Promise<unknown>): Promise<RpcException> {
    const thrown = await promise.catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(RpcException);
    return thrown as RpcException;
  }

  it('caps active tokens at 10 under 15 concurrent creates', async () => {
    const userId = await createUser();

    const results = await Promise.allSettled(
      Array.from({ length: 15 }, (_, i) =>
        store.create(userId, `ci-${i}`, null, T),
      ),
    );

    const created = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(created).toHaveLength(MAX_ACTIVE_PATS_PER_USER);
    expect(rejected).toHaveLength(5);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(RpcException);
      expect(
        ((r as PromiseRejectedResult).reason as RpcException).getError(),
      ).toMatchObject({ message: 'PAT_LIMIT_REACHED' });
    }
    expect(await store.list(userId, T)).toHaveLength(MAX_ACTIVE_PATS_PER_USER);
    // every created token verifies
    for (const r of created) {
      const { token } = (r as PromiseFulfilledResult<{ token: string }>).value;
      await expect(store.verify(token, T)).resolves.toEqual({
        userId,
        tokenId: expect.any(String),
      });
    }
  });

  it('frees a name when its token is revoked', async () => {
    const userId = await createUser();
    const first = await store.create(userId, 'ci', null, T);

    await store.revoke(userId, first.pat.id, T);
    await expect(store.verify(first.token, T)).resolves.toBeNull();

    // the name is free again
    const second = await store.create(userId, 'ci', null, T);
    expect(second.pat.name).toBe('ci');
    expect(await store.list(userId, T)).toHaveLength(1);

    // revoking an unknown id answers PAT_NOT_FOUND
    const error = await refusalOf(store.revoke(userId, randomUUID(), T));
    expect(error.getError()).toMatchObject({ message: 'PAT_NOT_FOUND' });
  });

  it('refuses a second active token of one name with PAT_NAME_TAKEN and keeps the first', async () => {
    const userId = await createUser();
    const first = await store.create(userId, 'ci', null, T);

    const error = await refusalOf(store.create(userId, 'ci', null, T));
    expect(error.getError()).toMatchObject({ message: 'PAT_NAME_TAKEN' });

    // the refused create leaves no row, on PostgreSQL as on MySQL, and the
    // next create with another name succeeds
    expect(await store.list(userId, T)).toHaveLength(1);
    const other = await store.create(userId, 'deploy', null, T);
    expect(other.pat.name).toBe('deploy');
    // the first token still verifies
    await expect(store.verify(first.token, T)).resolves.toEqual({
      userId,
      tokenId: first.pat.id,
    });
  });

  it('does not count expired tokens toward the limit and frees their names', async () => {
    const userId = await createUser();
    const soon = new Date(T.getTime() + 1_000);
    for (let i = 0; i < MAX_ACTIVE_PATS_PER_USER; i++) {
      await store.create(userId, `old-${i}`, soon, T);
    }
    const later = new Date(T.getTime() + 2_000);

    // an expired token is no longer listed, so its name is free again
    const reused = await store.create(userId, 'old-0', null, later);
    expect(reused.pat.name).toBe('old-0');

    // ten expired tokens leave room for ten active ones
    for (let i = 1; i < MAX_ACTIVE_PATS_PER_USER; i++) {
      await store.create(userId, `new-${i}`, null, later);
    }
    expect(await store.list(userId, later)).toHaveLength(
      MAX_ACTIVE_PATS_PER_USER,
    );
    const error = await refusalOf(
      store.create(userId, 'one-more', null, later),
    );
    expect(error.getError()).toMatchObject({ message: 'PAT_LIMIT_REACHED' });
  });

  it('revokeAllOfUser revokes every active token of that user only', async () => {
    const userId = await createUser();
    const other = await createUser();
    const a = await store.create(userId, 'ci', null, T);
    const b = await store.create(
      userId,
      'deploy',
      new Date(T.getTime() + 60_000),
      T,
    );
    const kept = await store.create(other, 'ci', null, T);

    await expect(store.revokeAllOfUser(userId, T)).resolves.toBe(2);

    await expect(store.verify(a.token, T)).resolves.toBeNull();
    await expect(store.verify(b.token, T)).resolves.toBeNull();
    expect(await store.list(userId, T)).toHaveLength(0);
    await expect(store.verify(kept.token, T)).resolves.toEqual({
      userId: other,
      tokenId: kept.pat.id,
    });
    // a second call matches nothing
    await expect(store.revokeAllOfUser(userId, T)).resolves.toBe(0);
  });

  it('writes last_used_at at most once a minute', async () => {
    const userId = await createUser();
    const { pat, token } = await store.create(userId, 'ci', null, T);

    await store.verify(token, T);
    let listed = await store.list(userId, T);
    expect(listed[0].lastUsedAt?.getTime()).toBe(T.getTime());

    // 30 s later: no write
    const soon = new Date(T.getTime() + 30_000);
    await store.verify(token, soon);
    listed = await store.list(userId, T);
    expect(listed[0].lastUsedAt?.getTime()).toBe(T.getTime());

    // 61 s later: written again
    const later = new Date(T.getTime() + 61_000);
    await store.verify(token, later);
    listed = await store.list(userId, T);
    expect(listed[0].lastUsedAt?.getTime()).toBe(later.getTime());
    expect(listed[0].id).toBe(pat.id);
  });

  it("counts and revokes the tokens of an organisation's members only", async () => {
    const organizationId = await createOrganization();
    const member1 = await createUser();
    const member2 = await createUser();
    const outsider = await createUser();
    await addMember(organizationId, member1);
    await addMember(organizationId, member2);

    await store.create(member1, 'ci', null, T);
    await store.create(member1, 'deploy', null, T);
    await store.create(member2, 'ci', null, T);
    const outsiderToken = await store.create(outsider, 'ci', null, T);

    await expect(
      store.countActiveForOrganization(organizationId, T),
    ).resolves.toBe(3);
    // an organisation with no members counts 0
    const emptyOrg = await createOrganization();
    await expect(store.countActiveForOrganization(emptyOrg, T)).resolves.toBe(
      0,
    );

    await expect(
      store.revokeAllForOrganization(organizationId, T),
    ).resolves.toBe(3);

    // the members' tokens are gone, the outsider's still verifies
    expect(await store.list(member1, T)).toHaveLength(0);
    expect(await store.list(member2, T)).toHaveLength(0);
    await expect(store.verify(outsiderToken.token, T)).resolves.toEqual({
      userId: outsider,
      tokenId: outsiderToken.pat.id,
    });
    // a second revocation affects nothing
    await expect(
      store.revokeAllForOrganization(organizationId, T),
    ).resolves.toBe(0);
  });
});
