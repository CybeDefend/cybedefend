import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FilterBar, { type DateRangeFilterConfig, type SearchSelectFilterConfig } from './FilterBar';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

/**
 * `variant`: the bar of the results tables (`card`, the default) and the bar
 * of a zinc-kit page (`toolbar`). The default is pinned to the
 * byte, since the Platform renders it: its snapshots were first captured
 * before `variant` existed, then re-baselined once to the Platform refresh
 * (checked against the former ones element by
 * element: same elements, attributes and text, classes only). Do not update
 * them to make a change pass: gate the change behind `toolbar` instead.
 *
 * The toolbar is drawn to the zinc kit: no card of its own
 * (it sits on the page), a 32 px hairline toggle, the count of active filters
 * as a quiet mono figure (not an accent-filled disc), a hairline panel, zinc
 * words, no icon before a label. Its behaviour is the card's: same toggle
 * name, same `filter-bar-panel` and `filter-bar-active-count`.
 */

/** React's `useId` values come from one counter for the whole run: renumbered per snapshot. */
const normalize = (html: string): string => {
  const ids = new Map<string, string>();
  return html
    .replace(/:r[0-9a-z]+:/g, (id) => {
      if (!ids.has(id)) ids.set(id, `:id${ids.size}:`);
      return ids.get(id) as string;
    })
    .replace(/></g, '>\n<');
};

beforeEach(() => {
  // The Input/Select atoms draw their ids from Math.random.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const list = (id: string, label: string, value = ['a']) => ({
  id,
  label,
  options: [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ],
  value,
  onChange: vi.fn(),
});
const period = (overrides: Partial<DateRangeFilterConfig> = {}): DateRangeFilterConfig => ({
  id: 'period',
  label: 'Period',
  fromLabel: 'From',
  toLabel: 'To',
  from: '2026-09-01',
  to: null,
  onChange: vi.fn(),
  ...overrides,
});
const searched = (overrides: Partial<SearchSelectFilterConfig> = {}): SearchSelectFilterConfig => ({
  id: 'project',
  label: 'Project',
  allLabel: 'All projects',
  value: 'p-1',
  valueLabel: 'payments-api',
  searchPlaceholder: 'Search a project',
  errorText: 'The projects could not be loaded.',
  load: vi.fn(async () => ({ options: [], hasMore: false })),
  onChange: vi.fn(),
  ...overrides,
});
const sort = {
  orderOptions: [
    { value: 'date', label: 'Date' },
    { value: 'name', label: 'Name' },
  ],
  directionOptions: [
    { value: 'desc', label: 'Descending' },
    { value: 'asc', label: 'Ascending' },
  ],
  selectedOrder: 'date',
  selectedDirection: 'desc',
  onOrderChange: vi.fn(),
  onDirectionChange: vi.fn(),
};

/** Every kind of control at once: more than five, so the bar collapses behind its toggle. */
const everything = () => ({
  filters: [list('type', 'Type'), list('agent', 'Coding agent', ['a', 'b'])],
  dateRange: period(),
  searchFilters: [searched(), searched({ id: 'user', label: 'User', value: null, valueLabel: null })],
  textFilters: [{ id: 'branch', label: 'Branch', value: 'main', onChange: vi.fn() }],
  sort,
  onSearchChange: vi.fn(),
  searchPlaceholder: 'Search',
});

const toggle = () => screen.getByRole('button', { name: /^filters/i });

describe('FilterBar — the default (card) variant keeps today’s DOM', () => {
  it('collapsed, with every kind of control, its panel open', () => {
    const { container } = render(<FilterBar {...everything()} />);
    fireEvent.click(toggle());
    expect(normalize(container.innerHTML)).toMatchSnapshot();
  });

  it('inline, with a period and a text filter', () => {
    const { container } = render(
      <FilterBar
        filters={[list('type', 'Type')]}
        dateRange={period()}
        textFilters={[{ id: 'branch', label: 'Branch', value: '', onChange: vi.fn() }]}
      />,
    );
    expect(normalize(container.innerHTML)).toMatchSnapshot();
  });

  it('with a searched choice that could not be read', async () => {
    const failing = searched({ value: null, valueLabel: null, load: vi.fn(async () => Promise.reject(new Error('500'))) });
    const { container } = render(<FilterBar filters={[]} searchFilters={[failing]} />);
    fireEvent.click(toggle());
    fireEvent.click(within(screen.getByTestId('filter-bar-panel')).getByRole('button', { name: 'Project' }));
    await waitFor(() => expect(screen.getAllByRole('status').length).toBeGreaterThan(0));
    // The open list lives in a portal: the bar's own DOM is what is pinned.
    expect(normalize(container.innerHTML)).toMatchSnapshot();
  });

  it('is what `variant="card"` renders too', () => {
    const one = render(<FilterBar {...everything()} />);
    const html = normalize(one.container.innerHTML);
    one.unmount();
    const two = render(<FilterBar {...everything()} variant="card" />);
    expect(normalize(two.container.innerHTML)).toBe(html);
  });
});

