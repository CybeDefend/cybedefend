import React from 'react';
import { describe, it, expect, vi } from 'vitest';

/**
 * The integration catalogue per edition: a container registry is connected so
 * that a scanner pulls its images, and the Community Edition runs no scanner
 * (container results come as a SARIF import). It still lists the
 * registries, and Comp AI, greyed out: « Available on Cloud only », with a
 * link to the cloud, and no card opens a dialog; a `?openRegistry=` link opens
 * nothing either. The template reads `EDITION` once at load, so each case
 * re-imports it.
 */
const ed = vi.hoisted(() => ({ edition: 'community' as string }));
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));
const menu = vi.hoisted(() => ({ ids: [] as string[] }));
import { fireEvent, render, screen, within } from '@testing-library/react';
import { upsellLink } from '@/edition/upsell/upsellLink';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/components/atoms/card/Card', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/components/atoms/search-box/SearchBox', () => ({
  default: () => null,
}));
vi.mock('@/components/atoms/loader/Loader', () => ({ default: () => null }));
vi.mock('@/components/molecules/page-container', () => ({
  PageContainer: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/components/molecules/coming-soon-overlay/ComingSoonOverlay', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/components/molecules/upgrade-plan-overlay/UpgradePlanOverlay', () => ({
  default: ({ children, subtitle }: any) => (
    <div data-testid="upgrade-plan-overlay" data-subtitle={subtitle}>
      {children}
    </div>
  ),
}));
vi.mock('@/components/molecules/modal/IssueIntegrationInfoModal', () => ({
  default: () => null,
}));
vi.mock('@/components/molecules/not-found-element/NotFoundElement', () => ({
  default: () => null,
}));
vi.mock('@/components/molecules/wrapper/SettingsWrapper', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/components/molecules/sidebar/sidebar-menu/SidebarMenu', () => ({
  default: ({ items }: { items: Array<{ id: string }> }) => {
    menu.ids = items.map((item) => item.id);
    return null;
  },
}));
vi.mock('@/components/molecules/on-boarding/OnboardingStep', () => ({
  default: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/components/molecules/modal/slack-integration-modal/SlackIntegrationModal', () => ({
  default: () => <div data-testid="slack-integration-modal" />,
}));
vi.mock('@/components/molecules/modal/jira-integration-modal/JiraIntegrationModal', () => ({ default: () => null }));
vi.mock('@/components/molecules/modal/gitlab-integration-modal/GitlabIntegrationModal', () => ({ default: () => null }));
vi.mock('@/components/molecules/modal/CursorInstallModal', () => ({ default: () => null }));

vi.mock('@/server/hooks/useDisabledFeatures', () => ({ default: () => new Set<string>() }));
vi.mock('@/utils/function/utils', () => ({
  cn: (...c: any[]) => c.filter(Boolean).join(' '),
}));

const baseProps = {
  wrapperLoading: false,
  isGithubLinked: false,
  isGitlabLinked: false,
  isJiraLinked: false,
  isLinearLinked: false,
  isSlackLinked: false,
  isLoadingIntegrations: false,
  onGitlabClick: vi.fn(),
  onGithubClick: vi.fn(),
  githubInstallOwnedByCurrentUser: true,
  gitlabInstallOwnedByCurrentUser: true,
  getRegistryCredentialCount: () => 0,
  onCredentialsChange: vi.fn(),
};

const renderIn = async (edition: string, url = '/organization/settings/integrations') => {
  ed.edition = edition;
  vi.resetModules();
  const Template = (await import('./SettingsOrganizationIntegrationTemplate')).default;
  render(
    <MemoryRouter initialEntries={[url]}>
      <Template {...baseProps} />
    </MemoryRouter>,
  );
};

const REGISTRIES = [
  'Docker Hub',
  'GitLab Registry',
  'GCR',
  'GitHub Container Registry',
  'ECR',
  'ACR',
  'Quay',
  'Harbor',
  'JFrog Artifactory',
  'Scaleway',
];

/** The card of `name`: the element that carries its `data-integration`. */
const cardOf = (name: string) => {
  const card = screen.getByText(name).closest('[data-integration]');
  if (!card) throw new Error(`no card for ${name}`);
  return card as HTMLElement;
};

