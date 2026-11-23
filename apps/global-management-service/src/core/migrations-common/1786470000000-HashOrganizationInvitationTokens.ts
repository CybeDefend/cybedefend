import { createHash } from 'node:crypto';
import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from 'typeorm';
import { dialectApi, parseDialect, run } from '@cybedefend/db-dialect';

const TABLE = 'organization_invitations';
const INDEX = 'UQ_orginv_token_hash';
const BATCH = 500;

/** The stored form of an invitation token (as in local-auth/token-hash.ts). */
function sha256Hex(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Invitation tokens are bearer credentials: whoever reads one can accept the
 * invitation. They were stored in clear; every other token of the service is
 * stored as its SHA-256. This is the EXPAND step:
 *
 * 1. `tokenHash` CHAR(64), nullable;
 * 2. the plaintext `token` becomes nullable (the application no longer
 *    writes it);
 * 3. every row still holding a token gets its hash and loses the token, so a
 *    link already sent keeps working (the hash of the token it carries is
 *    what the acceptance now looks up);
 * 4. a unique index on `tokenHash`, once the backfill is done.
 *
 * The `token` column and its index `IDX_orginv_token_email` stay, always
 * NULL for rows this version writes: during a rolling deploy an older pod
 * still inserts `token` (NOT NULL in its entity) and would fail if the column
 * were gone. A later release drops them (CONTRACT), after hashing any row an
 * older pod wrote during this rollout.
 *
 * Portable schema API, plus raw SQL only through the dialect's `sql` tag;
 * the engine is read from the query runner. Hashing runs in Node, so no
 * engine-specific hash function is needed.
 */
export class HashOrganizationInvitationTokens1786470000000 implements MigrationInterface {
  name = 'HashOrganizationInvitationTokens1786470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const { sql, ident } = dialectApi(
      parseDialect(queryRunner.connection.options.type),
    );

    await queryRunner.addColumn(
      TABLE,
      new TableColumn({
        name: 'tokenHash',
        type: 'char',
        length: '64',
        isNullable: true,
      }),
    );

    const token = (await queryRunner.getTable(TABLE))?.findColumnByName(
      'token',
    );
    if (token && !token.isNullable) {
      const nullable = token.clone();
      nullable.isNullable = true;
      await queryRunner.changeColumn(TABLE, token, nullable);
    }

    // Each batch empties the rows it read, so the next SELECT moves on.
    for (;;) {
      const { rows } = await run(
        queryRunner,
        sql`SELECT ${ident('id')}, ${ident('token')} FROM ${ident(TABLE)} WHERE ${ident('token')} IS NOT NULL AND ${ident('tokenHash')} IS NULL ORDER BY ${ident('id')} LIMIT ${BATCH}`,
      );
      for (const row of rows) {
        await run(
          queryRunner,
          sql`UPDATE ${ident(TABLE)} SET ${ident('tokenHash')} = ${sha256Hex(String(row.token))}, ${ident('token')} = NULL WHERE ${ident('id')} = ${String(row.id)}`,
        );
      }
      if (rows.length < BATCH) break;
    }

    await queryRunner.createIndex(
      TABLE,
      new TableIndex({
        name: INDEX,
        columnNames: ['tokenHash'],
        isUnique: true,
      }),
    );
  }

  /**
   * The tokens cannot come back: a row keeps its hash in `token` (NOT NULL
   * again), so an invitation sent before stays unusable after a rollback, and
   * the invitee needs a new one.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const { sql, ident } = dialectApi(
      parseDialect(queryRunner.connection.options.type),
    );
    await queryRunner.dropIndex(TABLE, INDEX);
    await run(
      queryRunner,
      sql`UPDATE ${ident(TABLE)} SET ${ident('token')} = ${ident('tokenHash')} WHERE ${ident('token')} IS NULL AND ${ident('tokenHash')} IS NOT NULL`,
    );
    await run(
      queryRunner,
      sql`DELETE FROM ${ident(TABLE)} WHERE ${ident('token')} IS NULL`,
    );
    const token = (await queryRunner.getTable(TABLE))?.findColumnByName(
      'token',
    );
    if (token && token.isNullable) {
      const required = token.clone();
      required.isNullable = false;
      await queryRunner.changeColumn(TABLE, token, required);
    }
    await queryRunner.dropColumn(TABLE, 'tokenHash');
  }
}
