import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  install: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => h.navigate };
});
vi.mock('@/components/atoms/loader/LoaderHome', () => ({ default: () => <div data-testid="loader" /> }));
vi.mock('@/server/services/integrations/githubIntegrationsService', () => ({
  installGithubIntegration: (...args: unknown[]) => h.install(...args),
}));
vi.mock('react-toastify', () => ({ toast: { error: h.toastError, success: h.toastSuccess } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import { IntegrationGithubPage } from './IntegrationGithubPage';

const makeStore = () =>
  configureStore({
    reducer: {
      organization: () => ({ selectedOrganization: { id: 'org-1' } }),
      app: () => ({ isAppInitialized: true, isDataStable: true }),
    },
  });

const renderAt = (url: string) =>
  render(
    <Provider store={makeStore()}>
      <MemoryRouter initialEntries={[url]}>
        <IntegrationGithubPage />
      </MemoryRouter>
    </Provider>,
  );

const STATE = 'a'.repeat(64);

beforeEach(() => {
  h.navigate.mockReset();
  h.install.mockReset();
  h.toastError.mockReset();
  h.toastSuccess.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('IntegrationGithubPage — installation state', () => {
  it('sends the code, the installation id and the state GitHub handed back', async () => {
    h.install.mockResolvedValue(undefined);
    renderAt(`/integrations/github?code=x&installation_id=42&state=${STATE}`);

    await waitFor(() =>
      expect(h.install).toHaveBeenCalledWith('org-1', {
        code: 'x',
        installationId: 42,
        state: STATE,
      }),
    );
  });

  it('makes no API call without a state, and asks to restart from the dashboard', async () => {
    renderAt('/integrations/github?code=x&installation_id=42');

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith('pages.integration.github.integration.missingState'),
    );
    expect(h.install).not.toHaveBeenCalled();
    expect(h.navigate).toHaveBeenCalled();
  });
});
