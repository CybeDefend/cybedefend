import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';

/**
 * Where Linear hands the account back after the consent screen. The page is the
 * popup's last stop: it checks the `state` the connection modal kept, sends the
 * code to the gateway, tells the window that opened it and closes. Its URL is
 * registered at Linear and never moves.
 */

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  install: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => h.navigate };
});
vi.mock('@/components/atoms/loader/LoaderHome', () => ({ default: () => <div data-testid="loader" /> }));
vi.mock('@/server/services/integrations/linearIntegrationsService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/services/integrations/linearIntegrationsService')>()),
  installLinearIntegration: (...args: unknown[]) => h.install(...args),
}));

import { IntegrationLinearCallbackPage } from './IntegrationLinearCallbackPage';

const ORIGIN = window.location.origin;
const STATE_KEY = 'linear_oauth_state';

const makeStore = (appState = { isAppInitialized: true, isDataStable: true }) =>
  configureStore({
    reducer: {
      organization: () => ({ selectedOrganization: { id: 'org-1' } }),
      app: () => appState,
    },
  });

const renderAt = (url: string, store = makeStore()) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[url]}>
        <IntegrationLinearCallbackPage />
      </MemoryRouter>
    </Provider>,
  );

/** What the server answers a refused route: the closed code in the response `message`. */
const refused = (code: string) => Object.assign(new Error('Request failed'), { response: { data: { message: code } } });

const opener = { postMessage: vi.fn() };
const setOpener = (value: unknown) =>
  Object.defineProperty(window, 'opener', { value, configurable: true, writable: true });

beforeEach(() => {
  h.navigate.mockReset();
  h.install.mockReset();
  opener.postMessage.mockReset();
  sessionStorage.clear();
  setOpener(opener);
  vi.spyOn(window, 'close').mockImplementation(() => undefined);
});

afterEach(() => {
  setOpener(null);
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('IntegrationLinearCallbackPage — the state', () => {
  it('installs with the code when the state matches the one the modal kept', async () => {
    sessionStorage.setItem(STATE_KEY, 's-1');
    h.install.mockResolvedValue({});
    renderAt('/integrations/linear/callback?code=c-1&state=s-1');

    await waitFor(() =>
      expect(h.install).toHaveBeenCalledWith('org-1', {
        code: 'c-1',
        redirectUri: `${ORIGIN}/integrations/linear/callback`,
        state: 's-1',
      }),
    );
  });

  it('refuses a state that is not the one the modal kept', async () => {
    sessionStorage.setItem(STATE_KEY, 'kept');
    renderAt('/integrations/linear/callback?code=c-1&state=forged');

    await waitFor(() =>
      expect(opener.postMessage).toHaveBeenCalledWith({ type: 'linear-oauth-error' }, ORIGIN),
    );
    expect(h.install).not.toHaveBeenCalled();
  });

  it('refuses a callback without a state', async () => {
    sessionStorage.setItem(STATE_KEY, 'kept');
    renderAt('/integrations/linear/callback?code=c-1');

    await waitFor(() =>
      expect(opener.postMessage).toHaveBeenCalledWith({ type: 'linear-oauth-error' }, ORIGIN),
    );
    expect(h.install).not.toHaveBeenCalled();
  });

  it('refuses a state when the modal kept none', async () => {
    renderAt('/integrations/linear/callback?code=c-1&state=anything');

    await waitFor(() =>
      expect(opener.postMessage).toHaveBeenCalledWith({ type: 'linear-oauth-error' }, ORIGIN),
    );
    expect(h.install).not.toHaveBeenCalled();
  });

  it('refuses a callback without a code, even with the right state', async () => {
    sessionStorage.setItem(STATE_KEY, 's-1');
    renderAt('/integrations/linear/callback?state=s-1');

    await waitFor(() =>
      expect(opener.postMessage).toHaveBeenCalledWith({ type: 'linear-oauth-error' }, ORIGIN),
    );
    expect(h.install).not.toHaveBeenCalled();
  });

  it('uses the saved state once and takes the code and state off the address bar', async () => {
    sessionStorage.setItem(STATE_KEY, 's-1');
    h.install.mockResolvedValue({});
    const replace = vi.spyOn(window.history, 'replaceState');
    renderAt('/integrations/linear/callback?code=c-1&state=s-1');

    await waitFor(() => expect(h.install).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(STATE_KEY)).toBeNull();
    expect(replace).toHaveBeenCalledWith({}, expect.any(String), window.location.pathname);
  });

  it('waits for the app to be ready before using the code', async () => {
    sessionStorage.setItem(STATE_KEY, 's-1');
    renderAt('/integrations/linear/callback?code=c-1&state=s-1', makeStore({ isAppInitialized: false, isDataStable: true }));

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(h.install).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(STATE_KEY)).toBe('s-1');
  });
});

describe('IntegrationLinearCallbackPage — the answer', () => {
  beforeEach(() => sessionStorage.setItem(STATE_KEY, 's-1'));

  it('posts the result to the opener and closes the popup', async () => {
    h.install.mockResolvedValue({});
    renderAt('/integrations/linear/callback?code=c-1&state=s-1');

    await waitFor(() =>
      expect(opener.postMessage).toHaveBeenCalledWith({ type: 'linear-oauth-success' }, ORIGIN),
    );
    expect(window.close).toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('posts a failure to the opener, without the server text', async () => {
    h.install.mockRejectedValue(Object.assign(new Error('boom'), { response: { data: { message: 'secret server text' } } }));
    renderAt('/integrations/linear/callback?code=c-1&state=s-1');

    await waitFor(() =>
      expect(opener.postMessage).toHaveBeenCalledWith({ type: 'linear-oauth-error' }, ORIGIN),
    );
    expect(JSON.stringify(opener.postMessage.mock.calls)).not.toContain('secret server text');
    expect(window.close).toHaveBeenCalled();
  });

  it('hands the opener the code of a refusal from the closed list, so it can say why', async () => {
    h.install.mockRejectedValue(refused('LINEAR_WORKSPACE_TAKEN'));
    renderAt('/integrations/linear/callback?code=c-1&state=s-1');

    await waitFor(() =>
      expect(opener.postMessage).toHaveBeenCalledWith(
        { type: 'linear-oauth-error', code: 'LINEAR_WORKSPACE_TAKEN' },
        ORIGIN,
      ),
    );
  });

  it('navigates to the integrations page when there is no opener', async () => {
    setOpener(null);
    h.install.mockResolvedValue({});
    renderAt('/integrations/linear/callback?code=c-1&state=s-1');

    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/organization/settings/integrations'));
    expect(opener.postMessage).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
  });

  it('navigates to the integrations page when the install fails and there is no opener', async () => {
    setOpener(null);
    h.install.mockRejectedValue(new Error('boom'));
    renderAt('/integrations/linear/callback?code=c-1&state=s-1');

    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/organization/settings/integrations'));
  });
});
