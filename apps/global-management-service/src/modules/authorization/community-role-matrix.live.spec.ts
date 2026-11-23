import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { PermifyService } from '../permify/permify.service';
import { AuthorizationService } from './authorization.service';
import { CommunityEntitlements } from 'src/edition/community/entitlements.community';
import SecretsService from 'src/core/secrets/secrets.service';
import { createLoggerMock } from 'src/test-utils/typeorm-mock.util';

/**
 * LIVE spec: the roles x permissions matrix of a Community Edition
 * organisation on a REAL Permify (charts/cybedefend/files/schema.perm).
 *
 * The organisation is seeded with what CommunityEntitlements
 * .organizationCreationState() answers (read here, never copied), through
 * the same AuthorizationService.initializeOrganizationProducts call
 * createOrganization makes. With that state every product gate the core
 * routes depend on is open, so each organisation, team and project
 * permission the core gateway routes check must reduce to its ROLE clause,
 * and the closed product's permissions must stay denied to everyone.
 *
 * The expected table below is written by hand from the schema's role
 * clauses, NOT computed from the schema: a schema change that closes a
 * gate in the Community state, or moves a role, fails this spec.
 *
 * Skipped unless `PERMIFY_LIVE=1`, so `pnpm run test` stays hermetic. Like
 * the other PERMIFY_LIVE specs it is run by hand, not by a CI job.
 *
 * How to run (a throwaway engine, nothing shared):
 *   docker run -d --rm --name permify-live-matrix --label cybedefend.test=role-matrix \
 *     -p 13676:3476 -p 13678:3478 \
 *     ghcr.io/permify/permify:v1.6.10 serve --database-engine memory
 *   # load charts/cybedefend/files/schema.perm into tenant t1:
 *   #   POST localhost:13676/v1/tenants/t1/schemas/write  {"schema": "<file>"}
 *   PERMIFY_LIVE=1 PERMIFY_ENDPOINT=localhost:13678 \
 *     PERMIFY_HTTP=http://localhost:13676 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=community-role-matrix.live
 *   docker stop permify-live-matrix
 */

const LIVE = process.env.PERMIFY_LIVE === '1';
const describeLive = LIVE ? describe : describe.skip;

const ENDPOINT = process.env.PERMIFY_ENDPOINT ?? 'localhost:3478';
const HTTP = process.env.PERMIFY_HTTP ?? 'http://localhost:3476';
const TENANT = 't1';

/** Serial pacer, under Permify's `server.rate_limit` (see product-gates.live). */
const MIN_INTERVAL_MS = Math.ceil(
  1000 / Number(process.env.PERMIFY_RATE_LIMIT_RPS ?? 80),
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
      `No schema loaded in tenant ${TENANT}: load charts/cybedefend/files/schema.perm first`,
    );
  }
  return body.head;
}

/**
 * The people of the matrix. Every organisation role holds that one relation
 * on the organisation; every team role is a plain organisation `member` that
 * also holds that role on the organisation's one team, which owns the one
 * project. The outsider holds nothing.
 */
const PEOPLE = [
  'creator',
  'administrator',
  'manager',
  'billing_manager',
  'member',
  'team_manager',
  'analyst_developer',
  'developer',
  'read_only',
  'outsider',
] as const;
type Person = (typeof PEOPLE)[number];

const ORG_ROLES: Person[] = [
  'creator',
  'administrator',
  'manager',
  'billing_manager',
  'member',
];
const TEAM_ROLES: Person[] = [
  'team_manager',
  'analyst_developer',
  'developer',
  'read_only',
];

/** Everyone the organisation counts as a member (`organization.read`). */
const ORG_MEMBERS: Person[] = [...ORG_ROLES, ...TEAM_ROLES];

type Entity = 'organization' | 'team' | 'project';

/**
 * Who is ALLOWED each permission in the Community state, written from the
 * role clause of schema.perm. Anyone not listed must be denied.
 */
