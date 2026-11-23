import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The results tables show the tickets of both tools in one
 * « Tickets » column (a list) or in the group header (a grouped view), as
 * soon as one tool can take a ticket for the project: Jira configured for it,
 * or Linear connected to the organisation. Before, the column was « Jira »
 * and appeared only with a Jira configuration, which the Container page never
 * passed down.
 */

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('@/server/api/gatewayAPI', () => ({ default: {} }));

import { ResultsSastTable } from '@/components/organismes/table/sast-table/ResultsSastTable';
import { ResultsContainerTable } from '@/components/organismes/table/container-table/ResultsContainerTable';
import { GroupedResultsScaTable } from '@/components/organismes/table/grouped-sca-table/GroupedResultsScaTable';
import type { IssueTracking } from '@/server/hooks/useIssueTracking';
import type { GroupedScaVulnerability } from '@/server/interfaces/Vulnerability';

const tracking = (over: Partial<IssueTracking> = {}): IssueTracking => ({
  organizationId: 'org-1',
  ticketsByVulnerability: new Map(),
  jira: { configured: false, allowedBranches: [] },
  linear: { connected: false, configured: false, allowedBranches: [] },
  anyConfigured: false,
  refresh: vi.fn().mockResolvedValue(undefined),
  ...over,
});

const NONE = tracking();
const LINEAR_ONLY = tracking({
  linear: { connected: true, configured: false, allowedBranches: [] },
  anyConfigured: true,
});
const JIRA_AND_LINEAR = tracking({
  jira: { configured: true, projectKey: 'KAN', allowedBranches: [] },
  linear: { connected: true, configured: false, allowedBranches: [] },
  anyConfigured: true,
});

/** What every results table takes besides its rows. */
const listProps: any = {
  projectId: 'p-1',
  currentPage: 1,
  totalPages: 1,
  pageSize: 10,
  pageSizeOptions: [10, 20, 50, 100],
  onPageChange: vi.fn(),
  onPageSizeChange: vi.fn(),
  selectedSeverity: [],
  selectedStatus: [],
  selectedPriority: [],
  selectedOrder: 'currentSeverity',
  selectedOrderDirection: 'desc',
  onSeverityChange: vi.fn(),
  onStatusChange: vi.fn(),
  onPriorityChange: vi.fn(),
  onOrderChange: vi.fn(),
  onOrderDirectionChange: vi.fn(),
  onSearchQueryChange: vi.fn(),
  loading: false,
};

const sastIssue = {
  id: 'sast-1',
  projectId: 'p-1',
  path: 'src/app.py',
  language: 'Python',
  vulnerableStartLine: 10,
  vulnerableEndLine: 10,
  currentSeverity: 'HIGH',
  currentState: 'to_verify',
  currentPriority: 'normal',
  createdAt: '2026-09-01T00:00:00Z',
  vulnerability: { id: 'v-sast-1', name: 'SQL injection', cvss3: { baseScore: '7.5' }, cwe: [] },
};

const containerIssue = {
  id: 'det-1',
  projectId: 'p-1',
  createdAt: '2026-06-10T09:26:25.000Z',
  updateAt: '2026-06-10T09:26:25.000Z',
  currentState: 'to_verify',
  currentSeverity: 'CRITICAL',
  currentPriority: 'urgent',
  vulnerabilityIdentifier: 'CVE-2026-8376',
  vulnerability: { vulnerabilityId: 'CVE-2026-8376', class: 'os-pkgs', fixedVersion: '' },
  package: { id: 'pkg-1', name: 'perl-base', version: '5.32.1' },
};

const scaGroup: GroupedScaVulnerability = {
  cveId: 'CVE-2026-1234',
  packageName: 'lodash',
  vulnerability: { summary: 'Prototype pollution in lodash' } as GroupedScaVulnerability['vulnerability'],
  occurrences: [
    { id: 'sca-1', path: 'package.json', packageVersion: '4.17.20', currentState: 'to_verify', currentSeverity: 'HIGH', currentPriority: 'normal', createdAt: '2026-09-01', isTransitive: false },
    { id: 'sca-2', path: 'web/package.json', packageVersion: '4.17.19', currentState: 'to_verify', currentSeverity: 'HIGH', currentPriority: 'normal', createdAt: '2026-09-01', isTransitive: true },
  ],
  occurrenceCount: 2,
  severityBreakdown: { critical: 0, high: 2, medium: 0, low: 0 },
  highestSeverity: 'HIGH',
  devCount: 0,
  directCount: 1,
  transitiveCount: 1,
  hasFix: true,
  hasAutofix: false,
  hasCybeAnalysis: false,
  firstSeen: '2026-09-01',
  lastSeen: '2026-09-01',
};

const inRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('Results tables — ticket tracking', () => {
  it('the SAST table shows a Tickets column when Linear alone is configured', () => {
    inRouter(<ResultsSastTable {...listProps} issues={[sastIssue]} totalIssues={1} issueTracking={LINEAR_ONLY} />);

    expect(screen.getByRole('columnheader', { name: 'Tickets' })).toBeInTheDocument();
    const row = screen.getByText('SQL injection').closest('tr') as HTMLElement;
    expect(within(row).getByAltText('Linear')).toBeInTheDocument();
    expect(within(row).queryByAltText('Jira')).toBeNull();
  });

  it('the SAST table has no Tickets column when no tool can take a ticket', () => {
    inRouter(<ResultsSastTable {...listProps} issues={[sastIssue]} totalIssues={1} issueTracking={NONE} />);

    expect(screen.queryByRole('columnheader', { name: 'Tickets' })).toBeNull();
    expect(screen.queryByAltText('Linear')).toBeNull();
  });

  it('the grouped SCA header shows the tracker for Jira and Linear', () => {
    inRouter(
      <GroupedResultsScaTable
        {...listProps}
        groups={[scaGroup]}
        totalGroups={1}
        issueTracking={JIRA_AND_LINEAR}
      />,
    );

    expect(screen.getByAltText('Jira')).toBeInTheDocument();
    expect(screen.getByAltText('Linear')).toBeInTheDocument();
  });

  it('the container table shows the tracker', () => {
    inRouter(
      <ResultsContainerTable
        {...listProps}
        issues={[containerIssue]}
        totalIssues={1}
        selectedClassType={[]}
        onClassTypeChange={vi.fn()}
        selectedOrder="cvssScore"
        issueTracking={JIRA_AND_LINEAR}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'Tickets' })).toBeInTheDocument();
    const row = screen.getByText('perl-base').closest('tr') as HTMLElement;
    expect(within(row).getByAltText('Jira')).toBeInTheDocument();
    expect(within(row).getByAltText('Linear')).toBeInTheDocument();
  });
});
