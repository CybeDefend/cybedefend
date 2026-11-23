import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  OneToMany,
} from 'typeorm';
import {
  UuidPrimaryColumn,
  columnType,
  UpdatedAtColumn,
} from '@cybedefend/db-dialect';
import { GithubIntegration } from './github-integration.entity';
import { GithubBranch } from './github-branch.entity';

@Entity('github_repositories')
@Index(
  'IDX_github_repositories_unique_repo_per_install',
  ['githubId', 'integrationId'],
  {
    unique: true,
  },
)
@Index('IDX_gh_repo_projectId', ['projectId'])
export class GithubRepository {
  @UuidPrimaryColumn()
  id: string;

  @Column()
  githubId: number;

  @Column()
  nodeId: string;

  @Column()
  name: string;

  @Column()
  fullName: string;

  @Column()
  private: boolean;

  @Column({ nullable: true })
  projectId: string;

  @Column({ nullable: true })
  defaultBranch: string; // Repository default branch from GitHub

  @Column({ nullable: true })
  scanBranch: string; // User-selected branch for scanning (null = use default)

  @ManyToOne(
    () => GithubIntegration,
    (integration) => integration.repositories,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'integrationId' })
  integration: GithubIntegration;

  @Column()
  integrationId: string;

  @Column({ type: columnType('datetime'), precision: 6, nullable: true })
  branchesSyncedAt: Date | null;

  @OneToMany(() => GithubBranch, (branch) => branch.repository)
  branches: GithubBranch[];

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @UpdatedAtColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;
}
