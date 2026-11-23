import React, { type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { createRoutesFromChildren, matchRoutes, type RouteObject } from 'react-router-dom';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import { appRouteTable } from '@/App';
import type { Edition } from '@/edition/edition';
import { upsellLink } from '@/edition/upsell/upsellLink';
import EditionsPage from './EditionsPage';
import { EDITIONS_MATRIX, PROPRIETARY_RULE_LANGUAGES } from './editionsMatrix';

/** The name of the element the deepest route of an edition's table renders at `path`. */
const pageAt = (edition: Edition, path: string): string | null => {
  const routes: RouteObject[] = createRoutesFromChildren(
    (appRouteTable(edition).props as { children: ReactNode }).children,
  );
  const matches = matchRoutes(routes, path);
  if (!matches || matches.length === 0) return null;
  let element = matches[matches.length - 1].route.element as ReactElement | undefined;
  // A page inside the shell: the page is the shell's child.
  while (element && (element.type as { name?: string }).name === 'ShellPage') {
    element = (element.props as { children: ReactElement }).children;
  }
  if (!element) return null;
  const type = element.type as { displayName?: string; name?: string } | string;
  return typeof type === 'string' ? type : (type.displayName ?? type.name ?? null);
};

describe('EditionsPage', () => {
  it('renders a table with three columns and the CTA links built by upsellLink', () => {
    render(<EditionsPage />);
    const table = screen.getByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(['Feature', 'Open Source', 'Cloud', 'Enterprise']);
    // One row per line of the matrix, under the header row.
    expect(within(table).getAllByRole('row')).toHaveLength(EDITIONS_MATRIX.length + 1);

    // A row reads its marks by their translated names.
    // (Read by text, not by role and name: an accessible name per row of a long table is slow to compute.)
    const marks = (label: string) =>
      Array.from(
        (within(table).getByText(label).closest('tr') as HTMLElement).querySelectorAll('[role="img"]'),
      ).map((i) => i.getAttribute('aria-label'));
    expect(marks('Code map')).toEqual(['Not included', 'Included', 'Included']);
    // Only the Enterprise plan has the per-scanner report.
    expect(marks('Per-scanner report')).toEqual(['Not included', 'Not included', 'Included']);

    // The last « Try CybeDefend Cloud » is the one under the matrix; the first is the highlights block's.
    const cloud = screen.getAllByText('Try CybeDefend Cloud').at(-1)?.closest('a') as HTMLElement;
    expect(cloud).toHaveAttribute('href', upsellLink('editions', '/pricing'));
    const enterprise = screen.getByText('Contact us about Enterprise').closest('a') as HTMLElement;
    expect(enterprise).toHaveAttribute('href', upsellLink('editions', '/contact'));
    for (const link of [cloud, enterprise]) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')?.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
    }
  });

  it('a partly true cell carries its note as text, next to its mark', () => {
    render(<EditionsPage />);
    const table = screen.getByRole('table');
    const scans = within(table).getByText('Code scans (SAST, IaC, secrets, CI/CD, SCA)').closest('tr') as HTMLElement;
    const cells = within(scans).getAllByRole('cell');
    expect(within(cells[1]).getByText('On your own Kubernetes cluster')).toBeInTheDocument();
    expect(within(cells[2]).getByText('Managed scanners')).toBeInTheDocument();
    expect(within(cells[1]).getByRole('img')).toHaveAttribute('aria-label', 'Included');
    const policies = within(table).getByText('Policies').closest('tr') as HTMLElement;
    expect(within(within(policies).getAllByRole('cell')[2]).getByText('Team plan')).toBeInTheDocument();
    // A plain cell has its mark and no note.
    expect(within(within(policies).getAllByRole('cell')[1]).queryByText(/./)).toBeNull();
  });

  it('the SARIF import is Open Source only, with no note on which kinds are accepted', () => {
    render(<EditionsPage />);
    const table = screen.getByRole('table');
    const sarif = within(table).getByText('SARIF import of scanner results').closest('tr') as HTMLElement;
    expect(Array.from(sarif.querySelectorAll('[role="img"]')).map((i) => i.getAttribute('aria-label'))).toEqual([
      'Included',
      'Not included',
      'Not included',
    ]);
    expect(screen.queryByText('SAST, IaC, secrets and CI/CD')).toBeNull();
  });

  it('e-mail and password accounts are Open Source only; the cloud names its sign-in providers', () => {
    render(<EditionsPage />);
    const table = screen.getByRole('table');
    const accounts = within(table).getByText('Email and password accounts').closest('tr') as HTMLElement;
    expect(Array.from(accounts.querySelectorAll('[role="img"]')).map((i) => i.getAttribute('aria-label'))).toEqual([
      'Included',
      'Not included',
      'Not included',
    ]);
    const cells = within(accounts).getAllByRole('cell');
    expect(within(cells[2]).getByText('GitHub, GitLab, Microsoft or Google sign-in')).toBeInTheDocument();
    expect(within(cells[3]).getByText('GitHub, GitLab, Microsoft or Google sign-in')).toBeInTheDocument();
  });

  it('the « SSO / SAML » row is Enterprise only', () => {
    render(<EditionsPage />);
    const sso = within(screen.getByRole('table')).getByText('SSO / SAML').closest('tr') as HTMLElement;
    expect(Array.from(sso.querySelectorAll('[role="img"]')).map((i) => i.getAttribute('aria-label'))).toEqual([
      'Not included',
      'Not included',
      'Included',
    ]);
  });

  it('a « Why Cloud » block above the matrix puts forward what Cloud brings to SAST', () => {
    render(<EditionsPage />);
    const block = screen.getByRole('region', { name: 'Why Cloud' });
    expect(block.compareDocumentPosition(screen.getByRole('table')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(block).getByText('Reachability analysis for SAST')).toBeInTheDocument();
    expect(within(block).getByText('Fewer false positives')).toBeInTheDocument();
    expect(within(block).getByText('5,000+ proprietary rules')).toBeInTheDocument();
    const languages = within(block).getByRole('list', { name: 'Languages covered' });
    expect(within(languages).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      ...PROPRIETARY_RULE_LANGUAGES,
    ]);
    expect(within(languages).getByText('Rust')).toBeInTheDocument();
    const cta = within(block).getByText('Try CybeDefend Cloud').closest('a') as HTMLElement;
    expect(cta).toHaveAttribute('href', upsellLink('editions', '/pricing'));
    expect(cta).toHaveAttribute('target', '_blank');
    expect(cta.getAttribute('rel')?.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
  });

  it('the matrix keeps a row for each highlight', () => {
    render(<EditionsPage />);
    const table = screen.getByRole('table');
    const marks = (label: string) =>
      Array.from(
        (within(table).getByText(label).closest('tr') as HTMLElement).querySelectorAll('[role="img"]'),
      ).map((i) => i.getAttribute('aria-label'));
    expect(marks('Reachability analysis (SAST)')).toEqual(['Not included', 'Included', 'Included']);
    expect(marks('False-positive reduction')).toEqual(['Not included', 'Included', 'Included']);
    expect(marks('Proprietary rules')).toEqual(['Not included', 'Included', 'Included']);
    const rules = within(table).getByText('Proprietary rules').closest('tr') as HTMLElement;
    expect(within(rules).getAllByText('5,000+ rules')).toHaveLength(2);
  });

  it('the route exists in community, inside the shell', () => {
    expect(pageAt('community', '/editions')).toBe('EditionsPage');
  });

  it('the route does not exist in the cloud', () => {
    expect(pageAt('cloud', '/editions')).toBe('NotFoundPage');
  });
});
