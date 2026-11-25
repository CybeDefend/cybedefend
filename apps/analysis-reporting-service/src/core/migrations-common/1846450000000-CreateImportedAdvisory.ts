import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * The new table `imported_advisory`: the advisory content a results import
 * declared, owned by the project it was imported into, keyed by
 * (projectId, advisoryId), with an index on organizationId for the
 * organization purge.
 *
 * It creates one empty table and touches no existing one: no lock on the
 * advisory or detection tables, on either engine. The long text columns are
 * longtext on MySQL and text on PostgreSQL (the arrays are JSON text, the same
 * type on both engines). Idempotent both ways, TypeORM's schema API only.
 */
const TABLE = 'imported_advisory';
const ORG_INDEX = 'IDX_imported_advisory_org';

export class CreateImportedAdvisory1846450000000 implements MigrationInterface {
  name = 'CreateImportedAdvisory1846450000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable(TABLE)) return;
    const longText =
      queryRunner.connection.options.type === 'postgres' ? 'text' : 'longtext';
    const text = (name: string) => ({ name, type: longText, isNullable: true });
    await queryRunner.createTable(
      new Table({
        name: TABLE,
        columns: [
          { name: 'projectId', type: 'varchar', length: '36', isPrimary: true },
          {
            name: 'advisoryId',
            type: 'varchar',
            length: '255',
            isPrimary: true,
          },
          {
            name: 'organizationId',
            type: 'varchar',
            length: '36',
            isNullable: true,
          },
          { name: 'scanId', type: 'varchar', length: '36' },
          { name: 'toolName', type: 'varchar', length: '255' },
          text('summary'),
          text('details'),
          { name: 'severity', type: 'varchar', length: '16' },
          {
            name: 'cvssV3Vector',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          text('cweIds'),
          text('aliases'),
          text('referenceUrls'),
          text('fixes'),
          {
            name: 'createdAt',
            type: 'timestamp',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
          },
        ],
        indices: [
          new TableIndex({ name: ORG_INDEX, columnNames: ['organizationId'] }),
        ],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable(TABLE)) {
      await queryRunner.dropTable(TABLE);
    }
  }
}
