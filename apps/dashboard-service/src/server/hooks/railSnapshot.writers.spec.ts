import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../services/projectService', () => ({
  fetchProjectsForOrganization: vi.fn(),
}));

vi.mock('./useRealtimeStream', () => ({
  useRealtimeStream: vi.fn(),
}));


vi.mock('@/utils/function/region', () => ({
  getRegionConfig: () => ({ apiUrl: 'https://api.test' }),
}));

import useOrganizationProjects from './useOrganizationProjects';
import { fetchProjectsForOrganization } from '../services/projectService';
import { readKnownProjects, resetRailSnapshot } from '../services/railSnapshot';

const mockedList = fetchProjectsForOrganization as ReturnType<typeof vi.fn>;

/** What global-management puts on the paginated list: EMPTY_MAIN_STATISTICS, a stub of zeros. */
const ZERO_STUB = {
  criticalIssues: 0,
  highIssues: 0,
  mediumIssues: 0,
  lowIssues: 0,
  newIssues: 0,
  newIssuesInLast7Days: 0,
  solvedIssues: 0,
  solvedIssuesInLast7Days: 0,
  highRiskProjects: 0,
  highRiskProjectsInLast7Days: 0,
  criticalRiskProjects: 0,
  criticalRiskProjectsInLast7Days: 0,
  agentAnalysesCount: 0,
  agentAutofixCount: 0,
  agentTriageCount: 0,
  agentFalsePositiveCount: 0,
};

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * The AppSec rail reads the known projects from `railSnapshot`; the project
 * list hook is what writes it. The list also carries a stub of zeros as its
 * `mainStatistics`: nothing of it may reach the rail (a rail
 * block reading it would show « 0 Critical » on an organisation with
 * findings; the snapshot holds no statistics at all).
 */
describe('the writer of railSnapshot', () => {
  beforeEach(() => {
    resetRailSnapshot();
    mockedList.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('notes the projects of a list page, with their team and risk level', async () => {
    mockedList.mockResolvedValueOnce({
      projects: [
        { projectId: 'p-1', name: 'payments-api', teamName: 'Platform', cyberRiskLevel: 'critical' },
        { projectId: 'p-2', name: 'web-storefront', teamName: 'Platform', cyberRiskLevel: 'high' },
      ],
      mainStatistics: ZERO_STUB,
      totalProjects: 2,
      totalPages: 1,
    });

    renderHook(() => useOrganizationProjects('org-1', 10, ''));
    await flushAsync();

    expect([...readKnownProjects('org-1').keys()]).toEqual(['p-1', 'p-2']);
    expect(readKnownProjects('org-1').get('p-1')).toEqual({ id: 'p-1', name: 'payments-api', teamName: 'Platform', riskLevel: 'critical' });
  });

  it('notes nothing when the list fails', async () => {
    mockedList.mockRejectedValueOnce(new Error('503'));

    renderHook(() => useOrganizationProjects('org-1', 10, ''));
    await flushAsync();

    expect(readKnownProjects('org-1').size).toBe(0);
  });
});
