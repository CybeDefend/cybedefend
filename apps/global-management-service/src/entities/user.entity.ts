import { IsOptional } from 'class-validator';
import { UserOrganizationMembership } from './user-organization-membership.entity';
import { UserTeamMembership } from './user-team-membership.entity';
import { Column, Entity, Index, OneToMany } from 'typeorm';
import { UpdatedAtColumn, UuidPrimaryColumn } from '@cybedefend/db-dialect';
import { Organization } from './organization.entity';
import { OrganizationInvitation } from './organization-invitation.entity';
import { Project } from './project.entity';
import { Team } from './team.entity';

@Entity('user')
export class User {
  @UuidPrimaryColumn()
  id: string;

  @Column()
  firstName: string;

  // Unique constraint enforced at the DB level by the
  // AddUniqueEmailUserConstraint migration (index name: IDX_user_email_unique).
  // The decorator is declared here for entity/schema parity, but the DDL is
  // owned by the migration file — TypeORM `synchronize` is disabled.
  @Index('IDX_user_email_unique', { unique: true })
  @Column()
  email: string;

  @Column()
  @IsOptional()
  lastName: string;

  @Column({ length: 8192 })
  @IsOptional()
  picture: string;

  @Column({ default: true })
  @IsOptional()
  notification: boolean;

  @Column({ default: false })
  @IsOptional()
  isOnboardingCompleted: boolean;

  @Column({
    type: 'text',
    nullable: true,
    default: null,
    transformer: {
      to: (value: string[] | null) => (value ? JSON.stringify(value) : null),
      from: (value: string | null) => {
        if (!value) return [];
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      },
    },
  })
  onboardingProgress: string[];

  /**
   * Onboarding persona chosen by the user:
   * solo_dev | tech_lead | security_pro | unspecified. Null until answered.
   */
  @Column({ type: 'varchar', length: 32, nullable: true })
  onboardingPersona?: string | null;

  /**
   * Onboarding intended usage(s) chosen by the user, persisted as a
   * comma-separated string of values from:
   * vibecoding | team_security | compliance | unspecified. Null until answered.
   */
  @Column({ type: 'varchar', length: 128, nullable: true })
  onboardingUsage?: string | null;

  @UpdatedAtColumn({ precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  createdAt: Date;

  @UpdatedAtColumn({ precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  updatedAt: Date;

  @OneToMany(() => UserOrganizationMembership, (membership) => membership.user)
  organizationMemberships: UserOrganizationMembership[];

  @OneToMany(() => UserTeamMembership, (membership) => membership.user)
  teamMemberships: UserTeamMembership[];

  @OneToMany(() => Organization, (organization) => organization.creator)
  createdOrganizations: Organization[];

  @OneToMany(() => Team, (team) => team.creator)
  createdTeams: Team[];

  @OneToMany(() => Project, (project) => project.creator)
  createdProjects: Project[];

  @OneToMany(() => OrganizationInvitation, (invitation) => invitation.invitedBy)
  organizationInvitations: OrganizationInvitation[];

  /**
   * Logto user ID — the 'sub' claim from Logto JWTs.
   * Used to map CybeDefend users to Logto user accounts.
   */
  @Column({ type: 'varchar', length: 128, nullable: true, unique: true })
  logtoUserId?: string | null;
}
