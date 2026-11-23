import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { LicenseSummaryResponse } from '@/server/interfaces/Packages';
import ResultsScaLicensesTable from './ResultsScaLicensesTable';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const data: LicenseSummaryResponse = {
  projectId: 'p1',
  totalPackages: 1,
  packagesWithLicenses: 1,
  packagesWithoutLicenses: 0,
  permissiveCount: 0,
  weakCopyleftCount: 0,
  strongCopyleftCount: 1,
  unknownCount: 0,
  ignoredCount: 0,
  licenses: [
    {
      spdxId: 'GPL-3.0-only',
      name: 'GNU General Public License v3.0 only',
      category: 'STRONG_COPYLEFT',
      risk: 'HIGH',
      riskDescription: 'Copyleft',
      count: 1,
    },
  ],
};

const rowHrefs = (container: HTMLElement) =>
  Array.from(new Set(Array.from(container.querySelectorAll('a[data-link-wrapper]')).map((a) => a.getAttribute('href'))));

describe('ResultsScaLicensesTable — where a licence leads', () => {
  it('opens the AppSec page of the licence, keeping the branch and the package types', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/appsec/project/p1/sca']}>
        <Routes>
          <Route
            path="/appsec/project/:projectId/sca"
            element={
              <ResultsScaLicensesTable
                data={data}
                loading={false}
                error={null}
                refresh={vi.fn()}
                selectedBranch="main"
                packageType={['npm']}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(rowHrefs(container)).toEqual(['/appsec/project/p1/sca/license/GPL-3.0-only?branch=main&packageType=npm']);
  });
});
