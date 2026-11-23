import { In, Not, Repository } from 'typeorm';
import { ReportAggregationService } from './report-aggregation.service';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from '../../entities/container_vulnerability_detections.entity';
import { VulnerabilityDetectionHistory } from '../../entities/vulnerability-detection-history.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';

// Minimal repo mock exposing only `find`, which is all the aggregation uses.
type RepoMock = { find: jest.Mock };

const makeRepo = (): RepoMock => ({ find: jest.fn().mockResolvedValue([]) });

const asRepo = <T>(m: RepoMock): Repository<T> => m as unknown as Repository<T>;

const sastRow = (
  over: Partial<SastVulnerabilityDetections>,
): SastVulnerabilityDetections =>
  ({
    id: 'sast',
    currentSeverity: 'critical',
    effectiveSeverity: null,
    currentState: 'to_verify',
    createdAt: new Date(),
    path: 'file.ts',
    ...over,
  }) as SastVulnerabilityDetections;

describe('ReportAggregationService — muted states are excluded from reports', () => {
  let service: ReportAggregationService;
  let sast: RepoMock;
  let iac: RepoMock;
  let sca: RepoMock;
  let container: RepoMock;
  let history: RepoMock;
  let secret: RepoMock;
  let cicd: RepoMock;

  beforeEach(() => {
    sast = makeRepo();
    iac = makeRepo();
    sca = makeRepo();
    container = makeRepo();
    history = makeRepo();
    secret = makeRepo();
    cicd = makeRepo();
    service = new ReportAggregationService(
      asRepo<SastVulnerabilityDetections>(sast),
      asRepo<IacVulnerabilityDetections>(iac),
      asRepo<ScaVulnerabilityDetections>(sca),
      asRepo<VulnerabilityDetectionsContainer>(container),
      asRepo<VulnerabilityDetectionHistory>(history),
      asRepo<SecretVulnerabilityDetections>(secret),
      asRepo<CicdVulnerabilityDetections>(cicd),
    );
  });

  // Every finding type the instance stores reaches the reports: a project
  // whose only open findings are leaked secrets or CI/CD issues is not a
  // project with nothing to report.
  describe('secret and CI/CD findings', () => {
    const row = (id: string, over: Record<string, unknown> = {}) =>
      ({
        id,
        currentSeverity: 'critical',
        effectiveSeverity: null,
        currentState: 'to_verify',
        createdAt: new Date(),
        path: `${id}.yml`,
        vulnerability: { name: `${id} rule` },
        ...over,
      }) as never;

    beforeEach(() => {
      secret.find.mockResolvedValue([
        row('secret-open'),
        row('secret-ignored', { currentState: 'ignored' }),
      ]);
      cicd.find.mockResolvedValue([
        row('cicd-open', { currentSeverity: 'high' }),
      ]);
    });

    it('weekly: counts them in the total, the severities and the recent list', async () => {
      const res = await service.aggregateWeekly('p1', 'Proj');

      expect(res.total).toBe(2);
      expect(res.severities).toEqual({
        critical: 1,
        high: 1,
        medium: 0,
        low: 0,
      });
      expect(res.topRecent.map((v) => v.id).sort()).toEqual([
        'cicd-open',
        'secret-open',
      ]);
      expect(res.topRecent.find((v) => v.id === 'secret-open')).toMatchObject({
        type: 'SECRET',
        title: 'secret-open rule',
      });
      expect(res.topRecent.find((v) => v.id === 'cicd-open')?.type).toBe(
        'CICD',
      );
    });

    // The secret and CI/CD tables can hold many triaged rows: the muted
    // states are left out by the query itself, not loaded and dropped.
    it('reads only the reportable rows of the secret and CI/CD tables', async () => {
      await service.aggregateWeekly('p1', 'Proj');

      const reportable = {
        projectId: 'p1',
        currentState: Not(In(['ignored', 'resolved', 'not_exploitable'])),
      };
      for (const repo of [secret, cicd]) {
        expect(repo.find).toHaveBeenCalledTimes(1);
        expect(repo.find.mock.calls[0][0].where).toEqual(reportable);
      }
    });

    it('monthly: counts them in the total', async () => {
      const res = await service.aggregateMonthly('p1', 'Proj');

      expect(res.total).toBe(2);
    });

    it('daily critical: alerts on a new critical secret', async () => {
      const res = await service.aggregateDailyCritical('p1', 'Proj');

      expect(res.criticals.map((v) => v.id)).toEqual(['secret-open']);
    });
  });

  describe('aggregateDailyCritical', () => {
    it('excludes ignored / resolved / not_exploitable criticals, keeps active ones', async () => {
      sast.find.mockResolvedValue([
        sastRow({ id: 'active-to-verify', currentState: 'to_verify' }),
        sastRow({ id: 'active-confirmed', currentState: 'confirmed' }),
        sastRow({ id: 'muted-ignored', currentState: 'ignored' }),
        sastRow({ id: 'muted-resolved', currentState: 'resolved' }),
        sastRow({
          id: 'muted-not-exploitable',
          currentState: 'not_exploitable',
        }),
      ]);

      const res = await service.aggregateDailyCritical('p1', 'Proj');

      expect(res.criticals.map((c) => c.id).sort()).toEqual(
        ['active-confirmed', 'active-to-verify'].sort(),
      );
    });
  });

  describe('aggregateWeekly', () => {
    it('does not count muted vulnerabilities in totals, severities, types or topRecent', async () => {
      sast.find.mockResolvedValue([
        sastRow({ id: 'active', currentState: 'to_verify' }),
        sastRow({ id: 'ignored', currentState: 'ignored' }),
        sastRow({
          id: 'resolved-high',
          currentState: 'resolved',
          currentSeverity: 'high',
        }),
      ]);

      const res = await service.aggregateWeekly('p1', 'Proj');

      expect(res.total).toBe(1);
      expect(res.severities.critical).toBe(1);
      expect(res.severities.high).toBe(0);
      expect(res.types.sast).toBe(1);
      expect(res.topRecent.map((v) => v.id)).toEqual(['active']);
    });
  });

  describe('aggregateMonthly', () => {
    it('does not count muted vulnerabilities in totals, severities or types', async () => {
      sast.find.mockResolvedValue([
        sastRow({ id: 'active', currentState: 'confirmed' }),
        sastRow({ id: 'ignored', currentState: 'ignored' }),
      ]);

      const res = await service.aggregateMonthly('p1', 'Proj');

      expect(res.total).toBe(1);
      expect(res.severities.critical).toBe(1);
      expect(res.types.sast).toBe(1);
    });
  });

  // An archived branch is one the customer no longer ships: its findings stay
  // in the database but no report or alert counts them.
  describe('findings of archived branches are left out', () => {
    const archived: ReadonlySet<string> = new Set(['release/1.0']);

    beforeEach(() => {
      sast.find.mockResolvedValue([
        sastRow({ id: 'live', currentState: 'to_verify', branch: 'main' }),
        sastRow({
          id: 'archived',
          currentState: 'to_verify',
          branch: 'release/1.0',
        }),
        sastRow({ id: 'no-branch', currentState: 'to_verify', branch: null }),
      ]);
    });

    it('aggregateDailyCritical', async () => {
      const res = await service.aggregateDailyCritical('p1', 'Proj', archived);

      expect(res.criticals.map((c) => c.id).sort()).toEqual([
        'live',
        'no-branch',
      ]);
    });

    it('aggregateWeekly', async () => {
      const res = await service.aggregateWeekly('p1', 'Proj', archived);

      expect(res.total).toBe(2);
      expect(res.severities.critical).toBe(2);
      expect(res.types.sast).toBe(2);
      expect(res.newLast7d).toBe(2);
      expect(res.topRecent.map((v) => v.id).sort()).toEqual([
        'live',
        'no-branch',
      ]);
    });

    it('aggregateMonthly', async () => {
      const res = await service.aggregateMonthly('p1', 'Proj', archived);

      expect(res.total).toBe(2);
      expect(res.newLast30d).toBe(2);
      expect(res.topCriticalPerType.sast.map((v) => v.id).sort()).toEqual([
        'live',
        'no-branch',
      ]);
    });

    it('counts every branch when none is archived', async () => {
      const res = await service.aggregateWeekly('p1', 'Proj');

      expect(res.total).toBe(3);
    });
  });

  // The detection branch must be carried onto every aggregated
  // vulnerability so the report mails can show which branch each vuln was found
  // on (daily critical grouping + weekly/monthly per-row chip).
  describe('branch is carried onto aggregated vulnerabilities', () => {
    it('aggregateDailyCritical exposes the detection branch on each critical', async () => {
      sast.find.mockResolvedValue([
        sastRow({ id: 'a', currentState: 'to_verify', branch: 'main' }),
        sastRow({ id: 'b', currentState: 'confirmed', branch: 'dev' }),
      ]);

      const res = await service.aggregateDailyCritical('p1', 'Proj');

      const byId = Object.fromEntries(
        res.criticals.map((c) => [c.id, (c as any).branch]),
      );
      expect(byId['a']).toBe('main');
      expect(byId['b']).toBe('dev');
    });

    it('aggregateWeekly carries the branch onto topRecent entries', async () => {
      sast.find.mockResolvedValue([
        sastRow({
          id: 'active',
          currentState: 'to_verify',
          branch: 'release/1.2',
        }),
      ]);

      const res = await service.aggregateWeekly('p1', 'Proj');

      expect((res.topRecent[0] as any).branch).toBe('release/1.2');
    });

    it('leaves branch undefined when the detection has no branch', async () => {
      sast.find.mockResolvedValue([
        sastRow({ id: 'a', currentState: 'to_verify', branch: null as any }),
      ]);

      const res = await service.aggregateDailyCritical('p1', 'Proj');

      expect((res.criticals[0] as any).branch ?? undefined).toBeUndefined();
    });
  });
});
