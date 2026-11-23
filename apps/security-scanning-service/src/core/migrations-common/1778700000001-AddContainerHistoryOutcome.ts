import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * `historyOutcome` is what the secret scanner reports about its git history
 * pass on its own container (`ok` | `failed`); null until it reports and on
 * rows older than this column. Read when the scan's results are final, to
 * decide whether the history cursor may move.
 *
 * Common migration: TypeORM's schema API only, idempotent through
 * `hasColumn`, so it runs unchanged on MySQL and PostgreSQL.
 */
export class AddContainerHistoryOutcome1778700000001 implements MigrationInterface {
  name = 'AddContainerHistoryOutcome1778700000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('container', 'historyOutcome'))) {
      await queryRunner.addColumn(
        'container',
        new TableColumn({
          name: 'historyOutcome',
          type: 'varchar',
          length: '16',
          isNullable: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('container', 'historyOutcome')) {
      await queryRunner.dropColumn('container', 'historyOutcome');
    }
  }
}
