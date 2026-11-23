import { beforeAll } from 'vitest';
import { readySlots } from '@/edition/slots';
beforeAll(() => readySlots(), 30_000);
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ResultsSastTable } from './ResultsSastTable';

// A results row whose AGENT verdict predates the latest scan of its
// family carries an amber warning badge, so the staleness is visible from the
// list and not only from the detail banner.

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const issue = (id: string, extra: Record<string, unknown>) => ({
  id,
  projectId: 'p-1',
  path: 'src/app.py',
  language: 'Python',
  vulnerableStartLine: 10,
  vulnerableEndLine: 10,
  currentSeverity: 'HIGH',
  currentState: 'to_verify',
  currentPriority: 'normal',
  createdAt: '2026-09-01T00:00:00Z',
  scoringSource: 'agent',
  hasCybeAnalysis: true,
  hasCybeAutofix: false,
  exploitabilityVerdict: 'theoretical',
  vulnerability: { id: `v-${id}`, name: `Finding ${id}`, cvss3: { baseScore: '7.5' }, cwe: [] },
  ...extra,
});

const AGENT_OLD = issue('old', {
  exploitabilitySource: 'agent',
  exploitabilityUpdatedAt: '2026-09-12T10:51:00Z',
});
const AGENT_FRESH = issue('fresh', {
  exploitabilitySource: 'agent',
  exploitabilityUpdatedAt: '2026-09-18T09:45:00Z',
});
const MANUAL_OLD = issue('manual', {
  exploitabilitySource: 'manual',
  exploitabilityUpdatedAt: '2026-09-12T10:51:00Z',
});

const baseProps: any = {
  projectId: 'p-1',
  issues: [AGENT_OLD, AGENT_FRESH, MANUAL_OLD],
  totalIssues: 3,
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

const containerOnlyScan = { scanId: 's-2', state: 'completed', createAt: '2026-09-18T09:30:00Z', scanType: 'container' };

const renderTable = (scanInfo: unknown) =>
  render(
    <MemoryRouter>
      <ResultsSastTable {...baseProps} scanInfo={scanInfo} />
    </MemoryRouter>,
  );

describe('ResultsSastTable — stale agent analysis badge', () => {
  it('flags nothing when the latest scan did not run SAST (container-only scan)', () => {
    renderTable(containerOnlyScan);
    expect(screen.queryByTestId('stale-analysis-badge')).toBeNull();
  });

  it('flags nothing without scan info', () => {
    renderTable(null);
    expect(screen.queryByTestId('stale-analysis-badge')).toBeNull();
  });
});