describe('FilterBar — the toolbar variant', () => {
  const renderToolbar = (props: Partial<React.ComponentProps<typeof FilterBar>> = {}) =>
    render(<FilterBar {...everything()} variant="toolbar" className="mb-4" {...props} />);

  it('keeps the behaviour: the same toggle, panel and count, and « Clear filters »', () => {
    const onClearFilters = vi.fn();
    renderToolbar({ onClearFilters });
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('filter-bar-panel')).toBeNull();
    // Type, the period and the project are on.
    expect(screen.getByTestId('filter-bar-active-count')).toHaveTextContent('3');
    expect(screen.getByTestId('filter-bar-active-count')).toHaveAttribute(
      'title',
      expect.stringContaining('Period'),
    );
    expect(toggle()).toHaveAccessibleName('Filters 3');

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByTestId('filter-bar-panel');
    expect(within(panel).getByRole('button', { name: 'Type: A' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Project' })).toHaveTextContent('payments-api');
    expect(within(panel).getByLabelText('From')).toHaveValue('2026-09-01');
    expect(within(panel).getByRole('textbox', { name: 'Branch' })).toHaveValue('main');

    fireEvent.click(screen.getAllByRole('button', { name: /clear filters/i })[0]);
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('sits on the page: no card of its own, the caller’s classes kept', () => {
    const { container } = renderToolbar();
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('mb-4');
    for (const card of ['bg-white', 'border-b', 'px-4', 'py-3', 'dark:bg-neutral-800']) {
      expect(root).not.toHaveClass(card);
    }
  });

  it('lays the toggle and « Clear filters » on one wrapping row', () => {
    renderToolbar();
    const row = toggle().parentElement as HTMLElement;
    expect(row).toHaveClass('flex', 'flex-wrap', 'items-center', 'gap-2');
    expect(within(row).getByRole('button', { name: /clear filters/i })).toBeInTheDocument();
  });

  it('draws the toggle as a 32 px hairline button, its word visible at every width', () => {
    renderToolbar();
    const button = toggle();
    expect(button).toHaveClass('h-8', 'rounded-lg', 'text-[13px]', 'border-zinc-200', 'shrink-0');
    expect(button.className).toMatch(/dark:border-white\/\[0\.1\]/);
    expect(button.className).not.toMatch(/shadow-sm|bg-secondary|gray-|neutral-/);
    // No icon carries the word on a phone here: the word is never visually hidden.
    expect(within(button).getByText('Filters')).not.toHaveClass('sr-only');
    // No funnel before the word: the chevron says it opens.
    expect(button.querySelector('.cybe-icon-filter')).toBeNull();
    expect(button.querySelector('.cybe-icon-chevron-down')).not.toBeNull();
  });

  it('rings the toggle and « Clear filters » for the keyboard only: a click leaves no halo', () => {
    renderToolbar();
    const row = toggle().parentElement as HTMLElement;
    for (const button of [toggle(), within(row).getByRole('button', { name: /clear filters/i })]) {
      expect(button).toHaveClass('focus:ring-0', 'focus-visible:ring-2', 'focus-visible:ring-zinc-300');
      expect(button.className).not.toMatch(/(?:^|\s)focus:ring-2(?:\s|$)/);
    }
  });

  it('marks the open toggle with a neutral fill and turns its chevron', () => {
    renderToolbar();
    fireEvent.click(toggle());
    expect(toggle().className).toMatch(/bg-zinc-50/);
    expect(toggle().querySelector('.cybe-icon-chevron-down')).toHaveClass('rotate-180');
  });

  it('says how many filters are on as a quiet mono figure, never an accent disc', () => {
    renderToolbar();
    const count = screen.getByTestId('filter-bar-active-count');
    expect(count).toHaveClass('font-mono', 'tabular-nums');
    expect(count.className).toMatch(/text-zinc-500/);
    expect(count.className).not.toMatch(/secondary|text-white|rounded-full/);
  });

  it('offers « Clear filters » as a quiet word, without an icon', () => {
    renderToolbar();
    const row = toggle().parentElement as HTMLElement;
    const clear = within(row).getByRole('button', { name: /clear filters/i });
    expect(within(clear).getByText('Clear filters')).not.toHaveClass('hidden');
    expect(clear.querySelector('svg')).toBeNull();
    expect(clear.className).toMatch(/text-zinc-500/);
    expect(clear.className).not.toMatch(/gray-|neutral-/);
  });

  it('opens a hairline panel, its labels plain words in zinc', () => {
    renderToolbar();
    fireEvent.click(toggle());
    const panel = screen.getByTestId('filter-bar-panel');
    expect(panel).toHaveClass('rounded-xl', 'border', 'border-zinc-200', 'bg-white');
    expect(panel.className).toMatch(/dark:border-white\/\[0\.07\] dark:bg-\[#0c0c0e\]/);
    expect(panel.className).not.toMatch(/shadow|gray-|neutral-/);
    const filterBy = within(panel).getByText('Filter by');
    expect(filterBy.className).toMatch(/text-zinc-500/);
    expect(filterBy).not.toHaveClass('uppercase');
    expect(filterBy.querySelector('svg')).toBeNull();
    const orderBy = within(panel).getByText('Order by');
    expect(orderBy.querySelector('svg')).toBeNull();
    // The lists still stack in one column on a phone.
    const grid = panel.querySelector('.grid') as HTMLElement;
    expect(grid).toHaveClass('grid-cols-1', 'sm:grid-cols-2');
    // The day fields name themselves in zinc.
    expect(within(panel).getByText('From').className).toMatch(/text-zinc-500/);
  });

  it('says a failed search in zinc, as a status', async () => {
    const failing = searched({ value: null, valueLabel: null, load: vi.fn(async () => Promise.reject(new Error('500'))) });
    render(<FilterBar filters={[]} searchFilters={[failing]} variant="toolbar" />);
    fireEvent.click(toggle());
    fireEvent.click(within(screen.getByTestId('filter-bar-panel')).getByRole('button', { name: 'Project' }));
    const status = await screen.findByText('The projects could not be loaded.');
    expect(status).toHaveAttribute('role', 'status');
    expect(status.className).toMatch(/text-zinc-500/);
  });

  it('lays a short bar inline from xl, with plain-word labels and no icon', () => {
    const { container } = render(
      <FilterBar filters={[list('type', 'Type')]} sort={sort} variant="toolbar" />,
    );
    const inline = container.querySelector('[data-filter-bar-inline]') as HTMLElement;
    expect(inline).not.toBeNull();
    expect(inline).toHaveClass('hidden', 'xl:flex');
    expect(within(inline).getByText('Filter by').closest('div')?.querySelector('svg')).toBeNull();
    expect(within(inline).getByText('Order by').closest('div')?.querySelector('svg')).toBeNull();
    const clear = within(inline).getByRole('button', { name: /clear filters/i });
    expect(clear.querySelector('svg')).toBeNull();
  });

  it('draws nothing in the accent, nor the card’s grey or neutral ramps, in what it draws itself', () => {
    const { container } = renderToolbar();
    fireEvent.click(toggle());
    // The bar's own pieces, not the Select/Input atoms it holds.
    const own = [
      container.firstElementChild as HTMLElement,
      toggle(),
      toggle().parentElement as HTMLElement,
      screen.getByTestId('filter-bar-active-count'),
      screen.getByTestId('filter-bar-panel'),
    ];
    for (const element of own) {
      expect(element.getAttribute('class') ?? '').not.toMatch(/secondary|gray-|neutral-|shadow-sm|font-bold/);
    }
  });
});
