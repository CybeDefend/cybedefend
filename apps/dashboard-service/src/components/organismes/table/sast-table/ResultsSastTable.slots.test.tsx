import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SlotRegistration } from '@/edition/slots';
import { ResultsSastTable } from './ResultsSastTable';

/**
 * The AutoFix control of a results row is not rendered by the core
 * table anymore — it is a `finding.actions` registration of the active
 * edition (the closed tree's, in a private build). With no registration the
 * row shows no AutoFix mark at all; a registration renders once per row and
 * receives the row's vulnerability in its context.
 */

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const { slots } = vi.hoisted(() => ({ slots: { current: [] as SlotRegistration[] } }));
vi.mock('@/edition/active', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/active')>()),
  activeSlots: () => slots.current,
}));

const issue = (id: string, extra: Record<string, unknown> = {}) => ({
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
  scoringSource: 'static',
  hasCybeAnalysis: false,
  hasCybeAutofix: true,
  exploitabilityVerdict: 'theoretical',
  vulnerability: { id: `v-${id}`, name: `Finding ${id}`, cvss3: { baseScore: '7.5' }, cwe: [] },
  ...extra,
});

const baseProps: any = {
  projectId: 'p-1',
  issues: [issue('r-1'), issue('r-2')],
  totalIssues: 2,
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

const renderTable = () =>
  render(
    <MemoryRouter>
      <ResultsSastTable {...baseProps} scanInfo={null} />
    </MemoryRouter>,
  );

describe('ResultsSastTable — the finding.actions slot of a row', () => {
  it('without a registration the row has no AutoFix control', () => {
    slots.current = [];
    renderTable();
    expect(screen.queryByTitle('Cybe Autofix')).toBeNull();
    expect(screen.queryByLabelText('Cybe Autofix')).toBeNull();
  });

  it('a finding.actions registration renders once per row with the row’s vulnerability in its context', () => {
    slots.current = [
      {
        slot: 'finding.actions',
        id: 'a',
        order: 1,
        render: (ctx) => <span data-testid="a">{(ctx.vulnerability as { id: string }).id}</span>,
      },
    ];
    renderTable();
    const marks = screen.getAllByTestId('a');
    expect(marks.map((m) => m.textContent)).toEqual(['r-1', 'r-2']);
  });
});