const EXPECTED: Record<Entity, Record<string, Person[]>> = {
  organization: {
    // Product gates: open to anyone in the Community state (is_active true,
    // member_products off, writes_blocked false); routes never check them
    // alone, they always come with a role clause.
    appsec_active: [...PEOPLE],
    appsec_writable: [...PEOPLE],
    writable_any: [...PEOPLE],
    read: ORG_MEMBERS,
    read_user: ORG_MEMBERS.filter((p) => p !== 'billing_manager'),
    remove_user: ['creator', 'administrator', 'manager'],
    manage: ['creator', 'administrator'],
    manage_integration: ['creator', 'administrator', 'manager'],
    update_user_role: ['creator', 'administrator'],
    add_user: ['creator', 'administrator', 'manager'],
    create_team: ['creator', 'administrator', 'manager'],
    read_appsec: ORG_MEMBERS,
    read_policy: ORG_MEMBERS.filter((p) => p !== 'billing_manager'),
    manage_policy: ['creator', 'administrator'],
    delete_policy: ['creator', 'administrator'],
    read_report: ['creator', 'administrator'],
    create_report: ['creator', 'administrator'],
    archive_report: ['creator', 'administrator'],
    // The closed product: never in the Community state.
    vibedefend: [],
    read_vibedefend: [],
  },
  team: {
    read: [...TEAM_ROLES, 'creator', 'administrator'],
    manage: ['team_manager', 'creator', 'administrator'],
    update_user_role: ['team_manager', 'creator', 'administrator'],
    add_user: ['team_manager', 'creator', 'administrator'],
    remove_user: ['team_manager', 'creator', 'administrator'],
    create_project: ['team_manager', 'creator', 'administrator'],
    read_report: ['team_manager', 'creator', 'administrator'],
    create_report: ['team_manager', 'creator', 'administrator'],
    archive_report: ['team_manager', 'creator', 'administrator'],
  },
  project: {
    read: [...TEAM_ROLES, 'creator', 'administrator'],
    update: ['team_manager', 'creator', 'administrator'],
    delete: ['team_manager', 'creator', 'administrator'],
    read_scan_result: [
      'team_manager',
      'analyst_developer',
      'developer',
      'creator',
      'administrator',
    ],
    change_vulnerability_state: [
      'team_manager',
      'analyst_developer',
      'developer',
      'creator',
      'administrator',
    ],
    start_scan: [
      'team_manager',
      'analyst_developer',
      'developer',
      'creator',
      'administrator',
    ],
    read_report: [
      'team_manager',
      'analyst_developer',
      'creator',
      'administrator',
    ],
    create_report: [
      'team_manager',
      'analyst_developer',
      'creator',
      'administrator',
    ],
    archive_report: ['team_manager', 'creator', 'administrator'],
    read_effective_policy: [...TEAM_ROLES, 'creator', 'administrator'],
    read_compliance_history: [...TEAM_ROLES, 'creator', 'administrator'],
    read_policy_violation: [
      'team_manager',
      'analyst_developer',
      'developer',
      'creator',
      'administrator',
    ],
    // The closed product: never in the Community state.
    use_vibedefend: [],
    manage_vibedefend: [],
  },
};

/** One row of the matrix, as `jest.each` reads it. */
const ROWS: Array<[Entity, string, Person[]]> = (
  Object.entries(EXPECTED) as Array<[Entity, Record<string, Person[]>]>
).flatMap(([entity, permissions]) =>
  Object.entries(permissions).map(
    ([permission, allowed]) =>
      [entity, permission, allowed] as [Entity, string, Person[]],
  ),
);

describeLive('Community roles x permissions matrix on a live Permify', () => {
  jest.setTimeout(600_000);

  let permify: PermifyService;
  const ids: Record<Entity, string> = {
    organization: randomUUID(),
    team: randomUUID(),
    project: randomUUID(),
  };
  const users = Object.fromEntries(
    PEOPLE.map((p) => [p, `${p}-${randomUUID()}`]),
  ) as Record<Person, string>;

  beforeAll(async () => {
    const schemaVersion = await resolveSchemaVersion();
    const config = {
      get: (key: string): string | undefined =>
        ({
          PERMIFY_ENDPOINT: ENDPOINT,
          PERMIFY_SCHEMA_VERSION: schemaVersion,
        })[key],
    } as unknown as ConfigService;
    const secrets = {
      getSecret: () => undefined,
    } as unknown as SecretsService;
    permify = new PermifyService(
      config,
      secrets,
      createLoggerMock() as unknown as Logger,
    );
    const authorization = new AuthorizationService(
      permify,
      createLoggerMock() as unknown as Logger,
    );

    const write = (
      entityType: Entity,
      entityId: string,
      relation: string,
      subjectType: string,
      subjectId: string,
    ) =>
      paced(() =>
        permify.writePermission(
          entityId,
          subjectId,
          subjectType,
          entityType,
          relation,
        ),
      );

    for (const role of ORG_ROLES) {
      await write('organization', ids.organization, role, 'user', users[role]);
    }
    for (const role of TEAM_ROLES) {
      await write(
        'organization',
        ids.organization,
        'member',
        'user',
        users[role],
      );
      await write('team', ids.team, role, 'user', users[role]);
    }
    await write(
      'team',
      ids.team,
      'organization',
      'organization',
      ids.organization,
    );
    await write('project', ids.project, 'team', 'team', ids.team);
    await write(
      'project',
      ids.project,
      'organization',
      'organization',
      ids.organization,
    );

    // The edition's own creation state, written as createOrganization does.
    const state = new CommunityEntitlements().organizationCreationState();
    await expect(
      paced(() =>
        authorization.initializeOrganizationProducts(ids.organization, state),
      ),
    ).resolves.toBe(true);
  });

  it.each(ROWS)(
    '%s.%s is allowed to exactly %j',
    async (entity, permission, allowed) => {
      const granted: Person[] = [];
      for (const person of PEOPLE) {
        const can = await paced(() =>
          permify.checkPermission(
            ids[entity],
            users[person],
            'user',
            entity,
            permission,
          ),
        );
        if (can) granted.push(person);
      }
      expect(granted.sort()).toEqual([...allowed].sort());
    },
  );
});
