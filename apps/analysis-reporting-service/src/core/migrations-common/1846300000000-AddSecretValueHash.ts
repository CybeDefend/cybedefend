import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from 'typeorm';

/**
 * A nullable `secretValueHash` (varchar 64) on the secret detections: the
 * keyed hash (hex HMAC-SHA256) of the secret value, so a finding of a HEAD
 * pass and one of a history pass match on (rule, path, value) without a
 * reversible copy. Plus the index the match reads: (projectId, branch,
 * secretValueHash).
 *
 * Nullable, no default: an instant change on MySQL 8 and catalog-only on
 * PostgreSQL. Idempotent both ways, TypeORM's schema API only.
 */
const TABLE = 'vulnerability_detections_secret';
const COLUMN = 'secretValueHash';
const INDEX = 'IDX_vd_secret_proj_branch_valuehash';

export class AddSecretValueHash1846300000000 implements MigrationInterface {
  name = 'AddSecretValueHash1846300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn(TABLE, COLUMN))) {
      await queryRunner.addColumn(
        TABLE,
        new TableColumn({
          name: COLUMN,
          type: 'varchar',
          length: '64',
          isNullable: true,
        }),
      );
    }
    const table = await queryRunner.getTable(TABLE);
    if (table && !table.indices.some((i) => i.name === INDEX)) {
      await queryRunner.createIndex(
        TABLE,
        new TableIndex({
          name: INDEX,
          columnNames: ['projectId', 'branch', COLUMN],
        }),
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable(TABLE);
    if (table?.indices.some((i) => i.name === INDEX)) {
      await queryRunner.dropIndex(TABLE, INDEX);
    }
    if (await queryRunner.hasColumn(TABLE, COLUMN)) {
      await queryRunner.dropColumn(TABLE, COLUMN);
    }
  }
}
