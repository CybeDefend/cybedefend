import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ResultsContainerTable } from './ResultsContainerTable';

// Same removal as on the SCA list: the "Scoring Source"
// (All / Static / AI Agent) filter must never appear on the container list —
// even when scoring-source props are forwarded from a stale caller.

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const baseProps: any = {
  projectId: 'p-1',
  issues: [],
  totalIssues: 0,
  currentPage: 1,
  totalPages: 1,
  pageSize: 10,
  pageSizeOptions: [10, 20, 50, 100],
  onPageChange: vi.fn(),
  onPageSizeChange: vi.fn(),
  selectedSeverity: ['critical'],
  selectedStatus: ['to_verify'],
  selectedPriority: ['normal'],
  selectedClassType: ['os-pkgs'],
  selectedExploitability: undefined,
  selectedOrder: 'cvssScore',
  selectedOrderDirection: 'desc',
  onSeverityChange: vi.fn(),
  onStatusChange: vi.fn(),
  onPriorityChange: vi.fn(),
  onClassTypeChange: vi.fn(),
  onOrderChange: vi.fn(),
  onOrderDirectionChange: vi.fn(),
  onSearchQueryChange: vi.fn(),
  // Keep the toolbar rendered so the test asserts the filter is gone from an
  // otherwise-present toolbar, not that the whole toolbar disappeared.
  triageMode: true,
  onTriageModeChange: vi.fn(),
  loading: false,
};

describe('ResultsContainerTable — no Scoring Source filter', () => {
  it('does not render the Scoring Source filter even when scoring-source props are passed', () => {
    // Forwarded via spread of `any` so this test stays type-safe after the
    // scoring-source props are removed from the component interface.
    const scoringProps: any = {
      selectedScoringSource: 'all',
      onScoringSourceChange: vi.fn(),
    };

    render(
      <MemoryRouter>
        <ResultsContainerTable {...baseProps} {...scoringProps} />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole('radio', {
        name: 'components.resultsTable.scoringSourceAgent',
      }),
    ).toBeNull();
    expect(
      screen.queryByText('components.resultsTable.scoringSource'),
    ).toBeNull();
  });
});
