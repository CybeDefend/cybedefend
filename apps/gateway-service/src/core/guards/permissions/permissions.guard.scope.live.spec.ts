/**
 * PermissionsGuard against a real Permify loaded with the production schema:
 * a route naming an organization and a project (or a team) is allowed only
 * when the child belongs to that organization. Opt-in, against a throwaway
 * in-memory Permify:
 *
 *   docker run -d --rm --name permify-scope -p 13478:3478 \
 *     ghcr.io/permify/permify:v1.6.10 serve --database-engine memory
 *   PERMIFY_SCOPE_LIVE=1 PERMIFY_SCOPE_ENDPOINT=localhost:13478 \
 *     pnpm exec jest --testPathPatterns=permissions.guard.scope.live
 *
 * The spec writes the schema itself (tenant `t1`) and uses random ids, so it
 * can run against a Permify that already holds data.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as permify from '@permify/permify-node';
import { Logger } from 'nestjs-pino';
import SecretsService from 'src/core/secrets/secrets.service';
import {
  createPermifyClient,
  PermifyClient,
} from 'src/core/utils/permify-client';
import { PermissionsGuard } from './permissions.guard';

const live = process.env.PERMIFY_SCOPE_LIVE === '1';
const endpoint = process.env.PERMIFY_SCOPE_ENDPOINT ?? 'localhost:13478';
const schemaPath = resolve(
  __dirname,
  '../../../../../../charts/cybedefend/files/schema.perm',
);
const TENANT = 't1';

const packBoolean = (data: boolean) => ({
  typeUrl: 'type.googleapis.com/base.v1.BooleanValue',
  value: Buffer.from(permify.grpc.base.BooleanValue.encode({ data }).finish()),
});

(live ? describe : describe.skip)(
  'PermissionsGuard child scope against a real Permify',
  () => {
    jest.setTimeout(30_000);

    let client: PermifyClient;
    let schemaVersion: string;
    const id = (name: string) => `${name}-${randomUUID()}`;
    const orgA = id('org-a');
    const orgB = id('org-b');
    const teamA = id('team-a');
    const teamB = id('team-b');
    const projectA = id('project-a');
    const projectB = id('project-b');
    // Administrator of A; developer on B's team and member of B.
    const user = id('user');

    const tuple = (
      entityType: string,
      entityId: string,
      relation: string,
      subjectType: string,
      subjectId: string,
    ) => ({
      entity: { type: entityType, id: entityId },
      relation,
      subject: { type: subjectType, id: subjectId, relation: '' },
    });

    const guardFor = (subjectTypes: string[], permissions: string[]) =>
      new PermissionsGuard(
        {
          get: (key: string) =>
            key === 'subjectTypes' ? subjectTypes : permissions,
        } as unknown as Reflector,
        new ConfigService({
          PERMIFY_ENDPOINT: endpoint,
          PERMIFY_SCHEMA_VERSION: schemaVersion,
        }),
        { getSecret: () => undefined } as unknown as SecretsService,
        { error: () => undefined } as unknown as Logger,
      );

    const ctx = (params: Record<string, string>) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ params, user: { sub: user } }),
        }),
        getHandler: () => ({}),
      }) as unknown as ExecutionContext;

    /** The exact call the guard makes for the membership. */
    const inOrganization = async (
      childType: string,
      childId: string,
      organizationId: string,
    ) =>
      (
        await client.permission.check({
          tenantId: TENANT,
          metadata: { snapToken: '', schemaVersion, depth: 100 },
          entity: { type: childType, id: childId },
          permission: 'organization',
          subject: { type: 'organization', id: organizationId },
        })
      ).can;

    beforeAll(async () => {
      client = createPermifyClient(endpoint, () => undefined);
      ({ schemaVersion } = await client.schema.write({
        tenantId: TENANT,
        schema: readFileSync(schemaPath, 'utf8'),
      }));
      const attributes = [orgA, orgB].flatMap((org) => [
        {
          entity: { type: 'organization', id: org },
          attribute: 'is_active',
          value: packBoolean(true),
        },
        {
          entity: { type: 'organization', id: org },
          attribute: 'writes_blocked',
          value: packBoolean(false),
        },
      ]);
      await client.data.write({
        tenantId: TENANT,
        metadata: { schemaVersion },
        tuples: [
          tuple('team', teamA, 'organization', 'organization', orgA),
          tuple('team', teamB, 'organization', 'organization', orgB),
          tuple('project', projectA, 'team', 'team', teamA),
          tuple('project', projectA, 'organization', 'organization', orgA),
          tuple('project', projectB, 'team', 'team', teamB),
          tuple('project', projectB, 'organization', 'organization', orgB),
          tuple('organization', orgA, 'administrator', 'user', user),
          tuple('organization', orgB, 'member', 'user', user),
          tuple('team', teamB, 'developer', 'user', user),
        ],
        attributes,
      });
    });

    it('checks the organization relation of a project and of a team directly', async () => {
      const { CHECK_RESULT_ALLOWED, CHECK_RESULT_DENIED } =
        permify.grpc.base.CheckResult;
      expect(await inOrganization('project', projectA, orgA)).toBe(
        CHECK_RESULT_ALLOWED,
      );
      expect(await inOrganization('project', projectB, orgA)).toBe(
        CHECK_RESULT_DENIED,
      );
      expect(await inOrganization('team', teamA, orgA)).toBe(
        CHECK_RESULT_ALLOWED,
      );
      expect(await inOrganization('team', teamB, orgA)).toBe(
        CHECK_RESULT_DENIED,
      );
    });

    it('the user holds each permission on its own id', async () => {
      const guard = guardFor([], []);
      expect(
        await guard.checkPermission(
          orgA,
          'organization',
          'manage_integration',
          user,
        ),
      ).toBe(true);
      expect(
        await guard.checkPermission(projectB, 'project', 'start_scan', user),
      ).toBe(true);
    });

    it('allows a project of the path organization', async () => {
      await expect(
        guardFor(
          ['organization', 'project'],
          ['manage_integration', 'read'],
        ).canActivate(ctx({ organizationId: orgA, projectId: projectA })),
      ).resolves.toBe(true);
    });

    it('refuses a project of another organization', async () => {
      await expect(
        guardFor(
          ['organization', 'project'],
          ['manage_integration', 'start_scan'],
        ).canActivate(ctx({ organizationId: orgA, projectId: projectB })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a team of the path organization and refuses one of another', async () => {
      const guard = guardFor(['organization', 'team'], ['read', 'read']);
      await expect(
        guard.canActivate(ctx({ organizationId: orgA, teamId: teamA })),
      ).resolves.toBe(true);
      await expect(
        guardFor(
          ['organization', 'team'],
          ['manage_integration', 'read'],
        ).canActivate(ctx({ organizationId: orgA, teamId: teamB })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  },
);
