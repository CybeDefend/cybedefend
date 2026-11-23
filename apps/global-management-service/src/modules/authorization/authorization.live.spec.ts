import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import * as permifyNode from '@permify/permify-node';
import { AuthorizationService } from './authorization.service';
import { PermifyService } from '../permify/permify.service';
import SecretsService from 'src/core/secrets/secrets.service';
import { createLoggerMock } from 'src/test-utils/typeorm-mock.util';

/**
 * LIVE integration spec of AuthorizationService's relation reads — runs
 * against a REAL Permify.
 *
 * It is skipped unless `PERMIFY_LIVE=1`, so `pnpm run test` stays hermetic.
 *
 * How to run
 * ----------
 *   1. Start Permify v1.6.10 (gRPC 3478, HTTP 3476) and load the PRODUCTION
 *      schema `charts/cybedefend/files/schema.perm` into tenant `t1`:
 *        curl -s localhost:3476/healthz                       # -> {"status":"SERVING"}
 *        curl -s -XPOST localhost:3476/v1/tenants/t1/schemas/list \
 *             -H 'Content-Type: application/json' -d '{"page_size":5}'
 *   2. From `global-management-service/`:
 *        PERMIFY_LIVE=1 pnpm exec jest --testPathPatterns=authorization.live --runInBand
 *
 * Optional overrides: `PERMIFY_ENDPOINT` (default `localhost:3478`),
 * `PERMIFY_HTTP` (default `http://localhost:3476`), `PERMIFY_SCHEMA_VERSION`
 * (default: the tenant's head version, discovered at startup),
 * `PERMIFY_RATE_LIMIT_RPS` (default 40 — see below).
 *
 * Rate limiting: Permify rejects with `RESOURCE_EXHAUSTED … rejected by
 * grpc_ratelimit middleware` above `server.rate_limit` req/s (the local
 * fixture ships 100, `permify-service/config.template.yaml` ships 1000). This
 * spec issues a few hundred sequential RPCs, so it paces itself below that cap
 * — without the pacer the first ~12 tests pass and every call after them is
 * rejected until the bucket refills.
 *
 * What it proves
 * --------------
 *  (1) EQUIVALENCE — for every membership relation, `permission.Check` and
 *      `data.ReadRelationships` agree, in both directions (written / deleted).
 *  (2) NO FALSE POSITIVE FROM THE GRAPH — `Check` on a *permission* can be
 *      ALLOWED through the graph (an org administrator gets `team#read` and
 *      `team#manage`) while the read returns nothing; `Check` on the four
 *      direct *relations* — the only thing the replaced loops ever probed —
 *      agrees with the read. That is why the substitution is sound.
 *  (3) The six converted flows, end to end, against the real engine.
 *  (4) Paging — five relations come back in one page.
 *  (5) `canAddTeamMember` — who holds `team#add_user`, the gate
 *      of every team seat an invitation grants: an org `manager` does not.
 */

const LIVE = process.env.PERMIFY_LIVE === '1';
const describeLive = LIVE ? describe : describe.skip;

const ENDPOINT = process.env.PERMIFY_ENDPOINT ?? 'localhost:3478';
const HTTP = process.env.PERMIFY_HTTP ?? 'http://localhost:3476';
const TENANT = 't1';

/** Candidate relations of the replaced loops, in their probing order. */
const ORGANIZATION_ROLES = [
  'administrator',
  'manager',
  'billing_manager',
  'member',
];
const TEAM_ROLES = [
  'team_manager',
  'analyst_developer',
  'developer',
  'read_only',
];
/** Every `@user` relation the schema declares on `organization`. */
const ALL_ORGANIZATION_RELATIONS = ['creator', ...ORGANIZATION_ROLES];

/**
 * Serial pacer keeping the whole spec under Permify's `server.rate_limit`.
 * Every RPC the spec issues — and every service flow, which issues two or
 * three of its own — takes one slot.
 */
const MIN_INTERVAL_MS = Math.ceil(
  1000 / Number(process.env.PERMIFY_RATE_LIMIT_RPS ?? 40),
);
let nextSlotAt = 0;

async function paced<T>(call: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + MIN_INTERVAL_MS;

  if (slot > now) {
    await new Promise((resolve) => setTimeout(resolve, slot - now));
  }
  return call();
}

type SchemaListResponse = { head?: string };

