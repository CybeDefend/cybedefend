import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

const h = vi.hoisted(() => ({
  getInstallation: vi.fn(),
  getOAuthUrl: vi.fn(),
  disconnect: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-toastify', () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock('@/server/services/integrations/jiraIntegrationsService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/services/integrations/jiraIntegrationsService')>()),
  getJiraInstallation: (...a: unknown[]) => h.getInstallation(...a),
  getJiraOAuthUrl: (...a: unknown[]) => h.getOAuthUrl(...a),
  disconnectJira: (...a: unknown[]) => h.disconnect(...a),
}));

import JiraIntegrationModal from './JiraIntegrationModal';

const ORG_ID = 'org-1';
const CONSENT_URL = 'https://auth.atlassian.com/authorize?client_id=cid&state=state-123';

const renderModal = () =>
  render(
    <Provider
      store={configureStore({ reducer: { organization: () => ({ selectedOrganization: { id: ORG_ID } }) } })}
    >
      <JiraIntegrationModal onClose={vi.fn()} />
    </Provider>,
  );

let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.getInstallation.mockReset().mockResolvedValue({ isConfigured: false });
  h.getOAuthUrl.mockReset().mockResolvedValue({ installUrl: CONSENT_URL });
  h.toastError.mockReset();
  sessionStorage.clear();
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
  openSpy.mockRestore();
});

describe('JiraIntegrationModal — connecting', () => {
  it('opens the Jira consent in a popup', async () => {
    renderModal();
    fireEvent.click(await screen.findByText('Connect to Jira'));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(CONSENT_URL, '_blank', 'width=600,height=700'));
  });

  it('says Jira is not configured on this instance when the server answers JIRA_NOT_CONFIGURED', async () => {
    h.getOAuthUrl.mockRejectedValue(
      Object.assign(new Error('Request failed'), { response: { status: 400, data: { message: 'JIRA_NOT_CONFIGURED' } } }),
    );
    renderModal();
    fireEvent.click(await screen.findByText('Connect to Jira'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    const notice = render(<>{h.toastError.mock.calls[0][0]}</>);
    expect(notice.container.textContent).toMatch(/^Jira is not configured on this instance\./);
    expect(within(notice.container).getByRole('link', { name: /Optional integrations/ })).toHaveAttribute(
      'href',
      expect.stringMatching(/deploy\/community\/README\.md#optional-integrations$/),
    );
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('keeps the generic error for any other failure', async () => {
    h.getOAuthUrl.mockRejectedValue(new Error('network'));
    renderModal();
    fireEvent.click(await screen.findByText('Connect to Jira'));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('Failed to connect Jira'));
  });
});
