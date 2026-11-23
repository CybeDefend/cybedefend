import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import {
  UuidPrimaryColumn,
  columnType,
  UpdatedAtColumn,
} from '@cybedefend/db-dialect';
import { GithubRepository } from './github-repository.entity';

/**
 * GitHub Branch Entity
 * Represents a branch synced from a GitHub repository. Branches are persisted
 * for stable scan-branch selection and webhook routing without round-tripping
 * to GitHub on every read.
 */
@Entity('github_branches')
@Index('IDX_github_branches_unique_name_per_repo', ['repositoryId', 'name'], {
  unique: true,
})
export class GithubBranch {
  @UuidPrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column({ default: false })
  isProtected: boolean;

  @ManyToOne(() => GithubRepository, (repo) => repo.branches, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'repositoryId' })
  repository: GithubRepository;

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

  @Column({
    type: columnType('datetime'),
    precision: 6,
    default: () => 'CURRENT_TIMESTAMP(6)',
  })
  createdAt: Date;

  @UpdatedAtColumn({
    type: columnType('datetime'),
    precision: 6,
    default: () => 'CURRENT_TIMESTAMP(6)',
  })
  updatedAt: Date;
}
