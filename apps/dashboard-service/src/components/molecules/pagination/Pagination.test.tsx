import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Pagination from './Pagination';
import enPagination from '@/i18n/locales/en/components/pagination.json';
import frPagination from '@/i18n/locales/fr/components/pagination.json';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const onPageChange = vi.fn();
const onPageSizeChange = vi.fn();

const base = {
  currentPage: 1,
  totalPages: 3,
  pageSize: 10,
  totalItems: 25,
  onPageChange,
  onPageSizeChange,
};

const renderPager = (props: Partial<React.ComponentProps<typeof Pagination>> = {}) =>
  render(<Pagination {...base} {...props} />);

// The component is shared by every table in the app. Its behaviour for the
// callers that do NOT opt in must not move by a pixel.
describe('Pagination — nothing to paginate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing when a single page is left', () => {
    const { container } = renderPager({ totalPages: 1, totalItems: 90 });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there are fewer items than the smallest page', () => {
    const { container } = renderPager({ totalPages: 1, totalItems: 4 });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the pager, and its size selector, when there is more than one page', () => {
    renderPager();
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});

// Opt-in, for a caller whose page size is the ONLY control over what a page
// costs upstream: collapsing the listing to one page must not take the size
// selector down with the pager (the container tag panel).
describe('Pagination — alwaysShowPageSize', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the size selector, and nothing else, when a single page is left', () => {
    renderPager({
      totalPages: 1,
      totalItems: 90,
      pageSize: 100,
      pageSizeOptions: [10, 25, 50, 100],
      alwaysShowPageSize: true,
    });

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('100');
    // Nothing to navigate: no page numbers, no prev/next, no items count.
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
    expect(screen.queryByText(/Showing/)).toBeNull();

    fireEvent.change(select, { target: { value: '10' } });
    expect(onPageSizeChange).toHaveBeenCalledWith(10);
  });

  it('renders nothing extra when there IS something to paginate', () => {
    renderPager({ alwaysShowPageSize: true });

    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByText(/Showing/)).toBeInTheDocument();
  });
});

// The component reads three keys that exist in NEITHER locale file, so it falls
// back to its inline English defaults: a French user reads "Showing 1-10 of 42"
// and "10 / page".
describe('Pagination — the strings it renders are translated', () => {
  const en = enPagination.components.pagination as Record<string, string>;
  const fr = frPagination.components.pagination as Record<string, string>;

  it.each(['showing', 'of', 'page'])('has a "%s" entry in en and in fr', (key) => {
    expect(en).toHaveProperty(key);
    expect(fr).toHaveProperty(key);
    expect(en[key]).not.toBe('');
    expect(fr[key]).not.toBe('');
  });

  it('actually translates the two that are words, not symbols', () => {
    expect(fr.showing).not.toBe(en.showing);
    expect(fr.of).not.toBe(en.of);
  });
});

describe('Pagination — showPageSize', () => {
  // A list with a fixed page size must not offer a one-option size selector.
  it('renders no page-size selector when showPageSize is false', () => {
    render(<Pagination {...base} showPageSize={false} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2/ })).toBeInTheDocument();
  });
});

// Opt-in, for a list paged by a cursor (the agents-space activity): only the
// page next to the current one can be asked, so no page number is offered.
describe('Pagination — showPageNumbers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers Previous and Next, the count and the size selector, and no page number', () => {
    renderPager({ currentPage: 2, totalPages: 5, totalItems: 48, showPageNumbers: false });
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(nav.querySelectorAll('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '5' })).not.toBeInTheDocument();
    expect(screen.getByText(/11-20/)).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenLastCalledWith(3);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPageChange).toHaveBeenLastCalledWith(1);
  });

  it('still shows the page numbers by default', () => {
    renderPager({ currentPage: 2, totalPages: 5, totalItems: 48 });
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5' })).toBeInTheDocument();
  });
});
