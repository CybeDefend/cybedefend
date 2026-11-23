import { CyberRiskService } from './cyber-risk.service';
import { ProjectCyberRiskRepository } from './repositories/project-cyber-risk.repository';
import type { VulnForScoring } from './helpers/points-from-vuln';

describe('CyberRiskService.computeAndPersistProjectScore', () => {
  const fixedNow = new Date('2026-05-28T12:00:00.000Z');
  let repo: jest.Mocked<ProjectCyberRiskRepository>;
  let fetchActiveVulns: jest.Mock<Promise<VulnForScoring[]>, [string]>;
  let getScoringBranches: jest.Mock<Promise<string[]>, [string]>;
  let service: CyberRiskService;

  beforeEach(() => {
    repo = {
      upsert: jest.fn(),
      findByProjectId: jest.fn(),
      findByProjectIds: jest.fn(),
    } as unknown as jest.Mocked<ProjectCyberRiskRepository>;
    fetchActiveVulns = jest.fn();
    getScoringBranches = jest.fn().mockResolvedValue(['main', 'master']);
    service = new CyberRiskService(
      repo,
      { fetchActiveVulns } as any,
      {
        getScoringBranches,
      } as any,
    );
    jest.useFakeTimers().setSystemTime(fixedNow);
  });

  afterEach(() => jest.useRealTimers());

  it('resolves the project scoring branches and forwards them to fetchActiveVulns', async () => {
    getScoringBranches.mockResolvedValue(['main']);
    fetchActiveVulns.mockResolvedValue([]);

    await service.computeAndPersistProjectScore('p1');

    expect(getScoringBranches).toHaveBeenCalledWith('p1');
    expect(fetchActiveVulns).toHaveBeenCalledWith('p1', undefined, ['main']);
  });

  it('forwards the main/master fallback branches to fetchActiveVulns when no reference branch resolves', async () => {
    getScoringBranches.mockResolvedValue(['main', 'master']);
    fetchActiveVulns.mockResolvedValue([]);

    await service.computeAndPersistProjectScore('p1');

    expect(fetchActiveVulns).toHaveBeenCalledWith('p1', undefined, [
      'main',
      'master',
    ]);
  });

  it('returns 0/low for a project with no active vulns', async () => {
    fetchActiveVulns.mockResolvedValue([]);
    const result = await service.computeAndPersistProjectScore('p1');
    expect(result).toEqual({
      projectId: 'p1',
      score: 0,
      level: 'low',
      vulnCount: 0,
      computedAt: fixedNow,
    });
    expect(repo.upsert).toHaveBeenCalledWith({
      projectId: 'p1',
      score: 0,
      level: 'low',
      level7Days: 'low',
      vulnCount: 0,
      computedAt: fixedNow,
    });
  });

  it('persists the 7-day level from the since-windowed fetch, distinct from all-time', async () => {
    // all-time fetch (since=undefined) is elevated; the 7-day fetch (since set)
    // is empty -> a lower 7-day level. Proves level7Days uses the windowed set.
    fetchActiveVulns.mockImplementation((_p: string, since?: Date) =>
      Promise.resolve(
        since ? [] : ([{ cvss4: 10.0 }, { cvss4: 10.0 }] as VulnForScoring[]),
      ),
    );

    const result = await service.computeAndPersistProjectScore('p1');

    expect(result.level).not.toBe('low'); // all-time elevated
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ level7Days: 'low' }), // empty 7-day window
    );
  });

  it('sums CVSS-based points and rounds the total to an int', async () => {
    fetchActiveVulns.mockResolvedValue([
      { cvss4: 10.0 }, // 20
      { cvss4: 9.5 }, // 17.5
      { cvss4: 7.0 }, // 5
      { cvss4: 5.5 }, // ≈3.03
    ]);
    const result = await service.computeAndPersistProjectScore('p2');
    // 20 + 17.5 + 5 + 3.0344828 ≈ 45.53 → round → 46 → level=medium
    expect(result.score).toBe(46);
    expect(result.level).toBe('medium');
    expect(result.vulnCount).toBe(4);
  });

  it('crosses critical threshold (≥80) with enough vulns', async () => {
    fetchActiveVulns.mockResolvedValue(
      Array.from({ length: 5 }, () => ({ cvss4: 10.0 })), // 5×20 = 100
    );
    const result = await service.computeAndPersistProjectScore('p3');
    expect(result.score).toBe(100);
    expect(result.level).toBe('critical');
  });

  it('falls back to severity for vulns without CVSS', async () => {
    fetchActiveVulns.mockResolvedValue([
      { severity: 'critical' }, // 17.5
      { severity: 'high' }, // 7.5
      { severity: 'medium' }, // 3
      { severity: 'low' }, // 1
    ]);
    const result = await service.computeAndPersistProjectScore('p4');
    // 17.5 + 7.5 + 3 + 1 = 29 → medium
    expect(result.score).toBe(29);
    expect(result.level).toBe('medium');
  });

  it('uses cvssEnvironmental when present (highest priority)', async () => {
    fetchActiveVulns.mockResolvedValue([
      { cvssEnvironmental: 9.0, cvss4: 10, cvss3: 8, severity: 'high' },
    ]);
    const result = await service.computeAndPersistProjectScore('p5');
    expect(result.score).toBe(15); // 15 = points at env=9.0
  });

  it('uses fixed computedAt timestamp on upsert', async () => {
    fetchActiveVulns.mockResolvedValue([]);
    await service.computeAndPersistProjectScore('p6');
    const call = repo.upsert.mock.calls[0][0];
    expect(call.computedAt).toEqual(fixedNow);
  });
});

