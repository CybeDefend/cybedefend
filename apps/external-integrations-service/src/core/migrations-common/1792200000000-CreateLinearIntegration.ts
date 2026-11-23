import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableUnique,
} from 'typeorm';
import {
  addEnumValue,
  createUpdatedAtTrigger,
  dialectApi,
  parseDialect,
  type DialectApi,
} from '@cybedefend/db-dialect';

const MAPPING_TABLE = 'vulnerability_issue_mapping';
const INTEGRATIONS = 'linear_integrations';
const PROJECT_MAPPINGS = 'linear_project_mappings';

/** The platform values of vulnerability_issue_mapping before Linear. */
const PLATFORMS_WITHOUT_LINEAR = ['github', 'gitlab', 'jira'];

/**
 * Linear issue-tracker integration data model.
 *
 * - `linear_integrations`: one Linear workspace per organisation (and one
 *   organisation per workspace), with its encrypted OAuth tokens.
 * - `linear_project_mappings`: one Linear team (and optionally project) per
 *   CybeDefend project, removed with its integration.
 * - `vulnerability_issue_mapping`: `linear` joins the platform enum, plus the
 *   Linear-specific columns cached on each ticket link (nullable: GitHub,
 *   GitLab and Jira rows never fill them).
 *
 * A common migration (both engines): TypeORM's schema API and
 * `@cybedefend/db-dialect` only, the engine read from the query runner. On
 * MySQL it builds what the first version of this migration (written for the
 * MySQL track) built: same tables, keys, types and the
 * class name, so a database that already ran it does not run it again. On
 * PostgreSQL the second-precision timestamps are TIMESTAMP(0), as in the
 * baseline, and `updatedAt` moves through a trigger (UPDATED_AT_COLUMNS).
 *
 * Idempotent: every step checks what is already there.
 */
export class CreateLinearIntegration1792200000000 implements MigrationInterface {
  name = 'CreateLinearIntegration1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const api = dialectApi(parseDialect(queryRunner.connection.options.type));

    // The parent table first: the mappings table references it.
    if (!(await queryRunner.hasTable(INTEGRATIONS))) {
      await queryRunner.createTable(
        new Table({
          name: INTEGRATIONS,
          columns: [
            idColumn(api),
            varchar('organizationId', 36),
            varchar('linearOrganizationId', 64),
            varchar('workspaceName', 255),
            varchar('workspaceUrlKey', 255),
            text('accessToken'),
            text('refreshToken', true),
            datetime(api, 'tokenExpiresAt', { isNullable: true }),
            flag(api, 'needsReconnect'),
            varchar('installedByUserId', 36, true),
            datetime(api, 'createdAt', { default: 'CURRENT_TIMESTAMP' }),
            updatedAt(api),
          ],
          uniques: [
            new TableUnique({
              name: 'UQ_linear_integrations_organizationId',
              columnNames: ['organizationId'],
            }),
            new TableUnique({
              name: 'UQ_linear_integrations_linearOrganizationId',
              columnNames: ['linearOrganizationId'],
            }),
          ],
        }),
      );
      await createUpdatedAtTrigger(queryRunner, INTEGRATIONS, 'updatedAt');
    }

    if (!(await queryRunner.hasTable(PROJECT_MAPPINGS))) {
      await queryRunner.createTable(
        new Table({
          name: PROJECT_MAPPINGS,
          columns: [
            idColumn(api),
            varchar('integrationId', 36),
            varchar('projectId', 36),
            varchar('teamId', 64),
            varchar('teamKey', 16),
            varchar('teamName', 255),
            varchar('linearProjectId', 64, true),
            varchar('linearProjectName', 255, true),
            text('labels', true),
            text('allowedBranches', true),
            flag(api, 'autoCreateEnabled'),
            datetime(api, 'createdAt', { default: 'CURRENT_TIMESTAMP' }),
            updatedAt(api),
          ],
          uniques: [
            new TableUnique({
              name: 'UQ_linear_project_mappings_projectId',
              columnNames: ['projectId'],
            }),
          ],
          foreignKeys: [
            new TableForeignKey({
              name: 'FK_linear_project_mappings_integrationId',
              columnNames: ['integrationId'],
              referencedTableName: INTEGRATIONS,
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            }),
          ],
        }),
      );
      await createUpdatedAtTrigger(queryRunner, PROJECT_MAPPINGS, 'updatedAt');
    }

