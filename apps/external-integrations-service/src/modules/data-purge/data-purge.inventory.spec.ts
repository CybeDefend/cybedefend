import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getMetadataArgsStorage } from 'typeorm';
import { Logger } from 'nestjs-pino';
import {
  CORE_INTEGRATION_TABLES,
  KEPT_COLUMNS,
  ORGANIZATION_INTEGRATION_TYPES,
  PROJECT_PURGE_TABLES,
  PROJECT_UNLINK_TABLES,
  ORGANIZATION_PURGE_TABLES,
} from './purge-tables';
import { IntegrationsAdminService } from '../integrations-admin/integrations-admin.service';
import {
  CONTAINER_REGISTRIES_ADMIN_PORT,
  type ContainerRegistriesAdminPort,
} from '../../edition/ports/container-registries-admin.port';
import { createLoggerMock } from '../../test-utils/mocks';

/**
 * Every column named like a project, team or organization key must be purged
 * by this service, or kept with its reason. A table added later with such a
 * column fails here until it is either purged or argued.
 *
 * The container registry entities belong to the closed edition; their kept
 * columns are checked by that edition's own inventory spec.
 */
const KEY_COLUMN =
  /^(project_?id|internal_?id|team_?ids?|organization_?id|org_?id|scope_?id)$/i;

const entitiesDir = join(__dirname, '../../entities');
type EntityClass = new (...args: unknown[]) => unknown;
const entityClasses: EntityClass[] = [];
for (const file of readdirSync(entitiesDir)) {
  if (!file.endsWith('.entity.ts')) continue;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(join(entitiesDir, file)); // cybedefend-ignore[CD-SAST-1455]: the test joins its own source directory with the file names readdir returns there; no input reaches it
  for (const value of Object.values(mod)) {
    if (typeof value === 'function') entityClasses.push(value as EntityClass);
  }
}

const storage = getMetadataArgsStorage();
const tableOf = (target: unknown): string | undefined =>
  storage.tables.find((t) => t.target === target)?.name;

describe('external-integrations purge inventory', () => {
  it('every table keyed by a project, team or organization is purged or kept with a reason', () => {
    const selected = new Set<string>();
    for (const column of storage.columns) {
      const table = tableOf(column.target);
      if (!table || !entityClasses.includes(column.target as EntityClass)) {
        continue;
      }
      const dbName = column.options.name ?? column.propertyName;
      if (KEY_COLUMN.test(column.propertyName) || KEY_COLUMN.test(dbName)) {
        selected.add(`${table}.${dbName}`);
      }
    }

    const covered = new Set<string>([
      ...[
        ...PROJECT_UNLINK_TABLES,
        ...PROJECT_PURGE_TABLES,
        ...ORGANIZATION_PURGE_TABLES,
        ...CORE_INTEGRATION_TABLES,
      ].map((t) => `${t.table}.${t.column}`),
      ...Object.keys(KEPT_COLUMNS),
    ]);

    expect(selected.size).toBeGreaterThan(10);
    const missing = [...selected].filter((c) => !covered.has(c)).sort();
    expect(missing).toEqual([]);
    // Nothing listed that no longer exists.
    const stale = Object.keys(KEPT_COLUMNS).filter((c) => !selected.has(c));
    expect(stale).toEqual([]);
  });

  it('names, in every list it exports, only tables of core entities', () => {
    // The Community schema creates the tables of the core entities and no
    // other: a purge naming any other table would fail there. Closed tables
    // reach the purge through PURGE_TABLE_EXTENSIONS.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lists = require('./purge-tables') as Record<string, unknown>;
    const core = new Set(entityClasses.map(tableOf).filter(Boolean));
    const named: string[] = [];
    for (const value of Object.values(lists)) {
      if (Array.isArray(value)) {
        for (const t of value) {
          if (t && typeof t === 'object' && 'table' in t) {
            named.push((t as { table: string }).table);
          }
        }
      } else if (value && typeof value === 'object') {
        named.push(...Object.keys(value).map((k) => k.split('.')[0]));
      }
    }
    expect(named.length).toBeGreaterThan(10);
    expect([...new Set(named.filter((t) => !core.has(t)))].sort()).toEqual([]);
  });

  it('gives every kept column a reason', () => {
    expect(Object.values(KEPT_COLUMNS).every((r) => r.length > 10)).toBe(true);
  });

  it('keeps slack_integrations.teamId: a Slack workspace id, not a CybeDefend team', () => {
    expect(KEPT_COLUMNS['slack_integrations.teamId']).toMatch(
      /Slack workspace/,
    );
  });

  it('keeps linear_project_mappings.teamId: a Linear team id, not a CybeDefend team', () => {
    expect(KEPT_COLUMNS['linear_project_mappings.teamId']).toMatch(
      /Linear team/,
    );
  });

  it('lists exactly the tables the core deletes, the registries going through the admin port', async () => {
    const deletedTables: string[] = [];
    const registries: jest.Mocked<ContainerRegistriesAdminPort> = {
      listOrganizationIds: jest.fn().mockResolvedValue([]),
      countForOrg: jest.fn().mockResolvedValue(0),
      deleteForOrg: jest.fn().mockResolvedValue(0),
    };
    const providers = entityClasses
      .filter((e) => tableOf(e))
      .map((entity) => ({
        provide: getRepositoryToken(entity),
        useValue: {
          delete: jest.fn().mockImplementation(() => {
            deletedTables.push(tableOf(entity));
            return Promise.resolve({ affected: 0 });
          }),
        },
      }));
    const moduleRef = await Test.createTestingModule({
      providers: [
        IntegrationsAdminService,
        { provide: Logger, useValue: createLoggerMock() },
        { provide: CONTAINER_REGISTRIES_ADMIN_PORT, useValue: registries },
        ...providers,
      ],
    }).compile();

    await moduleRef
      .get(IntegrationsAdminService)
      .deleteIntegrationsForOrg('o', ORGANIZATION_INTEGRATION_TYPES);

    expect([...deletedTables].sort()).toEqual(
      CORE_INTEGRATION_TABLES.map((t) => t.table).sort(),
    );
    for (const t of CORE_INTEGRATION_TABLES) {
      expect(t.column).toBe('organizationId');
    }
    // The container registry tokens go through the admin port: the ten
    // tables are checked by the cloud inventory spec against it.
    expect(registries.deleteForOrg).toHaveBeenCalledWith('o', {
      failClosed: undefined,
    });
  });
});
