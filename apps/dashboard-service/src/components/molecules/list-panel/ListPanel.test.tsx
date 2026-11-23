import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ListPanel from './ListPanel';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

describe('ListPanel', () => {
  it('labels the section with its title heading', () => {
    render(<ListPanel title="Recent scans">rows</ListPanel>);

    const section = screen.getByRole('region', { name: 'Recent scans' });
    expect(section.tagName).toBe('SECTION');
    const heading = screen.getByRole('heading', { level: 2, name: 'Recent scans' });
    expect(section).toHaveAttribute('aria-labelledby', heading.id);
  });

  it('renders the title as h3 and the wrapper as the requested element', () => {
    const { container } = render(
      <ListPanel title="History" titleAs="h3" as="aside" data-testid="panel">
        rows
      </ListPanel>,
    );

    expect(screen.getByRole('heading', { level: 3, name: 'History' })).toBeInTheDocument();
    expect(screen.getByTestId('panel').tagName).toBe('ASIDE');
    expect(container.querySelector('section')).toBeNull();
  });

  it('shows the icon, description, count badge and actions in the header', () => {
    render(
      <ListPanel
        title="Scans"
        description="Last 30 days"
        icon={<span data-testid="panel-icon" />}
        count={12}
        actions={<a href="/all">See all</a>}
      >
        rows
      </ListPanel>,
    );

    expect(screen.getByTestId('panel-icon')).toBeInTheDocument();
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
    expect(screen.getByTestId('list-panel-count')).toHaveTextContent('12');
    expect(screen.getByRole('link', { name: 'See all' })).toBeInTheDocument();
  });

  it('renders a count of zero', () => {
    render(<ListPanel title="Scans" count={0}>rows</ListPanel>);
    expect(screen.getByTestId('list-panel-count')).toHaveTextContent('0');
  });

  it('offers an icon-only refresh button that calls back', () => {
    const onRefresh = vi.fn();
    render(
      <ListPanel title="Scans" onRefresh={onRefresh}>
        rows
      </ListPanel>,
    );

    const refresh = screen.getByRole('button', { name: 'Refresh' });
    expect(refresh).toBeEnabled();
    fireEvent.click(refresh);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('honours a custom refresh label, and disables and spins while refreshing', () => {
    const onRefresh = vi.fn();
    render(
      <ListPanel title="Scans" onRefresh={onRefresh} refreshing refreshLabel="Reload scans">
        rows
      </ListPanel>,
    );

    const refresh = screen.getByRole('button', { name: 'Reload scans' });
    expect(refresh).toBeDisabled();
    expect(refresh.querySelector('.animate-spin')).not.toBeNull();
    fireEvent.click(refresh);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('renders no refresh button without onRefresh', () => {
    render(<ListPanel title="Scans">rows</ListPanel>);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows skeleton rows and marks the body busy while loading', () => {
    render(
      <ListPanel title="Scans" loading loadingRows={5} isEmpty empty={<p>Nothing yet</p>}>
        <p>row content</p>
      </ListPanel>,
    );

    const body = screen.getByTestId('list-panel-body');
    expect(body).toHaveAttribute('aria-busy', 'true');
    expect(within(body).getAllByTestId('list-panel-skeleton-row')).toHaveLength(5);
    expect(screen.queryByText('row content')).toBeNull();
    expect(screen.queryByText('Nothing yet')).toBeNull();
  });

  it('defaults to three skeleton rows', () => {
    render(<ListPanel title="Scans" loading>rows</ListPanel>);
    expect(screen.getAllByTestId('list-panel-skeleton-row')).toHaveLength(3);
  });

  it('shows the empty state instead of children when empty', () => {
    render(
      <ListPanel title="Scans" isEmpty empty={<p>Nothing yet</p>}>
        <p>row content</p>
      </ListPanel>,
    );

    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
    expect(screen.queryByText('row content')).toBeNull();
    expect(screen.getByTestId('list-panel-body')).not.toHaveAttribute('aria-busy');
  });

  it('shows children when not empty', () => {
    render(
      <ListPanel title="Scans" empty={<p>Nothing yet</p>}>
        <p>row content</p>
      </ListPanel>,
    );

    expect(screen.getByText('row content')).toBeInTheDocument();
    expect(screen.queryByText('Nothing yet')).toBeNull();
  });

  it('renders a footer strip', () => {
    render(
      <ListPanel title="Scans" footer={<nav aria-label="Pagination">pages</nav>}>
        rows
      </ListPanel>,
    );

    const footer = screen.getByTestId('list-panel-footer');
    expect(footer).toHaveClass('border-t');
    expect(within(footer).getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
  });

  it('omits the footer strip when no footer is given', () => {
    render(<ListPanel title="Scans">rows</ListPanel>);
    expect(screen.queryByTestId('list-panel-footer')).toBeNull();
  });

  it('paints an accent header band on demand', () => {
    const { rerender } = render(<ListPanel title="Scans">rows</ListPanel>);
    expect(screen.getByTestId('list-panel-header')).not.toHaveClass('bg-secondary/5');

    rerender(
      <ListPanel title="Scans" headerTone="accent">
        rows
      </ListPanel>,
    );
    const header = screen.getByTestId('list-panel-header');
    expect(header).toHaveClass('bg-secondary/5');
    expect(header).toHaveClass('dark:bg-secondary/10');
  });

  it('forwards className and data-testid to the wrapper', () => {
    render(
      <ListPanel title="Scans" className="mt-6" data-testid="scans-panel">
        rows
      </ListPanel>,
    );

    const panel = screen.getByTestId('scans-panel');
    expect(panel).toHaveClass('mt-6');
    expect(panel.tagName).toBe('SECTION');
    // The surface inside is the Card atom, unpadded and clipped.
    expect(panel.firstElementChild).toHaveClass('overflow-hidden', 'p-0', 'rounded-2xl');
  });
});
