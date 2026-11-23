import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The grouped SAST/IaC/CI-CD tables flag an agent analysis from a
// previous scan on each occurrence; the Results templates hand them the
// latest finished scan of the family, like the detailed tables and drawer.

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const { groupedProps, capture } = vi.hoisted(() => {
  const groupedProps = vi.fn();
  const capture = (props: Record<string, unknown>) => {
    groupedProps(props);
    return null;
  };
  return { groupedProps, capture };
});
vi.mock('@/components/organismes/table/grouped-sast-table/GroupedResultsSastTable', () => ({
  GroupedResultsSastTable: capture,
}));
vi.mock('@/components/organismes/table/grouped-iac-table/GroupedResultsIacTable', () => ({
  GroupedResultsIacTable: capture,
}));
vi.mock('@/components/organismes/table/grouped-cicd-table/GroupedResultsCicdTable', () => ({
  GroupedResultsCicdTable: capture,
}));
vi.mock('@/components/organismes/table/sast-table/ResultsSastTable', () => ({ ResultsSastTable: () => null }));
vi.mock('@/components/organismes/table/iac-table/ResultsIacTable', () => ({ ResultsIacTable: () => null }));
vi.mock('@/components/organismes/table/cicd-table/ResultsCicdTable', () => ({ ResultsCicdTable: () => null }));
vi.mock('@/components/organismes/issue-drawer/IssueQuickViewHost', () => ({ default: () => null }));
vi.mock('@/components/molecules/wrapper/AnalyseWrapper', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/molecules/view-mode-toggle/ViewModeToggle', () => ({
  default: () => null,
  ViewModeToggle: () => null,
}));
vi.mock('@/components/molecules/triage-toggle/TriageToggle', () => ({ default: () => null }));

import ResultsSastTemplate from './sast-page/ResultsSastTemplate';
import ResultsIacTemplate from './iac-page/ResultsIacTemplate';
import ResultsCicdTemplate from './cicd-page/ResultsCicdTemplate';

const SCAN_AT = '2026-09-18T09:30:00Z';

const TEMPLATES = [
  ['ResultsSastTemplate', ResultsSastTemplate, 'sast'],
  ['ResultsIacTemplate', ResultsIacTemplate, 'iac'],
  ['ResultsCicdTemplate', ResultsCicdTemplate, 'cicd'],
] as const;

describe.each(TEMPLATES)('%s — grouped view', (_name, Template, family) => {
  beforeEach(() => groupedProps.mockReset());

  const renderGrouped = (scanInfo: unknown) => {
    const props: any = {
      projectId: 'p-1',
      projectName: 'demo',
      viewMode: 'grouped',
      onViewModeChange: vi.fn(),
      groupedVulnerabilities: [],
      totalGroups: 0,
      issues: [],
      scanInfo,
      vulnCounts: {},
      errors: {},
    };
    render(
      <MemoryRouter>
        <Template {...props} />
      </MemoryRouter>,
    );
    return groupedProps.mock.calls[groupedProps.mock.calls.length - 1][0];
  };

  it(`passes the date of the latest finished ${family} scan`, () => {
    const props = renderGrouped({ scanId: 's-1', state: 'completed', createAt: SCAN_AT, scanType: family });
    expect(props.lastScanAt).toBe(SCAN_AT);
  });

  it('passes null while the latest scan is still running', () => {
    const props = renderGrouped({ scanId: 's-1', state: 'running', createAt: SCAN_AT, scanType: family });
    expect(props.lastScanAt).toBeNull();
  });
});
