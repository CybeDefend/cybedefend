import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchScaVulnerabilityById } from './resultService';
import gatewayAPI from '@/server/api/gatewayAPI';

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

const sampleCvssExplanation = {
  base: {
    severity: 'critical',
    baseScore: 9.3,
    attackOrigin: 'network',
    attackComplexity: 'low',
    authRequired: 'none',
    userInteraction: 'none',
    confidentialityImpact: 'high',
    integrityImpact: 'high',
    availabilityImpact: 'high',
    hasSubsequentImpact: false,
  },
  environmental: {
    envScore: 9.4,
    baseScore: 9.3,
    scoreDelta: 0.1,
    direction: 'increased',
    drivers: [{ metricKey: 'CR', value: 'H', effect: 'increases' }],
  },
};

describe('fetchScaVulnerabilityById — CVSS explanation propagation', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  afterEach(() => {
    mockedGet.mockReset();
  });

  it('propagates cvssExplanation from the SCA wrapper (detail page shape)', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        isProjectParsed: true,
        sca: {
          base: {
            id: 'vuln-1',
            projectId: 'proj-1',
            currentState: 'to_verify',
            currentSeverity: 'CRITICAL',
            vulnerabilityType: 'sca',
            exploitabilityVerdict: 'proven',
            exploitabilityScore: 0.89,
          },
          library: { id: 'lib-1', packageName: 'lodash' },
          cvssScore: 9.8,
          metadata: { description: 'Path traversal' },
          hasAutofix: true,
          autofixRecords: [],
          cvssExplanation: sampleCvssExplanation,
        },
      },
    });

    const response = await fetchScaVulnerabilityById('proj-1', 'vuln-1');

    expect(response.vulnerability).toBeDefined();
    expect(response.vulnerability.cvssExplanation).toEqual(sampleCvssExplanation);
  });

  it('propagates cvssExplanation from the flat base shape (list page wrapper)', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        isProjectParsed: false,
        base: {
          id: 'vuln-2',
          projectId: 'proj-1',
          currentState: 'to_verify',
          currentSeverity: 'HIGH',
          vulnerabilityType: 'sca',
        },
        library: { id: 'lib-2', packageName: 'spring' },
        cvssScore: 7.5,
        metadata: { description: 'SSRF' },
        cvssExplanation: sampleCvssExplanation,
      },
    });

    const response = await fetchScaVulnerabilityById('proj-1', 'vuln-2');

    expect(response.vulnerability).toBeDefined();
    expect(response.vulnerability.cvssExplanation).toEqual(sampleCvssExplanation);
  });

  it('propagates cvssExplanation from the legacy vulnerability.base shape', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        isProjectParsed: false,
        vulnerability: {
          base: {
            id: 'vuln-3',
            projectId: 'proj-1',
            currentState: 'to_verify',
            currentSeverity: 'MEDIUM',
            vulnerabilityType: 'sca',
          },
          library: { id: 'lib-3', packageName: 'jackson' },
          cvssScore: 5.0,
          metadata: { description: 'XXE' },
          cvssExplanation: sampleCvssExplanation,
        },
      },
    });

    const response = await fetchScaVulnerabilityById('proj-1', 'vuln-3');

    expect(response.vulnerability).toBeDefined();
    expect(response.vulnerability.cvssExplanation).toEqual(sampleCvssExplanation);
  });

  // The SCA detail response carries an is_malware / isMalware flag.
  // The detail mapper must surface it (like the list mapper) so the issue page
  // can hide the CVSS / EPSS / exploitable-path cards for a malicious package.
  it('propagates isMalware=true from the SCA wrapper (detail page shape)', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        isProjectParsed: true,
        sca: {
          base: {
            id: 'vuln-mal',
            projectId: 'proj-1',
            currentState: 'to_verify',
            currentSeverity: 'CRITICAL',
            vulnerabilityType: 'sca',
          },
          library: { id: 'lib-mal', packageName: 'evil-pkg' },
          cvssScore: 0,
          metadata: { id: 'MAL-2026-2705', description: 'Malicious package' },
          isMalware: true,
        },
      },
    });

    const response = await fetchScaVulnerabilityById('proj-1', 'vuln-mal');

    expect(
      (response.vulnerability as { isMalware?: boolean }).isMalware,
    ).toBe(true);
  });

  it('defaults isMalware to false for a normal SCA finding (no flag on the response)', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        isProjectParsed: false,
        sca: {
          base: {
            id: 'vuln-normal',
            projectId: 'proj-1',
            currentState: 'to_verify',
            currentSeverity: 'HIGH',
            vulnerabilityType: 'sca',
          },
          library: { id: 'lib-normal', packageName: 'lodash' },
          cvssScore: 7.5,
          metadata: { cve: 'CVE-2024-1', description: 'SSRF' },
        },
      },
    });

    const response = await fetchScaVulnerabilityById('proj-1', 'vuln-normal');

    expect(
      (response.vulnerability as { isMalware?: boolean }).isMalware,
    ).toBe(false);
  });

  it('leaves cvssExplanation undefined when the backend does not produce it', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        isProjectParsed: false,
        sca: {
          base: {
            id: 'vuln-4',
            projectId: 'proj-1',
            currentState: 'to_verify',
            currentSeverity: 'LOW',
            vulnerabilityType: 'sca',
          },
          library: { id: 'lib-4', packageName: 'foo' },
          cvssScore: 2.0,
          metadata: { description: 'Minor issue' },
          hasAutofix: false,
          autofixRecords: [],
        },
      },
    });

    const response = await fetchScaVulnerabilityById('proj-1', 'vuln-4');

    expect(response.vulnerability).toBeDefined();
    expect(response.vulnerability.cvssExplanation).toBeUndefined();
  });
});
