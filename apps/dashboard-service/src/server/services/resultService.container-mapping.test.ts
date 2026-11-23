import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchContainerVulnerabilityById,
  fetchContainerResultsForProject,
} from './resultService';
import gatewayAPI from '@/server/api/gatewayAPI';
import { ContainerVulnerabilityResult } from '@/server/interfaces/Vulnerability';

vi.mock('@/server/api/gatewayAPI', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockedGet = gatewayAPI.get as unknown as ReturnType<typeof vi.fn>;

// Full detail payload as returned by the gateway (gRPC pass-through of
// ContainerVulnerabilityDetection) — every scoring field must survive the
// frontend transform; the old transform hand-picked 11 keys and dropped them.
const detection = {
  id: 'det-1',
  projectId: 'proj-1',
  vulnerabilityIdentifier: 'CVE-2026-8376',
  currentState: 'to_verify',
  currentSeverity: 'critical',
  currentPriority: 'urgent',
  fixedVersion: '',
  branch: 'main',
  createdAt: '2026-06-10T09:26:25.000Z',
  updatedAt: '2026-06-10T09:26:25.000Z',
  package: { id: 'pkg-1', name: 'perl-base', version: '5.32.1', arch: 'amd64' },
  vuln: {
    vulnerabilityId: 'CVE-2026-8376',
    title: 'Perl heap overflow',
    description: 'desc',
    severity: 'critical',
    pkgName: 'perl-base',
    installedVersion: '5.32.1',
    fixedVersion: '',
    target: 'cybedefend-test:latest (debian 11.3)',
    class: 'os-pkgs',
    type: '',
    cvss: {},
    cweIds: ['CWE-787'],
    references: ['https://example.test/advisory'],
  },
  historyItems: { items: [{ id: 'h1', type: 'state', value: 'to_verify' }] },
  scoringSource: 'static',
  cvssScore: 9.8,
  cvss4Vector: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
  cvss4BaseScore: 9.3,
  cvss4EnvironmentalScore: 10,
  cvss4EnvironmentalVector: 'CVSS:4.0/AV:N/.../CR:H',
  epssScore: 0.42,
  epssPercentile: 0.97,
  epssRefreshedAt: '2026-06-10T06:07:00.000Z',
  exploitabilityScore: 0.8,
  exploitabilityVerdict: 'proven',
  exploitabilityReason: 'reachable',
  exploitabilityScoreReason: 'network vector',
  exploitabilitySource: 'agent',
  exploitabilityUpdatedAt: '2026-06-10T08:00:00.000Z',
  priorityScore: 92.5,
  cvssExplanation: { base: { severity: 'critical', baseScore: 9.3 } },
};

describe('fetchContainerVulnerabilityById — scoring fields propagation', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('preserves every scoring/metadata field from the detection', async () => {
    mockedGet.mockResolvedValueOnce({
      data: { isProjectParsed: true, detection },
    });

    const result = await fetchContainerVulnerabilityById('proj-1', 'det-1');
    const v = result.vulnerability as ContainerVulnerabilityResult;

    // Shape-specific mapping still applied.
    expect(v.vulnerabilityType).toBe('container');
    expect(v.vulnerability.vulnerabilityId).toBe('CVE-2026-8376');
    expect(v.package.name).toBe('perl-base');
    expect(v.historyItems).toEqual(detection.historyItems.items);
    expect(v.updateAt).toBe(detection.updatedAt);

    // Scoring fields previously dropped by the transform.
    expect(v.cvssScore).toBe(9.8);
    expect(v.cvss4BaseScore).toBe(9.3);
    expect(v.cvss4Vector).toBe(detection.cvss4Vector);
    expect(v.cvss4EnvironmentalScore).toBe(10);
    expect(v.cvss4EnvironmentalVector).toBe(detection.cvss4EnvironmentalVector);
    expect(v.epssScore).toBe(0.42);
    expect(v.epssPercentile).toBe(0.97);
    expect(v.epssRefreshedAt).toBe(detection.epssRefreshedAt);
    expect(v.scoringSource).toBe('static');
    expect(v.exploitabilityScore).toBe(0.8);
    expect(v.exploitabilityVerdict).toBe('proven');
    expect(v.exploitabilityReason).toBe('reachable');
    expect(v.exploitabilityScoreReason).toBe('network vector');
    expect(v.exploitabilitySource).toBe('agent');
    expect(v.exploitabilityUpdatedAt).toBe(detection.exploitabilityUpdatedAt);
    expect(v.priorityScore).toBe(92.5);
    expect(v.cvssExplanation).toEqual(detection.cvssExplanation);
    expect(v.vulnerabilityIdentifier).toBe('CVE-2026-8376');
    expect(v.fixedVersion).toBe('');
    expect((v as { branch?: string }).branch).toBe('main');
    expect(result.isProjectParsed).toBe(true);
  });

  it('normalizes historyItems when the wrapper is missing', async () => {
    mockedGet.mockResolvedValueOnce({
      data: { detection: { ...detection, historyItems: undefined } },
    });

    const result = await fetchContainerVulnerabilityById('proj-1', 'det-1');
    expect(result.vulnerability.historyItems).toEqual([]);
    expect(result.isProjectParsed).toBe(false);
  });
});

describe('fetchContainerResultsForProject — list scoring fields propagation', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('preserves the scoring fields the list table renders (CVSS + exploitability)', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
        vulnerabilities: [detection],
      },
    });

    const result = await fetchContainerResultsForProject('proj-1');
    const v = result.vulnerabilities[0] as ContainerVulnerabilityResult;

    expect(v.vulnerabilityType).toBe('container');
    expect(v.vulnerability.vulnerabilityId).toBe('CVE-2026-8376');
    expect(v.historyItems).toEqual(detection.historyItems.items);

    // Fields the table columns read — previously dropped by the transform,
    // which made CVSS show "–" and exploitability "Not Evaluated".
    expect(v.cvssScore).toBe(9.8);
    expect(v.cvss4BaseScore).toBe(9.3);
    expect(v.cvss4EnvironmentalScore).toBe(10);
    expect(v.exploitabilityVerdict).toBe('proven');
    expect(v.scoringSource).toBe('static');
    expect(v.priorityScore).toBe(92.5);
    expect(v.epssScore).toBe(0.42);
    expect(v.vulnerabilityIdentifier).toBe('CVE-2026-8376');
    expect(v.fixedVersion).toBe('');
  });
});
