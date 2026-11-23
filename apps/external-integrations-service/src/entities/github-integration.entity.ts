import { Entity, Column, OneToMany, Unique, Index } from 'typeorm';
import { UuidPrimaryColumn, UpdatedAtColumn } from '@cybedefend/db-dialect';
import { GithubRepository } from './github-repository.entity';

@Entity('github_integrations')
@Unique('UQ_github_integrations_installationId', ['installationId'])
@Index('IDX_gh_integ_organizationId', ['organizationId'])
export class GithubIntegration {
  @UuidPrimaryColumn()
  id: string;

  @Column()
  installationId: number;

  @Column({ nullable: true })
  userId: string;

  @Column({ nullable: true })
  organizationId: string;

  /**
   * The GitHub account (user or organization login) the installation belongs
   * to, recorded with the installation. Shown as the GHCR
   * owner; never used to build an image reference, which reads it live.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  githubOwner: string | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @UpdatedAtColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;

  @OneToMany(() => GithubRepository, (repository) => repository.integration, {
    cascade: true,
  })
  repositories: GithubRepository[];
}
