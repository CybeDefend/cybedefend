import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  install: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => h.navigate };
});
vi.mock('@/components/atoms/loader/LoaderHome', () => ({ default: () => <div data-testid="loader" /> }));
vi.mock('@/server/services/integrations/slackIntegrationsService', () => ({
  installSlackIntegration: (...args: unknown[]) => h.install(...args),
  createSlackOAuthState: vi.fn(),
}));

import { IntegrationSlackCallbackPage } from './IntegrationSlackCallbackPage';

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
        <IntegrationSlackCallbackPage />
      </MemoryRouter>
    </Provider>,
  );

const opener = { postMessage: vi.fn() };

beforeEach(() => {
  h.navigate.mockReset();
  h.install.mockReset();
  opener.postMessage.mockReset();
  Object.defineProperty(window, 'opener', { value: opener, configurable: true, writable: true });
  vi.spyOn(window, 'close').mockImplementation(() => undefined);
});

afterEach(() => {
  Object.defineProperty(window, 'opener', { value: null, configurable: true, writable: true });
  vi.restoreAllMocks();
});

describe('IntegrationSlackCallbackPage — OAuth state', () => {
  it('sends the code and the state Slack handed back', async () => {
    h.install.mockResolvedValue(undefined);
    renderAt('/integrations/slack/callback?code=x&state=y');

    await waitFor(() =>
      expect(h.install).toHaveBeenCalledWith('org-1', {
        code: 'x',
        redirectUri: `${window.location.origin}/integrations/slack/callback`,
        state: 'y',
      }),
    );
    await waitFor(() =>
      expect(opener.postMessage).toHaveBeenCalledWith({ type: 'slack-oauth-success' }, window.location.origin),
    );
  });

  it('refuses a callback without a state, as one without a code', async () => {
    renderAt('/integrations/slack/callback?code=x');

    await waitFor(() =>
      expect(opener.postMessage).toHaveBeenCalledWith({ type: 'slack-oauth-error' }, window.location.origin),
    );
    expect(h.install).not.toHaveBeenCalled();
  });
});
