import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';

/**
 * The foot of the Help menu per edition. The cloud names
 * its region (Europe or United States) and the gateway's version and commit.
 * The Community Edition is self-hosted: it has no region and no commit to
 * show (the gateway answers « unknown »), so the foot reads « Open Source »
 * and the version, when the gateway knows it.
 */
const ed = vi.hoisted(() => ({ edition: 'community' as string }));
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-rebac', () => ({
  AuthorizedContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { BottomSidebar, COMMUNITY_DISCORD_URL, COMMUNITY_GITHUB_URL, HELP_SUPPORT_SLOT_ID } from './BottomSidebar';
import { upsellLink } from '@/edition/upsell/upsellLink';
import { supportUrl } from '@/edition/support';

afterEach(() => {
  ed.edition = 'community';
});

const renderOpenHelp = (versionInfo: { version: string; commit: string } | null) => {
  const store = configureStore({
    reducer: {
      organization: () => ({ selectedOrganization: { id: 'org-1', name: 'Acme', myRole: 'creator' } }),
      user: () => ({ firstName: 'Ada', lastName: 'Lovelace' }),
      appVersion: () => ({
        versionInfo: versionInfo && { service: 'Gateway Service', environment: 'x', deploymentEnv: 'x', ...versionInfo },
        isLoading: false,
        isLoaded: true,
      }),
    },
  });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <BottomSidebar isDarkMode toggleTheme={() => {}} />
      </MemoryRouter>
    </Provider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Help/ }));
};

describe('BottomSidebar Help menu foot', () => {
  it('in Community, shows « Open Source » and the version, no region and no commit', () => {
    renderOpenHelp({ version: '1.3.0', commit: 'unknown' });
    expect(screen.getByTestId('help-edition-badge')).toHaveTextContent('Open Source');
    expect(screen.queryByText('Europe')).toBeNull();
    expect(screen.queryByText('United States')).toBeNull();
    expect(screen.queryByText('🇪🇺')).toBeNull();
    expect(screen.queryByText('🇺🇸')).toBeNull();
    expect(screen.getByText('v1.3.0')).toBeInTheDocument();
    expect(screen.queryByText('unknown')).toBeNull();
  });

  it('in Community, never shows a commit, even a real one', () => {
    renderOpenHelp({ version: '1.3.0', commit: 'abc1234' });
    expect(screen.queryByText('abc1234')).toBeNull();
    expect(screen.getByText('v1.3.0')).toBeInTheDocument();
  });

  it('in Community, leaves the version line out when the gateway does not know it', () => {
    renderOpenHelp({ version: 'Unknown', commit: 'Unknown' });
    expect(screen.getByTestId('help-edition-badge')).toHaveTextContent('Open Source');
    expect(screen.queryByText(/^v/)).toBeNull();
    expect(screen.queryByText('Unknown')).toBeNull();
  });

  it('in the cloud, keeps the region, the version and the commit', () => {
    ed.edition = 'cloud';
    renderOpenHelp({ version: '1.3.0', commit: 'abc1234' });
    expect(screen.queryByTestId('help-edition-badge')).toBeNull();
    expect(screen.queryByText('Open Source')).toBeNull();
    expect(screen.getByText(/Europe|United States/)).toBeInTheDocument();
    expect(screen.getByText('v1.3.0')).toBeInTheDocument();
    expect(screen.getByText('abc1234')).toBeInTheDocument();
  });
});

describe('BottomSidebar Help menu entries', () => {
  const newTab = (link: HTMLElement) => {
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  };

  it('in Community, offers the Discord community, opening the invite in a new tab', () => {
    renderOpenHelp(null);
    const discord = screen.getByRole('link', { name: /Join the Discord community.*\(opens in a new tab\)/ });
    expect(COMMUNITY_DISCORD_URL).toBe('https://discord.gg/UPzm4n6SAJ');
    expect(discord).toHaveAttribute('href', COMMUNITY_DISCORD_URL);
    newTab(discord);
  });

  it('in Community, invites to contribute on GitHub: an issue or a change', () => {
    renderOpenHelp(null);
    const github = screen.getByRole('link', { name: /Contribute on GitHub.*\(opens in a new tab\)/ });
    expect(COMMUNITY_GITHUB_URL).toBe('https://github.com/CybeDefend/cybedefend');
    expect(github).toHaveAttribute('href', COMMUNITY_GITHUB_URL);
    expect(github).toHaveTextContent(/issue/i);
    newTab(github);
  });

  it('in Community, says support comes with CybeDefend Cloud, and links there, not to the portal', () => {
    renderOpenHelp(null);
    const support = screen.getByRole('link', { name: /Support.*Available on CybeDefend Cloud.*\(opens in a new tab\)/ });
    expect(support).toHaveAttribute('href', upsellLink(HELP_SUPPORT_SLOT_ID, '/pricing'));
    newTab(support);
    expect(screen.queryByText('Contact our team')).toBeNull();
    expect(document.querySelector(`a[href="${supportUrl('cloud')}"]`)).toBeNull();
  });

  it('in the cloud, keeps its menu: documentation, changelog and the support portal, no Discord nor GitHub', () => {
    ed.edition = 'cloud';
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderOpenHelp(null);
    expect(screen.queryByText('Join the Discord community')).toBeNull();
    expect(screen.queryByText('Contribute on GitHub')).toBeNull();
    expect(screen.queryByText('Available on CybeDefend Cloud')).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /Support.*Contact our team/ }));
    expect(open).toHaveBeenCalledWith(supportUrl('cloud'), '_blank');
    open.mockRestore();
  });
});
