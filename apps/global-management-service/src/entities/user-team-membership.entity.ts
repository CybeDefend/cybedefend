// user-team-membership.entity.ts
import { User } from './user.entity';
import { Entity, Index, ManyToOne, Column } from 'typeorm';
import { UuidPrimaryColumn } from '@cybedefend/db-dialect';
import { Team } from './team.entity';

@Entity('teams_members')
// Composite index for membership lookups by (teamId, userId).
// The PK is on the synthetic `id`; only single-column FK indexes exist on
// teamId / userId, so this composite is NOT redundant.
@Index('IDX_tm_team_user', ['team', 'user'])
export class UserTeamMembership {
  @UuidPrimaryColumn()
  id: string;

  @ManyToOne(() => User, (user) => user.teamMemberships, {
    onDelete: 'CASCADE',
  })
  user: User;

  @ManyToOne(() => Team, (team) => team.userMemberships, {
    onDelete: 'CASCADE',
  })
  team: Team;

  @Column()
  role: string;
}