describe('CyberRiskService.computeProjectScoreLevelSince', () => {
  let repo: jest.Mocked<ProjectCyberRiskRepository>;
  let fetchActiveVulns: jest.Mock<
    Promise<VulnForScoring[]>,
    [string, Date?, string[]?]
  >;
  let getScoringBranches: jest.Mock<Promise<string[]>, [string]>;
  let service: CyberRiskService;

  beforeEach(() => {
    repo = {
      upsert: jest.fn(),
      findByProjectId: jest.fn(),
      findByProjectIds: jest.fn(),
    } as unknown as jest.Mocked<ProjectCyberRiskRepository>;
    fetchActiveVulns = jest.fn();
    getScoringBranches = jest.fn().mockResolvedValue(['main', 'master']);
    service = new CyberRiskService(
      repo,
      { fetchActiveVulns } as any,
      { getScoringBranches } as any,
    );
  });

  it('computes the live level branch-scoped like the persisted score and forwards since + branches', async () => {
    const since = new Date('2026-05-22T00:00:00.000Z');
    getScoringBranches.mockResolvedValue(['develop']);
    fetchActiveVulns.mockResolvedValue([
      { cvss4: 10.0 }, // 20
      { cvss4: 9.5 }, // 17.5
    ]);

    const level = await service.computeProjectScoreLevelSince('p1', since);

    // 20 + 17.5 = 37.5 → round 38 → medium
    expect(level).toBe('medium');
    expect(getScoringBranches).toHaveBeenCalledWith('p1');
    expect(fetchActiveVulns).toHaveBeenCalledWith('p1', since, ['develop']);
  });

  it('returns low for a project with no vulns in the window', async () => {
    const since = new Date('2026-05-22T00:00:00.000Z');
    fetchActiveVulns.mockResolvedValue([]);

    const level = await service.computeProjectScoreLevelSince('p2', since);

    expect(level).toBe('low');
    expect(fetchActiveVulns).toHaveBeenCalledWith('p2', since, [
      'main',
      'master',
    ]);
  });
});

describe('CyberRiskService.computeBatchLevelsSince', () => {
  let repo: jest.Mocked<ProjectCyberRiskRepository>;
  let fetchActiveVulnsBatch: jest.Mock<
    Promise<Map<string, VulnForScoring[]>>,
    [string[], Date?, Map<string, string[]>?]
  >;
  let getScoringBranchesBatch: jest.Mock<
    Promise<Map<string, string[]>>,
    [string[]]
  >;
  let service: CyberRiskService;

  beforeEach(() => {
    repo = {
      upsert: jest.fn(),
      findByProjectId: jest.fn(),
      findByProjectIds: jest.fn(),
    } as unknown as jest.Mocked<ProjectCyberRiskRepository>;
    fetchActiveVulnsBatch = jest.fn();
    getScoringBranchesBatch = jest.fn().mockResolvedValue(new Map());
    service = new CyberRiskService(
      repo,
      { fetchActiveVulnsBatch } as any,
      { getScoringBranchesBatch } as any,
    );
  });

  it('resolves per-project scoring branches and forwards them to the batched fetch', async () => {
    const since = new Date('2026-05-22T00:00:00.000Z');
    const branchMap = new Map<string, string[]>([
      ['a', ['main']],
      ['b', ['main']],
      ['c', ['main']],
    ]);
    getScoringBranchesBatch.mockResolvedValue(branchMap);
    fetchActiveVulnsBatch.mockResolvedValue(
      new Map<string, VulnForScoring[]>([
        [
          'a',
          [
            { cvss4: 10.0 },
            { cvss4: 10.0 },
            { cvss4: 10.0 },
            { cvss4: 10.0 },
            { cvss4: 10.0 },
          ],
        ], // 100 → critical
        ['b', [{ severity: 'low' }]], // 1 → low (or none threshold dependent)
        ['c', []], // 0 → low (floor)
      ]),
    );

    const result = await service.computeBatchLevelsSince(
      ['a', 'b', 'c'],
      since,
    );

    expect(getScoringBranchesBatch).toHaveBeenCalledWith(['a', 'b', 'c']);
    expect(fetchActiveVulnsBatch).toHaveBeenCalledWith(
      ['a', 'b', 'c'],
      since,
      branchMap,
    );
    expect(result.get('a')).toBe('critical');
    expect(result.get('c')).toBe('low');
    expect([...result.keys()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('short-circuits to an empty Map for an empty project list', async () => {
    const since = new Date('2026-05-22T00:00:00.000Z');
    const result = await service.computeBatchLevelsSince([], since);
    expect(result.size).toBe(0);
    expect(getScoringBranchesBatch).not.toHaveBeenCalled();
    expect(fetchActiveVulnsBatch).not.toHaveBeenCalled();
  });
});
