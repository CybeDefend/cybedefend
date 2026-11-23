import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The SCA table of the Community Edition: no extension adds a column or a row
 * badge (`EMPTY_EXTENSIONS`), so the EPSS column and the malware badge are not
 * there, whatever the browser remembers from a cloud session.
 */
vi.mock('@/edition/active', async (importOriginal) => {
  const { EMPTY_EXTENSIONS } = await import('@/edition/extensions');
  return {
    ...(await importOriginal<typeof import('@/edition/active')>()),
    activeSlots: () => [],
    activeExtensions: () => EMPTY_EXTENSIONS,
    ACTIVE_SLOTS: [],
    ACTIVE_EXTENSIONS: EMPTY_EXTENSIONS,
  };
});
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
/**
 * A SARIF import carries no dependency analysis, so the Community Edition
 * renders no reachability badge. The table reads `EDITION` once at
 * load: the cloud case below re-imports it under the cloud edition.
 */
const ed = vi.hoisted(() => ({ edition: 'community' as string }));
// Each edition case re-imports its module tree after vi.resetModules(), slow under a parallel run.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));

import { translate as t } from '@/test/i18n-mock';
import { ResultsScaTable } from './ResultsScaTable';

const issue: any = {
  id: 'occ-1',
  isMalware: true,
  currentSeverity: 'CRITICAL',
  createdAt: '2026-07-01',
  exploitabilityVerdict: 'malicious',
  epssPercentile: 0.97,
  vulnerability: { id: 'MAL-2026-2705', cve: 'CVE-2026-1', packages: [] },
  package: { packageName: 'evil-pkg', fileName: 'package.json', reachability: 'used' },
};

const baseProps: any = {
  projectId: 'p',
  issues: [issue],
  totalIssues: 1,
  currentPage: 1,
  totalPages: 1,
  pageSize: 10,
  pageSizeOptions: [10, 20, 50, 100],
  onPageChange: vi.fn(),
  onPageSizeChange: vi.fn(),
  selectedSeverity: [],
  selectedStatus: [],
  selectedPriority: [],
  selectedPackageTypeVuln: [],
  selectedOrder: 'currentSeverity',
  selectedOrderDirection: 'desc',
  onSeverityChange: vi.fn(),
  onStatusChange: vi.fn(),
  onPriorityChange: vi.fn(),
  onPackageTypeVulnChange: vi.fn(),
  onOrderChange: vi.fn(),
  onOrderDirectionChange: vi.fn(),
  onSearchQueryChange: vi.fn(),
  loading: false,
  includeDevAndTest: true,
};

const renderTable = (props: Record<string, unknown> = {}) =>
  render(
    <MemoryRouter>
      <ResultsScaTable {...baseProps} {...props} />
    </MemoryRouter>,
  );

beforeEach(() => localStorage.clear());

describe('ResultsScaTable in the Community Edition', () => {
  it('no EPSS header, cell or column-settings item, even with showEpssColumnSca_p = true', () => {
    localStorage.setItem('showEpssColumnSca_p', 'true');
    renderTable();
    expect(screen.queryByText(t('components.resultsTable.epss'))).not.toBeInTheDocument();
    expect(screen.queryByText(t('components.resultsTable.showEpssColumn'))).not.toBeInTheDocument();
    expect(screen.queryByText('97%')).not.toBeInTheDocument();
    expect(screen.getByText(t('components.resultsScaTable.cvss'))).toBeInTheDocument();
  });

  it('a row with isMalware shows no malware badge', () => {
    renderTable();
    expect(screen.queryByText(t('components.resultsScaTemplate.malwareBadge'))).not.toBeInTheDocument();
  });

  it('the empty-state row spans the core columns only', () => {
    const { container } = renderTable({ issues: [], totalIssues: 0 });
    const cell = container.querySelector('tbody td[colspan]');
    expect(cell?.getAttribute('colspan')).toBe('6');
    expect(container.querySelectorAll('thead th')).toHaveLength(6);
  });
});

const REACHABILITY_USED = () => t('pages.issuePage.sca.reachability.used');

const loadTable = async (edition: string) => {
  ed.edition = edition;
  vi.resetModules();
  return (await import('./ResultsScaTable')).ResultsScaTable;
};

describe('ResultsScaTable reachability, by edition', () => {
  it('community: a row whose package is used shows no reachability badge', async () => {
    const Table = await loadTable('community');
    render(
      <MemoryRouter>
        <Table {...baseProps} />
      </MemoryRouter>,
    );
    expect(screen.getByText('evil-pkg')).toBeInTheDocument();
    expect(screen.queryByLabelText(REACHABILITY_USED())).not.toBeInTheDocument();
  });

  it('cloud: the same row shows the reachability badge', async () => {
    const Table = await loadTable('cloud');
    render(
      <MemoryRouter>
        <Table {...baseProps} />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(REACHABILITY_USED())).toBeInTheDocument();
  });
});
