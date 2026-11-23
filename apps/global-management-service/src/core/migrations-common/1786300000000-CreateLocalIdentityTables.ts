import {
  InstanceChecker,
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';
import { dialectApi, parseDialect } from '@cybedefend/db-dialect';

/**
 * The local identity tables of the Community Edition's LocalAuthModule: the
 * argon2id credential, the refresh-token families, the
 * one-time tokens (password reset, setup), the personal access tokens and
 * the ES256 signing keys. They exist in every edition — this is a common
 * migration — but only LocalAuthModule, loaded in community mode only,
 * reads or writes them.
 *
 * Portable schema API only: the engine is read from the
 * query runner (never from DB_TYPE, so one process can build both engines),
 * the types go through `columnType`, the timestamps' default through
 * `nowPrecise`, and `query` is never called. What 1786200000000 read from
 * information_schema is read here through `getTable('user')`: on MySQL
 * TypeORM fills charset/collation only when `user.id` differs from the
 * database defaults, so a legacy database seeded utf8mb4_unicode_ci gets a
 * matching FK column; on PostgreSQL both are undefined.
 */
export class CreateLocalIdentityTables1786300000000 implements MigrationInterface {
  name = 'CreateLocalIdentityTables1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const api = dialectApi(parseDialect(queryRunner.connection.options.type));

    // createTable records a stored generated column's expression in
    // TypeORM's own typeorm_metadata table, and the migration executor
    // creates that table only when entities are loaded (the schema-parity
    // spec runs with entities: []), so make sure it exists first. The call
    // is createTable(…, true): idempotent.
    const schemaBuilder = queryRunner.connection.driver.createSchemaBuilder();
    if (InstanceChecker.isRdbmsSchemaBuilder(schemaBuilder)) {
      // protected on RdbmsSchemaBuilder; called here the same way the
      // migration executor calls it
      await (
        schemaBuilder as unknown as {
          createTypeormMetadataTable(runner: QueryRunner): Promise<void>;
        }
      ).createTypeormMetadataTable(queryRunner);
    }

    const userId = (await queryRunner.getTable('user'))?.findColumnByName('id');
    const userKey: Partial<TableColumn> = {};
    if (userId?.charset) userKey.charset = userId.charset;
    if (userId?.collation) userKey.collation = userId.collation;

    const datetime = (
      name: string,
      opts: Partial<TableColumn> = {},
    ): TableColumn =>
      new TableColumn({
        name,
        type: api.columnType('datetime') as string,
        precision: 3,
        ...opts,
      });
    const createdAt = (): TableColumn =>
      datetime('created_at', { default: api.nowPrecise(3).text });
    const id = (): TableColumn =>
      new TableColumn({
        name: 'id',
        type: 'varchar',
        length: '36',
        isPrimary: true,
      });
    const userIdColumn = (opts: Partial<TableColumn> = {}): TableColumn =>
      new TableColumn({
        name: 'user_id',
        type: 'varchar',
        length: '36',
        ...userKey,
        ...opts,
      });
    const tokenHash = (): TableColumn =>
      new TableColumn({
        name: 'token_hash',
        type: 'char',
        length: '64',
        isUnique: true,
      });
    const fkUser = (table: string): TableForeignKey =>
      new TableForeignKey({
        name: `FK_${table}_user`,
        columnNames: ['user_id'],
        referencedTableName: 'user',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      });

    await queryRunner.createTable(
      new Table({
        name: 'local_credential',
        columns: [
          userIdColumn({ isPrimary: true }),
          new TableColumn({
            name: 'password_hash',
            type: 'varchar',
            length: '255',
          }),
          datetime('password_changed_at'),
          createdAt(),
        ],
        foreignKeys: [fkUser('local_credential')],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'auth_refresh_token',
        columns: [
          id(),
          userIdColumn(),
          new TableColumn({ name: 'family_id', type: 'varchar', length: '36' }),
          tokenHash(),
          datetime('expires_at'),
          datetime('rotated_at', { isNullable: true }),
          datetime('revoked_at', { isNullable: true }),
          new TableColumn({
            name: 'replaced_by',
            type: 'varchar',
            length: '36',
            isNullable: true,
          }),
          createdAt(),
        ],
        indices: [
          new TableIndex({
            name: 'IDX_art_family',
            columnNames: ['family_id'],
          }),
          new TableIndex({ name: 'IDX_art_user', columnNames: ['user_id'] }),
        ],
        foreignKeys: [fkUser('auth_refresh_token')],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'auth_one_time_token',
        columns: [
          id(),
          userIdColumn({ isNullable: true }),
          new TableColumn({
            name: 'purpose',
            type: 'enum',
            enum: ['password_reset', 'setup'],
          }),
          tokenHash(),
          datetime('expires_at'),
          datetime('consumed_at', { isNullable: true }),
          new TableColumn({ name: 'attempts', type: 'int', default: '0' }),
          createdAt(),
        ],
        indices: [
          new TableIndex({
            name: 'IDX_aott_user_purpose_created',
            columnNames: ['user_id', 'purpose', 'created_at'],
          }),
        ],
        foreignKeys: [fkUser('auth_one_time_token')],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'personal_access_token',
        columns: [
          id(),
          userIdColumn(),
          new TableColumn({ name: 'name', type: 'varchar', length: '128' }),
          tokenHash(),
          new TableColumn({ name: 'last_four', type: 'char', length: '4' }),
          datetime('last_used_at', { isNullable: true }),
          datetime('expires_at', { isNullable: true }),
          datetime('revoked_at', { isNullable: true }),
          createdAt(),
          // A standard CASE, which MySQL 8 and PostgreSQL 16 both accept in
          // a stored generated column; a partial index (WHERE revoked_at IS
          // NULL) is not used because MySQL has none. Both engines let a
          // unique index hold several NULLs, so a revoked token frees its
          // name.
          new TableColumn({
            name: 'active_name',
            type: 'varchar',
            length: '128',
            isNullable: true,
            asExpression:
              'CASE WHEN revoked_at IS NULL THEN name ELSE NULL END',
            generatedType: 'STORED',
          }),
        ],
        indices: [
          new TableIndex({
            name: 'UQ_pat_user_active_name',
            columnNames: ['user_id', 'active_name'],
            isUnique: true,
          }),
        ],
        foreignKeys: [fkUser('personal_access_token')],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'auth_signing_key',
        columns: [
          new TableColumn({
            name: 'kid',
            type: 'varchar',
            length: '64',
            isPrimary: true,
          }),
          new TableColumn({ name: 'private_key_encrypted', type: 'text' }),
          new TableColumn({ name: 'public_jwk', type: 'text' }),
          createdAt(),
          datetime('retired_at', { isNullable: true }),
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('auth_signing_key', true);
    await queryRunner.dropTable('personal_access_token', true);
    await queryRunner.dropTable('auth_one_time_token', true);
    await queryRunner.dropTable('auth_refresh_token', true);
    await queryRunner.dropTable('local_credential', true);
  }
}
