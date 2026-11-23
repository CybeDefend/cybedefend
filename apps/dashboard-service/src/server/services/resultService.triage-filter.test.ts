import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchSastResultsForProject,
  fetchScaResultsForProject,
  fetchIacResultsForProject,
  fetchCicdResultsForProject,
  fetchSecretResultsForProject,
  fetchContainerResultsForProject,
} from './resultService';
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

const emptyPage = {
  data: {
    vulnerabilities: [],
    total: 0,
    totalPages: 0,
    page: 1,
    limit: 10,
    projectName: 'p',
    scanProjectInfo: null,
    vulnCountByType: { sast: 0, iac: 0, cicd: 0, secret: 0, sca: 0, container: 0 },
    isProjectParsed: false,
  },
};

const lastCallParams = () => {
  const call = mockedGet.mock.calls[0];
  return call?.[1]?.params as Record<string, any>;
};

describe('resultService triage exploitability filter wiring', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedGet.mockResolvedValue(emptyPage);
  });
  afterEach(() => {
    mockedGet.mockReset();
  });

  // SAST
  it('fetchSastResultsForProject sends exploitabilityVerdict (not exploitability)', async () => {
    await fetchSastResultsForProject('p', {
      exploitability: ['actively_exploited', 'proven', 'theoretical'],
    });
    const params = lastCallParams();
    expect(params.exploitabilityVerdict).toEqual([
      'actively_exploited',
      'proven',
      'theoretical',
    ]);
    expect(params.exploitability).toBeUndefined();
  });

  it('fetchSastResultsForProject strips the not_evaluated frontend sentinel', async () => {
    await fetchSastResultsForProject('p', {
      exploitability: ['actively_exploited', 'proven', 'not_evaluated'],
    });
    const params = lastCallParams();
    expect(params.exploitabilityVerdict).toEqual(['actively_exploited', 'proven']);
  });

  it('fetchSastResultsForProject omits the filter when all backend verdicts are selected', async () => {
    // Default "everything selected" must not narrow the backend result, so NULL verdicts stay.
    await fetchSastResultsForProject('p', {
      exploitability: [
        'actively_exploited',
        'proven',
        'theoretical',
        'not_exploitable',
        'not_evaluated',
      ],
    });
    expect(lastCallParams().exploitabilityVerdict).toBeUndefined();
  });

  // SCA
  it('fetchScaResultsForProject sends exploitabilityVerdict (not exploitability)', async () => {
    await fetchScaResultsForProject('p', {
      exploitability: ['actively_exploited', 'proven'],
    });
    const params = lastCallParams();
    expect(params.exploitabilityVerdict).toEqual(['actively_exploited', 'proven']);
    expect(params.exploitability).toBeUndefined();
  });

  // IAC — filter must reach the backend
  it('fetchIacResultsForProject forwards exploitability as exploitabilityVerdict', async () => {
    await fetchIacResultsForProject('p', {
      exploitability: ['actively_exploited', 'proven'],
    });
    expect(lastCallParams().exploitabilityVerdict).toEqual([
      'actively_exploited',
      'proven',
    ]);
  });

  // CICD
  it('fetchCicdResultsForProject forwards exploitability as exploitabilityVerdict', async () => {
    await fetchCicdResultsForProject('p', {
      exploitability: ['proven'],
    });
    expect(lastCallParams().exploitabilityVerdict).toEqual(['proven']);
  });

  // Secret
  it('fetchSecretResultsForProject forwards exploitability as exploitabilityVerdict', async () => {
    await fetchSecretResultsForProject('p', {
      exploitability: ['proven'],
    });
    expect(lastCallParams().exploitabilityVerdict).toEqual(['proven']);
  });

  // Container
  it('fetchContainerResultsForProject forwards exploitability as exploitabilityVerdict', async () => {
    await fetchContainerResultsForProject('p', {
      exploitability: ['actively_exploited'],
    });
    expect(lastCallParams().exploitabilityVerdict).toEqual(['actively_exploited']);
  });
});
