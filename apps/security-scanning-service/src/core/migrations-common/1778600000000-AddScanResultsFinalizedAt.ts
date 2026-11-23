import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * `resultsFinalizedAt` is when analysis-reporting reported every scanner of
 * the scan finalized; null until then and on rows older than this column.
 * `progressHighWater` is the highest progress already served for the scan,
 * shared by every pod so it never goes down.
 *
 * Common migration: TypeORM's schema API only, so it runs unchanged on MySQL
 * after the frozen track and on PostgreSQL after the baseline. Idempotent
 * both ways through `hasColumn`. `resultsFinalizedAt` keeps seconds on both
 * engines, like `endTime` (precision 0: PostgreSQL would default to 6).
 */
export class AddScanResultsFinalizedAt1778600000000 implements MigrationInterface {
  name = 'AddScanResultsFinalizedAt1778600000000';

  private readonly columns: TableColumn[] = [
    new TableColumn({
      name: 'resultsFinalizedAt',
      type: 'timestamp',
      precision: 0,
      isNullable: true,
    }),
    new TableColumn({
      name: 'progressHighWater',
      type: 'int',
      isNullable: false,
      default: 0,
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
