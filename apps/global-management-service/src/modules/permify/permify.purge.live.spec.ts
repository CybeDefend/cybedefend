import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import * as permifyNode from '@permify/permify-node';
import { PermifyService } from './permify.service';
import SecretsService from 'src/core/secrets/secrets.service';
import { createLoggerMock } from 'src/test-utils/typeorm-mock.util';

/**
 * LIVE spec of the organization `permify` purge step:
 * `deleteOrganizationAttributes` against a REAL Permify with the real
 * schema (charts/cybedefend/files/schema.perm). Skipped unless
 * `PERMIFY_LIVE=1`, like `authorization.live.spec.ts`
 * (same setup, same env: `PERMIFY_ENDPOINT`, `PERMIFY_HTTP`,
 * `PERMIFY_SCHEMA_VERSION`):
 *
 *   PERMIFY_LIVE=1 pnpm exec jest --testPathPatterns=permify.purge.live --runInBand
 *
 * Proves that one DeleteData removes the four organization attributes and
 * the relationships of that organization, and nothing of another one.
 */

const LIVE = process.env.PERMIFY_LIVE === '1';
const describeLive = LIVE ? describe : describe.skip;

const ENDPOINT = process.env.PERMIFY_ENDPOINT ?? 'localhost:3478';
const HTTP = process.env.PERMIFY_HTTP ?? 'http://localhost:3476';
const TENANT = 't1';
const ATTRIBUTES = [
  'is_active',
  'writes_blocked',
  'vibedefend_active',
  'member_products',
];

async function resolveSchemaVersion(): Promise<string> {
  if (process.env.PERMIFY_SCHEMA_VERSION) {
    return process.env.PERMIFY_SCHEMA_VERSION;
  }
  const response = await fetch(`${HTTP}/v1/tenants/${TENANT}/schemas/list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page_size: 1 }),
  });
  const body = (await response.json()) as { head?: string };
  if (!body.head) throw new Error(`No schema loaded in tenant ${TENANT}`);
  return body.head;
}

describeLive('PermifyService.deleteOrganizationAttributes (live)', () => {
  jest.setTimeout(60_000);

  let permify: PermifyService;
  let raw: ReturnType<typeof permifyNode.grpc.newClient>;

  const attributesOf = async (organizationId: string): Promise<string[]> => {
    const res = await raw.data.readAttributes({
      tenantId: TENANT,
      metadata: { snapToken: '' },
      filter: {
        entity: { type: 'organization', ids: [organizationId] },
        attributes: [],
      },
      pageSize: 100,
      continuousToken: '',
    });
    return (res.attributes ?? []).map((a) => a.attribute).sort();
  };

  const relationsOf = async (organizationId: string): Promise<string[]> => {
    const res = await raw.data.readRelationships({
      tenantId: TENANT,
      metadata: { snapToken: '' },
      filter: {
        entity: { type: 'organization', ids: [organizationId] },
        relation: '',
        subject: undefined,
      },
      pageSize: 100,
      continuousToken: '',
    });
    return (res.tuples ?? []).map((t) => t.relation).sort();
  };

  const seed = async (organizationId: string) => {
    await permify.setOrganizationProductAttributes(organizationId, {
      is_active: true,
      writes_blocked: false,
      vibedefend_active: true,
      member_products: true,
    });
    await permify.writePermission(
      organizationId,
      randomUUID(),
      'user',
      'organization',
      'creator',
    );
  };

  beforeAll(async () => {
    const schemaVersion = await resolveSchemaVersion();
    const module = await Test.createTestingModule({
      providers: [
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
            error: (message: string): void => {
              if (process.env.PERMIFY_LIVE_DEBUG === '1')
                console.error(message);
            },
          },
        },
      ],
    }).compile();
    permify = module.get(PermifyService);
    raw = permifyNode.grpc.newClient({
      endpoint: ENDPOINT,
      cert: undefined,
      insecure: true,
      pk: undefined,
      certChain: undefined,
    });
  });

  it('removes the four attributes and the relationships of that organization only', async () => {
    const orgA = randomUUID();
    const orgB = randomUUID();
    await seed(orgA);
    await seed(orgB);
    expect(await attributesOf(orgA)).toEqual([...ATTRIBUTES].sort());
    expect(await relationsOf(orgA)).toEqual(['creator']);

    await permify.deleteOrganizationAttributes(orgA);

    expect(await attributesOf(orgA)).toEqual([]);
    expect(await relationsOf(orgA)).toEqual([]);
    expect(await attributesOf(orgB)).toEqual([...ATTRIBUTES].sort());
    expect(await relationsOf(orgB)).toEqual(['creator']);
    expect(await permify.getOrganizationActive(orgA)).toBeNull();
    expect(await permify.getOrganizationActive(orgB)).toBe(true);
  });

  it('is idempotent on an organization already purged', async () => {
    const orgA = randomUUID();
    await seed(orgA);
    await permify.deleteOrganizationAttributes(orgA);
    await expect(
      permify.deleteOrganizationAttributes(orgA),
    ).resolves.toBeUndefined();
    expect(await attributesOf(orgA)).toEqual([]);
  });
});
