import {
  Column,
  type ColumnType,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { columnType } from '@cybedefend/db-dialect';
import { User } from 'src/entities/user.entity';

/**
 * A personal access token (`cdp_…`): only the SHA-256 hash and the
 * last four characters are stored, never the secret. The name of an active
 * token is unique per user through the generated column `active_name` and
 * the unique index UQ_pat_user_active_name: a revoked token frees its name.
 *
 * Named `LocalPersonalAccessTokenEntity` because `LocalPersonalAccessToken`
 * is the generated local_auth message (contract issue 13). The table comes
 * from the common migration 1786300000000-CreateLocalIdentityTables; only
 * LocalAuthModule reads or writes it.
 */
@Entity('personal_access_token')
@Index('UQ_pat_user_active_name', ['userId', 'activeName'], { unique: true })
export class LocalPersonalAccessTokenEntity {
  /** Set in code with randomUUID(). */
  @PrimaryColumn({ name: 'id', type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_personal_access_token_user',
  })
  user: User;

  @Column({ name: 'name', type: 'varchar', length: 128 })
  name: string;

  /** SHA-256 of the token value, hex, 64 characters. */
  @Column({ name: 'token_hash', type: 'char', length: 64, unique: true })
  tokenHash: string;

  /** The last 4 characters of the token value. */
  @Column({ name: 'last_four', type: 'char', length: 4 })
  lastFour: string;

  /** Written at most once per 60 s. */
  @Column({
    name: 'last_used_at',
    type: columnType('datetime') as ColumnType,
    precision: 3,
    nullable: true,
  })
  lastUsedAt: Date | null;

  /** NULL: never expires. */
  @Column({
    name: 'expires_at',
    type: columnType('datetime') as ColumnType,
    precision: 3,
    nullable: true,
  })
  expiresAt: Date | null;

  @Column({
    name: 'revoked_at',
    type: columnType('datetime') as ColumnType,
    precision: 3,
    nullable: true,
  })
  revokedAt: Date | null;

  @Column({
    name: 'created_at',
    type: columnType('datetime') as ColumnType,
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  createdAt: Date;

  /**
   * `name` while the token is active, NULL once revoked — the generated
   * column the unique index reads. Read-only: the database computes it.
   */
  @Column({
    name: 'active_name',
    type: 'varchar',
    length: 128,
    nullable: true,
    insert: false,
    update: false,
    asExpression: 'CASE WHEN revoked_at IS NULL THEN name ELSE NULL END',
    generatedType: 'STORED',
  })
  activeName: string | null;
}
