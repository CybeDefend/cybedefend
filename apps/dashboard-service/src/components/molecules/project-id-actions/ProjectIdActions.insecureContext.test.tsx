import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * A self-hosted instance opened over plain HTTP on a host other than
 * localhost (`http://host.docker.internal:8080`) has no `navigator.clipboard`:
 * the copy of the project id toasted « Échec de la copie de la commande ».
 * It now copies through the execCommand fallback.
 */
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('react-toastify', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));
vi.mock('@/edition/slots', () => ({ Slot: () => null }));

import ProjectIdActions from './ProjectIdActions';

const PROJECT = '11111111-2222-4333-8444-555555555555';
let execCommand: ReturnType<typeof vi.fn>;

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
  execCommand = vi.fn().mockReturnValue(true);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
});

function renderActions() {
  return render(
    <MemoryRouter initialEntries={[`/appsec/project/${PROJECT}`]}>
      <ProjectIdActions projectId={PROJECT} statePill={false} />
    </MemoryRouter>,
  );
}

describe('ProjectIdActions on a page that is not a secure context', () => {
  it('copies the project id through the fallback, without the failure toast', async () => {
    renderActions();
    fireEvent.click(screen.getByTestId('copy-project-id-button'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('keeps the failure toast when the fallback fails too', async () => {
    execCommand.mockReturnValue(false);
    renderActions();
    fireEvent.click(screen.getByTestId('copy-project-id-button'));
    // the button copies an id, not a command: the generic failure sentence
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Copy failed'));
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
