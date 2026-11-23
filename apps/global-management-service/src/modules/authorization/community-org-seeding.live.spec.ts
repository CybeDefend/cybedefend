import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import {
  OrganizationProductAttributes,
  PermifyService,
} from '../permify/permify.service';
import { AuthorizationService } from './authorization.service';
import type { OrganizationCreationState } from 'src/edition/ports/entitlements.port';
import SecretsService from 'src/core/secrets/secrets.service';
import { createLoggerMock } from 'src/test-utils/typeorm-mock.util';

/**
 * LIVE spec: a Community Edition organisation is seeded active
 * and unswitched at creation (ENTITLEMENTS_PORT.organizationCreationState()
 * answers true/false/false/false), and that state grants AppSec on a REAL
 * Permify (schema.perm 1.5.0):
 *
 *   appsec_active = is_active and (member_products_off(member_products)
 *     or appsec_user or creator or administrator)
 *
 * With `is_active=true` and `member_products=false`, every member passes the
 * AppSec gate even without a product tuple, while `vibedefend_active=false`
 * denies the second product to everyone. The cloud values (false/false/false/true) are
 * covered by the closed edition's own spec.
 *
 * Skipped unless `PERMIFY_LIVE=1`, so `pnpm run test` stays hermetic.
 *
 * How to run (a throwaway engine, nothing shared):
 *   docker run -d --rm --name permify-live-l03 -p 13676:3476 -p 13678:3478 \
 *     ghcr.io/permify/permify:v1.6.10 serve --database-engine memory
 *   # load charts/cybedefend/files/schema.perm into tenant t1:
 *   #   POST localhost:13676/v1/tenants/t1/schemas/write  {"schema": "<file>"}
 *   PERMIFY_LIVE=1 PERMIFY_ENDPOINT=localhost:13678 \
 *     PERMIFY_HTTP=http://localhost:13676 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=community-org-seeding.live
 *   docker stop permify-live-l03
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

/** What the Community Edition's ENTITLEMENTS_PORT answers. */
const COMMUNITY_STATE: OrganizationCreationState = {
  isActive: true,
  writesBlocked: false,
  vibedefendActive: false,
  memberProducts: false,
};

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

describeLive('Community organisation seeding on a live Permify', () => {
  jest.setTimeout(600_000);

  let permify: PermifyService;
  let authorization: AuthorizationService;
  let org: string;
  let creator: string;
  let member: string;

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
    authorization = new AuthorizationService(
      permify,
      createLoggerMock() as unknown as Logger,
    );

    // One organisation, its creator and one plain member, seeded exactly as
    // the Community createOrganization does: the creator relation, then the
    // edition's product attributes in one write (no product tuple).
    org = randomUUID();
    creator = `creator-${randomUUID()}`;
    member = `member-${randomUUID()}`;
    await paced(() =>
      permify.writePermission(org, creator, 'user', 'organization', 'creator'),
    );
    await paced(() =>
      permify.writePermission(org, member, 'user', 'organization', 'member'),
    );
    const attributes: OrganizationProductAttributes = {
      is_active: COMMUNITY_STATE.isActive,
      writes_blocked: COMMUNITY_STATE.writesBlocked,
      vibedefend_active: COMMUNITY_STATE.vibedefendActive,
      member_products: COMMUNITY_STATE.memberProducts,
    };
    await expect(
      paced(() =>
        authorization.initializeOrganizationProducts(org, COMMUNITY_STATE),
      ),
    ).resolves.toBe(true);
    expect(attributes.is_active).toBe(true);
  });

  const can = (userId: string, permission: string) =>
    paced(() =>
      permify.checkPermission(org, userId, 'user', 'organization', permission),
    );

  it('a community organisation grants AppSec to its creator', async () => {
    await expect(can(creator, 'appsec_active')).resolves.toBe(true);
    await expect(can(creator, 'appsec_writable')).resolves.toBe(true);
    await expect(can(creator, 'read_appsec')).resolves.toBe(true);
    await expect(can(creator, 'read')).resolves.toBe(true);
  });

  it('a community organisation grants AppSec to a member with no product tuple', async () => {
    // The switch is off, so member_products_off holds and the gate is open to
    // every member, tuple or not.
    await expect(can(member, 'appsec_active')).resolves.toBe(true);
  });

  it('a community organisation grants no second product', async () => {
    await expect(can(creator, 'vibedefend')).resolves.toBe(false);
    await expect(can(member, 'vibedefend')).resolves.toBe(false);
  });
});
