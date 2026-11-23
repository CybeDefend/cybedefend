import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * The import columns of `scan`. `importFormat IS NOT NULL` is the one
 * definition of an import scan; `importTool` holds the comma-separated tool
 * list that `CompleteImportScan.tool_name` reports.
 *
 * Common migration: TypeORM's schema API only, no SQL text, so it runs
 * unchanged on MySQL after the frozen track and on PostgreSQL after the
 * baseline. `hasColumn` reads the current database's schema on both engines,
 * which replaces the MySQL-only `TABLE_SCHEMA = DATABASE()` guard of the
 * frozen track (1778200000000). Idempotent both ways.
 */
export class AddImportColumnsToScan1778400000000 implements MigrationInterface {
  name = 'AddImportColumnsToScan1778400000000';

  private readonly columns: TableColumn[] = [
    new TableColumn({
      name: 'importFormat',
      type: 'varchar',
      length: '16',
      isNullable: true,
    }),
    new TableColumn({
      name: 'importTool',
      type: 'varchar',
      length: '255',
      isNullable: true,
    }),
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const column of this.columns) {
      if (!(await queryRunner.hasColumn('scan', column.name))) {
        await queryRunner.addColumn('scan', column);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of this.columns) {
      if (await queryRunner.hasColumn('scan', column.name)) {
        await queryRunner.dropColumn('scan', column.name);
      }
    }
  }
}
