import { beforeAll } from 'vitest';
import { readySlots } from '@/edition/slots';
beforeAll(() => readySlots(), 30_000);
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GroupedResultsSastTable } from './grouped-sast-table/GroupedResultsSastTable';
import { GroupedResultsIacTable } from './grouped-iac-table/GroupedResultsIacTable';
import { GroupedResultsCicdTable } from './grouped-cicd-table/GroupedResultsCicdTable';

// In the grouped view too, an occurrence whose AGENT verdict
// predates the latest scan of its family (or the security context) carries
// the amber badge of the detailed rows.

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const occurrence = (id: string, extra: Record<string, unknown>): Record<string, unknown> => ({
  id,
  path: `src/${id}.py`,
  vulnerableStartLine: 10,
  vulnerableEndLine: 10,
  currentState: 'to_verify',
  currentSeverity: 'high',
  currentPriority: 'normal',
  createdAt: '2026-09-01T00:00:00Z',
  hasAutofix: false,
  hasCybeAnalysis: true,
  exploitabilityVerdict: 'theoretical',
  ...extra,
});

const group = (occurrences: ReturnType<typeof occurrence>[]) => ({
  ruleId: 'rule-1',
  vulnerability: { id: 'rule-1', name: 'Command Injection', cwe: [] },
  occurrenceCount: occurrences.length,
  severityBreakdown: { critical: 0, high: occurrences.length, medium: 0, low: 0 },
  highestSeverity: 'high',
  language: 'Python',
  occurrences,
  hasAutofix: false,
  firstSeen: '2026-09-01T00:00:00Z',
  lastSeen: '2026-09-01T00:00:00Z',
  hasCybeAnalysis: true,
});

const AGENT_OLD = occurrence('agent-old', {
  exploitabilitySource: 'agent',
  exploitabilityUpdatedAt: '2026-09-12T10:51:00Z',
});

const baseProps: any = {
  projectId: 'p-1',
  totalGroups: 1,
  currentPage: 1,
  totalPages: 1,
  pageSize: 10,
  pageSizeOptions: [10, 20, 50, 100],
  onPageChange: vi.fn(),
  onPageSizeChange: vi.fn(),
  selectedSeverity: [],
  selectedStatus: [],
  selectedPriority: [],
  selectedOrder: 'occurrenceCount',
  selectedOrderDirection: 'desc',
  onSeverityChange: vi.fn(),
  onStatusChange: vi.fn(),
  onPriorityChange: vi.fn(),
  onOrderChange: vi.fn(),
  onOrderDirectionChange: vi.fn(),
  onSearchQueryChange: vi.fn(),
  loading: false,
};

const TABLES = [
  ['GroupedResultsSastTable', GroupedResultsSastTable],
  ['GroupedResultsIacTable', GroupedResultsIacTable],
  ['GroupedResultsCicdTable', GroupedResultsCicdTable],
] as const;

describe.each(TABLES)('%s — stale agent analysis badge', (_name, Table) => {
  const renderExpanded = (occurrences: ReturnType<typeof occurrence>[], lastScanAt: string | null) => {
    render(
      <MemoryRouter>
        <Table {...baseProps} groups={[group(occurrences)]} lastScanAt={lastScanAt} />
      </MemoryRouter>,
    );
    // Groups start collapsed: open the category to reveal its occurrences.
    fireEvent.click(screen.getByText('Command Injection'));
  };

  it('flags nothing when the latest scan date is unknown', () => {
    renderExpanded([AGENT_OLD], null);
    expect(screen.queryByTestId('stale-analysis-badge')).toBeNull();
  });
});
