import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GroupedResultsSastTable } from './grouped-sast-table/GroupedResultsSastTable';
import { GroupedResultsIacTable } from './grouped-iac-table/GroupedResultsIacTable';
import { GroupedResultsCicdTable } from './grouped-cicd-table/GroupedResultsCicdTable';
import { GroupedResultsSecretTable } from './grouped-secret-table/GroupedResultsSecretTable';
import { GroupedResultsScaTable } from './grouped-sca-table/GroupedResultsScaTable';
import { GroupedResultsContainerTable } from './grouped-container-table/GroupedResultsContainerTable';

/*
  Selecting a finding in a grouped table must not shift the cells of its row
  (the path under « Line », the line under « Exploit. »). A selected row that
  carries its marker as a `::before` does: a table row cannot hold a generated
  box without the browser making it one more cell. jsdom lays nothing out, so the guard is twofold:
  the selected row has the same cells, in the same order, as its neighbour
  and as the header, and no row of the table asks for a `::before` / `::after`.
*/

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const breakdown = { critical: 1, high: 1, medium: 0, low: 0 };

const occurrence = (id: string, path: string, line: number) => ({
  id,
  path,
  vulnerableStartLine: line,
  vulnerableEndLine: line,
  currentSeverity: 'CRITICAL',
  currentState: 'to_verify',
  currentPriority: 'urgent',
  exploitabilityVerdict: 'proven',
  hasAutofix: false,
  hasCybeAnalysis: false,
});

const codeGroup = {
  ruleId: 'rule-1',
  vulnerability: { id: 'v-1', name: 'SQL Injection', cwe: ['CWE-89'] },
  occurrences: [occurrence('o-1', 'src/a.ts', 12), occurrence('o-2', 'src/b.ts', 40)],
  occurrenceCount: 2,
  severityBreakdown: breakdown,
  highestSeverity: 'CRITICAL',
  language: 'typescript',
  hasAutofix: false,
  hasCybeAnalysis: false,
  firstSeen: '2026-09-01T00:00:00Z',
  lastSeen: '2026-10-01T00:00:00Z',
};

const scaGroup = {
  cveId: 'CVE-2026-0001',
  packageName: 'lodash',
  vulnerability: { id: 'sv-1', summary: 'Prototype pollution', cve: 'CVE-2026-0001' },
  occurrences: [
    { ...occurrence('o-1', 'package.json', 1), fileName: 'package.json', packageVersion: '4.17.20', isTransitive: false },
    { ...occurrence('o-2', 'web/package.json', 1), fileName: 'package.json', packageVersion: '4.17.19', isTransitive: true },
  ],
  occurrenceCount: 2,
  severityBreakdown: breakdown,
  highestSeverity: 'CRITICAL',
  devCount: 0,
  directCount: 1,
  transitiveCount: 1,
  hasFix: true,
  hasAutofix: false,
  hasCybeAnalysis: false,
  firstSeen: '2026-09-01T00:00:00Z',
  lastSeen: '2026-10-01T00:00:00Z',
};

const containerGroup = {
  packageName: 'openssl',
  packageVersion: '3.0.2',
  packageClass: 'os-pkgs',
  occurrences: [
    { id: 'o-1', vulnerabilityId: 'CVE-2026-1000', currentState: 'to_verify', currentSeverity: 'CRITICAL', currentPriority: 'urgent', fixedVersion: '3.0.3', exploitabilityVerdict: 'proven' },
    { id: 'o-2', vulnerabilityId: 'CVE-2026-1001', currentState: 'to_verify', currentSeverity: 'HIGH', currentPriority: 'high', fixedVersion: '', exploitabilityVerdict: 'theoretical' },
  ],
  occurrenceCount: 2,
  severityBreakdown: breakdown,
  highestSeverity: 'CRITICAL',
  hasFix: true,
  hasCybeAnalysis: false,
  firstSeen: '2026-09-01T00:00:00Z',
  lastSeen: '2026-10-01T00:00:00Z',
};

const common = {
  projectId: 'p-1',
  totalGroups: 1,
  currentPage: 1,
  totalPages: 1,
  pageSize: 10,
  pageSizeOptions: [10, 20],
  onPageChange: vi.fn(),
  onPageSizeChange: vi.fn(),
  selectedSeverity: [],
  selectedStatus: [],
  selectedPriority: [],
  selectedClassType: [],
  selectedOrder: 'currentSeverity',
  selectedOrderDirection: 'desc',
  onSeverityChange: vi.fn(),
  onStatusChange: vi.fn(),
  onPriorityChange: vi.fn(),
  onClassTypeChange: vi.fn(),
  onOrderChange: vi.fn(),
  onOrderDirectionChange: vi.fn(),
  onSearchQueryChange: vi.fn(),
  loading: false,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTable = React.FC<any>;
const TABLES: Array<[string, AnyTable, unknown, string]> = [
  ['SAST', GroupedResultsSastTable, codeGroup, 'SQL Injection'],
  ['IaC', GroupedResultsIacTable, codeGroup, 'SQL Injection'],
  ['CI/CD', GroupedResultsCicdTable, codeGroup, 'SQL Injection'],
  ['Secrets', GroupedResultsSecretTable, codeGroup, 'SQL Injection'],
  ['SCA', GroupedResultsScaTable, scaGroup, 'lodash'],
  ['Container', GroupedResultsContainerTable, containerGroup, 'openssl'],
];

/** A utility that draws a generated box: on a `<tr>` it becomes an extra cell. */
const GENERATED_BOX = /(^|\s)[^\s]*\b(before|after):/;

describe.each(TABLES)('%s grouped table: the selected row', (_name, Table, group, groupTitle) => {
  const renderWithOpenIssue = () =>
    render(
      <MemoryRouter initialEntries={['/appsec/project/p-1/results?issue=o-2']}>
        <Table {...common} groups={[group]} />
      </MemoryRouter>,
    );

  const occurrenceTable = () => {
    // The tables that follow the drawer open its group on their own; the others are opened by hand.
    if (!document.querySelector('tbody tr')) fireEvent.click(screen.getAllByText(groupTitle)[0]);
    const table = document.querySelector('table') as HTMLTableElement;
    expect(table).not.toBeNull();
    return table;
  };

  it('keeps the same cells, in the same order, as the other rows and the header', () => {
    renderWithOpenIssue();
    const table = occurrenceTable();
    const headers = within(table).getAllByRole('columnheader');
    const rows = Array.from(table.querySelectorAll('tbody > tr')) as HTMLTableRowElement[];
    expect(rows).toHaveLength(2);
    const [first, selected] = rows;
    expect(selected.cells).toHaveLength(headers.length);
    expect(selected.cells).toHaveLength(first.cells.length);
    Array.from(selected.cells).forEach((cell, i) => {
      expect(cell.tagName).toBe(first.cells[i].tagName);
      expect(cell.colSpan).toBe(first.cells[i].colSpan);
    });
  });

  it('draws no generated box on a row, the selected one included', () => {
    renderWithOpenIssue();
    const table = occurrenceTable();
    for (const row of Array.from(table.querySelectorAll('tr'))) {
      expect(row.className).not.toMatch(GENERATED_BOX);
    }
  });
});
