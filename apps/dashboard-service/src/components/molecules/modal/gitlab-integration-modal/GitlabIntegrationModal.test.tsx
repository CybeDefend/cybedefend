import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-toastify', () => ({ toast }));
vi.mock('@/components/atoms/modal/Modal', () => ({
  default: (props: { title?: string; children: React.ReactNode; footerButtons?: React.ReactNode }) => (
    <div role="dialog" aria-label={props.title}>
      {props.children}
      {props.footerButtons}
    </div>
  ),
}));
const disconnectGitlab = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/integrations/gitlabIntegrationsService', () => ({ disconnectGitlab }));

import GitlabIntegrationModal from './GitlabIntegrationModal';

function renderModal(
  props: { installedByCurrentUser?: boolean; reconnectRequired?: boolean; canManage?: boolean } = {},
) {
  const handlers = { onReconnect: vi.fn(), onDisconnected: vi.fn(), onClose: vi.fn() };
  render(
    <GitlabIntegrationModal
      organizationId="org-1"
      installedByCurrentUser={props.installedByCurrentUser ?? true}
      reconnectRequired={props.reconnectRequired ?? false}
      canManage={props.canManage ?? true}
      {...handlers}
    />,
  );
  return handlers;
}

describe('GitlabIntegrationModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('says what disconnecting loses before doing anything', () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    expect(screen.getByText('Projects linked to a GitLab repository will no longer be linked to it.')).toBeTruthy();
    expect(screen.getByText('Automatic scans on push will stop.')).toBeTruthy();
    expect(screen.getByText('Scan history and vulnerabilities are kept.')).toBeTruthy();
    expect(disconnectGitlab).not.toHaveBeenCalled();
  });

  it('disconnects once confirmed, then lets the page refresh', async () => {
    disconnectGitlab.mockResolvedValue(undefined);
    const { onDisconnected } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect GitLab' }));

    await waitFor(() => expect(onDisconnected).toHaveBeenCalledTimes(1));
    expect(disconnectGitlab).toHaveBeenCalledWith('org-1');
    expect(toast.success).toHaveBeenCalledWith('GitLab disconnected');
  });

  it('does nothing when the confirmation is cancelled', () => {
    const { onDisconnected } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(disconnectGitlab).not.toHaveBeenCalled();
    expect(onDisconnected).not.toHaveBeenCalled();
    expect(screen.queryByText('Automatic scans on push will stop.')).toBeNull();
  });

  it("shows its own sentence on a failure, never the server's", async () => {
    disconnectGitlab.mockRejectedValue(new Error('Request failed with status code 501: not implemented'));
    const { onDisconnected } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect GitLab' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('GitLab could not be disconnected. Try again.'));
    expect(onDisconnected).not.toHaveBeenCalled();
  });

  it('offers to reconnect to the member who connected GitLab', () => {
    const { onReconnect } = renderModal({ installedByCurrentUser: true });

    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));

    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('offers to reconnect to any member when the connection is broken', () => {
    renderModal({ installedByCurrentUser: false, reconnectRequired: true });

    expect(screen.getByText('Reconnection required')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('tells a member who cannot manage integrations who can, and offers neither action', () => {
    renderModal({ canManage: false, installedByCurrentUser: true, reconnectRequired: true });

    expect(
      screen.getByText('Only an organization administrator or manager can reconnect or disconnect GitLab.'),
    ).toBeTruthy();
    expect(screen.getByText('Reconnection required')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
  });

  it("does not let another member replace a healthy connection, but lets them disconnect it", () => {
    renderModal({ installedByCurrentUser: false, reconnectRequired: false });

    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });
});
