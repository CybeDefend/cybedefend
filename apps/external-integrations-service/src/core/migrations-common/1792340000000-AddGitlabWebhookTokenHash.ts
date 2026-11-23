import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const TABLE = 'gitlab_repositories';
const COLUMN = 'webhookTokenHash';

/**
 * `gitlab_repositories.webhookTokenHash`: the SHA-256 (hex) of the random
 * secret token the project's webhook was registered with. Incoming webhooks
 * are verified against the hash of the project they name. NULL means the
 * hook still carries the token of the former scheme (the OAuth application
 * secret), accepted only while GITLAB_WEBHOOK_LEGACY_TOKEN_ACCEPTED is on,
 * until the token migration task gives it its own token.
 *
 * A common migration (both engines): TypeORM's schema API only.
 * Idempotent: the column is looked up first.
 */
export class AddGitlabWebhookTokenHash1792340000000 implements MigrationInterface {
  name = 'AddGitlabWebhookTokenHash1792340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn(TABLE, COLUMN)) return;
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn(TABLE, COLUMN))) return;
    await queryRunner.dropColumn(TABLE, COLUMN);
  }
}
