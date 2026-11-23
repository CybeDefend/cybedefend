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
 * One row of a refresh-token family: the SHA-256 hash of the token
 * is stored, never the token. `rotated_at` carries the 20 s race window.
 * The table comes from the common migration
 * 1786300000000-CreateLocalIdentityTables; only LocalAuthModule reads or
 * writes it.
 */
@Entity('auth_refresh_token')
@Index('IDX_art_family', ['familyId'])
@Index('IDX_art_user', ['userId'])
export class AuthRefreshToken {
  /** Set in code with randomUUID(). */
  @PrimaryColumn({ name: 'id', type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_auth_refresh_token_user',
  })
  user: User;

  /** The family this token belongs to; a reuse revokes the whole family. */
  @Column({ name: 'family_id', type: 'varchar', length: 36 })
  familyId: string;

  /** SHA-256 of the refresh token, hex, 64 characters. */
  @Column({ name: 'token_hash', type: 'char', length: 64, unique: true })
  tokenHash: string;

  @Column({
    name: 'expires_at',
    type: columnType('datetime') as ColumnType,
    precision: 3,
  })
  expiresAt: Date;

  /** Set when this token was rotated; within 20 s of it a reuse is a race. */
  @Column({
    name: 'rotated_at',
    type: columnType('datetime') as ColumnType,
    precision: 3,
    nullable: true,
  })
  rotatedAt: Date | null;

  @Column({
    name: 'revoked_at',
    type: columnType('datetime') as ColumnType,
    precision: 3,
    nullable: true,
  })
  revokedAt: Date | null;

  /** The id of the token that replaced this one in its family. */
  @Column({ name: 'replaced_by', type: 'varchar', length: 36, nullable: true })
  replacedBy: string | null;

  @Column({
    name: 'created_at',
    type: columnType('datetime') as ColumnType,
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  createdAt: Date;
}
