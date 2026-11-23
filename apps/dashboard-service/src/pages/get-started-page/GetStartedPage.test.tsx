import React, { type ReactElement, type ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, createRoutesFromChildren, matchRoutes, type RouteObject } from 'react-router-dom';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { appRouteTable } from '@/App';
import type { Edition } from '@/edition/edition';
import { upsellLink } from '@/edition/upsell/upsellLink';
import { APPSEC_PROJECTS_PATH } from '@/utils/product';
import GetStartedPage, {
  GET_STARTED_CLOUD_SLOT_ID,
  GET_STARTED_PRIVATE_CLOUD_SLOT_ID,
} from './GetStartedPage';

/**
 * The Community Edition's « Get started » home: the default landing of `/appsec`, in the style of
 * Logto's. The project list moves to a stable URL of its own, and the cloud
 * keeps its home exactly as it was.
 */

const routeTable = (edition: Edition): RouteObject[] =>
  createRoutesFromChildren((appRouteTable(edition).props as { children: ReactNode }).children);

const nameOf = (element: ReactElement): string | null => {
  const type = element.type as { displayName?: string; name?: string } | string;
  return typeof type === 'string' ? type : (type.displayName ?? type.name ?? null);
};

/** Every component name of the element a path renders, outermost first (guard, shell, page). */
const elementsAt = (edition: Edition, path: string): string[] => {
  const matches = matchRoutes(routeTable(edition), path);
  if (!matches || matches.length === 0) return [];
  const names: string[] = [];
  let node = matches[matches.length - 1].route.element as ReactElement | undefined;
  while (node && React.isValidElement(node)) {
    const name = nameOf(node);
    if (name) names.push(name);
    const children = (node.props as { children?: ReactNode }).children;
    node = React.isValidElement(children) ? (children as ReactElement) : undefined;
  }
  return names;
};

describe('the AppSec home per edition', () => {
  it('community: /appsec is the Get started page, with or without its trailing slash', () => {
    expect(elementsAt('community', '/appsec')).toContain('GetStartedPage');
    expect(elementsAt('community', '/appsec/')).toContain('GetStartedPage');
    expect(elementsAt('community', '/appsec')).not.toContain('HomePage');
  });

  it('community: the project list has its stable URL', () => {
    expect(APPSEC_PROJECTS_PATH).toBe('/appsec/projects');
    expect(elementsAt('community', APPSEC_PROJECTS_PATH)).toContain('HomePage');
  });

  it('community: the former URLs still work', () => {
    expect(elementsAt('community', '/project/p-1/sast')).toContain('AppSecLegacyRedirect');
    expect(elementsAt('community', '/appsec/project/p-1')).toContain('ProjectOverviewPage');
    expect(elementsAt('community', '/')).toContain('RootLanding');
  });

  it('cloud: /appsec stays the project list, and /appsec/projects serves it too', () => {
    expect(elementsAt('cloud', '/appsec')).toContain('HomePage');
    expect(elementsAt('cloud', '/appsec')).not.toContain('GetStartedPage');
    expect(elementsAt('cloud', APPSEC_PROJECTS_PATH)).toContain('HomePage');
    expect(elementsAt('cloud', '/project/p-1/sast')).toContain('AppSecLegacyRedirect');
  });
});

const README = 'https://github.com/CybeDefend/cybedefend/blob/main/deploy/community/README.md';

const renderPage = () =>
  render(
    <MemoryRouter>
      <GetStartedPage />
    </MemoryRouter>,
  );

