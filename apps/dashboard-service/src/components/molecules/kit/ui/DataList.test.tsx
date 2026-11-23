import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const motion = vi.hoisted(() => ({ calm: false }));
vi.mock('@/components/molecules/kit/motion/useLivingMotion', () => {
  const useLivingMotion = () => ({ calm: motion.calm, setCalm: () => {}, reducedMotion: false });
  return { useLivingMotion, default: useLivingMotion };
});

import DataList, { DataRow } from './DataList';
import { DataList as ListFromIndex, DataRow as RowFromIndex } from '.';

const browserWithMotion = () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
};

const inRouter = (ui: React.ReactElement) =>
  render(
    <MemoryRouter initialEntries={['/space']}>
      <Routes>
        <Route path="/space" element={ui} />
        <Route path="/space/project/:id/rules" element={<p>project page</p>} />
      </Routes>
    </MemoryRouter>,
  );

/**
 * "Lists over cards": data as dense rows (40–44 px)
 * separated by hairlines, a 120 ms hover tint, the whole row is the link.
 * Think Linear's issue list.
 */
describe('DataList', () => {
  it('is a list whose rows are separated by hairlines', () => {
    render(
      <DataList aria-label="Agents">
        <DataRow>Claude Code</DataRow>
        <DataRow>Cursor</DataRow>
      </DataList>,
    );
    const list = screen.getByRole('list', { name: 'Agents' });
    expect(list.tagName).toBe('UL');
    expect(list).toHaveClass('divide-y', 'divide-zinc-200', 'dark:divide-vd-line');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('forwards className and attributes, and is exported from the folder index', () => {
    render(
      <ListFromIndex className="-mx-4" data-testid="l">
        <RowFromIndex>x</RowFromIndex>
      </ListFromIndex>,
    );
    expect(screen.getByTestId('l')).toHaveClass('-mx-4', 'divide-y');
  });
});

describe('DataRow', () => {
  beforeEach(() => {
    motion.calm = false;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a 44 px row: its text in ink, 14 px, truncated, padded like a panel', () => {
    const { container } = render(
      <ul>
        <DataRow data-testid="r">payments-api</DataRow>
      </ul>,
    );
    const row = screen.getByTestId('r');
    expect(row.tagName).toBe('LI');
    const inner = row.firstElementChild as HTMLElement;
    expect(inner).toHaveClass('min-h-11', 'px-4', 'sm:px-5', 'flex', 'flex-col', 'justify-center');
    expect(screen.getByText('payments-api')).toHaveClass('truncate', 'text-sm', 'text-zinc-900', 'dark:text-zinc-100');
    expect(container.querySelector('a, button')).toBeNull();
    // A row that leads nowhere does not pretend to: no hover tint.
    expect(row.className).not.toMatch(/hover:/);
  });

  it('is 40 px when small', () => {
    render(
      <ul>
        <DataRow size="sm" data-testid="r">x</DataRow>
      </ul>,
    );
    expect(screen.getByTestId('r').firstElementChild).toHaveClass('min-h-10');
  });

  it('lays out leading, text, meta then trailing; the meta in mono 13 px zinc on the right', () => {
    render(
      <ul>
        <DataRow
          leading={<span data-testid="lead">L</span>}
          meta="33 %"
          trailing={<span data-testid="trail">T</span>}
        >
          Claude Code
        </DataRow>
      </ul>,
    );
    const meta = screen.getByText('33 %');
    expect(meta).toHaveClass('shrink-0', 'font-mono', 'text-[13px]', 'tabular-nums', 'text-zinc-500', 'dark:text-zinc-400');
    const order = [screen.getByTestId('lead'), screen.getByText('Claude Code'), meta, screen.getByTestId('trail')];
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('puts what goes below (a meter) under the line, inside the row', () => {
    render(
      <ul>
        <DataRow data-testid="r" below={<span data-testid="meter" />}>
          Cursor
        </DataRow>
      </ul>,
    );
    const below = screen.getByTestId('meter');
    expect(screen.getByTestId('r')).toContainElement(below);
    expect(screen.getByText('Cursor').compareDocumentPosition(below) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('becomes the link when it has a destination: the whole row, a 120 ms hover tint, no accent', () => {
    inRouter(
      <ul>
        <DataRow to="/space/project/p-1/rules" meta="12" data-testid="r">
          payments-api
        </DataRow>
      </ul>,
    );
    const link = screen.getByRole('link', { name: /payments-api/ });
    expect(link).toHaveAttribute('href', '/space/project/p-1/rules');
    expect(link).toHaveClass('w-full', 'min-h-11', 'px-4');
    expect(link.className).not.toMatch(/secondary|rounded-xl|scale-\[0\.98\]/);
    const row = screen.getByTestId('r');
    expect(row).toHaveClass('group', 'transition-colors', 'duration-[120ms]', 'hover:bg-zinc-50', 'dark:hover:bg-vd-raised');

    fireEvent.click(screen.getByText('payments-api'));
    expect(screen.getByText('project page')).toBeInTheDocument();
  });

  it('takes the name a caller gives its link', () => {
    inRouter(
      <ul>
        <DataRow to="/space/project/p-1/rules" label="Open payments-api">
          payments-api
        </DataRow>
      </ul>,
    );
    expect(screen.getByRole('link', { name: 'Open payments-api' })).toBeInTheDocument();
  });

  it('becomes a button when it opens something in place', () => {
    const onSelect = vi.fn();
    render(
      <ul>
        <DataRow onSelect={onSelect} label="Open the detail of this event">
          Diff scan on feat/login
        </DataRow>
      </ul>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open the detail of this event' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('slides a fresh row in with a fading highlight when the page may move', () => {
    browserWithMotion();
    const { container } = render(
      <ul>
        <DataRow fresh>new event</DataRow>
      </ul>,
    );
    const highlight = container.querySelector('[data-row-fresh]');
    expect(highlight).toHaveClass('pointer-events-none', 'absolute', 'inset-0', 'bg-zinc-100', 'dark:bg-white/[0.04]');
    expect(highlight).toHaveAttribute('aria-hidden', 'true');
  });

  it('draws a fresh row still on a calm page, and where nothing can animate', () => {
    const { container, unmount } = render(
      <ul>
        <DataRow fresh>new event</DataRow>
      </ul>,
    );
    expect(container.querySelector('[data-row-fresh]')).toBeNull();
    unmount();

    browserWithMotion();
    motion.calm = true;
    const { container: calm } = render(
      <ul>
        <DataRow fresh>new event</DataRow>
      </ul>,
    );
    expect(calm.querySelector('[data-row-fresh]')).toBeNull();
  });
});
