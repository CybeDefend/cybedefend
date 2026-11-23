import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProjectCyberRiskEntity } from '../../../entities/project-cyber-risk.entity';

export type ProjectCyberRiskUpsertInput = {
  projectId: string;
  score: number;
  level: ProjectCyberRiskEntity['level'];
  level7Days: ProjectCyberRiskEntity['level7Days'];
  vulnCount: number;
  computedAt: Date;
};

@Injectable()
export class ProjectCyberRiskRepository {
  constructor(
    @InjectRepository(ProjectCyberRiskEntity)
    private readonly repo: Repository<ProjectCyberRiskEntity>,
  ) {}

  async upsert(input: ProjectCyberRiskUpsertInput): Promise<void> {
    await this.repo.upsert(input, ['projectId']);
  }

  async findByProjectId(
    projectId: string,
  ): Promise<ProjectCyberRiskEntity | null> {
    return this.repo.findOne({ where: { projectId } });
  }

  async findByProjectIds(
    projectIds: string[],
  ): Promise<ProjectCyberRiskEntity[]> {
    if (projectIds.length === 0) return [];
    return this.repo.findBy({ projectId: In(projectIds) });
  }
}
