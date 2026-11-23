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
 * A one-time token (instance setup, password reset): the SHA-256 hash
 * of the token is stored, never the token, and `consumed_at` makes it single
 * use. `user_id` is nullable: a setup token exists before its user row. The
 * table comes from the common migration
 * 1786300000000-CreateLocalIdentityTables; only LocalAuthModule reads or
 * writes it.
 */
@Entity('auth_one_time_token')
@Index('IDX_aott_user_purpose_created', ['userId', 'purpose', 'createdAt'])
export class AuthOneTimeToken {
  /** Set in code with randomUUID(). */
  @PrimaryColumn({ name: 'id', type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'user_id', type: 'varchar', length: 36, nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_auth_one_time_token_user',
  })
  user: User | null;

  @Column({ name: 'purpose', type: 'enum', enum: ['password_reset', 'setup'] })
  purpose: 'password_reset' | 'setup';

  /** SHA-256 of the token, hex, 64 characters. */
  @Column({ name: 'token_hash', type: 'char', length: 64, unique: true })
  tokenHash: string;

  /**
   * SHA-256 (hex) of the address that asked for a password reset
   * (`resetRequesterKey`), the key of the hourly cap with the user; null for
   * a setup token and the rows written before migration 1786400000000.
   */
  @Column({
    name: 'requester_key',
    type: 'char',
    length: 64,
    nullable: true,
  })
  requesterKey: string | null;

  @Column({
    name: 'expires_at',
    type: columnType('datetime') as ColumnType,
    precision: 3,
  })
  expiresAt: Date;

  @Column({
    name: 'consumed_at',
    type: columnType('datetime') as ColumnType,
    precision: 3,
    nullable: true,
  })
  consumedAt: Date | null;

  /** Wrong-presentation counter of the token (the reset limit is silent). */
  @Column({ name: 'attempts', type: 'int', default: 0 })
  attempts: number;

  @Column({
    name: 'created_at',
    type: columnType('datetime') as ColumnType,
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  createdAt: Date;
}
