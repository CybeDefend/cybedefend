import {
  Entity,
  Column,
  type ColumnType,
  Index,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import {
  columnType,
  UpdatedAtColumn,
  UuidPrimaryColumn,
} from '@cybedefend/db-dialect';
import { Organization } from './organization.entity';
import { User } from './user.entity';

@Entity('organization_invitations')
// The acceptance looks an invitation up by the hash of its token (unique);
// org-scoped listing filters by status with expiry.
@Index('UQ_orginv_token_hash', ['tokenHash'], { unique: true })
@Index('IDX_orginv_org_status_exp', ['organization', 'status', 'expiresAt'])
export class OrganizationInvitation {
  @UuidPrimaryColumn()
  id: string;

  /**
   * The SHA-256 (hex) of the invitation token, like every other token of the
   * service (`tokenHash` in local-auth/token-hash.ts). The token itself is a
   * bearer credential: it travels once to the invitee (mail, link, or the
   * invite response without SMTP) and is never stored or logged. Nullable
   * only for a row an older version wrote during a rolling deploy.
   *
   * The former plaintext `token` column stays in the table, nullable and
   * always NULL, until the contract migration of a later release drops it
   * (an older pod still inserts it during the rolling deploy).
   */
  @Column({ type: 'char', length: 64, nullable: true })
  tokenHash: string | null;

  @Column()
  email: string;

  @Column()
  role: string;

  /**
   * Per-member products: the products the invitation gives
   * once accepted (an administrator always both). Pending invitations of
   * before the release hold both.
   */
  @Column({ name: 'appsec_access', type: 'boolean', default: true })
  appsecAccess: boolean;

  @Column({ name: 'vibedefend_access', type: 'boolean', default: true })
  vibedefendAccess: boolean;

  @Column({
    type: 'enum',
    enum: ['pending', 'accepted', 'canceled'],
    default: 'pending',
  })
  status: 'pending' | 'accepted' | 'canceled';

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date;

  @Column({
    type: columnType('json') as ColumnType,
    nullable: true,
    comment:
      'Array of team assignments with roles for automatic addition upon invitation acceptance',
  })
  teamAssignments: { teamId: string; role: string }[];

  @ManyToOne(() => Organization, (organization) => organization.invitations, {
    onDelete: 'CASCADE',
  })
  organization: Organization;

  @ManyToOne(() => User, (user) => user.organizationInvitations, {
    onDelete: 'CASCADE',
  })
  invitedBy: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdatedAtColumn({ precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  updatedAt: Date;

  @Column({ nullable: true })
  acceptedAt: Date;

  /**
   * Logto invitation ID — synced via LogtoAdminService.
   * Used to track invitations mirrored in Logto.
   */
  @Column({ type: 'varchar', length: 128, nullable: true })
  logtoInvitationId?: string | null;
}
