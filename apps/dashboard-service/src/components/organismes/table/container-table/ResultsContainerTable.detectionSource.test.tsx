import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ResultsContainerTable } from './ResultsContainerTable';
import { ContainerVulnerabilityResult } from '@/server/interfaces/Vulnerability';

// The container list shows which detections CybeDefend added from
// the OSV database (package inventory matching) versus those the scanner pod
// reported itself.

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const issue = (id: string, detectionSource: 'scanner' | 'osv'): ContainerVulnerabilityResult =>
  ({
    id,
    projectId: 'p-1',
    vulnerabilityType: 'container',
    vulnerabilityIdentifier: `CVE-2026-${id}`,
    currentState: 'to_verify',
    currentSeverity: 'high',
    currentPriority: 'urgent',
    fixedVersion: '1.36.1-r9',
    branch: 'main',
    createdAt: '2026-09-10T11:00:00.000Z',
    updateAt: '2026-09-10T11:00:00.000Z',
    package: { id: `pkg-${id}`, name: 'busybox', version: '1.36.1-r7', arch: 'x86_64' },
    vulnerability: {
      vulnerabilityId: `CVE-2026-${id}`,
      title: 'busybox overflow',
      description: '',
      severity: 'high',
      pkgName: 'busybox',
      installedVersion: '1.36.1-r7',
      fixedVersion: '1.36.1-r9',
      target: 'alpine (alpine 3.18.12)',
      class: 'os-pkgs',
      type: 'alpine',
      cvss: {},
      cweIds: [],
      references: [],
    },
    historyItems: [],
    scoringSource: 'static',
    detectionSource,
    cvssScore: 7.5,
    cvss4BaseScore: 7.5,
  }) as unknown as ContainerVulnerabilityResult;

const baseProps: any = {
  projectId: 'p-1',
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
  selectedClassType: [],
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
  triageMode: false,
  onTriageModeChange: vi.fn(),
  loading: false,
};

describe('ResultsContainerTable — detection source', () => {
  it('flags the OSV-matched row and only that one', () => {
    render(
      <MemoryRouter>
        <ResultsContainerTable
          {...baseProps}
          issues={[issue('1', 'scanner'), issue('2', 'osv')]}
        />
      </MemoryRouter>,
    );

    const badges = screen.getAllByLabelText('Matched by CybeDefend (OSV)');
    expect(badges).toHaveLength(1);
    expect(badges[0].closest('tr')).toHaveTextContent('CVE-2026-2');
  });
});
