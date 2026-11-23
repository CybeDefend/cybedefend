import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * « Go to my projects » of the GitHub / GitLab issues explanation. The issues
 * are created from AppSec findings and switched on in an AppSec project's
 * settings, so the projects it means are the AppSec ones: the AppSec home, not
 * the root, which would hand the account to the landing rule.
 */

const h = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-router-dom', () => ({ useNavigate: () => h.navigate }));
vi.mock('../../atoms/modal/Modal', () => ({
  default: ({ children, footerButtons }: { children: React.ReactNode; footerButtons: React.ReactNode }) => (
    <div role="dialog">
      {children}
      {footerButtons}
    </div>
  ),
}));

import IssueIntegrationInfoModal from './IssueIntegrationInfoModal';

beforeEach(() => {
  h.navigate.mockReset();
});

describe('IssueIntegrationInfoModal', () => {
  it.each(['github', 'gitlab'] as const)('closes and opens the AppSec home from the %s explanation', async (type) => {
    const onClose = vi.fn();
    render(<IssueIntegrationInfoModal onClose={onClose} integrationType={type} />);
    await userEvent.click(screen.getByRole('button', { name: /go to my projects/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(h.navigate).toHaveBeenCalledWith('/appsec');
  });
});
