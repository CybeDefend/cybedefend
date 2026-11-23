import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

import enRefusals from '@/i18n/locales/en/components/linearRefusals.json';

const h = vi.hoisted(() => ({
  getInstallation: vi.fn(),
  getOAuthUrl: vi.fn(),
  disconnect: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-toastify', () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock('@/server/services/integrations/linearIntegrationsService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/services/integrations/linearIntegrationsService')>()),
  getLinearInstallation: (...a: unknown[]) => h.getInstallation(...a),
  getLinearOAuthUrl: (...a: unknown[]) => h.getOAuthUrl(...a),
  disconnectLinear: (...a: unknown[]) => h.disconnect(...a),
}));

import LinearIntegrationModal from './LinearIntegrationModal';

const ORG_ID = 'org-1';
const CONSENT_URL = 'https://linear.app/oauth/authorize?client_id=cid&state=state-123&scope=read%2Cwrite&actor=app';
const CREATED_AT = '2026-10-20T10:00:00.000Z';

const installation = (extra: Record<string, unknown> = {}) => ({
  isConfigured: true,
  id: 'lin-1',
  linearOrganizationId: 'lo-1',
  workspaceName: 'Acme Workspace',
  workspaceUrlKey: 'acme',
  organizationId: ORG_ID,
  installedByUserId: 'user-1',
  needsReconnect: false,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  ...extra,
});

const makeStore = () =>
  configureStore({
    reducer: { organization: () => ({ selectedOrganization: { id: ORG_ID } }) },
  });

const renderModal = (onClose = vi.fn()) =>
  render(
    <Provider store={makeStore()}>
      <LinearIntegrationModal onClose={onClose} />
    </Provider>,
  );

/** What the server answers a refused route: the closed code in the response `message`. */
const refused = (code: string, text = 'a sentence only the server wrote') =>
  Object.assign(new Error(text), { response: { data: { message: code } } });

/** What the popup's callback page posts to the window that opened it. */
const popupSays = (data: unknown, origin = window.location.origin) =>
  act(async () => {
    window.dispatchEvent(new MessageEvent('message', { data, origin }));
  });

