import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

/**
 * The Community Edition's « CybeDefend Cloud » card in the rail (in the
 * style of Logto's « Focus on building, not hosting »): an illustration, a title, one sentence
 * on what the cloud adds, two links to the site, and a close button. Closing it is remembered
 * per browser; the storage may refuse (a private window, blocked site data) and the card then
 * still closes, for this page load.
 */
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import CloudSidebarCard, { CLOUD_CARD_SLOT_ID } from './CloudSidebarCard';
import { CLOUD_CARD_DISMISSED_KEY, resetCloudCardDismissalForTests } from './cloudCardDismissal';
import { upsellLink } from './upsellLink';

beforeEach(() => {
  window.localStorage.clear();
  resetCloudCardDismissalForTests();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CloudSidebarCard', () => {
  it('invites to CybeDefend Cloud: a title, what it adds, and the two links of the site', () => {
    render(<CloudSidebarCard />);
    const card = screen.getByRole('region', { name: 'Focus on security, not hosting.' });
    expect(card).toHaveTextContent(/managed scanners/i);
    expect(card).toHaveTextContent(/false positives/i);
    expect(card).toHaveTextContent(/AutoFix/);

    const tryCloud = screen.getByRole('link', { name: /Try CybeDefend Cloud.*\(opens in a new tab\)/ });
    expect(tryCloud).toHaveAttribute('href', upsellLink(CLOUD_CARD_SLOT_ID, '/pricing'));
    const enterprise = screen.getByRole('link', { name: /Private cloud & Enterprise.*\(opens in a new tab\)/ });
    // The page the editions page's « Contact us for Enterprise » opens.
    expect(enterprise).toHaveAttribute('href', upsellLink(CLOUD_CARD_SLOT_ID, '/contact'));
    for (const link of [tryCloud, enterprise]) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('sits in the flow of the rail, a section the rail fit can leave out', () => {
    render(<CloudSidebarCard />);
    const card = screen.getByRole('region');
    expect(card).toHaveAttribute('data-rail-section', 'cloud');
    expect(card.className).not.toMatch(/\b(absolute|fixed|z-\d+)\b/);
  });

  it('closes, and stays closed in this browser', () => {
    const { unmount } = render(<CloudSidebarCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide the CybeDefend Cloud card' }));
    expect(screen.queryByRole('region')).toBeNull();
    expect(window.localStorage.getItem(CLOUD_CARD_DISMISSED_KEY)).toBe('1');
    unmount();

    resetCloudCardDismissalForTests();
    render(<CloudSidebarCard />);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('still closes when the storage refuses, and shows when it cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    render(<CloudSidebarCard />);
    expect(screen.getByRole('region')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide the CybeDefend Cloud card' }));
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('draws in the accent token, never a fixed violet, and no zinc-500 words', () => {
    const { container } = render(<CloudSidebarCard />);
    expect(container.innerHTML).not.toMatch(/(violet|purple|fuchsia)-\d/);
    container.querySelectorAll('p, h3, a, span').forEach((element) => {
      expect(element.className).not.toMatch(/(^|\s)(dark:)?text-zinc-500\b/);
    });
  });
});
