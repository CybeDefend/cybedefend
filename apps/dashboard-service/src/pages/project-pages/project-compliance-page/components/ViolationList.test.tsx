import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { PolicyViolation } from '@/server/interfaces/Policy';
import ViolationList from './ViolationList';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const violation: PolicyViolation = {
  id: 'viol-1',
  policyId: 'pol-1',
  projectId: 'p1',
  scanId: 's1',
  organizationId: 'org-1',
  actionTaken: 'WARN',
  affectedVulnerabilitiesCount: 2,
  affectedVulnerabilities: [
    { id: 'v9', name: 'SQL injection', severity: 'HIGH', cvssScore: 8, filePath: 'src/db.ts', vulnerabilityType: 'sast' },
    {
      id: 'license-strong_copyleft-r1',
      name: 'GPL-3.0',
      severity: 'MEDIUM',
      cvssScore: 0,
      filePath: 'package.json',
      vulnerabilityType: 'sca',
    },
  ],
  rule: { id: 'r1', name: 'No high', description: '', type: 'severity', value: 'HIGH', action: 'WARN', operator: 'equals' },
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

const LocationProbe: React.FC = () => {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname + search}</div>;
};

const renderList = () =>
  render(
    <MemoryRouter initialEntries={['/appsec/project/p1/compliance']}>
      <Routes>
        <Route
          path="/appsec/project/:projectId/compliance"
          element={
            <ViolationList
              violations={[violation]}
              loading={false}
              error={null}
              currentPage={1}
              totalPages={1}
              totalItems={1}
              pageSize={10}
              onPageChange={vi.fn()}
              onPageSizeChange={vi.fn()}
              onRefresh={vi.fn()}
            />
          }
        />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );

describe('ViolationList — where an affected finding leads', () => {
  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the AppSec finding of a vulnerability', () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Show vulnerabilities' }));
    fireEvent.click(screen.getByText('SQL injection'));
    expect(screen.getByTestId('location').textContent).toBe('/appsec/project/p1/sast/issue/v9');
  });

  it('opens the AppSec licences tab for a licence violation', () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Show vulnerabilities' }));
    fireEvent.click(screen.getByText('GPL-3.0'));
    expect(screen.getByTestId('location').textContent).toBe('/appsec/project/p1/sca?tab=licenses');
  });
});
