import {
  Entity,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { UuidPrimaryColumn, columnType } from '@cybedefend/db-dialect';
import { GitlabIntegration } from './gitlab-integration.entity';
import { GitlabBranch } from './gitlab-branch.entity';

/**
 * GitLab Repository Entity
 * Represents synchronized GitLab repositories that can be linked to CybeDefend projects
 */
@Entity('gitlab_repositories')
@Index('IDX_gl_repo_projectId', ['projectId'])
export class GitlabRepository {
  @UuidPrimaryColumn()
  id: string;

  @Column()
  gitlabId: number; // GitLab project ID

  // Widths below mirror what GitLab itself allows, not the 255 default every
  // column started with — see migration WidenGitlabRepositoryTextColumns.
  // `nameWithNamespace`, `pathWithNamespace` and the three URLs are
  // concatenations over nested groups and are not capped at 255 upstream.
  @Column()
  name: string; // Repository name

  @Column({ length: 512 })
  nameWithNamespace: string; // Full name with namespace

  @Column()
  path: string; // Repository path

  @Column({ length: 512 })
  pathWithNamespace: string; // Full path with namespace

  @Column()
  private: boolean; // Repository visibility

  @Column({ nullable: true })
  defaultBranch: string; // Default branch name

  @Column({ type: 'text', nullable: true })
  description: string; // Repository description — GitLab allows 2000 chars

  @Column({ length: 512, nullable: true })
  webUrl: string; // GitLab web URL

  @Column({ length: 512, nullable: true })
  sshUrlToRepo: string; // SSH clone URL

  @Column({ length: 512, nullable: true })
  httpUrlToRepo: string; // HTTPS clone URL

  @Column({ nullable: true })
  projectId: string; // Linked CybeDefend project ID

  @Column({ nullable: true })
  scanBranch: string; // User-selected branch for scanning (null = use default)

  @Column({ type: 'int', nullable: true })
  webhookId: number;

  // SHA-256 (hex) of the random secret token the project's webhook was
  // registered with; the token itself is never stored. Shared by every row
  // of the same GitLab project, which share one hook. NULL: the hook still
  // carries the token of the former scheme (see verifyWebhookSignature).
  @Column({ type: 'varchar', length: 64, nullable: true })
  webhookTokenHash: string | null;

  @ManyToOne(
    () => GitlabIntegration,
    (integration) => integration.repositories,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'integrationId' })
  integration: GitlabIntegration;

  @Column()
  integrationId: string;

  @Column({ type: columnType('datetime'), precision: 6, nullable: true })
  branchesSyncedAt: Date | null;

  @OneToMany(() => GitlabBranch, (branch) => branch.repository)
  branches: GitlabBranch[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
