import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * A nullable `scannerRuleId` (varchar 255) on the four detection tables the
 * SARIF import writes to: the rule id of the tool that produced an imported
 * finding, as written in the file (`result.ruleId`). The catalogue keeps only
 * the last dotted segment of that id, so it cannot be read back from there.
 * Built-in scanners never write it.
 *
 * A nullable column without a default: an instant change on MySQL 8 and a
 * catalog-only change on PostgreSQL, whatever the size of the tables.
 *
 * Idempotent both ways: a column that already exists is not added again, one
 * that does not is not dropped (the existence read is TypeORM's getTable,
 * scoped to the current database / schema).
 */
const TABLES = [
  'vulnerability_detections_sast',
  'vulnerability_detections_iac',
  'vulnerability_detections_cicd',
  'vulnerability_detections_secret',
] as const;

const COLUMN = 'scannerRuleId';

export class AddDetectionScannerRuleId1846200000000 implements MigrationInterface {
  name = 'AddDetectionScannerRuleId1846200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      const read = await queryRunner.getTable(table);
      if (!read || read.findColumnByName(COLUMN)) continue;
      await queryRunner.addColumn(
        table,
        new TableColumn({
          name: COLUMN,
          type: 'varchar',
          length: '255',
          isNullable: true,
        }),
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      const read = await queryRunner.getTable(table);
      if (!read || !read.findColumnByName(COLUMN)) continue;
      await queryRunner.dropColumn(table, COLUMN);
    }
  }
}