describe('GetStartedPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });
  afterAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('says what it is for', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Something to help you succeed' })).toBeInTheDocument();
  });

  it('puts forward CybeDefend Cloud in a banner linking to the site', () => {
    renderPage();
    const banner = screen.getByRole('region', { name: 'Skip the ops work: try CybeDefend Cloud free' });
    const link = within(banner).getByRole('link', { name: /Try CybeDefend Cloud/ });
    expect(link).toHaveAttribute('href', upsellLink(GET_STARTED_CLOUD_SLOT_ID, '/pricing'));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it.each([
    ['en', 'Skip the ops work: try CybeDefend Cloud free', 'Explore the editions'],
    ['fr', "Oubliez l'exploitation : essayez CybeDefend Cloud gratuitement", 'Comparer les éditions'],
  ])('%s: under « Try CybeDefend Cloud », a text link opens the editions page in the app', async (lng, title, label) => {
    await i18n.changeLanguage(lng);
    renderPage();
    const banner = screen.getByRole('region', { name: title });
    const link = within(banner).getByRole('link', { name: label });
    // An in-app route, in the same tab, with no external-link icon.
    expect(link).toHaveAttribute('href', '/editions');
    expect(link).not.toHaveAttribute('target');
    expect(link.querySelector('svg')).toBeNull();
    // A small accent text link, not a button, readable in dark mode.
    expect(link).toHaveClass('text-secondary', 'dark:text-secondary-light', 'hover:underline');
    expect(link.className).not.toMatch(/\b(bg-secondary|rounded-lg|h-9)\b/);
    // Under the Cloud button, in the same column, so it follows the button on a phone.
    const cta = within(banner).getAllByRole('link').find((a) => a.getAttribute('target') === '_blank');
    expect(cta).toBeDefined();
    expect(cta!.parentElement).toBe(link.parentElement);
    expect(cta!.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.parentElement).toHaveClass('flex-col');
  });

  it('stacks the Cloud banner below the lg breakpoint, so its text is never squeezed between the picture and the button', () => {
    renderPage();
    const banner = screen.getByRole('region', { name: 'Skip the ops work: try CybeDefend Cloud free' });
    // One row from lg only: at sm, at a tablet width, the picture and the
    // button left the text a column a few words wide (seen at 800 px).
    expect(banner).toHaveClass('flex-col', 'lg:flex-row', 'lg:items-center');
    expect(banner.className).not.toMatch(/\bsm:flex-row\b/);
    const cta = within(banner).getAllByRole('link').find((a) => a.getAttribute('target') === '_blank');
    expect(cta!.parentElement).toHaveClass('items-start', 'lg:items-center');
    expect(cta!.parentElement!.className).not.toMatch(/\bsm:items-center\b/);
  });

  it.each([
    ['en', 'Skip the ops work: try CybeDefend Cloud free', 'Recommended'],
    ['fr', "Oubliez l'exploitation : essayez CybeDefend Cloud gratuitement", 'Recommandé'],
  ])('%s: marks the Cloud banner « Recommended », next to its title and outside it', async (lng, title, word) => {
    await i18n.changeLanguage(lng);
    renderPage();
    const banner = screen.getByRole('region', { name: title });
    const heading = within(banner).getByRole('heading', { level: 2, name: title });
    const badge = within(banner).getByText(word);
    // Same row as the title, which keeps its own accessible name.
    expect(heading.parentElement).toContainElement(badge);
    expect(heading).not.toContainElement(badge);
    expect(badge.closest('span')?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('offers the Private cloud, with « Contact us » to the contact page', () => {
    renderPage();
    const block = screen.getByRole('region', { name: 'Need compliance or custom deployment?' });
    expect(within(block).getByRole('heading', { name: 'Private cloud' })).toBeInTheDocument();
    expect(block.textContent).toMatch(/dedicated instance/i);
    expect(block.textContent).toMatch(/isolation/i);
    expect(block.textContent).toMatch(/domain/i);
    expect(block.textContent).toMatch(/SLA/);
    const contact = within(block).getByRole('link', { name: /Contact us/ });
    expect(contact).toHaveAttribute('href', upsellLink(GET_STARTED_PRIVATE_CLOUD_SLOT_ID, '/contact'));
    expect(contact).toHaveAttribute('target', '_blank');
  });

  it('lists the seven quick starts, each with its one line and its link', () => {
    renderPage();
    const quick = screen.getByRole('region', { name: 'Quick start' });
    const cards = within(quick).getAllByRole('article');
    expect(cards).toHaveLength(7);

    const card = (title: string) => {
      const found = cards.find((c) => within(c).queryByRole('heading', { name: title }));
      expect(found, title).toBeDefined();
      expect(within(found!).getByRole('heading', { name: title }).nextElementSibling?.textContent).toBeTruthy();
      return within(found!).getByRole('link');
    };

    expect(card('Import your first SARIF results')).toHaveAttribute('href', APPSEC_PROJECTS_PATH);
    expect(card('Connect a Kubernetes cluster')).toHaveAttribute('href', `${README}#run-scans-on-a-kubernetes-cluster`);
    // The public CLI does not work with Open Source yet (it signs in through
    // Logto and has no import): the card is the API import from CI instead.
    expect(card('Import results from CI')).toHaveAttribute('href', `${README}#importing-results`);
    expect(quick.textContent).not.toMatch(/\bCLI\b/);
    expect(quick.querySelector('a[href*="cybedefend-cli"]')).toBeNull();
    expect(card('Use the GitHub Action')).toHaveAttribute('href', 'https://github.com/CybeDefend/cybedefend-scanners');
    expect(card('Connect GitHub or GitLab')).toHaveAttribute('href', '/organization/settings/integrations');
    expect(card('Use the MCP server')).toHaveAttribute('href', `${README}#the-mcp-server-optional`);
    expect(card('Create a security policy')).toHaveAttribute('href', '/organization/settings/policies/create');

    // An external link opens in a new tab; an internal one stays in the app.
    expect(card('Import results from CI')).toHaveAttribute('target', '_blank');
    expect(card('Connect GitHub or GitLab')).not.toHaveAttribute('target');
  });

  it('reads in French too, with no raw key', async () => {
    await i18n.changeLanguage('fr');
    const { container } = renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'De quoi bien démarrer' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Private cloud' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Nous contacter/ })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/pages\.getStarted\./);
  });
});
