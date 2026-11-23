import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { In, Repository } from 'typeorm';
import { ProjectCyberRiskEntity } from '../../../entities/project-cyber-risk.entity';
import { ProjectCyberRiskRepository } from './project-cyber-risk.repository';

describe('ProjectCyberRiskRepository', () => {
  let typeOrmRepo: jest.Mocked<Repository<ProjectCyberRiskEntity>>;
  let repo: ProjectCyberRiskRepository;

  beforeEach(() => {
    typeOrmRepo = {
      upsert: jest.fn(),
      findOne: jest.fn(),
      findBy: jest.fn(),
    } as unknown as jest.Mocked<Repository<ProjectCyberRiskEntity>>;
    repo = new ProjectCyberRiskRepository(typeOrmRepo);
  });

  describe('upsert', () => {
    it('upserts a fresh row with all fields', async () => {
      const now = new Date('2026-05-28T12:00:00.000Z');
      await repo.upsert({
        projectId: 'p1',
        score: 97,
        level: 'critical',
        level7Days: 'high',
        vulnCount: 12,
        computedAt: now,
      });
      expect(typeOrmRepo.upsert).toHaveBeenCalledWith(
        {
          projectId: 'p1',
          score: 97,
          level: 'critical',
          level7Days: 'high',
          vulnCount: 12,
          computedAt: now,
        },
        ['projectId'],
      );
    });
  });

  describe('findByProjectId', () => {
    it('returns the entity when found', async () => {
      const entity = {
        projectId: 'p1',
        score: 50,
        level: 'high',
        vulnCount: 3,
        computedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ProjectCyberRiskEntity;
      typeOrmRepo.findOne.mockResolvedValue(entity);

      const result = await repo.findByProjectId('p1');

      expect(typeOrmRepo.findOne).toHaveBeenCalledWith({
        where: { projectId: 'p1' },
      });
      expect(result).toBe(entity);
    });

    it('returns null when not found', async () => {
      typeOrmRepo.findOne.mockResolvedValue(null);
      const result = await repo.findByProjectId('missing');
      expect(result).toBeNull();
    });
  });

  describe('findByProjectIds', () => {
    it('returns the rows for the requested project ids', async () => {
      const rows = [
        { projectId: 'p1', score: 10 },
        { projectId: 'p2', score: 80 },
      ] as ProjectCyberRiskEntity[];
      typeOrmRepo.findBy.mockResolvedValue(rows);

      const result = await repo.findByProjectIds(['p1', 'p2']);

      expect(typeOrmRepo.findBy).toHaveBeenCalledWith({
        projectId: In(['p1', 'p2']),
      });
      expect(result).toBe(rows);
    });

    it('short-circuits with empty array when no ids', async () => {
      const result = await repo.findByProjectIds([]);
      expect(typeOrmRepo.findBy).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });
});

/**
 * The CybeRisk upsert keeps TypeORM's `upsert`: ON DUPLICATE KEY on MySQL,
 * ON CONFLICT on its conflict path on PostgreSQL, which needs a unique on
 * exactly those columns. The path is the table's primary key, which both the
 * MySQL track and the PostgreSQL baseline create.
 */
describe('ProjectCyberRiskRepository upsert conflict path', () => {
  it('is the primary key of project_cyber_risk', () => {
    const snapshot = JSON.parse(
      readFileSync(
        join(
          __dirname,
          '..',
          '..',
          '..',
          'core',
          'db',
          '__snapshots__',
          'entity-metadata.mysql.json',
        ),
        'utf8',
      ),
    ) as {
      columns: Array<{ table: string; property: string; primary: boolean }>;
    };
    const primary = snapshot.columns
      .filter((c) => c.table === 'project_cyber_risk' && c.primary)
      .map((c) => c.property);
    expect(primary).toEqual(['projectId']);
  });
});
