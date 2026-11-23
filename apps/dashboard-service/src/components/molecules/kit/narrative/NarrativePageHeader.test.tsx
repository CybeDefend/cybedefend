import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import NarrativePageHeader from './NarrativePageHeader';

/**
 * The statement every zinc-kit page opens with: the title as the one `h1` at 24 px / 600, a 14 px zinc
 * description, an optional meta line, the actions on the right from a tablet
 * up; the eyebrow optional and small. No icon tile.
 */
describe('NarrativePageHeader', () => {
  it('names the page with one h1 under its eyebrow', () => {
    // Several facts in the eyebrow make one phrase: a comma, never a hairline nor a « · ».
    render(<NarrativePageHeader eyebrow="Agents, last 7 days, Acme" title="What your agents did this week" />);

    const h1 = screen.getByRole('heading', { level: 1, name: 'What your agents did this week' });
    expect(h1).toHaveClass('text-[24px]', 'font-semibold', 'tracking-[-0.02em]', 'text-zinc-900', 'dark:text-zinc-50');
    expect(h1.className).not.toMatch(/font-bold|text-2xl/);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

    const eyebrow = screen.getByText('Agents, last 7 days, Acme');
    expect(eyebrow).toHaveClass('uppercase', 'tracking-[0.08em]', 'text-xs');
    expect(eyebrow.querySelectorAll('[data-hairline]')).toHaveLength(0);
    expect(eyebrow).not.toHaveTextContent('·');
    // The eyebrow comes first in reading order.
    expect(eyebrow.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('needs no eyebrow: the title alone opens the page', () => {
    const { container } = render(<NarrativePageHeader title="Projects" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(container.querySelector('.uppercase')).toBeNull();
    expect(container.textContent).toBe('Projects');
  });

  it('stacks on a phone and puts the actions on the right from a tablet up', () => {
    const { container } = render(<NarrativePageHeader eyebrow="Set up" title="Link a repository" />);

    expect(container.firstElementChild).toHaveClass(
      'mb-6',
      'flex',
      'flex-col',
      'gap-4',
      'sm:flex-row',
      'sm:items-end',
      'sm:justify-between',
    );
    // A div, not a <header>: the page's only banner is the app header.
    expect(container.querySelector('header')).toBeNull();
  });

  it('keeps the actions in one wrapping row, in the order given', () => {
    render(
      <NarrativePageHeader
        eyebrow="Agents"
        title="Projects"
        actions={
          <>
            <a href="/space/connect" data-testid="connect">
              Link a repository
            </a>
            <a href="/new" data-testid="create">
              Create project
            </a>
          </>
        }
      />,
    );

    const connect = screen.getByTestId('connect');
    const create = screen.getByTestId('create');
    expect(connect.parentElement).toBe(create.parentElement);
    expect(connect.parentElement).toHaveClass('flex', 'flex-wrap', 'items-center', 'gap-2');
    expect(connect.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders no actions row when there is none', () => {
    const { container } = render(<NarrativePageHeader eyebrow="Agents" title="Agent activity" />);

    expect(container.querySelector('.flex-wrap.gap-2')).toBeNull();
  });

  it('writes a text description as a paragraph under the title', () => {
    render(
      <NarrativePageHeader
        eyebrow="Agents"
        title="Agent activity"
        description="What your coding agents did on the projects you can access."
      />,
    );

    const description = screen.getByText('What your coding agents did on the projects you can access.');
    expect(description.tagName).toBe('P');
    expect(description).toHaveClass('text-sm', 'text-zinc-500', 'dark:text-zinc-400');
  });

  it('takes a component as description without nesting a paragraph in a paragraph', () => {
    render(
      <NarrativePageHeader
        eyebrow="Organization"
        title="Organization overview"
        description={<p data-testid="headline">Compared with the previous 30 days: +20 diff scans.</p>}
      />,
    );

    const headline = screen.getByTestId('headline');
    expect(headline.parentElement?.tagName).not.toBe('P');
    expect(headline).toHaveTextContent('Compared with the previous 30 days: +20 diff scans.');
  });

  it('shows the meta line under the description, muted', () => {
    render(
      <NarrativePageHeader
        eyebrow="Agents"
        title="What your agents did this week"
        description="Description"
        meta={
          <>
            <span>12 projects you can read</span>
            <a href="/space/organization/overview">See the full report</a>
          </>
        }
      />,
    );

    const meta = screen.getByText('12 projects you can read').parentElement as HTMLElement;
    expect(meta).toHaveClass('flex', 'flex-wrap', 'items-center', 'text-[13px]', 'text-zinc-500', 'dark:text-zinc-400');
    expect(meta).toContainElement(screen.getByRole('link', { name: 'See the full report' }));
    const description = screen.getByText('Description');
    expect(description.compareDocumentPosition(meta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws no icon tile', () => {
    const { container } = render(<NarrativePageHeader eyebrow="Set up" title="Link a repository" />);

    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('passes a test id and extra classes to its root', () => {
    const { container } = render(
      <NarrativePageHeader eyebrow="Set up" title="Link a repository" data-testid="page-header" className="mb-8" />,
    );

    expect(screen.getByTestId('page-header')).toBe(container.firstElementChild);
    expect(container.firstElementChild).toHaveClass('mb-8');
  });
});
