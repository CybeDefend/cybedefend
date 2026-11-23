import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import LicenseDetailPage from './LicenseDetailPage';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('@/server/hooks/usePackagesByLicense', () => ({
  default: () => ({ data: null, loading: true, error: null, refresh: vi.fn() }),
}));
vi.mock('@/server/services/resultService', () => ({
  assignPackageLicense: vi.fn(),
  setPackageLicenseIgnored: vi.fn(),
}));
vi.mock('@/server/services/licenseService', () => ({ fetchLicenseClassifications: vi.fn() }));

const store = configureStore({ reducer: () => ({ organization: { selectedOrganization: { id: 'org-1' } } }) });

describe('LicenseDetailPage — the way back', () => {
  it('goes back to the licences tab of the AppSec SCA page', () => {
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/appsec/project/p1/sca/license/MIT']}>
          <Routes>
            <Route path="/appsec/project/:projectId/sca/license/:spdxId" element={<LicenseDetailPage />} />
          </Routes>
        </MemoryRouter>
      </Provider>,
    );

    expect(screen.getByRole('link', { name: 'Back to licenses' })).toHaveAttribute(
      'href',
      '/appsec/project/p1/sca?tab=licenses',
    );
  });
});
