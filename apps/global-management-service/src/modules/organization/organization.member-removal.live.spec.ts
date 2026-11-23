import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import {
  createLiveDatabase,
  liveEnabled,
  type LiveDatabase,
} from 'src/core/db/live-database';
import { LIVE_ENTITIES_GLOB } from 'src/core/db/typeorm-options';
import { User } from 'src/entities/user.entity';
import { IDENTITY_PROVIDER_COMMUNITY_BINDINGS } from 'src/edition/community/identity-provider.binding';
import { PersonalAccessTokenStore } from 'src/modules/local-auth/personal-access-token.store';
import { RefreshTokenStore } from 'src/modules/local-auth/refresh-token.store';
import {
  buildOrganizationService,
  type OrganizationFixture,
} from './organization.service.fixtures';

/**
 * LIVE spec: removing a member from an organisation signs that account out
 * everywhere in the Community Edition. `OrganizationService.deleteMember`
 * runs for real, with the community identity provider bound to the real
 * refresh-token and personal-access-token stores on a real MySQL or
 * PostgreSQL (the membership repositories and Permify stay doubles). After
 * the removal the member's refresh sessions no longer rotate and its
 * personal access tokens no longer verify; another member's are untouched.
 *
 * Skipped unless LOCAL_AUTH_LIVE=1; the engine is LIVE_DB_TYPE (mysql by
 * default), the URL GM_MYSQL_URL or GM_PG_URL. It creates a throwaway database
 * and drops it at the end.
 */
const LIVE = liveEnabled('LOCAL_AUTH');
const describeLive = LIVE ? describe : describe.skip;

const ROOT = join(__dirname, '..', '..');
const LOCAL_AUTH_ENTITIES = join(
  ROOT,
  'modules',
  'local-auth',
  'entities',
  '*.entity{.ts,.js}',
);

describeLive(
  'Removing a member revokes its sessions and tokens (real database)',
  () => {
    jest.setTimeout(300_000);

    let live: LiveDatabase;
    let dataSource: DataSource;
    let refreshTokens: RefreshTokenStore;
    let pats: PersonalAccessTokenStore;
    let t: OrganizationFixture;

    beforeAll(async () => {
      live = await createLiveDatabase({
        prefix: 'gm_member_removal',
        envPrefix: 'GM',
        entities: [LIVE_ENTITIES_GLOB, LOCAL_AUTH_ENTITIES],
      });
      dataSource = live.dataSource;
      refreshTokens = new RefreshTokenStore(dataSource);
      pats = new PersonalAccessTokenStore(dataSource);
    });

    afterAll(async () => {
      await live?.drop();
    });

    beforeEach(async () => {
      t = await buildOrganizationService({
        providers: [
          { provide: getDataSourceToken(), useValue: dataSource },
          ...IDENTITY_PROVIDER_COMMUNITY_BINDINGS,
        ],
      });
    });

    afterEach(async () => {
      await t.module.close();
    });

    async function createUser(): Promise<string> {
      const repo = dataSource.getRepository(User);
      const user = await repo.save(
        repo.create({
          id: randomUUID(),
          email: `member-removal-${randomUUID()}@example.test`,
          firstName: 'Member',
          lastName: 'Removal',
          picture: '',
        } as Partial<User>),
      );
      return user.id;
    }

    /** One organisation: the creator `creatorId`, the members given. */
    function givenOrganization(
      creatorId: string,
      members: Record<string, string>,
    ): void {
      t.orgRepo.findOne!.mockResolvedValue({
        id: 'o1',
        name: 'Org',
        userMemberships: [
          { id: 'm-c', role: 'creator', user: { id: creatorId } },
          ...Object.entries(members).map(([id, role]) => ({
            id: `m-${id}`,
            role,
            user: { id, email: `${id}@example.test`, logtoUserId: null },
          })),
        ],
      });
      t.utmRepo.find!.mockResolvedValue([]);
      t.uomRepo.remove!.mockResolvedValue(undefined);
    }

    /** Whether a refresh token still rotates into a new session. */
    async function refreshes(token: string): Promise<boolean> {
      return (await refreshTokens.rotate(token, new Date())).kind === 'rotated';
    }

    it('a removed member can neither refresh a session nor use a personal access token', async () => {
      const creator = await createUser();
      const removed = await createUser();
      const stays = await createUser();
      const now = new Date();
      const removedSessionA = await refreshTokens.issue(removed, now);
      const removedSessionB = await refreshTokens.issue(removed, now);
      const removedPat = await pats.create(removed, 'ci', null, now);
      const removedExpiringPat = await pats.create(
        removed,
        'deploy',
        new Date(now.getTime() + 3_600_000),
        now,
      );
      const staysSession = await refreshTokens.issue(stays, now);
      const staysPat = await pats.create(stays, 'ci', null, now);
      givenOrganization(creator, { [removed]: 'member', [stays]: 'member' });

      await expect(
        t.service.deleteMember({
          organizationId: 'o1',
          userId: removed,
          removedBy: creator,
        }),
      ).resolves.toEqual({
        message: 'User removed from organization successfully',
      });

      expect(await refreshes(removedSessionA.token)).toBe(false);
      expect(await refreshes(removedSessionB.token)).toBe(false);
      await expect(
        pats.verify(removedPat.token, new Date()),
      ).resolves.toBeNull();
      await expect(
        pats.verify(removedExpiringPat.token, new Date()),
      ).resolves.toBeNull();
      expect(await pats.list(removed, new Date())).toHaveLength(0);

      // the member who stays keeps its session and its token
      expect(await refreshes(staysSession.token)).toBe(true);
      await expect(pats.verify(staysPat.token, new Date())).resolves.toEqual({
        userId: stays,
        tokenId: staysPat.pat.id,
      });

      // the removed account signs in again with a new session
      const next = await refreshTokens.issue(removed, new Date());
      expect(await refreshes(next.token)).toBe(true);
    });

    it('a member who leaves is signed out too', async () => {
      const creator = await createUser();
      const leaving = await createUser();
      const session = await refreshTokens.issue(leaving, new Date());
      const pat = await pats.create(leaving, 'ci', null, new Date());
      givenOrganization(creator, { [leaving]: 'member' });

      await t.service.deleteMember({
        organizationId: 'o1',
        userId: leaving,
        removedBy: leaving,
      });

      expect(await refreshes(session.token)).toBe(false);
      await expect(pats.verify(pat.token, new Date())).resolves.toBeNull();
    });
  },
);
