// user-team-membership.entity.ts
import { User } from './user.entity';
import { Entity, Index, ManyToOne, Column } from 'typeorm';
import { UuidPrimaryColumn } from '@cybedefend/db-dialect';
import { Team } from './team.entity';

@Entity('teams_members')
// One membership row per (teamId, userId), and the index of the membership
// lookups by that pair. The PK is on the synthetic `id`.
@Index('UQ_tm_team_user', ['team', 'user'], { unique: true })
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