async function resolveSchemaVersion(): Promise<string> {
  if (process.env.PERMIFY_SCHEMA_VERSION) {
    return process.env.PERMIFY_SCHEMA_VERSION;
  }

  const response = await fetch(`${HTTP}/v1/tenants/${TENANT}/schemas/list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page_size: 1 }),
  });
  const body = (await response.json()) as SchemaListResponse;

  if (!body.head) {
    throw new Error(
      `No schema loaded in tenant ${TENANT} — load charts/cybedefend/files/schema.perm first`,
    );
  }
  return body.head;
}

describeLive('AuthorizationService against a live Permify', () => {
  jest.setTimeout(120_000);

  let authorization: AuthorizationService;
  let permify: PermifyService;
  let rawClient: ReturnType<typeof permifyNode.grpc.newClient>;
  let schemaVersion: string;

  // --- paced wrappers around the engine -----------------------------------

  const write = (
    entityType: string,
    entityId: string,
    subjectType: string,
    subjectId: string,
    relation: string,
  ): Promise<boolean> =>
    paced(() =>
      permify.writePermission(
        entityId,
        subjectId,
        subjectType,
        entityType,
        relation,
      ),
    );

  const remove = (
    entityType: string,
    entityId: string,
    userId: string,
    relation: string,
  ): Promise<boolean> =>
    paced(() =>
      permify.deletePermission(entityId, userId, 'user', entityType, relation),
    );

  const check = (
    entityType: string,
    entityId: string,
    userId: string,
    relationOrPermission: string,
  ): Promise<boolean> =>
    paced(() =>
      permify.checkPermission(
        entityId,
        userId,
        'user',
        entityType,
        relationOrPermission,
      ),
    );

  const read = (
    entityType: string,
    entityId: string,
    userId: string,
  ): Promise<string[]> =>
    paced(() =>
      permify.readRelationships({
        entity: { type: entityType, id: entityId },
        subject: { type: 'user', id: userId },
      }),
    );

  /** One slot for a whole AuthorizationService flow (2–3 internal RPCs). */
  const flow = <T>(call: () => Promise<T>): Promise<T> => paced(call);

  const checkAll = async (
    entityType: string,
    entityId: string,
    userId: string,
    relations: string[],
  ): Promise<string[]> => {
    const allowed: string[] = [];
    for (const relation of relations) {
      if (await check(entityType, entityId, userId, relation)) {
        allowed.push(relation);
      }
    }
    return allowed;
  };

  /** Writes the ABAC attributes `organization.active`/`writable` depend on. */
  const setOrganizationAttributes = (
    organizationId: string,
    values: { isActive: boolean; writesBlocked: boolean },
  ): Promise<unknown> => {
    const pack = (value: boolean) => ({
      typeUrl: 'type.googleapis.com/base.v1.BooleanValue',
      value: Buffer.from(
        permifyNode.grpc.base.BooleanValue.encode({ data: value }).finish(),
      ),
    });

    return paced(() =>
      rawClient.data.write({
        tenantId: TENANT,
        metadata: { schemaVersion },
        attributes: [
          {
            entity: { type: 'organization', id: organizationId },
            attribute: 'is_active',
            value: pack(values.isActive),
          },
          {
            entity: { type: 'organization', id: organizationId },
            attribute: 'writes_blocked',
            value: pack(values.writesBlocked),
          },
        ],
      }),
    );
  };

  const catchRpc = async (promise: Promise<unknown>): Promise<RpcException> => {
    try {
      await promise;
    } catch (error) {
      return error as RpcException;
    }
    throw new Error('expected the call to reject, but it resolved');
  };

  beforeAll(async () => {
    schemaVersion = await resolveSchemaVersion();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        PermifyService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string): string | undefined =>
              ({
                PERMIFY_ENDPOINT: ENDPOINT,
                PERMIFY_SCHEMA_VERSION: schemaVersion,
              })[key],
          },
        },
        {
          provide: SecretsService,
          useValue: { getSecret: (): string | undefined => undefined },
        },
        {
          provide: Logger,
          useValue: {
            ...createLoggerMock(),
            // PermifyService wraps every gRPC error into a bare
            // InternalServerErrorException, so the real status/details never
            // reach the test output. `PERMIFY_LIVE_DEBUG=1` surfaces them —
            // that is how the fixture's `rate_limit: 100` rejections
            // (RESOURCE_EXHAUSTED, see the header) were identified.
            error: (message: string): void => {
              if (process.env.PERMIFY_LIVE_DEBUG === '1') {
                console.error(message);
              }
            },
          },
        },
      ],
    }).compile();

    authorization = module.get<AuthorizationService>(AuthorizationService);
    permify = module.get<PermifyService>(PermifyService);

    rawClient = permifyNode.grpc.newClient({
      endpoint: ENDPOINT,
      cert: undefined,
      insecure: true,
      pk: undefined,
      certChain: undefined,
    });

    // Fail loudly and early if the engine is not reachable.
    await read('organization', randomUUID(), randomUUID());
  });

  describe('(1) equivalence: Check on a relation <=> the tuple exists', () => {
    it.each(ALL_ORGANIZATION_RELATIONS)('organization#%s', async (relation) => {
      const organizationId = randomUUID();
      const userId = randomUUID();

      await write('organization', organizationId, 'user', userId, relation);

      expect(
        await check('organization', organizationId, userId, relation),
      ).toBe(true);
      expect(await read('organization', organizationId, userId)).toEqual([
        relation,
      ]);

      await remove('organization', organizationId, userId, relation);

      expect(
        await check('organization', organizationId, userId, relation),
      ).toBe(false);
      expect(await read('organization', organizationId, userId)).toEqual([]);
    });

    it.each(TEAM_ROLES)('team#%s', async (relation) => {
      const teamId = randomUUID();
      const userId = randomUUID();

      await write('team', teamId, 'user', userId, relation);

      expect(await check('team', teamId, userId, relation)).toBe(true);
      expect(await read('team', teamId, userId)).toEqual([relation]);

      await remove('team', teamId, userId, relation);

      expect(await check('team', teamId, userId, relation)).toBe(false);
      expect(await read('team', teamId, userId)).toEqual([]);
    });
  });

  describe('(2) a graph-derived permission never leaks into the read', () => {
    it('org administrator has team#read and team#manage, yet holds no team relation', async () => {
      const organizationId = randomUUID();
      const teamId = randomUUID();
      const userId = randomUUID();

      await write(
        'organization',
        organizationId,
        'user',
        userId,
        'administrator',
      );
      await write(
        'team',
        teamId,
        'organization',
        organizationId,
        'organization',
      );
      await setOrganizationAttributes(organizationId, {
        isActive: true,
        writesBlocked: false,
      });

      // The graph grants the PERMISSIONS…
      expect(await check('team', teamId, userId, 'read')).toBe(true);
      expect(await check('team', teamId, userId, 'manage')).toBe(true);

      // …but no direct team tuple exists for that user, and Check on each of
      // the four RELATIONS the replaced loops probed agrees with the read.
      expect(await read('team', teamId, userId)).toEqual([]);
      expect(await checkAll('team', teamId, userId, TEAM_ROLES)).toEqual([]);
    });

    it('the converted flows only ever consider the direct membership relations', async () => {
      const organizationId = randomUUID();
      const teamId = randomUUID();
      const userId = randomUUID();

      await write(
        'organization',
        organizationId,
        'user',
        userId,
        'administrator',
      );
      await write(
        'team',
        teamId,
        'organization',
        organizationId,
        'organization',
      );
      await setOrganizationAttributes(organizationId, {
        isActive: true,
        writesBlocked: false,
      });

      // An org administrator who is not in the team is still "not a member":
      // the add succeeds (it is not blocked by the graph-derived permission)…
      await expect(
        flow(() =>
          authorization.teamAddMember({ teamId, userId, role: 'developer' }),
        ),
      ).resolves.toEqual({
        message: `User ${userId} added to team ${teamId} with role developer`,
      });
      expect(await read('team', teamId, userId)).toEqual(['developer']);

      // …and removal takes the direct relation away, leaving the org role.
      await flow(() => authorization.removeMemberFromTeam({ teamId, userId }));
      expect(await read('team', teamId, userId)).toEqual([]);
      expect(await read('organization', organizationId, userId)).toEqual([
        'administrator',
      ]);
    });
  });

  describe('(3) the six converted flows, end to end', () => {
    it('organizationAddMember / updateOrganizationRole / organizationRemoveMember', async () => {
      const organizationId = randomUUID();
      const userId = randomUUID();

      await flow(() =>
        authorization.organizationAddMember({
          organizationId,
          userId,
          role: 'member',
        }),
      );
      expect(
        await checkAll(
          'organization',
          organizationId,
          userId,
          ALL_ORGANIZATION_RELATIONS,
        ),
      ).toEqual(['member']);
      expect(await read('organization', organizationId, userId)).toEqual([
        'member',
      ]);

      // "user already has another role" path
      const duplicate = await catchRpc(
        flow(() =>
          authorization.organizationAddMember({
            organizationId,
            userId,
            role: 'manager',
          }),
        ),
      );
      expect(duplicate.getError()).toEqual({
        code: status.ALREADY_EXISTS,
        message: 'User already has a role in organization',
      });
      expect(await read('organization', organizationId, userId)).toEqual([
        'member',
      ]);

      await flow(() =>
        authorization.updateOrganizationRole({
          organizationId,
          userId,
          role: 'administrator',
        }),
      );
      expect(
        await checkAll(
          'organization',
          organizationId,
          userId,
          ALL_ORGANIZATION_RELATIONS,
        ),
      ).toEqual(['administrator']);

      await expect(
        flow(() =>
          authorization.updateOrganizationRole({
            organizationId,
            userId,
            role: 'administrator',
          }),
        ),
      ).resolves.toEqual({
        message: `User ${userId} already has role administrator in organization ${organizationId}`,
      });
      expect(
        await checkAll(
          'organization',
          organizationId,
          userId,
          ALL_ORGANIZATION_RELATIONS,
        ),
      ).toEqual(['administrator']);

      await flow(() =>
        authorization.organizationRemoveMember({ organizationId, userId }),
      );
      expect(
        await checkAll(
          'organization',
          organizationId,
          userId,
          ALL_ORGANIZATION_RELATIONS,
        ),
      ).toEqual([]);
      expect(await read('organization', organizationId, userId)).toEqual([]);

      const absent = await catchRpc(
        flow(() =>
          authorization.updateOrganizationRole({
            organizationId,
            userId,
            role: 'member',
          }),
        ),
      );
      expect(absent.getError()).toEqual({
        code: status.NOT_FOUND,
        message: 'User does not have any role in organization',
      });
    });

    it('teamAddMember / teamUpdateMemberRole / removeMemberFromTeam', async () => {
      const teamId = randomUUID();
      const userId = randomUUID();

      await flow(() =>
        authorization.teamAddMember({ teamId, userId, role: 'developer' }),
      );
      expect(await checkAll('team', teamId, userId, TEAM_ROLES)).toEqual([
        'developer',
      ]);

      const duplicate = await catchRpc(
        flow(() =>
          authorization.teamAddMember({ teamId, userId, role: 'read_only' }),
        ),
      );
      expect(duplicate.getError()).toEqual({
        code: status.ALREADY_EXISTS,
        message: 'User already has a role in team',
      });
      expect(await read('team', teamId, userId)).toEqual(['developer']);

      await flow(() =>
        authorization.teamUpdateMemberRole({
          teamId,
          userId,
          role: 'team_manager',
        }),
      );
      expect(await checkAll('team', teamId, userId, TEAM_ROLES)).toEqual([
        'team_manager',
      ]);

      await expect(
        flow(() =>
          authorization.teamUpdateMemberRole({
            teamId,
            userId,
            role: 'team_manager',
          }),
        ),
      ).resolves.toEqual({
        message: `User ${userId} already has role team_manager in team ${teamId}`,
      });

      await flow(() => authorization.removeMemberFromTeam({ teamId, userId }));
      expect(await checkAll('team', teamId, userId, TEAM_ROLES)).toEqual([]);

      const absent = await catchRpc(
        flow(() => authorization.removeMemberFromTeam({ teamId, userId })),
      );
      expect(absent.getError()).toEqual({
        code: status.NOT_FOUND,
        message: 'User does not have any role in team',
      });
    });

    it('`creator` is outside the candidate list: it never blocks an add nor gets deleted', async () => {
      const organizationId = randomUUID();
      const userId = randomUUID();

      await write('organization', organizationId, 'user', userId, 'creator');

      // The add is NOT refused, because `creator` was never probed by the loop.
      await flow(() =>
        authorization.organizationAddMember({
          organizationId,
          userId,
          role: 'member',
        }),
      );
      expect(
        (await read('organization', organizationId, userId)).slice().sort(),
      ).toEqual(['creator', 'member']);

      // The removal takes `member` away and leaves `creator` in place.
      await flow(() =>
        authorization.organizationRemoveMember({ organizationId, userId }),
      );
      expect(await read('organization', organizationId, userId)).toEqual([
        'creator',
      ]);
    });

    it('organizationRemoveMember deletes EVERY candidate role held', async () => {
      const organizationId = randomUUID();
      const userId = randomUUID();

      for (const relation of ['manager', 'member']) {
        await write('organization', organizationId, 'user', userId, relation);
      }
      expect(
        (await read('organization', organizationId, userId)).slice().sort(),
      ).toEqual(['manager', 'member']);

      await flow(() =>
        authorization.organizationRemoveMember({ organizationId, userId }),
      );
      expect(await read('organization', organizationId, userId)).toEqual([]);
    });
  });

  describe('(4) paging', () => {
    it('returns all five organization relations of one subject in a single page', async () => {
      const organizationId = randomUUID();
      const userId = randomUUID();

      for (const relation of ALL_ORGANIZATION_RELATIONS) {
        await write('organization', organizationId, 'user', userId, relation);
      }

      const relations = await read('organization', organizationId, userId);

      expect(relations).toHaveLength(ALL_ORGANIZATION_RELATIONS.length);
      expect(relations.slice().sort()).toEqual(
        ALL_ORGANIZATION_RELATIONS.slice().sort(),
      );
    });
  });

  describe('(5) canAddTeamMember: the team#add_user gate every team seat must pass', () => {
    /** A team of a fresh organization, and a user holding `relation` on `on`. */
    const staffingCase = async (
      on: 'organization' | 'team',
      relation: string,
      writesBlocked = false,
    ): Promise<{ teamId: string; userId: string }> => {
      const organizationId = randomUUID();
      const teamId = randomUUID();
      const userId = randomUUID();

      await write(
        'team',
        teamId,
        'organization',
        organizationId,
        'organization',
      );
      await setOrganizationAttributes(organizationId, {
        isActive: true,
        writesBlocked,
      });
      await write(
        on,
        on === 'organization' ? organizationId : teamId,
        'user',
        userId,
        relation,
      );
      // A team seat is held by a member of the organisation (teamService
      // refuses anyone else), and a team role grants
      // nothing without that membership.
      if (on === 'team') {
        await write('organization', organizationId, 'user', userId, 'member');
      }

      return { teamId, userId };
    };

    it.each<['organization' | 'team', string, boolean]>([
      ['organization', 'creator', true],
      ['organization', 'administrator', true],
      // `add_user` on the organization does not reach its teams.
      ['organization', 'manager', false],
      ['organization', 'billing_manager', false],
      ['organization', 'member', false],
      ['team', 'team_manager', true],
      ['team', 'analyst_developer', false],
      ['team', 'developer', false],
      ['team', 'read_only', false],
    ])('%s#%s may staff the team: %s', async (on, relation, expected) => {
      const { teamId, userId } = await staffingCase(on, relation);

      expect(
        await flow(() => authorization.canAddTeamMember(teamId, userId)),
      ).toBe(expected);
    });

    it('a team_manager of one team cannot staff a sibling team of the same organization', async () => {
      const organizationId = randomUUID();
      const ownTeamId = randomUUID();
      const siblingTeamId = randomUUID();
      const userId = randomUUID();

      for (const teamId of [ownTeamId, siblingTeamId]) {
        await write(
          'team',
          teamId,
          'organization',
          organizationId,
          'organization',
        );
      }
      await setOrganizationAttributes(organizationId, {
        isActive: true,
        writesBlocked: false,
      });
      await write('team', ownTeamId, 'user', userId, 'team_manager');
      await write('organization', organizationId, 'user', userId, 'member');

      expect(
        await flow(() => authorization.canAddTeamMember(ownTeamId, userId)),
      ).toBe(true);
      expect(
        await flow(() => authorization.canAddTeamMember(siblingTeamId, userId)),
      ).toBe(false);
    });

    it('nobody staffs a team of a write-blocked organization, as for POST /team/:teamId/member', async () => {
      const { teamId, userId } = await staffingCase(
        'organization',
        'creator',
        true,
      );

      expect(
        await flow(() => authorization.canAddTeamMember(teamId, userId)),
      ).toBe(false);
    });
  });
});
