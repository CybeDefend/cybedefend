import {
  Column,
  type ColumnType,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { columnType } from '@cybedefend/db-dialect';
import { Organization } from './organization.entity';

/**
 * The organization's current deletion code: only the creator
 * deletes an organization, with a 6-digit code e-mailed to them. The code is
 * never stored: `codeHash` is its scrypt hash with the per-code `codeSalt`.
 *
 * Every write goes through the conditional UPDATEs of
 * `MysqlOrganizationDeletionCodeStore`; this entity only declares the table
 * (migration 1786200000000) and its cascade.
 */
@Entity('organization_deletion_code')
export class OrganizationDeletionCode {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'organizationId',
    foreignKeyConstraintName: 'FK_organization_deletion_code_organization',
  })
  organization: Organization;

  /** The creator the current code was sent to. */
  @Column({ type: 'varchar', length: 36 })
  userId: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  codeHash: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  codeSalt: string | null;

  @Column({
    type: columnType('datetime') as ColumnType,
    precision: 3,
    nullable: true,
  })
  expiresAt: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({
    type: columnType('datetime') as ColumnType,
    precision: 3,
    nullable: true,
  })
  sentAt: Date | null;

  @Column({
    type: columnType('datetime') as ColumnType,
    precision: 3,
    nullable: true,
  })
  sendsWindowStart: Date | null;

  @Column({ type: 'int', default: 0 })
  sendsInWindow: number;

  @Column({
    type: columnType('datetime') as ColumnType,
    precision: 3,
    nullable: true,
  })
  failuresWindowStart: Date | null;

  @Column({ type: 'int', default: 0 })
  failuresInWindow: number;

  @Column({
    type: columnType('datetime') as ColumnType,
    precision: 3,
    nullable: true,
  })
  lockedUntil: Date | null;
}
