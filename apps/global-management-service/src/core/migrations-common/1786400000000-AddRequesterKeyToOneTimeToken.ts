import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * The key of the password-reset cap (security review of the Community
 * Edition's local auth): `auth_one_time_token.requester_key`, the SHA-256
 * (hex) of the address that asked for the reset. The hourly cap of 3 reset
 * tokens counts per (requester, user) instead of per user, so a stranger can
 * no longer use up the real user's share. Nullable: a setup token has none,
 * and a row written before this migration matches no requester (it stops
 * counting at once, which can only let a request through, never refuse one).
 *
 * Portable schema API only (common migration, both engines); `query` is never
 * called. The cap's count still reads the index on (user_id, purpose,
 * created_at): a user has a handful of reset rows an hour.
 */
export class AddRequesterKeyToOneTimeToken1786400000000 implements MigrationInterface {
  name = 'AddRequesterKeyToOneTimeToken1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'auth_one_time_token',
      new TableColumn({
        name: 'requester_key',
        type: 'char',
        length: '64',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('auth_one_time_token', 'requester_key');
  }
}
