import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';
import { columnType } from '@cybedefend/db-dialect';

/**
 * `scan.uploadFilterSummary`: what the upload filter left out of the archive
 * the scanners read (counts by reason, at most 20 excluded folders). Null on
 * a scan with no upload and on rows older than this column.
 *
 * Common migration: TypeORM's schema API and `columnType` only (json on
 * MySQL, jsonb on PostgreSQL), idempotent through `hasColumn`. A nullable
 * column with no default is added without rewriting the table: an instant
 * change on MySQL 8, a catalog change on PostgreSQL.
 */
export class AddScanUploadFilterSummary1778800000000 implements MigrationInterface {
  name = 'AddScanUploadFilterSummary1778800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('scan', 'uploadFilterSummary'))) {
      await queryRunner.addColumn(
        'scan',
        new TableColumn({
          name: 'uploadFilterSummary',
          type: columnType('json') as string,
          isNullable: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('scan', 'uploadFilterSummary')) {
      await queryRunner.dropColumn('scan', 'uploadFilterSummary');
    }
  }
}
