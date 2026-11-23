import {
  Column,
  type ColumnType,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { columnType } from '@cybedefend/db-dialect';
import { User } from 'src/entities/user.entity';

/**
 * The local account's argon2id credential: one row per user, the
 * hash is never logged. The table comes from the common migration
 * 1786300000000-CreateLocalIdentityTables and exists in every edition; only
 * LocalAuthModule, loaded in community mode only, reads or writes it.
 */
@Entity('local_credential')
export class LocalCredential {
  /** The user this credential belongs to: the primary key, so one row per user. */
  @PrimaryColumn({ name: 'user_id', type: 'varchar', length: 36 })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_local_credential_user',
  })
  user: User;

  /** argon2id hash, prefix `$argon2id$v=19$m=19456,t=2,p=1$`. */
  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({
    name: 'password_changed_at',
    type: columnType('datetime') as ColumnType,
    precision: 3,
  })
  passwordChangedAt: Date;

  @Column({
    name: 'created_at',
    type: columnType('datetime') as ColumnType,
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  createdAt: Date;
}
