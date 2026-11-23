import { Repository } from 'typeorm';
import { ActiveVulnFetcher } from './active-vuln-fetcher.service';
import { ACTIVE_VULN_STATES } from './cyber-risk.constants';

type Row = {
  cvssEnvironmental: string | number | null;
  cvss4: string | number | null;
  severity: string | null;
  projectId?: string;
  id?: string | number;
  branch?: string | null;
};

function repoMock(rows: Row[]) {
  const qb: any = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };
  const repo = {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  } as unknown as Repository<any>;
  return { repo, qb };
}

describe('ActiveVulnFetcher.fetchActiveVulns', () => {
  it('queries all 6 detection repos filtered by project + active states and merges rows in order', async () => {
    const sast = repoMock([
      { cvssEnvironmental: null, cvss4: null, severity: 'high' },
    ]);
    const iac = repoMock([]);
    const cicd = repoMock([]);
    const sca = repoMock([
      { cvssEnvironmental: '9.5', cvss4: '10.0', severity: 'critical' },
    ]);
    const container = repoMock([]);
    const secret = repoMock([]);

    const fetcher = new ActiveVulnFetcher(
      sast.repo,
      iac.repo,
      cicd.repo,
      sca.repo,
      container.repo,
      secret.repo,
    );

    const result = await fetcher.fetchActiveVulns('p1');

    for (const m of [sast, iac, cicd, sca, container, secret]) {
      expect(m.repo.createQueryBuilder).toHaveBeenCalledWith('v');
      expect(m.qb.where).toHaveBeenCalledWith('v.projectId = :projectId', {
        projectId: 'p1',
      });
      expect(m.qb.andWhere).toHaveBeenCalledWith(
        'v.currentState IN (:...states)',
        {
          states: [...ACTIVE_VULN_STATES],
        },
      );
    }

    expect(result).toEqual([
      { cvssEnvironmental: null, cvss4: null, cvss3: null, severity: 'high' },
      { cvssEnvironmental: 9.5, cvss4: 10, cvss3: null, severity: 'critical' },
    ]);
  });

  it('normalizes UPPERCASE currentSeverity (as actually stored) to canonical lowercase so CVSS-less findings still score', async () => {
    const sast = repoMock([
      { cvssEnvironmental: null, cvss4: null, severity: 'CRITICAL' },
      { cvssEnvironmental: null, cvss4: null, severity: 'High' },
      { cvssEnvironmental: null, cvss4: null, severity: '' },
    ]);
    const empty = () => repoMock([]).repo;
    const fetcher = new ActiveVulnFetcher(
      sast.repo,
      empty(),
      empty(),
      empty(),
      empty(),
      empty(),
    );

    const result = await fetcher.fetchActiveVulns('p1');

    expect(result).toEqual([
      {
        cvssEnvironmental: null,
        cvss4: null,
        cvss3: null,
        severity: 'critical',
      },
      { cvssEnvironmental: null, cvss4: null, cvss3: null, severity: 'high' },
      { cvssEnvironmental: null, cvss4: null, cvss3: null, severity: null },
    ]);
  });

  it('coerces decimal strings to numbers and normalizes unknown severities to null', async () => {
    const sca = repoMock([
      { cvssEnvironmental: '7.0', cvss4: null, severity: 'weird' },
    ]);
    const empty = () => repoMock([]).repo;
    const fetcher = new ActiveVulnFetcher(
      empty(),
      empty(),
      empty(),
      sca.repo,
      empty(),
      empty(),
    );

    const result = await fetcher.fetchActiveVulns('p9');

    expect(result).toEqual([
      { cvssEnvironmental: 7, cvss4: null, cvss3: null, severity: null },
    ]);
  });

  it('adds a createdAt > :since andWhere on every repo query when since is provided', async () => {
    const mocks = [
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
    ];
    const fetcher = new ActiveVulnFetcher(
      mocks[0].repo,
      mocks[1].repo,
      mocks[2].repo,
      mocks[3].repo,
      mocks[4].repo,
      mocks[5].repo,
    );

    const since = new Date('2026-05-22T00:00:00.000Z');
    await fetcher.fetchActiveVulns('p7', since);

    for (const m of mocks) {
      expect(m.qb.andWhere).toHaveBeenCalledWith('v.createdAt > :since', {
        since,
      });
    }
  });

  it('adds a v.branch IN (:...branches) andWhere on every repo query when a non-empty branch list is provided', async () => {
    const mocks = [
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
    ];
    const fetcher = new ActiveVulnFetcher(
      mocks[0].repo,
      mocks[1].repo,
      mocks[2].repo,
      mocks[3].repo,
      mocks[4].repo,
      mocks[5].repo,
    );

    await fetcher.fetchActiveVulns('p7', undefined, ['main', 'master']);

    for (const m of mocks) {
      expect(m.qb.andWhere).toHaveBeenCalledWith('v.branch IN (:...branches)', {
        branches: ['main', 'master'],
      });
    }
  });

  it('does NOT add a branch andWhere when no branch list is provided', async () => {
    const mocks = [
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
    ];
    const fetcher = new ActiveVulnFetcher(
      mocks[0].repo,
      mocks[1].repo,
      mocks[2].repo,
      mocks[3].repo,
      mocks[4].repo,
      mocks[5].repo,
    );

    await fetcher.fetchActiveVulns('p7');

    for (const m of mocks) {
      expect(m.qb.andWhere).not.toHaveBeenCalledWith(
        'v.branch IN (:...branches)',
        expect.anything(),
      );
    }
  });

  it('does NOT add a branch andWhere when an empty branch list is provided', async () => {
    const mocks = [
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
    ];
    const fetcher = new ActiveVulnFetcher(
      mocks[0].repo,
      mocks[1].repo,
      mocks[2].repo,
      mocks[3].repo,
      mocks[4].repo,
      mocks[5].repo,
    );

    await fetcher.fetchActiveVulns('p7', undefined, []);

    for (const m of mocks) {
      expect(m.qb.andWhere).not.toHaveBeenCalledWith(
        'v.branch IN (:...branches)',
        expect.anything(),
      );
    }
  });
});

