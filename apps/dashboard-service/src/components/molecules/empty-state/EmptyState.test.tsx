import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';
import { Search } from '@/components/atoms/icon/icons';

/**
 * The product grew seven different ways to say "there is nothing here": a
 * product logo, a magnifying glass, a green tick on a green square, plain
 * centred text… Nothing told the user whether an empty screen was good news or
 * a problem, and each convention had its own spacing.
 *
 * One component, one medallion, and a `tone` that carries the meaning:
 * `positive` for "nothing wrong was found", `neutral` for "no data yet",
 * `warning` for "something is filtering the view".
 */
describe('EmptyState', () => {
  it('reads as good news when the emptiness is a good outcome', () => {
    const { container } = render(<EmptyState tone="positive" title="No vulnerabilities" />);

    const medallion = container.querySelector('[data-testid="empty-state-visual"]');
    expect(medallion?.className).toMatch(/green/);
  });

  it('stays neutral when the screen is simply waiting for data', () => {
    const { container } = render(<EmptyState title="No data yet" />);

    const medallion = container.querySelector('[data-testid="empty-state-visual"]');
    expect(medallion?.className).toMatch(/gray/);
  });

  it('flags that a filter is hiding things', () => {
    const { container } = render(<EmptyState tone="warning" title="Nothing matches" />);

    const medallion = container.querySelector('[data-testid="empty-state-visual"]');
    expect(medallion?.className).toMatch(/amber/);
  });

  it('keeps its text column readable rather than stretched edge to edge', () => {
    const { container } = render(
      <EmptyState title="Nothing here" description="A description that would otherwise run the full width of a 1300px card." />,
    );

    expect(container.querySelector('[data-testid="empty-state-copy"]')?.className).toMatch(/max-w/);
  });

  it('still takes a caller-supplied icon', () => {
    const { container } = render(<EmptyState title="Nothing" icon={<Search />} />);

    expect(container.querySelector('.cybe-icon-search')).toBeInTheDocument();
  });

  it('renders the action it is given', () => {
    render(<EmptyState title="Nothing" action={<button type="button">Run a scan</button>} />);

    expect(screen.getByRole('button', { name: 'Run a scan' })).toBeInTheDocument();
  });
});
