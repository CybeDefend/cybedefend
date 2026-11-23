import { Entity, Column, OneToMany, ManyToOne } from 'typeorm';
import { UpdatedAtColumn, UuidPrimaryColumn } from '@cybedefend/db-dialect';
import { User } from './user.entity';
import { IsOptional } from 'class-validator';
import { UserOrganizationMembership } from './user-organization-membership.entity';
import { OrganizationInvitation } from './organization-invitation.entity';
import { Team } from './team.entity';

/**
 * An organisation: the core columns only. An edition that stores more about
 * an organisation declares its own columns on this entity from its own code.
 */
@Entity('organization')
export class Organization {
  @UuidPrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column()
  industry: string;

  @Column()
  country: string;

  @Column({ default: false })
  isActive: boolean;

  @Column({ default: 1 })
  concurrentScanLimit: number;

  /**
   * Per-member products: the organisation's switch. Off,
   * every member holds both products and counts as an AppSec seat; on, each member holds what its product columns say. Mirrors
   * the Permify attribute `member_products`, which enforces it; the counts
   * read this column, never Permify. New organisations start on; the switch
   * script turns the others on, column then attribute.
   */
  @Column({ name: 'member_products', type: 'boolean', default: false })
  memberProducts: boolean;

  // Max pre-commit diff scans a single user may run in parallel
  // across this org (default 1). Configurable (future dashboard); enforced in
  // security-scanning at diff-scan create time.
  @Column({ default: 1 })
  diffScanMaxParallelPerUser: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @IsOptional()
  creator?: User;

  @UpdatedAtColumn({ precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  createdAt: Date;

  @UpdatedAtColumn({ precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  updatedAt: Date;

  @OneToMany(() => Team, (team) => team.organization, { cascade: true })
  teams: Team[];

  @OneToMany(
    () => UserOrganizationMembership,
    (membership) => membership.organization,
  )
  userMemberships: UserOrganizationMembership[];

  @OneToMany(
    () => OrganizationInvitation,
    (invitation) => invitation.organization,
  )
  invitations: OrganizationInvitation[];
}