describe('ActiveVulnFetcher.fetchActiveVulnsBatch', () => {
  it('returns a Map keyed by projectId merging rows from all 6 repos', async () => {
    const sast = repoMock([
      {
        projectId: 'a',
        cvssEnvironmental: null,
        cvss4: null,
        severity: 'high',
      },
    ]);
    const iac = repoMock([]);
    const cicd = repoMock([
      {
        projectId: 'b',
        cvssEnvironmental: null,
        cvss4: '7.0',
        severity: 'medium',
      },
    ]);
    const sca = repoMock([
      {
        projectId: 'a',
        cvssEnvironmental: '9.5',
        cvss4: '10.0',
        severity: 'critical',
      },
    ]);
    const container = repoMock([]);
    const secret = repoMock([]);

    const fetcher = new ActiveVulnFetcher(
      sast.repo,
      iac.repo,
      cicd.repo,
      sca.repo,
      container.repo,
      secret.repo,
    );

    const result = await fetcher.fetchActiveVulnsBatch(['a', 'b']);

    expect([...result.keys()].sort()).toEqual(['a', 'b']);
    expect(result.get('a')).toEqual([
      { cvssEnvironmental: null, cvss4: null, cvss3: null, severity: 'high' },
      { cvssEnvironmental: 9.5, cvss4: 10, cvss3: null, severity: 'critical' },
    ]);
    expect(result.get('b')).toEqual([
      { cvssEnvironmental: null, cvss4: 7, cvss3: null, severity: 'medium' },
    ]);

    for (const m of [sast, iac, cicd, sca, container, secret]) {
      expect(m.qb.where).toHaveBeenCalledWith(
        'v.projectId IN (:...projectIds)',
        { projectIds: ['a', 'b'] },
      );
    }
  });

  it('selects the branch column and keeps only rows whose branch is in the project scoring set', async () => {
    const sast = repoMock([
      {
        projectId: 'a',
        branch: 'main',
        cvssEnvironmental: null,
        cvss4: '9.0',
        severity: 'critical',
      },
      {
        projectId: 'a',
        branch: 'feature/x',
        cvssEnvironmental: null,
        cvss4: '9.0',
        severity: 'critical',
      }, // dropped: not in ['main']
      {
        projectId: 'b',
        branch: 'develop',
        cvssEnvironmental: null,
        cvss4: '7.0',
        severity: 'high',
      },
    ]);
    const empty = () => repoMock([]).repo;
    const fetcher = new ActiveVulnFetcher(
      sast.repo,
      empty(),
      empty(),
      empty(),
      empty(),
      empty(),
    );

    const branchesByProject = new Map<string, string[]>([
      ['a', ['main']],
      ['b', ['develop']],
    ]);
    const result = await fetcher.fetchActiveVulnsBatch(
      ['a', 'b'],
      undefined,
      branchesByProject,
    );

    expect(sast.qb.addSelect).toHaveBeenCalledWith('v.branch', 'branch');
    expect(result.get('a')).toEqual([
      { cvssEnvironmental: null, cvss4: 9, cvss3: null, severity: 'critical' },
    ]);
    expect(result.get('b')).toEqual([
      { cvssEnvironmental: null, cvss4: 7, cvss3: null, severity: 'high' },
    ]);
  });

  it('adds a createdAt > :since andWhere on the batch query when since is provided', async () => {
    const mocks = [
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
    ];
    const fetcher = new ActiveVulnFetcher(
      mocks[0].repo,
      mocks[1].repo,
      mocks[2].repo,
      mocks[3].repo,
      mocks[4].repo,
      mocks[5].repo,
    );

    const since = new Date('2026-05-22T00:00:00.000Z');
    await fetcher.fetchActiveVulnsBatch(['a'], since);

    for (const m of mocks) {
      expect(m.qb.andWhere).toHaveBeenCalledWith('v.createdAt > :since', {
        since,
      });
    }
  });

  it('keeps all rows for a project that has no entry in the branch map', async () => {
    const sast = repoMock([
      {
        projectId: 'a',
        branch: 'feature/x',
        cvssEnvironmental: null,
        cvss4: '9.0',
        severity: 'critical',
      },
    ]);
    const empty = () => repoMock([]).repo;
    const fetcher = new ActiveVulnFetcher(
      sast.repo,
      empty(),
      empty(),
      empty(),
      empty(),
      empty(),
    );

    // branchesByProject is supplied but project 'a' has no entry → no filter.
    const result = await fetcher.fetchActiveVulnsBatch(
      ['a'],
      undefined,
      new Map<string, string[]>([['other', ['main']]]),
    );

    expect(result.get('a')).toEqual([
      { cvssEnvironmental: null, cvss4: 9, cvss3: null, severity: 'critical' },
    ]);
  });

  it('returns an empty Map without querying when projectIds is empty', async () => {
    const mocks = [
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
    ];
    const fetcher = new ActiveVulnFetcher(
      mocks[0].repo,
      mocks[1].repo,
      mocks[2].repo,
      mocks[3].repo,
      mocks[4].repo,
      mocks[5].repo,
    );

    const result = await fetcher.fetchActiveVulnsBatch([]);

    expect(result.size).toBe(0);
    for (const m of mocks) {
      expect(m.repo.createQueryBuilder).not.toHaveBeenCalled();
    }
  });
});