    const mapping = await queryRunner.getTable(MAPPING_TABLE);
    const platform = mapping?.findColumnByName('platform');
    if (!platform) {
      throw new Error(`DB_DIALECT_UNKNOWN_COLUMN: ${MAPPING_TABLE}.platform`);
    }
    if (!(platform.enum ?? []).includes('linear')) {
      await addEnumValue(queryRunner, MAPPING_TABLE, 'platform', ['linear']);
    }

    for (const column of mappingColumns(api)) {
      if (!(await queryRunner.hasColumn(MAPPING_TABLE, column.name))) {
        await queryRunner.addColumn(MAPPING_TABLE, column);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const api = dialectApi(parseDialect(queryRunner.connection.options.type));

    // The mappings table references the integrations table: drop it first
    // (dropping a table drops its trigger on PostgreSQL).
    await queryRunner.dropTable(PROJECT_MAPPINGS, true);
    await queryRunner.dropTable(INTEGRATIONS, true);

    for (const column of mappingColumns(api)) {
      if (await queryRunner.hasColumn(MAPPING_TABLE, column.name)) {
        await queryRunner.dropColumn(MAPPING_TABLE, column.name);
      }
    }

    const mapping = await queryRunner.getTable(MAPPING_TABLE);
    const platform = mapping?.findColumnByName('platform');
    if (platform && (platform.enum ?? []).includes('linear')) {
      // A row holding a value the narrowed enum lacks would fail the change.
      await queryRunner.manager
        .createQueryBuilder()
        .delete()
        .from(MAPPING_TABLE)
        .where('platform = :platform', { platform: 'linear' })
        .execute();
      const narrowed = platform.clone();
      narrowed.enum = PLATFORMS_WITHOUT_LINEAR;
      await queryRunner.changeColumn(MAPPING_TABLE, platform, narrowed);
    }
  }
}

/** The columns Linear adds to vulnerability_issue_mapping, in creation order. */
function mappingColumns(api: DialectApi): TableColumn[] {
  return [
    varchar('linearIdentifier', 32, true),
    varchar('linearTeamKey', 16, true),
    varchar('linearPriority', 32, true),
    varchar('linearAssignee', 255, true),
    varchar('linearStateType', 16, true),
    varchar('linearOrganizationId', 64, true),
    datetime(api, 'doneAt', { isNullable: true }),
    varchar('doneReason', 16, true),
  ];
}

/**
 * The uuid primary key: varchar(36), filled by TypeORM on MySQL and by the
 * database default on PostgreSQL (`UuidPrimaryColumn`).
 */
function idColumn(api: DialectApi): TableColumn {
  return new TableColumn({
    name: 'id',
    type: 'varchar',
    length: '36',
    isPrimary: true,
    ...(api.dialect === 'postgres' ? { default: api.uuidExpr().text } : {}),
  });
}

function varchar(
  name: string,
  length: number,
  isNullable = false,
): TableColumn {
  return new TableColumn({
    name,
    type: 'varchar',
    length: String(length),
    isNullable,
  });
}

function text(name: string, isNullable = false): TableColumn {
  return new TableColumn({ name, type: 'text', isNullable });
}

/** A boolean kept as tinyint (smallint on PostgreSQL), like Jira's. */
function flag(api: DialectApi, name: string): TableColumn {
  return new TableColumn({
    name,
    type: api.columnType('tinyint') as string,
    default: 0,
  });
}

/** A timestamp to the second: DATETIME on MySQL, TIMESTAMP(0) on PostgreSQL. */
function datetime(
  api: DialectApi,
  name: string,
  opts: Partial<TableColumn> = {},
): TableColumn {
  return new TableColumn({
    name,
    type: api.columnType('datetime') as string,
    ...(api.dialect === 'postgres' ? { precision: 0 } : {}),
    ...opts,
  });
}

/** MySQL moves it with ON UPDATE, PostgreSQL with createUpdatedAtTrigger. */
function updatedAt(api: DialectApi): TableColumn {
  return datetime(api, 'updatedAt', {
    default: 'CURRENT_TIMESTAMP',
    ...(api.dialect === 'mysql' ? { onUpdate: 'CURRENT_TIMESTAMP' } : {}),
  });
}
