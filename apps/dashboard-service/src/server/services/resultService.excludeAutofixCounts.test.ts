import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchSastResultsForProject,
  fetchIacResultsForProject,
  fetchCicdResultsForProject,
  fetchSecretResultsForProject,
  fetchScaResultsForProject,
  fetchGroupedSastResults,
  fetchGroupedIacResults,
  fetchGroupedCicdResults,
  fetchGroupedSecretResults,
} from './resultService';
import gatewayAPI from '@/server/api/gatewayAPI';

vi.mock('@/server/api/gatewayAPI', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mockedGet = gatewayAPI.get as unknown as ReturnType<typeof vi.fn>;

const page = {
  data: {
    vulnerabilities: [],
    groupedVulnerabilities: [],
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

const sentParams = () => mockedGet.mock.calls[0]?.[1]?.params as Record<string, unknown>;

type Fetch = (exclude?: boolean) => Promise<unknown>;

// The Results pages ask the lists to leave out the autofix
// counts they never show (five queries fewer per page). The parameter is only
// sent when asked for: the AutoFix page, which reads them, never sets it.
const fetchers: Array<[string, Fetch]> = [
  ['fetchSastResultsForProject', (e) => fetchSastResultsForProject('p', { excludeAutofixCounts: e })],
  ['fetchIacResultsForProject', (e) => fetchIacResultsForProject('p', { excludeAutofixCounts: e })],
  ['fetchCicdResultsForProject', (e) => fetchCicdResultsForProject('p', { excludeAutofixCounts: e })],
  ['fetchSecretResultsForProject', (e) => fetchSecretResultsForProject('p', { excludeAutofixCounts: e })],
  ['fetchScaResultsForProject', (e) => fetchScaResultsForProject('p', { excludeAutofixCounts: e })],
  ['fetchGroupedSastResults', (e) => fetchGroupedSastResults('p', undefined, { excludeAutofixCounts: e })],
  ['fetchGroupedIacResults', (e) => fetchGroupedIacResults('p', undefined, { excludeAutofixCounts: e })],
  ['fetchGroupedCicdResults', (e) => fetchGroupedCicdResults('p', undefined, { excludeAutofixCounts: e })],
  ['fetchGroupedSecretResults', (e) => fetchGroupedSecretResults('p', undefined, { excludeAutofixCounts: e })],
];

describe('resultService excludeAutofixCounts', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedGet.mockResolvedValue(page);
  });

  it.each(fetchers)('%s sends excludeAutofixCounts=true when asked', async (_name, fetch) => {
    await fetch(true);
    expect(sentParams().excludeAutofixCounts).toBe(true);
  });

  it.each(fetchers)('%s sends nothing otherwise', async (_name, fetch) => {
    await fetch(undefined);
    expect(sentParams()).not.toHaveProperty('excludeAutofixCounts');
    mockedGet.mockClear();
    await fetch(false);
    expect(sentParams()).not.toHaveProperty('excludeAutofixCounts');
  });
});
