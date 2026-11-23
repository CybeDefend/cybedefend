import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FilterBar from './FilterBar';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const list = (id: string) => ({
  id,
  label: id,
  options: [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ],
  value: ['a', 'b'],
  onChange: vi.fn(),
});

/**
 * Seen at 320 px: the collapsed « Filters » toggle showed its
 * icon only, its label hidden by CSS, and said nothing of whether the panel
 * was open; in the open panel two columns cut the labels of the lists.
 */
describe('FilterBar on a phone', () => {
  it('names the toggle and says whether the panel is open', () => {
    render(<FilterBar filters={[list('Type')]} />);
    // Named by its own text at every width (hidden visually only below sm).
    const toggle = screen.getByRole('button', { name: /^Filters/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('stacks the lists of the open panel in one column below sm', () => {
    render(<FilterBar filters={[list('Type'), list('Agent')]} />);
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    const grid = screen.getByTestId('filter-bar-panel').querySelector('.grid') as HTMLElement;
    expect(grid).toHaveClass('grid-cols-1', 'sm:grid-cols-2');
    expect(grid).not.toHaveClass('grid-cols-2');
  });

  it('keeps the count of active filters in the name of the toggle', () => {
    const narrowed = { ...list('Type'), value: ['a'] };
    render(<FilterBar filters={[narrowed]} />);
    // A screen reader must still hear that filters are hiding results.
    expect(screen.getByRole('button', { name: 'Filters 1' })).toBeInTheDocument();
  });

  it('names a text filter of the open panel', () => {
    render(
      <FilterBar
        filters={[]}
        textFilters={[{ id: 'q', label: 'Branch', value: '', onChange: vi.fn() }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    expect(screen.getAllByRole('textbox', { name: 'Branch' }).length).toBeGreaterThan(0);
    const inPanel = screen.getByTestId('filter-bar-panel').querySelector('input') as HTMLInputElement;
    expect(inPanel).toHaveAttribute('aria-label', 'Branch');
  });
});
