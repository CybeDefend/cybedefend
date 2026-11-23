import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OrganizationOverviewFiltersBar from './OrganizationOverviewFiltersBar';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const renderBar = (filters = {}) =>
  render(
    <OrganizationOverviewFiltersBar
      filters={filters as never}
      onFiltersChange={vi.fn()}
      onReset={vi.fn()}
    />,
  );

/**
 * This bar carried four option lists written in English inside the component
 * (`Critical`, `Open`, `Critical Count`…) while the labels above them came from
 * the locale — so a French screen mixed the two (audit 2.7). It also rendered
 * raw `<input>` and `<select>` elements, which is why the date fields looked
 * nothing like the rest of the form (audit 2.2).
 */
describe('OrganizationOverviewFiltersBar', () => {
  it('takes its severity words from the shared vocabulary', () => {
    renderBar();

    // The severity list only exists once the panel is open.
    fireEvent.click(screen.getByRole('button', { name: /more filters/i }));

    for (const label of ['Critical', 'High', 'Medium', 'Low']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('translates the state options instead of hardcoding them', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: /more filters/i }));

    expect(screen.getByText('Not Exploitable')).toBeInTheDocument();
  });

  it('renders no raw form control — the atoms own that styling', () => {
    const { container } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: /more filters/i }));

    expect(container.querySelectorAll('select')).toHaveLength(0);
    // `Input` renders the native element itself; nothing else may.
    for (const input of Array.from(container.querySelectorAll('input'))) {
      expect(input.className).toMatch(/rounded/);
    }
  });

  it('names the sort-direction control for anyone who cannot see the arrow', () => {
    renderBar();

    expect(screen.getByLabelText(/order/i)).toBeInTheDocument();
  });
});
