import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import { InvitationLinkNotice, invitationLink } from './InvitationLinkNotice';

const TOKEN = 'a'.repeat(32) + '0123456789abcdef'.repeat(2);

afterEach(() => cleanup());

/**
 * With no mail configured, the invitation answer carries its token:
 * the administrator sends the link themselves.
 * The token is a credential: only a well-formed one becomes a link.
 */
describe('InvitationLinkNotice', () => {
  it('builds the link from the page origin, the token in the fragment', () => {
    expect(invitationLink(TOKEN)).toBe(`${window.location.origin}/invite#token=${TOKEN}`);
    expect(invitationLink(TOKEN, 'https://appsec.example.test')).toBe(`https://appsec.example.test/invite#token=${TOKEN}`);

    render(<InvitationLinkNotice email="dev@acme.test" token={TOKEN} />);
    expect(screen.getByText(`${window.location.origin}/invite#token=${TOKEN}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy the invitation link' })).toBeInTheDocument();
    expect(screen.getByText(/No e-mail was sent: send this link to dev@acme\.test yourself\. It is shown once/)).toBeInTheDocument();
  });

  it('marks the link as a secret: it carries the invitation credential', () => {
    render(<InvitationLinkNotice email="dev@acme.test" token={TOKEN} />);
    const link = screen.getByText(`${window.location.origin}/invite#token=${TOKEN}`);
    expect(link.closest('[data-sensitive="secret"]')).not.toBeNull();
    // The sentence naming the invitee and the copy button stay readable.
    expect(screen.getByRole('button', { name: 'Copy the invitation link' }).closest('[data-sensitive]')).toBeNull();
  });

  it('keeps the token out of the path and the query: no server ever receives a fragment', () => {
    const url = new URL(invitationLink(TOKEN, 'https://appsec.example.test') as string);
    expect(url.pathname).toBe('/invite');
    expect(url.search).toBe('');
    expect(url.hash).toBe(`#token=${TOKEN}`);
  });

  it('renders nothing for an empty or malformed token', () => {
    for (const token of ['', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), `${'a'.repeat(60)}/../`, `${'a'.repeat(63)}\n`]) {
      expect(invitationLink(token)).toBeNull();
      const { container } = render(<InvitationLinkNotice email="dev@acme.test" token={token} />);
      expect(container).toBeEmptyDOMElement();
      cleanup();
    }
    expect(invitationLink(null as unknown as string)).toBeNull();
  });
});
