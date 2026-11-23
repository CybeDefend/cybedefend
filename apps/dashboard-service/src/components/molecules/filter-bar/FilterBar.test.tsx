import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import FilterBar, { type DateRangeFilterConfig, type SearchSelectFilterConfig } from './FilterBar';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const severity = (onChange = vi.fn()) => ({
  id: 'severity',
  label: 'Severity',
  options: [
    { value: 'CRITICAL', label: 'Critical' },
    { value: 'HIGH', label: 'High' },
    { value: 'LOW', label: 'Low' },
  ],
  value: ['CRITICAL', 'HIGH'],
  onChange,
  multiple: true,
});

/**
 * The vulnerabilities screen opened on "Filters 1" with a filter already on,
 * and the results area said "no issue matches your criteria" without naming a
 * criterion or offering a way out — so an empty list read as "you have
 * nothing" when in fact something was hidden.
 */
describe('FilterBar', () => {
  it('names the filters behind the active count', () => {
    render(<FilterBar filters={[severity()]} />);

    expect(screen.getByTestId('filter-bar-active-count')).toHaveAttribute(
      'title',
      expect.stringContaining('Severity'),
    );
  });

  it('offers a way to clear what is hiding results', () => {
    render(<FilterBar filters={[severity()]} />);

    // Inline on wide screens, beside the « Filters » toggle when collapsed.
    expect(screen.getAllByRole('button', { name: /clear filters/i }).length).toBeGreaterThan(0);
  });

  it('clearing restores every option of every filter', () => {
    const onChange = vi.fn();
    render(<FilterBar filters={[severity(onChange)]} />);

    fireEvent.click(screen.getAllByRole('button', { name: /clear filters/i })[0]);

    expect(onChange).toHaveBeenCalledWith(['CRITICAL', 'HIGH', 'LOW']);
  });

  it('shows no clear affordance when nothing is filtered', () => {
    const filter = { ...severity(), value: ['CRITICAL', 'HIGH', 'LOW'] };
    render(<FilterBar filters={[filter]} />);

    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument();
  });
});

/**
 * A period and a choice among many found by a server-side search: the
 * an activity page filters on both, through the same bar as the results
 * tables. Six controls collapse the bar: the « Filters » toggle opens them.
 */
