import {
  Entity,
  Index,
  Column,
  type ColumnType,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import {
  ciText,
  UpdatedAtColumn,
  UuidPrimaryColumn,
} from '@cybedefend/db-dialect';
import { User } from './user.entity';
import { UserTeamMembership } from './user-team-membership.entity';
import { Organization } from './organization.entity';
import { Project } from './project.entity';

@Entity('team')
// Org-scoped team lookup by name. No UNIQUE(organizationId, name) exists; only a
// single-column FK index on organizationId, so this composite is NOT redundant.
@Index('IDX_team_org_name', ['organization', 'name'])
export class Team {
  @UuidPrimaryColumn()
  id: string;

  // Compared case-insensitively in team.service.ts: citext on postgres.
  @Column({ type: ciText() as ColumnType })
  name: string;

  @Column()
  description: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  creator: User;

  @UpdatedAtColumn({ precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  createdAt: Date;

  @UpdatedAtColumn({ precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  updatedAt: Date;

  @ManyToOne(() => Organization, (organization) => organization.teams, {
    onDelete: 'CASCADE',
  })
  organization: Organization;

  @OneToMany(() => UserTeamMembership, (membership) => membership.team)
  userMemberships: UserTeamMembership[];

  @OneToMany(() => Project, (project) => project.team)
  projects: Project[];
}
