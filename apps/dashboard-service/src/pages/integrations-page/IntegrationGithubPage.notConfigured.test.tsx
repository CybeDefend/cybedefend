import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({ navigate: vi.fn(), installGithub: vi.fn(), toastError: vi.fn() }));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => h.navigate };
});
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: h.toastError } }));
vi.mock('@/components/atoms/loader/LoaderHome', () => ({ default: () => <div data-testid="loader" /> }));
vi.mock('@/server/services/integrations/githubIntegrationsService', () => ({
  installGithubIntegration: (...args: unknown[]) => h.installGithub(...args),
}));

import { IntegrationGithubPage } from './IntegrationGithubPage';

const renderCallback = () =>
  render(
    <Provider
      store={configureStore({
        reducer: {
          organization: () => ({ selectedOrganization: { id: 'org-1' } }),
          app: () => ({ isAppInitialized: true, isDataStable: true }),
        },
      })}
    >
      <MemoryRouter initialEntries={['/integrations/github/callback?code=c&installation_id=42&state=s']}>
        <IntegrationGithubPage />
      </MemoryRouter>
    </Provider>,
  );

beforeEach(() => {
  h.navigate.mockReset();
  h.installGithub.mockReset();
  h.toastError.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  localStorage.clear();
});

describe('the GitHub callback on an instance without a GitHub App', () => {
  it('says GitHub is not configured when the server answers GITHUB_APP_NOT_CONFIGURED', async () => {
    h.installGithub.mockRejectedValue(
      Object.assign(new Error('Request failed'), {
        response: { status: 400, data: { message: 'GITHUB_APP_NOT_CONFIGURED' } },
      }),
    );
    renderCallback();
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    const notice = render(<>{h.toastError.mock.calls[0][0]}</>);
    expect(notice.container.textContent).toMatch(/^GitHub is not configured on this instance\./);
    expect(within(notice.container).getByRole('link', { name: /Optional integrations/ })).toHaveAttribute(
      'href',
      expect.stringMatching(/deploy\/community\/README\.md#optional-integrations$/),
    );
  });

  it('keeps the generic error for any other failure', async () => {
    h.installGithub.mockRejectedValue(new Error('boom'));
    renderCallback();
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.toastError.mock.calls[0][0]).not.toMatch(/not configured on this instance/);
  });
});
