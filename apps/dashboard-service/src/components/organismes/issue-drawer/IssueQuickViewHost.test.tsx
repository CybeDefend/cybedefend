import React, { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import IssueQuickViewHost, { QuickViewPagination } from './IssueQuickViewHost';

const { dispatchSpy } = vi.hoisted(() => ({ dispatchSpy: vi.fn() }));
vi.mock('react-redux', () => ({ useDispatch: () => dispatchSpy }));

// Capture the props the host passes to the drawer; expose a way to invoke them.
let drawerProps: any;
vi.mock('./IssueQuickViewDrawer', () => ({
  default: (p: any) => {
    drawerProps = p;
    return (
      <div data-testid="drawer">
        <span data-testid="issueId">{String(p.issueId)}</span>
        <span data-testid="position">{p.positionText ?? ''}</span>
        <span data-testid="canPrev">{String(!!p.canPrev)}</span>
        <span data-testid="canNext">{String(!!p.canNext)}</span>
        <button onClick={() => p.onPrev?.()}>prev</button>
        <button onClick={() => p.onNext?.()}>next</button>
      </div>
    );
  },
}));

const renderAt = (path: string, ui: React.ReactNode) =>
  render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

beforeEach(() => {
  drawerProps = undefined;
  dispatchSpy.mockClear();
});

describe('IssueQuickViewHost — global position + cross-page navigation', () => {
  it('computes the global position across pages', () => {
    const pagination: QuickViewPagination = {
      currentPage: 2, totalPages: 5, pageSize: 3, totalCount: 14, onPageChange: vi.fn(),
    };
    renderAt(
      '/project/p1/sast?issue=b',
      <IssueQuickViewHost projectId="p1" type="sast" units={[['a'], ['b'], ['c']]} pagination={pagination} />,
    );
    // page 2, index 1 → 0-based global (2-1)*3 + 1 = 4 → displayed 1-based "5"
    expect(screen.getByTestId('position').textContent).toBe('5 / 14');
    expect(screen.getByTestId('canPrev').textContent).toBe('true');
    expect(screen.getByTestId('canNext').textContent).toBe('true');
  });

  it('forwards the latest scan date to the drawer', () => {
    renderAt(
      '/project/p1/sast?issue=b',
      <IssueQuickViewHost
        projectId="p1"
        type="sast"
        units={[['a'], ['b'], ['c']]}
        lastScanAt="2026-09-18T09:30:00Z"
      />,
    );
    expect(drawerProps.lastScanAt).toBe('2026-09-18T09:30:00Z');
  });

  it('falls back to a within-page label when no pagination is given', () => {
    renderAt(
      '/project/p1/sast?issue=b',
      <IssueQuickViewHost projectId="p1" type="sast" units={[['a'], ['b'], ['c']]} />,
    );
    expect(screen.getByTestId('position').textContent).toBe('2 / 3');
  });

  it('next on the last item of a non-final page requests the next page', () => {
    const onPageChange = vi.fn();
    renderAt(
      '/project/p1/sast?issue=c',
      <IssueQuickViewHost
        projectId="p1" type="sast" units={[['a'], ['b'], ['c']]}
        pagination={{ currentPage: 1, totalPages: 3, pageSize: 3, totalCount: 7, onPageChange }}
      />,
    );
    expect(screen.getByTestId('canNext').textContent).toBe('true');
    fireEvent.click(screen.getByText('next'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('prev on the first item of a non-first page requests the previous page', () => {
    const onPageChange = vi.fn();
    renderAt(
      '/project/p1/sast?issue=a',
      <IssueQuickViewHost
        projectId="p1" type="sast" units={[['a'], ['b'], ['c']]}
        pagination={{ currentPage: 2, totalPages: 3, pageSize: 3, totalCount: 7, onPageChange }}
      />,
    );
    expect(screen.getByTestId('canPrev').textContent).toBe('true');
    fireEvent.click(screen.getByText('prev'));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('disables next on the very last item of the last page', () => {
    renderAt(
      '/project/p1/sast?issue=c',
      <IssueQuickViewHost
        projectId="p1" type="sast" units={[['a'], ['b'], ['c']]}
        pagination={{ currentPage: 3, totalPages: 3, pageSize: 3, totalCount: 9, onPageChange: vi.fn() }}
      />,
    );
    expect(screen.getByTestId('canNext').textContent).toBe('false');
  });

  it('opens the first item of the next page once it has loaded (lazy cross-page)', () => {
    // Harness that swaps the page's units when onPageChange fires,
    // mimicking the list refetching page 2 only on the next-at-end action.
    const PAGES: Record<number, string[]> = { 1: ['a', 'b', 'c'], 2: ['d', 'e', 'f'] };
    const Harness: React.FC = () => {
      const [page, setPage] = useState(1);
      return (
        <IssueQuickViewHost
          projectId="p1"
          type="sast"
          units={PAGES[page].map((id) => [id])}
          pagination={{ currentPage: page, totalPages: 2, pageSize: 3, totalCount: 6, onPageChange: setPage }}
        />
      );
    };
    renderAt('/project/p1/sast?issue=c', <Harness />);
    expect(screen.getByTestId('issueId').textContent).toBe('c');

    act(() => {
      drawerProps.onNext(); // last of page 1 → load page 2, pending "first"
    });
    // page 2 loaded (d,e,f); 'c' no longer present → host opens the first: 'd'
    expect(screen.getByTestId('issueId').textContent).toBe('d');
    expect(screen.getByTestId('position').textContent).toBe('4 / 6');
  });

  it('grouped view: counts every occurrence in the total (single occurrence-based counter)', () => {
    // Page 2: group A (a1,a2,a3), group B (b1). 20 occurrences precede this page.
    renderAt(
      '/project/p1/sca?issue=a2',
      <IssueQuickViewHost
        projectId="p1" type="sca"
        units={[['a1', 'a2', 'a3'], ['b1']]}
        pagination={{ currentPage: 2, totalPages: 5, pageSize: 10, totalCount: 47, occurrenceOffset: 20, onPageChange: vi.fn() }}
      />,
    );
    // a2 is occurrence index 1 on the page → 20 + 1 + 1 = 22 / 47 (no sub-counter)
    expect(screen.getByTestId('position').textContent).toBe('22 / 47');
  });

  it('grouped view: next steps through occurrences WITHIN a category (no skip)', () => {
    renderAt(
      '/project/p1/sca?issue=a1',
      <IssueQuickViewHost
        projectId="p1" type="sca"
        units={[['a1', 'a2', 'a3'], ['b1']]}
        pagination={{ currentPage: 1, totalPages: 5, pageSize: 10, totalCount: 47, onPageChange: vi.fn() }}
      />,
    );
    // a1 → a2 (same category), NOT straight to b1
    act(() => drawerProps.onNext());
    expect(screen.getByTestId('issueId').textContent).toBe('a2');
    act(() => drawerProps.onNext());
    expect(screen.getByTestId('issueId').textContent).toBe('a3');
    // last occurrence of group A → first of group B
    act(() => drawerProps.onNext());
    expect(screen.getByTestId('issueId').textContent).toBe('b1');
  });

  it('grouped view: stepping across a page keeps the exact running occurrence count (no estimate jump)', () => {
    // Grouped pages are sized by GROUPS, so occurrences spread unevenly:
    // page 1 packs 3 occurrences into one group, page 2 holds a single one.
    // The even-distribution estimate can't know page 1 was occurrence-heavy, so
    // stepping must carry the EXACT count (3 → 4), not fall back to the estimate.
    const PAGES: Record<number, string[][]> = { 1: [['a1', 'a2', 'a3']], 2: [['b1']] };
    const Harness: React.FC = () => {
      const [page, setPage] = useState(1);
      return (
        <IssueQuickViewHost
          projectId="p1"
          type="sca"
          units={PAGES[page]}
          pagination={{
            currentPage: page,
            totalPages: 2,
            pageSize: 1, // groups per page
            totalCount: 4, // total occurrences across all pages
            // Deliberately-wrong estimate for page 2 (round(1*4/2) = 2) — the
            // running tracker must override it.
            occurrenceOffset: page === 1 ? 0 : 2,
            onPageChange: setPage,
          }}
        />
      );
    };
    renderAt('/project/p1/sca?issue=a3', <Harness />);
    expect(screen.getByTestId('position').textContent).toBe('3 / 4');

    act(() => drawerProps.onNext()); // last occurrence of page 1 → first of page 2
    expect(screen.getByTestId('issueId').textContent).toBe('b1');
    expect(screen.getByTestId('position').textContent).toBe('4 / 4'); // NOT 3/4 (the estimate)

    act(() => drawerProps.onPrev()); // back to the last occurrence of page 1
    expect(screen.getByTestId('issueId').textContent).toBe('a3');
    expect(screen.getByTestId('position').textContent).toBe('3 / 4');
  });

  it('closes the drawer when the page is changed from the list (issue leaves the list)', () => {
    const PAGES: Record<number, string[][]> = { 1: [['a'], ['b'], ['c']], 2: [['d'], ['e'], ['f']] };
    const Harness: React.FC = () => {
      const [page, setPage] = useState(1);
      return (
        <>
          <button onClick={() => setPage(2)}>list-page-2</button>
          <IssueQuickViewHost
            projectId="p1"
            type="sast"
            units={PAGES[page]}
            pagination={{ currentPage: page, totalPages: 2, pageSize: 3, totalCount: 6, onPageChange: setPage }}
          />
        </>
      );
    };
    renderAt('/project/p1/sast?issue=b', <Harness />);
    expect(screen.getByTestId('issueId').textContent).toBe('b');
    // Change page via the list's own control (NOT the drawer's next).
    act(() => {
      fireEvent.click(screen.getByText('list-page-2'));
    });
    // 'b' is gone from the list and no cross-page was pending → drawer closes.
    expect(screen.getByTestId('issueId').textContent).toBe('null');
  });

  it('keeps the drawer open AND remembers the position when the open vuln is edited off the current-page filter', () => {
    // Editing a vuln so it no longer matches the active list filter
    // makes it drop out of the list on the SAME page. The drawer must stay open
    // (the user is still working on that vuln) AND prev/next must keep working
    // from the remembered slot.
    const Harness: React.FC = () => {
      const [units, setUnits] = useState<string[][]>([['a'], ['b'], ['c']]);
      return (
        <>
          <button onClick={() => setUnits([['a'], ['c']])}>edit-b-off-filter</button>
          <IssueQuickViewHost
            projectId="p1"
            type="sast"
            units={units}
            pagination={{ currentPage: 1, totalPages: 1, pageSize: 3, totalCount: 3, onPageChange: vi.fn() }}
          />
        </>
      );
    };
    renderAt('/project/p1/sast?issue=b', <Harness />);
    expect(screen.getByTestId('issueId').textContent).toBe('b');
    expect(screen.getByTestId('position').textContent).toBe('2 / 3');

    // The list refetches the SAME page after the edit; 'b' no longer matches.
    act(() => {
      fireEvent.click(screen.getByText('edit-b-off-filter'));
    });

    // Drawer stays open on 'b' — page did not change, so it wasn't list nav.
    expect(screen.getByTestId('issueId').textContent).toBe('b');
    // The position is remembered, and prev/next stay enabled from that slot.
    expect(screen.getByTestId('position').textContent).toBe('2 / 3');
    expect(screen.getByTestId('canPrev').textContent).toBe('true');
    expect(screen.getByTestId('canNext').textContent).toBe('true');

    // "Next" moves to the vuln that took 'b's slot ('c'); the drawer follows.
    act(() => drawerProps.onNext());
    expect(screen.getByTestId('issueId').textContent).toBe('c');
  });

  it('from a vuln edited off the filter, prev returns to the item before its slot', () => {
    const Harness: React.FC = () => {
      const [units, setUnits] = useState<string[][]>([['a'], ['b'], ['c']]);
      return (
        <>
          <button onClick={() => setUnits([['a'], ['c']])}>edit-b-off-filter</button>
          <IssueQuickViewHost
            projectId="p1"
            type="sast"
            units={units}
            pagination={{ currentPage: 1, totalPages: 1, pageSize: 3, totalCount: 3, onPageChange: vi.fn() }}
          />
        </>
      );
    };
    renderAt('/project/p1/sast?issue=b', <Harness />);
    act(() => {
      fireEvent.click(screen.getByText('edit-b-off-filter'));
    });
    act(() => drawerProps.onPrev());
    expect(screen.getByTestId('issueId').textContent).toBe('a');
  });

  it('ignores rapid next clicks while a cross-page jump is loading (no request burst)', () => {
    const onPageChange = vi.fn();
    renderAt(
      '/project/p1/sast?issue=c',
      <IssueQuickViewHost
        projectId="p1" type="sast" units={[['a'], ['b'], ['c']]}
        pagination={{ currentPage: 1, totalPages: 5, pageSize: 3, totalCount: 15, onPageChange }}
      />,
    );
    act(() => {
      drawerProps.onNext(); // starts the jump (pending)
      drawerProps.onNext(); // still loading → ignored
      drawerProps.onNext(); // still loading → ignored
    });
    expect(onPageChange).toHaveBeenCalledTimes(1);
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('leaves « Ask Cybe » to the finding.actions slot inside the drawer (no onAskCybe prop)', () => {
    renderAt(
      '/project/p1/sast?issue=v9',
      <IssueQuickViewHost projectId="p1" type="sast" units={[['v9']]} />,
    );
    // The host no longer wires the chat itself: the drawer renders the
    // `finding.actions` slot, whose ee registration owns the dispatch.
    expect(drawerProps.onAskCybe).toBeUndefined();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('does not close on a deep link to an issue that is not on the current page', () => {
    renderAt(
      '/project/p1/sast?issue=zz',
      <IssueQuickViewHost
        projectId="p1" type="sast" units={[['a'], ['b'], ['c']]}
        pagination={{ currentPage: 1, totalPages: 2, pageSize: 3, totalCount: 6, onPageChange: vi.fn() }}
      />,
    );
    // 'zz' was never in the list → keep the drawer open (just no counter).
    expect(screen.getByTestId('issueId').textContent).toBe('zz');
    expect(screen.getByTestId('position').textContent).toBe('');
  });
});
