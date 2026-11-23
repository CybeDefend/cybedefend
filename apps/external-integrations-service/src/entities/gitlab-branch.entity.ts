import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import {
  UuidPrimaryColumn,
  columnType,
  UpdatedAtColumn,
} from '@cybedefend/db-dialect';
import { GitlabRepository } from './gitlab-repository.entity';

/**
 * GitLab Branch Entity
 * Represents a branch synced from a GitLab repository. Persisted to support
 * stable scan-branch selection and push-event routing without round-tripping
 * to GitLab on every read.
 */
@Entity('gitlab_branches')
@Index('IDX_gitlab_branches_unique_name_per_repo', ['repositoryId', 'name'], {
  unique: true,
})
export class GitlabBranch {
  @UuidPrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column({ default: false })
  isProtected: boolean;

  @ManyToOne(() => GitlabRepository, (repo) => repo.branches, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'repositoryId' })
  repository: GitlabRepository;

  @Column()
  repositoryId: string;

  @Column({
    type: columnType('datetime'),
    precision: 6,
    default: () => 'CURRENT_TIMESTAMP(6)',
  })
  firstSeenAt: Date;

  @UpdatedAtColumn({
    type: columnType('datetime'),
    precision: 6,
    default: () => 'CURRENT_TIMESTAMP(6)',
  })
  lastSeenAt: Date;

  // kept raw for DATETIME(6) parity with migration
  @Column({
    type: columnType('datetime'),
    precision: 6,
    default: () => 'CURRENT_TIMESTAMP(6)',
  })
  createdAt: Date;

  // kept raw for DATETIME(6) parity with migration
  @UpdatedAtColumn({
    type: columnType('datetime'),
    precision: 6,
    default: () => 'CURRENT_TIMESTAMP(6)',
  })
  updatedAt: Date;
}