describe('FilterBar — a period and a searched choice', () => {
  const project = (overrides: Partial<SearchSelectFilterConfig> = {}): SearchSelectFilterConfig => ({
    id: 'project',
    label: 'Project',
    allLabel: 'All projects',
    value: null,
    valueLabel: null,
    load: vi.fn(async () => ({
      options: [
        { value: 'p-1', label: 'checkout-service' },
        { value: 'p-2', label: 'billing' },
      ],
      hasMore: false,
    })),
    onChange: vi.fn(),
    ...overrides,
  });
  const period = (overrides: Partial<DateRangeFilterConfig> = {}): DateRangeFilterConfig => ({
    id: 'period',
    label: 'Period',
    fromLabel: 'From',
    toLabel: 'To',
    from: null,
    to: null,
    onChange: vi.fn(),
    ...overrides,
  });
  const open = () => fireEvent.click(screen.getByRole('button', { name: /^filters/i }));
  /** The collapsed panel: the inline copy is hidden by CSS, which jsdom does not apply. */
  const panel = () => screen.getByTestId('filter-bar-panel');
  const fromField = () => within(panel()).getByLabelText('From') as HTMLInputElement;

  it('keeps a year being typed in a day field, and filters only on a real day', () => {
    const dateRange = period();
    render(<FilterBar filters={[]} dateRange={dateRange} searchFilters={[project()]} />);
    open();

    for (const partial of ['0002-10-06', '0020-10-06', '0202-10-06']) {
      fireEvent.change(fromField(), { target: { value: partial } });
      expect(fromField().value).toBe(partial);
    }
    expect(dateRange.onChange).not.toHaveBeenCalled();

    fireEvent.change(fromField(), { target: { value: '2026-10-06' } });
    expect(dateRange.onChange).toHaveBeenLastCalledWith({ from: '2026-10-06', to: null });
  });

  it('clears a day when its field is emptied, and puts back the day on leaving a field it cannot use', () => {
    const dateRange = period({ from: '2026-10-01' });
    render(<FilterBar filters={[]} dateRange={dateRange} />);
    open();
    fireEvent.change(fromField(), { target: { value: '0202-10-01' } });
    fireEvent.blur(fromField());
    expect(fromField().value).toBe('2026-10-01');
    expect(dateRange.onChange).not.toHaveBeenCalled();

    fireEvent.change(fromField(), { target: { value: '' } });
    expect(dateRange.onChange).toHaveBeenLastCalledWith({ from: null, to: null });
  });

  it('asks nothing before the searched choice is opened, then offers « all » and what the search found', async () => {
    const choice = project();
    render(<FilterBar filters={[]} searchFilters={[choice]} />);
    open();
    expect(choice.load).not.toHaveBeenCalled();

    fireEvent.click(within(panel()).getByRole('button', { name: 'Project' }));
    expect(await screen.findByText('checkout-service')).toBeInTheDocument();
    expect(choice.load).toHaveBeenCalledWith('', 1);

    fireEvent.click(screen.getByText('billing'));
    expect(choice.onChange).toHaveBeenLastCalledWith({ value: 'p-2', label: 'billing' });
  });

  it('shows the name of the chosen value, never its id, and « all » unsets it', async () => {
    const choice = project({ value: 'p-9', valueLabel: 'legacy-api' });
    render(<FilterBar filters={[]} searchFilters={[choice]} />);
    open();
    const trigger = within(panel()).getByRole('button', { name: 'Project' });
    expect(trigger).toHaveTextContent('legacy-api');
    expect(trigger).not.toHaveTextContent('p-9');

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByText('All projects'));
    expect(choice.onChange).toHaveBeenLastCalledWith(null);
  });

  it('counts a period and a searched choice among the active filters, and clears them', () => {
    const dateRange = period({ from: '2026-10-01' });
    const choice = project({ value: 'p-1', valueLabel: 'checkout-service' });
    render(<FilterBar filters={[]} dateRange={dateRange} searchFilters={[choice]} />);

    expect(screen.getByTestId('filter-bar-active-count')).toHaveTextContent('2');
    expect(screen.getByTestId('filter-bar-active-count')).toHaveAttribute(
      'title',
      expect.stringContaining('Period'),
    );
    fireEvent.click(screen.getAllByRole('button', { name: /clear filters/i })[0]);
    expect(dateRange.onChange).toHaveBeenCalledWith({ from: null, to: null });
    expect(choice.onChange).toHaveBeenCalledWith(null);
  });
});

