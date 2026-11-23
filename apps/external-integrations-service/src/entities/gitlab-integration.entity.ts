import {
  Entity,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { UuidPrimaryColumn, columnType } from '@cybedefend/db-dialect';
import { GitlabRepository } from './gitlab-repository.entity';

/**
 * GitLab Integration Entity
 * Manages GitLab OAuth installations and connections at the organization level
 */
@Entity('gitlab_integrations')
@Index('IDX_gl_integ_organizationId', ['organizationId'])
export class GitlabIntegration {
  @UuidPrimaryColumn()
  id: string;

  @Column({ nullable: true })
  userId: string; // CybeDefend user who installed the integration

  @Column({ nullable: true })
  organizationId: string; // CybeDefend organization ID

  @Column({ nullable: true })
  gitlabUserId: number; // GitLab user ID

  @Column({ nullable: true })
  gitlabGroupId: number; // GitLab group/namespace ID

  @Column({ nullable: true, type: 'text' })
  accessToken: string; // Encrypted GitLab access token

  @Column({ nullable: true, type: 'text' })
  refreshToken: string; // Encrypted GitLab refresh token

  @Column({ nullable: true })
  refreshTokenExpiresAt: Date; // Refresh token expiration timestamp

  @Column({ nullable: true })
  tokenExpiresAt: Date; // Token expiration timestamp

  @Column({ nullable: true })
  scope: string; // OAuth scopes granted

  /**
   * When GitLab refused this connection's refresh token with `invalid_grant`
   * (the application was revoked on GitLab's side). NULL = healthy.
   */
  @Column({ type: columnType('datetime'), precision: 6, nullable: true })
  reconnectRequiredAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => GitlabRepository, (repository) => repository.integration, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  repositories: GitlabRepository[];
}
