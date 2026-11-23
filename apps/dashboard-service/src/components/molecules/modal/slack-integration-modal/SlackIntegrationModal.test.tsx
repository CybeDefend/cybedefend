import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

const h = vi.hoisted(() => ({
  createState: vi.fn(),
  getInstallation: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: h.toastError } }));
vi.mock('@/server/services/integrations/slackIntegrationsService', () => ({
  getSlackInstallation: (...a: unknown[]) => h.getInstallation(...a),
  disconnectSlack: vi.fn(),
  createSlackOAuthState: (...a: unknown[]) => h.createState(...a),
}));

import SlackIntegrationModal from './SlackIntegrationModal';

const ORG_ID = 'org-1';
const STATE = 'f'.repeat(64);

const makeStore = () =>
  configureStore({
    reducer: { organization: () => ({ selectedOrganization: { id: ORG_ID } }) },
  });

const renderModal = () =>
  render(
    <Provider store={makeStore()}>
      <SlackIntegrationModal onClose={vi.fn()} />
    </Provider>,
  );

type FakePopup = { location: { href: string }; close: ReturnType<typeof vi.fn> };
let popup: FakePopup;
let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.createState.mockReset();
  h.toastError.mockReset();
  h.getInstallation.mockReset().mockResolvedValue({ isConfigured: false });
  popup = { location: { href: '' }, close: vi.fn() };
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => popup as unknown as Window);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

const clickConnect = async () => {
  const button = await screen.findByText('components.slackIntegration.connectButton');
  fireEvent.click(button);
};

describe('SlackIntegrationModal — Connect sends a server-issued state', () => {
  it('opens the popup at once, then points it at Slack with the state the gateway issued', async () => {
    h.createState.mockResolvedValue(STATE);
    renderModal();
    await clickConnect();

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('', '_blank', 'width=600,height=700');
    expect(h.createState).toHaveBeenCalledWith(ORG_ID);

    await waitFor(() => expect(popup.location.href).not.toBe(''));
    const url = new URL(popup.location.href);
    expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(url.searchParams.get('state')).toBe(STATE);
    expect(url.searchParams.get('state')).not.toBe(ORG_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(`${window.location.origin}/integrations/slack/callback`);
    expect(popup.close).not.toHaveBeenCalled();
  });

  it('sends the client id of the runtime configuration', async () => {
    (window as Window & { __CYBEDEFEND_CONFIG__?: unknown }).__CYBEDEFEND_CONFIG__ = { slackClientId: 'runtime-slack-id' };
    try {
      h.createState.mockResolvedValue(STATE);
      renderModal();
      await clickConnect();

      await waitFor(() => expect(popup.location.href).not.toBe(''));
      expect(new URL(popup.location.href).searchParams.get('client_id')).toBe('runtime-slack-id');
    } finally {
      delete (window as Window & { __CYBEDEFEND_CONFIG__?: unknown }).__CYBEDEFEND_CONFIG__;
    }
  });

  it('closes the popup and shows the install error when no state could be issued', async () => {
    h.createState.mockRejectedValue(new Error('server said something'));
    renderModal();
    await clickConnect();

    await waitFor(() => expect(popup.close).toHaveBeenCalled());
    expect(popup.location.href).toBe('');
    expect(h.toastError).toHaveBeenCalledWith('components.slackIntegration.installError');
  });

  it('shows the install error when the browser blocked the popup', async () => {
    openSpy.mockImplementation(() => null);
    h.createState.mockResolvedValue(STATE);
    renderModal();
    await clickConnect();

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('components.slackIntegration.installError'));
    expect(h.createState).not.toHaveBeenCalled();
  });
});