describe('FilterBar — clearing in one go', () => {
  it('hands « Clear filters » to the caller when it clears everything itself', () => {
    const onClearFilters = vi.fn();
    const onChange = vi.fn();
    render(<FilterBar filters={[severity(onChange)]} onClearFilters={onClearFilters} />);

    fireEvent.click(screen.getAllByRole('button', { name: /clear filters/i })[0]);

    // One call: filters kept in the URL would otherwise each undo the one before.
    expect(onClearFilters).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});

/**
 * Seen in a browser: on a phone, the « Clear filters » label beside
 * the toggle crushed the search box of the results tables to its icon, under the
 * toggle; and in the open panel the searched choices were shorter than the
 * lists beside them, and greyed like a disabled field while unset.
 */
describe('FilterBar — the collapsed row and the panel at a glance', () => {
  const searched = (): SearchSelectFilterConfig => ({
    id: 'project',
    label: 'Project',
    allLabel: 'All projects',
    value: null,
    valueLabel: null,
    load: vi.fn(async () => ({ options: [], hasMore: false })),
    onChange: vi.fn(),
  });
  const collapsedRow = () =>
    screen.getByRole('button', { name: /^filters/i }).parentElement as HTMLElement;

  it('keeps the toggle and « Clear filters » their size, the label shown from `sm` only', () => {
    render(<FilterBar filters={[severity()]} onSearchChange={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: /^filters/i });
    const clear = within(collapsedRow()).getByRole('button', { name: /clear filters/i });

    expect(toggle).toHaveClass('shrink-0');
    expect(clear).toHaveClass('shrink-0');
    expect(within(clear).getByText(/clear filters/i)).toHaveClass('hidden', 'sm:inline');
  });

  it('gives a searched choice in the panel the size of the lists beside it, and « all » as a value', () => {
    const list = { ...severity(), value: ['CRITICAL', 'HIGH', 'LOW'] };
    render(<FilterBar filters={[list, list, list, list]} searchFilters={[searched()]} />);
    fireEvent.click(screen.getByRole('button', { name: /^filters/i }));
    const panel = screen.getByTestId('filter-bar-panel');
    const trigger = within(panel).getByRole('button', { name: 'Project' });

    expect(trigger).toHaveClass('py-3');
    expect(within(trigger).getByText('All projects')).not.toHaveClass('text-gray-500');
  });
});

/**
 * A list that may be left empty (`minChecked: 0`, the results tables'
 * Language) filters nothing when empty: the SAST table read « Filters 1 » and
 * offered « Clear filters » with no filter on.
 */
describe('FilterBar — a list that may be empty', () => {
  const language = (value: string[], onChange = vi.fn()) => ({
    id: 'language',
    label: 'Language',
    options: [
      { value: 'python', label: 'Python' },
      { value: 'go', label: 'Go' },
    ],
    value,
    onChange,
    multiple: true,
    minChecked: 0,
  });

  it('counts an empty list as no filter', () => {
    render(<FilterBar filters={[language([])]} />);
    expect(screen.queryByTestId('filter-bar-active-count')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /clear filters/i })).toHaveLength(0);
  });

  it('clears a chosen language back to an empty list, not to every language', () => {
    const onChange = vi.fn();
    render(<FilterBar filters={[language(['go'], onChange)]} />);
    fireEvent.click(screen.getAllByRole('button', { name: /clear filters/i })[0]);
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

/**
 * When the list is scrolled, the next page is loaded: the activity's project and user filters showed the first ten matches only.
 * Scrolling the open list to its end asks the next ten, for the same search.
 */
describe('FilterBar — a searched choice loads the next page at the end of its list', () => {
  type Page = { options: { value: string; label: string }[]; hasMore: boolean };
  const page = (search: string, n: number, hasMore: boolean): Page => ({
    options: Array.from({ length: 3 }, (_, i) => ({
      value: `${search || 'all'}-${n}-${i}`,
      label: `${search || 'all'} p${n} #${i}`,
    })),
    hasMore,
  });
  /** A load whose answers the test settles one by one, in any order. */
  const deferredLoad = () => {
    const pending: { search: string; page: number; resolve: (p: Page) => void; reject: (e: Error) => void }[] = [];
    const load = vi.fn(
      (search: string, n: number) =>
        new Promise<Page>((resolve, reject) => {
          pending.push({ search, page: n, resolve, reject });
        }),
    );
    const settle = (search: string, n: number, answer: Page | Error) => {
      const call = pending.find((p) => p.search === search && p.page === n);
      if (!call) throw new Error(`no call for ${search} page ${n}`);
      pending.splice(pending.indexOf(call), 1);
      if (answer instanceof Error) call.reject(answer);
      else call.resolve(answer);
    };
    return { load, settle };
  };
  const config = (load: SearchSelectFilterConfig['load']): SearchSelectFilterConfig => ({
    id: 'project',
    label: 'Project',
    allLabel: 'All projects',
    value: null,
    valueLabel: null,
    load,
    onChange: vi.fn(),
  });
  const openChoice = () => {
    fireEvent.click(screen.getByRole('button', { name: /^filters/i }));
    fireEvent.click(within(screen.getByTestId('filter-bar-panel')).getByRole('button', { name: 'Project' }));
  };
  const list = () => document.querySelector('[data-select-dropdown="true"] .overflow-auto') as HTMLElement;
  /** jsdom lays nothing out: the list is given a size, scrolled to its end. */
  const scrollToEnd = () => {
    const el = list();
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 400 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 240 });
    Object.defineProperty(el, 'scrollTop', { configurable: true, value: 160 });
    fireEvent.scroll(el);
  };
  const type = (text: string) =>
    fireEvent.change(document.querySelector('[data-select-dropdown="true"] input') as HTMLInputElement, {
      target: { value: text },
    });
  const pageCalls = (load: ReturnType<typeof vi.fn>, n: number) =>
    load.mock.calls.filter((call) => call[1] === n).length;

  it('asks the next page for the same search and adds it below, until there is no more', async () => {
    const { load, settle } = deferredLoad();
    render(<FilterBar filters={[]} searchFilters={[config(load)]} />);
    openChoice();
    await waitFor(() => expect(load).toHaveBeenCalledWith('', 1));
    settle('', 1, page('', 1, true));
    expect(await screen.findByText('all p1 #0')).toBeInTheDocument();

    scrollToEnd();
    expect(load).toHaveBeenLastCalledWith('', 2);
    settle('', 2, page('', 2, false));
    expect(await screen.findByText('all p2 #2')).toBeInTheDocument();
    expect(screen.getByText('all p1 #0')).toBeInTheDocument();

    scrollToEnd();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('asks no second page while one is loading', async () => {
    const { load, settle } = deferredLoad();
    render(<FilterBar filters={[]} searchFilters={[config(load)]} />);
    openChoice();
    await waitFor(() => expect(load).toHaveBeenCalledWith('', 1));
    settle('', 1, page('', 1, true));
    await screen.findByText('all p1 #0');

    scrollToEnd();
    scrollToEnd();
    scrollToEnd();
    expect(pageCalls(load, 2)).toBe(1);
  });

  it('starts again from page 1 on a new search, and drops a page of the search before', async () => {
    const { load, settle } = deferredLoad();
    render(<FilterBar filters={[]} searchFilters={[config(load)]} />);
    openChoice();
    await waitFor(() => expect(load).toHaveBeenCalledWith('', 1));
    settle('', 1, page('', 1, true));
    await screen.findByText('all p1 #0');
    scrollToEnd();
    expect(load).toHaveBeenLastCalledWith('', 2);

    type('api');
    await waitFor(() => expect(load).toHaveBeenLastCalledWith('api', 1));
    settle('', 2, page('', 2, true));
    settle('api', 1, page('api', 1, true));
    expect(await screen.findByText('api p1 #0')).toBeInTheDocument();
    expect(screen.queryByText('all p2 #0')).not.toBeInTheDocument();

    scrollToEnd();
    expect(load).toHaveBeenLastCalledWith('api', 2);
  });

  it('keeps what was loaded when a next page fails, shows no error and asks no more', async () => {
    const { load, settle } = deferredLoad();
    const choice = { ...config(load), errorText: 'Projects could not be loaded.' };
    render(<FilterBar filters={[]} searchFilters={[choice]} />);
    openChoice();
    await waitFor(() => expect(load).toHaveBeenCalledWith('', 1));
    settle('', 1, page('', 1, true));
    await screen.findByText('all p1 #0');

    scrollToEnd();
    settle('', 2, new Error('500'));
    await waitFor(() => expect(screen.queryByText(/loadingMore|loading more/i)).not.toBeInTheDocument());
    expect(screen.getByText('all p1 #2')).toBeInTheDocument();
    expect(screen.queryByText('Projects could not be loaded.')).not.toBeInTheDocument();

    scrollToEnd();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('FilterBar — a search the caller holds', () => {
  it('shows the value the caller holds, and follows it when the caller changes it', () => {
    const { rerender } = render(<FilterBar filters={[]} onSearchChange={vi.fn()} searchValue="postmark" />);
    for (const field of screen.getAllByRole('textbox')) expect(field).toHaveValue('postmark');

    rerender(<FilterBar filters={[]} onSearchChange={vi.fn()} searchValue="" />);
    for (const field of screen.getAllByRole('textbox')) expect(field).toHaveValue('');
  });

  it('keeps what is typed while the caller still holds the value it had', () => {
    const onSearchChange = vi.fn();
    render(<FilterBar filters={[]} onSearchChange={onSearchChange} searchValue="" />);
    const [field] = screen.getAllByRole('textbox');

    fireEvent.change(field, { target: { value: 'pay ' } });

    expect(field).toHaveValue('pay ');
    expect(onSearchChange).toHaveBeenLastCalledWith('pay ');
  });
});

describe('FilterBar — a searched choice without a search box', () => {
  const choice = (over: Partial<SearchSelectFilterConfig> = {}): SearchSelectFilterConfig => ({
    id: 'verdict',
    label: 'Verdict',
    allLabel: 'All verdicts',
    value: null,
    valueLabel: null,
    load: async () => ({ options: [{ value: 'clean', label: 'Clean' }], hasMore: false }),
    onChange: vi.fn(),
    ...over,
  });

  it('keeps the search box by default', async () => {
    render(<FilterBar filters={[]} searchFilters={[choice({ searchPlaceholder: 'Search a verdict' })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verdict' }));
    expect(await screen.findByText('Clean')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search a verdict')).toBeInTheDocument();
  });

  it('shows the choices alone when the caller says the list is too short to search', async () => {
    render(<FilterBar filters={[]} searchFilters={[choice({ searchable: false, searchPlaceholder: 'Search a verdict' })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verdict' }));
    expect(await screen.findByText('Clean')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search a verdict')).toBeNull();
  });
});
