import { Repository } from 'typeorm';
import { Project } from 'src/entities/project.entity';

/**
 * A project with its team and the team's organization, in ONE SELECT.
 *
 * `findOne({ relations: ['team', 'team.organization'] })` makes TypeORM page
 * the joined rows to honour its implicit `take: 1`, so every read would pay a
 * `SELECT DISTINCT distinctAlias` pre-query first. Both relations are
 * many-to-one: the read is one row, and `getOne` without `take` reads it with
 * one statement. LEFT JOINs, as
 * `findOne` did, so the result is the same entity graph.
 */
export function findProjectWithTeamOrg(
  repository: Repository<Project>,
  projectId: string,
): Promise<Project | null> {
  return repository
    .createQueryBuilder('project')
    .leftJoinAndSelect('project.team', 'team')
    .leftJoinAndSelect('team.organization', 'organization')
    .where('project.id = :projectId', { projectId })
    .getOne();
}
