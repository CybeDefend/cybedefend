import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import Panel, { PANEL_CLASSES } from './Panel';
import { Panel as FromIndex } from '.';

const header = (container: HTMLElement) => container.querySelector('[data-panel-header]') as HTMLElement | null;

/**
 * "Panel": `rounded-xl border border-zinc-200 bg-white`, in
 * dark the surface token on its hairline with a 1 px inner top highlight
 * (`PLATE_DARK`) and no drop shadow, 16–20 px of padding,
 * as tall as its content (never stretched by a grid row), a title row with the
 * title left and the muted meta or one ghost action right.
 */
describe('Panel', () => {
  it('is a section on the kit surface, without a drop shadow, as tall as its content', () => {
    const { container } = render(<Panel title="Agents">rows</Panel>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.tagName).toBe('SECTION');
    expect(PANEL_CLASSES).toBe(
      'rounded-xl border border-zinc-200 bg-white dark:border-vd-line dark:bg-vd-surface dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]',
    );
    expect(root).toHaveClass(...PANEL_CLASSES.split(' '), 'h-fit', 'p-4', 'sm:p-5');
    // A grid row stretches its items; `h-fit` keeps the panel at its content's height.
    expect(root.className).not.toMatch(/(?<!dark:)shadow|dark:shadow-(?!\[inset)|h-full|flex-1|self-stretch|gradient/);
  });

  it('names its region with its title: 15 px, 500, sentence case, no icon before it', () => {
    const { container } = render(<Panel title="Agents">rows</Panel>);
    expect(screen.getByRole('region', { name: 'Agents' })).toBe(container.firstElementChild);
    const title = screen.getByRole('heading', { level: 2, name: 'Agents' });
    expect(title).toHaveClass('text-[15px]', 'font-medium', 'text-zinc-900', 'dark:text-zinc-100');
    expect(title.className).not.toMatch(/uppercase|font-(?:semibold|bold)/);
    expect(header(container)?.querySelector('svg')).toBeNull();
  });

  it('puts the muted meta and the actions on the right of the title row, in that order', () => {
    const { container } = render(
      <Panel title="Agents" meta="Last 7 days" actions={<a href="/space/activity">All activity</a>}>
        rows
      </Panel>,
    );
    const meta = screen.getByText('Last 7 days');
    expect(meta).toHaveClass('text-[13px]', 'text-zinc-500', 'dark:text-zinc-400');
    const action = screen.getByRole('link', { name: 'All activity' });
    expect(meta.parentElement).toBe(action.parentElement);
    expect(meta.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const title = screen.getByRole('heading', { name: 'Agents' });
    expect(title.compareDocumentPosition(meta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(header(container)).toHaveClass('flex', 'items-center', 'justify-between');
  });

  it('draws no title row when it has no title, meta nor actions', () => {
    const { container } = render(<Panel>just content</Panel>);
    expect(header(container)).toBeNull();
    expect(container.firstElementChild).toHaveTextContent('just content');
    // Without a title a section is no named region.
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('renders as an aside or a div, with an h3 title when asked', () => {
    const { container, rerender } = render(<Panel as="aside" title="Next" titleAs="h3">x</Panel>);
    expect(container.firstElementChild?.tagName).toBe('ASIDE');
    expect(screen.getByRole('heading', { level: 3, name: 'Next' })).toBeInTheDocument();
    rerender(<Panel as="div" title="Next">x</Panel>);
    expect(container.firstElementChild?.tagName).toBe('DIV');
  });

  it('lets a list run flush when unpadded: the title row keeps the padding, the corners clip the rows', () => {
    const { container } = render(
      <Panel title="Agents" padded={false}>
        <ul data-testid="list" />
      </Panel>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toMatch(/(?:^|\s)p-4|sm:p-5/);
    expect(root).toHaveClass('overflow-hidden');
    expect(header(container)).toHaveClass('px-4', 'sm:px-5', 'pt-4');
    expect(screen.getByTestId('list').parentElement).toBe(root);
  });

  it('forwards className and attributes, and is exported from the folder index', () => {
    render(
      <FromIndex title="x" className="lg:col-span-2" data-testid="panel">
        y
      </FromIndex>,
    );
    expect(screen.getByTestId('panel')).toHaveClass('lg:col-span-2', 'rounded-xl');
  });
});
