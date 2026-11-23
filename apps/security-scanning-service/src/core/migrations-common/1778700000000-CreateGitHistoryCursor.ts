import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';
import { columnType } from '@cybedefend/db-dialect';

/**
 * `git_history_cursor`: one row per (project, branch) recording how far the
 * git history has been scanned. Common migration: TypeORM's schema API and
 * `columnType` only, idempotent both ways through `hasTable`. Timestamps keep
 * seconds on both engines (precision 0).
 */
export class CreateGitHistoryCursor1778700000000 implements MigrationInterface {
  name = 'CreateGitHistoryCursor1778700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('git_history_cursor')) return;
    await queryRunner.createTable(
      new Table({
        name: 'git_history_cursor',
        columns: [
          { name: 'id', type: 'varchar', length: '36', isPrimary: true },
          { name: 'projectId', type: 'varchar', length: '36' },
          { name: 'branch', type: 'varchar', length: '255' },
          { name: 'repositoryKey', type: 'varchar', length: '255' },
          { name: 'tipSha', type: 'varchar', length: '64', isNullable: true },
          {
            name: 'coveredSince',
            type: 'timestamp',
            precision: 0,
            isNullable: true,
          },
          { name: 'complete', type: 'boolean', default: false },
          {
            name: 'gaps',
            type: columnType('json') as string,
            isNullable: true,
          },
          { name: 'consecutiveFailures', type: 'int', default: 0 },
          {
            name: 'lastPassOutcome',
            type: 'varchar',
            length: '16',
            isNullable: true,
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            precision: 0,
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
    );
    await queryRunner.createIndex(
      'git_history_cursor',
      new TableIndex({
        name: 'UQ_git_history_cursor_project_branch',
        columnNames: ['projectId', 'branch'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('git_history_cursor')) {
      await queryRunner.dropTable('git_history_cursor');
    }
  }
}