let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.getInstallation.mockReset().mockResolvedValue({ isConfigured: false });
  h.getOAuthUrl.mockReset().mockResolvedValue({ installUrl: CONSENT_URL });
  h.disconnect.mockReset().mockResolvedValue({ success: true });
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  sessionStorage.clear();
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('LinearIntegrationModal — connecting', () => {
  it('opens the Linear consent in a popup and keeps the state', async () => {
    renderModal();
    fireEvent.click(await screen.findByText('Connect to Linear'));

    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
    expect(h.getOAuthUrl).toHaveBeenCalledWith(ORG_ID);
    expect(openSpy).toHaveBeenCalledWith(CONSENT_URL, '_blank', 'width=600,height=700');
    // The callback page compares this with the state Linear hands back.
    expect(sessionStorage.getItem('linear_oauth_state')).toBe('state-123');
  });

  it('shows the install error, not the server text, when the consent URL cannot be issued', async () => {
    h.getOAuthUrl.mockRejectedValue(new Error('server said something'));
    renderModal();
    fireEvent.click(await screen.findByText('Connect to Linear'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('Failed to connect Linear'));
    expect(openSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('linear_oauth_state')).toBeNull();
  });

  it('says Linear is not configured on this instance when the server answers LINEAR_NOT_CONFIGURED', async () => {
    h.getOAuthUrl.mockRejectedValue(
      Object.assign(new Error('Request failed'), { response: { status: 400, data: { message: 'LINEAR_NOT_CONFIGURED' } } }),
    );
    renderModal();
    fireEvent.click(await screen.findByText('Connect to Linear'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    const notice = render(<>{h.toastError.mock.calls[0][0]}</>);
    expect(notice.container.textContent).toMatch(/^Linear is not configured on this instance\./);
    expect(within(notice.container).getByRole('link', { name: /Optional integrations/ })).toHaveAttribute(
      'href',
      expect.stringMatching(/deploy\/community\/README\.md#optional-integrations$/),
    );
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('refreshes the workspace and says so when the popup reports success', async () => {
    renderModal();
    await screen.findByText('Connect to Linear');
    h.getInstallation.mockResolvedValue(installation());

    await popupSays({ type: 'linear-oauth-success' });

    expect(h.toastSuccess).toHaveBeenCalledWith('Linear connected successfully');
    expect(await screen.findByText('Acme Workspace')).toBeInTheDocument();
  });

  it('shows the install error when the popup reports a failure with no reason', async () => {
    renderModal();
    await screen.findByText('Connect to Linear');

    await popupSays({ type: 'linear-oauth-error' });

    expect(h.toastError).toHaveBeenCalledWith('Failed to connect Linear');
  });

  it('shows a fixed sentence for LINEAR_WORKSPACE_TAKEN, never the text of the server', async () => {
    renderModal();
    await screen.findByText('Connect to Linear');

    await popupSays({
      type: 'linear-oauth-error',
      code: 'LINEAR_WORKSPACE_TAKEN',
      message: 'Workspace 1234 belongs to organization 5678',
    });

    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(h.toastError).toHaveBeenCalledWith(enRefusals.components.linearRefusals.LINEAR_WORKSPACE_TAKEN);
    expect(JSON.stringify(h.toastError.mock.calls)).not.toContain('1234');
  });

  it('ignores a code that is not on the closed list', async () => {
    renderModal();
    await screen.findByText('Connect to Linear');

    await popupSays({ type: 'linear-oauth-error', code: 'ANYTHING_ELSE <b>x</b>' });

    expect(h.toastError).toHaveBeenCalledWith('Failed to connect Linear');
  });

  it('ignores a message from another origin', async () => {
    renderModal();
    await screen.findByText('Connect to Linear');

    await popupSays({ type: 'linear-oauth-success' }, 'https://evil.example');
    await popupSays({ type: 'linear-oauth-error', code: 'LINEAR_WORKSPACE_TAKEN' }, 'https://evil.example');

    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.toastError).not.toHaveBeenCalled();
  });
});

describe('LinearIntegrationModal — the connected workspace', () => {
  it('shows the workspace and its connection date', async () => {
    h.getInstallation.mockResolvedValue(installation());
    renderModal();

    expect(await screen.findByText('Acme Workspace')).toBeInTheDocument();
    expect(
      screen.getByText(`Connected since ${new Date(CREATED_AT).toLocaleDateString()}`),
    ).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.queryByText('Connect to Linear')).toBeNull();
    expect(screen.queryByText('Reconnect Linear')).toBeNull();
  });

  it('shows reconnect, and not « Connected », when the workspace needs to be connected again', async () => {
    h.getInstallation.mockResolvedValue(installation({ needsReconnect: true }));
    renderModal();

    expect(await screen.findByText('Acme Workspace')).toBeInTheDocument();
    expect(screen.getByText('Reconnection required')).toBeInTheDocument();
    expect(screen.queryByText('Connected')).toBeNull();

    // Reconnecting is the same consent flow, for the same workspace.
    fireEvent.click(screen.getByText('Reconnect Linear'));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(CONSENT_URL, '_blank', 'width=600,height=700'));
    expect(sessionStorage.getItem('linear_oauth_state')).toBe('state-123');
  });

  it('still offers to disconnect a workspace that needs to be connected again', async () => {
    h.getInstallation.mockResolvedValue(installation({ needsReconnect: true }));
    renderModal();

    expect(await screen.findByText('Disconnect')).toBeInTheDocument();
  });

  it('shows the not-connected state when the organization has no workspace', async () => {
    renderModal();

    expect(await screen.findByText('Linear is not connected')).toBeInTheDocument();
    expect(screen.queryByText('Disconnect')).toBeNull();
  });

  it('closes through the footer button', async () => {
    const onClose = vi.fn();
    renderModal(onClose);
    await screen.findByText('Connect to Linear');

    fireEvent.click(screen.getByText('Close'));

    expect(onClose).toHaveBeenCalled();
  });
});

describe('LinearIntegrationModal — disconnecting', () => {
  beforeEach(() => h.getInstallation.mockResolvedValue(installation()));

  it('asks for confirmation first, and says the settings and the links will be deleted', async () => {
    renderModal();
    fireEvent.click(await screen.findByText('Disconnect'));

    expect(h.disconnect).not.toHaveBeenCalled();
    const sentence = await screen.findByText(/links between findings and Linear tickets will be deleted/);
    expect(sentence).toBeInTheDocument();
    expect(sentence.textContent).toMatch(/project settings/);
  });

  it('disconnects once confirmed and goes back to the not-connected state', async () => {
    renderModal();
    fireEvent.click(await screen.findByText('Disconnect'));
    await screen.findByText(/links between findings and Linear tickets will be deleted/);

    fireEvent.click(screen.getByText('Yes'));

    await waitFor(() => expect(h.disconnect).toHaveBeenCalledWith(ORG_ID));
    expect(await screen.findByText('Linear is not connected')).toBeInTheDocument();
    expect(h.toastSuccess).toHaveBeenCalledWith('Linear disconnected successfully');
  });

  it('keeps the workspace when the confirmation is cancelled', async () => {
    renderModal();
    fireEvent.click(await screen.findByText('Disconnect'));
    await screen.findByText(/links between findings and Linear tickets will be deleted/);

    fireEvent.click(screen.getByText('No'));

    expect(h.disconnect).not.toHaveBeenCalled();
    expect(screen.queryByText(/links between findings and Linear tickets will be deleted/)).toBeNull();
    expect(screen.getByText('Acme Workspace')).toBeInTheDocument();
  });

  it('shows a fixed sentence when the server refuses, and the generic error otherwise', async () => {
    h.disconnect.mockRejectedValueOnce(refused('LINEAR_NOT_CONNECTED', 'raw server text'));
    renderModal();
    fireEvent.click(await screen.findByText('Disconnect'));
    await screen.findByText(/links between findings and Linear tickets will be deleted/);
    fireEvent.click(screen.getByText('Yes'));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(enRefusals.components.linearRefusals.LINEAR_NOT_CONNECTED),
    );
    expect(JSON.stringify(h.toastError.mock.calls)).not.toContain('raw server text');

    h.toastError.mockReset();
    h.disconnect.mockRejectedValueOnce(new Error('raw server text'));
    fireEvent.click(await screen.findByText('Disconnect'));
    await screen.findByText(/links between findings and Linear tickets will be deleted/);
    fireEvent.click(screen.getByText('Yes'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('Failed to disconnect Linear'));
  });
});