describe('SettingsOrganizationIntegrationTemplate — container registries per edition', () => {
  it('the Community Edition lists every registry, greyed, with the link to the cloud', async () => {
    await renderIn('community');
    expect(menu.ids).toContain('container_registries');
    expect(menu.ids).toContain('code_repository');
    for (const name of REGISTRIES) {
      const card = cardOf(name);
      expect(card).toHaveAttribute('data-cloud-only', 'integrations-registries');
      expect(within(card).getByText('Available on Cloud only')).toBeInTheDocument();
      const cta = within(card).getByRole('link', { name: `Get it on Cloud: ${name} (opens in a new tab)` });
      expect(cta).toHaveAttribute('href', upsellLink('integrations-registries', '/pricing'));
      expect(cta).toHaveAttribute('target', '_blank');
      expect(cta).toHaveAttribute('rel', 'noopener noreferrer');
      // The CTA is the card's only control: no dead button, no tab stop.
      expect(within(card).getAllByRole('link')).toHaveLength(1);
      expect(card.querySelector('[tabindex], button')).toBeNull();
    }
  });

  it('the Community Edition opens no registry dialog when a greyed card is clicked', async () => {
    await renderIn('community');
    fireEvent.click(screen.getByText('Docker Hub'));
    expect(screen.queryByTestId('dockerhub-registry-modal')).not.toBeInTheDocument();
  });

  it('the Community Edition opens no registry dialog from a link', async () => {
    await renderIn('community', '/organization/settings/integrations?openRegistry=dockerhub');
    expect(screen.queryByTestId('dockerhub-registry-modal')).not.toBeInTheDocument();
  });

  it('the Community Edition keeps the other integrations as they are', async () => {
    await renderIn('community');
    for (const name of ['GitHub', 'GitLab', 'Jira', 'Linear', 'Slack', 'Cybe MCP', 'GitHub Actions']) {
      expect(cardOf(name)).not.toHaveAttribute('data-cloud-only');
    }
    expect(screen.getAllByText('Available on Cloud only')).toHaveLength(REGISTRIES.length + 1);
    fireEvent.click(screen.getByText('Slack'));
    expect(screen.getByTestId('slack-integration-modal')).toBeInTheDocument();
  });

  // « The cloud lists … » and « the cloud opens … » are tested with the
  // closed extension.
});

describe('SettingsOrganizationIntegrationTemplate — Comp AI per edition', () => {
  it('community: Comp AI is greyed, with the link to the cloud and no link to Comp AI', async () => {
    await renderIn('community');
    const card = cardOf('Comp AI');
    expect(card).toHaveAttribute('data-cloud-only', 'integrations-compai');
    expect(within(card).getByText('Available on Cloud only')).toBeInTheDocument();
    const links = within(card).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName('Get it on Cloud: Comp AI (opens in a new tab)');
    expect(links[0]).toHaveAttribute('href', upsellLink('integrations-compai', '/pricing'));
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
    expect(card.innerHTML).not.toContain('trycomp.ai');
  });

  it('cloud: Comp AI keeps its link and carries no Cloud line', async () => {
    await renderIn('cloud');
    const card = cardOf('Comp AI');
    expect(card).not.toHaveAttribute('data-cloud-only');
    expect(screen.getByText('Comp AI').closest('a')?.getAttribute('href')).toBe('https://www.trycomp.ai/');
    expect(within(card).queryByText('Available on Cloud only')).not.toBeInTheDocument();
  });
});

/**
 * The cards that lead outside, per edition:
 * - « Cybe MCP » links to the cloud's docs; the Community Edition's MCP server
 *   is the stack's own (`mcp` profile, `<instance>/mcp`, a personal access
 *   token): the card opens a dialog that says so, linking nowhere outside.
 * - « GitHub Actions » leads to the action that uploads SARIF
 *   (CybeDefend/cybedefend-scanners), not to the cloud's scan action.
 * - « CLI » links to its repository. Its public README documents scans and
 *   results, no import, and it signs in through the cloud's token exchange,
 *   so the Community card says it does not work with this edition yet and
 *   points to the import API.
 */
describe('SettingsOrganizationIntegrationTemplate — cards leading outside, per edition', () => {
  const hrefOf = (name: string) => screen.getByText(name).closest('a')?.getAttribute('href') ?? null;

  it('community: the MCP card opens the instance\'s own MCP dialog', async () => {
    await renderIn('community');
    expect(hrefOf('Cybe MCP')).toBeNull();
    fireEvent.click(screen.getByText('Cybe MCP'));
    // The stack starts the MCP server: no compose profile to name.
    expect(screen.getByText('docker compose up -d')).toBeInTheDocument();
    expect(screen.getByRole('dialog').textContent).not.toMatch(/profile/i);
    expect(screen.getAllByText(/personal access token/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('dialog').innerHTML).not.toContain('docs.cybedefend.com');
  });

  it('community: GitHub Actions leads to the SARIF upload action', async () => {
    await renderIn('community');
    expect(hrefOf('GitHub Actions')).toBe('https://github.com/CybeDefend/cybedefend-scanners');
  });

  it('community: the CLI card links to its repository and says what it does here', async () => {
    await renderIn('community');
    expect(hrefOf('CLI')).toBe('https://github.com/CybeDefend/cybedefend-cli');
    const card = screen.getByText('CLI').closest('[data-integration]') as HTMLElement;
    expect(within(card).getByText(/Not supported by this edition yet/)).toBeInTheDocument();
    expect(within(card).queryByText('Available on Cloud only')).not.toBeInTheDocument();
  });

  it('cloud: the cards keep their links', async () => {
    await renderIn('cloud');
    expect(hrefOf('Cybe MCP')).toContain('docs.cybedefend.com');
    expect(hrefOf('GitHub Actions')).toBe('https://github.com/CybeDefend/cybedefend-action');
    expect(hrefOf('CLI')).toBe('https://github.com/CybeDefend/cybedefend-cli');
    const card = screen.getByText('CLI').closest('[data-integration]') as HTMLElement;
    expect(within(card).queryByText(/Not supported by this edition yet/)).not.toBeInTheDocument();
  });
});