describe('ActiveVulnFetcher.fetchActiveVulnsWithMeta', () => {
  it('selects v.id, tags each row with its scan type and coerces the meta shape', async () => {
    const sast = repoMock([
      { id: 101, cvssEnvironmental: null, cvss4: null, severity: 'high' },
    ]);
    const iac = repoMock([]);
    const cicd = repoMock([]);
    const sca = repoMock([
      {
        id: 'sca-7',
        cvssEnvironmental: '9.5',
        cvss4: '10.0',
        severity: 'critical',
      },
    ]);
    const container = repoMock([]);
    const secret = repoMock([]);

    const fetcher = new ActiveVulnFetcher(
      sast.repo,
      iac.repo,
      cicd.repo,
      sca.repo,
      container.repo,
      secret.repo,
    );

    const result = await fetcher.fetchActiveVulnsWithMeta('p1');

    // id is selected on every repo query, filtered by project + active states.
    expect(sast.qb.select).toHaveBeenCalledWith('v.id', 'id');
    expect(sast.qb.where).toHaveBeenCalledWith('v.projectId = :projectId', {
      projectId: 'p1',
    });
    expect(sast.qb.andWhere).toHaveBeenCalledWith(
      'v.currentState IN (:...states)',
      { states: [...ACTIVE_VULN_STATES] },
    );

    expect(result).toEqual([
      {
        id: '101',
        scanType: 'SAST',
        cvssEnvironmental: null,
        cvss4: null,
        cvss3: null,
        severity: 'high',
      },
      {
        id: 'sca-7',
        scanType: 'SCA',
        cvssEnvironmental: 9.5,
        cvss4: 10,
        cvss3: null,
        severity: 'critical',
      },
    ]);
  });

  it('adds a v.branch IN (:...branches) andWhere on every repo query when a non-empty branch list is provided', async () => {
    const mocks = [
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
    ];
    const fetcher = new ActiveVulnFetcher(
      mocks[0].repo,
      mocks[1].repo,
      mocks[2].repo,
      mocks[3].repo,
      mocks[4].repo,
      mocks[5].repo,
    );

    await fetcher.fetchActiveVulnsWithMeta('p1', ['main', 'master']);

    for (const m of mocks) {
      expect(m.qb.andWhere).toHaveBeenCalledWith('v.branch IN (:...branches)', {
        branches: ['main', 'master'],
      });
    }
  });

  it('does NOT add a branch andWhere when no branch list is provided', async () => {
    const mocks = [
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
    ];
    const fetcher = new ActiveVulnFetcher(
      mocks[0].repo,
      mocks[1].repo,
      mocks[2].repo,
      mocks[3].repo,
      mocks[4].repo,
      mocks[5].repo,
    );

    await fetcher.fetchActiveVulnsWithMeta('p1');

    for (const m of mocks) {
      expect(m.qb.andWhere).not.toHaveBeenCalledWith(
        'v.branch IN (:...branches)',
        expect.anything(),
      );
    }
  });

  it('does NOT add a branch andWhere when an empty branch list is provided', async () => {
    const mocks = [
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
      repoMock([]),
    ];
    const fetcher = new ActiveVulnFetcher(
      mocks[0].repo,
      mocks[1].repo,
      mocks[2].repo,
      mocks[3].repo,
      mocks[4].repo,
      mocks[5].repo,
    );

    await fetcher.fetchActiveVulnsWithMeta('p1', []);

    for (const m of mocks) {
      expect(m.qb.andWhere).not.toHaveBeenCalledWith(
        'v.branch IN (:...branches)',
        expect.anything(),
      );
    }
  });
});
