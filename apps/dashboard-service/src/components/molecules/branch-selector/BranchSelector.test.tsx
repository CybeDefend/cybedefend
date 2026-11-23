import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import BranchSelector from './BranchSelector';

const branches = [
  { name: 'main', isDefault: true },
  { name: 'feature', isDefault: false },
];

describe('BranchSelector — trigger label', () => {
  it('does not label the trigger "All branches" when showAllOption is false and nothing is selected', () => {
    render(
      <BranchSelector
        branches={branches as any}
        selectedBranch={null}
        onBranchChange={vi.fn()}
        showAllOption={false}
      />,
    );

    // The "All branches" wording must never appear when the option is disabled.
    expect(screen.queryByText('All branches')).not.toBeInTheDocument();
    expect(screen.getByText('Please select a branch')).toBeInTheDocument();
  });

  it('still labels the trigger "All branches" when showAllOption is true and nothing is selected', () => {
    render(
      <BranchSelector
        branches={branches as any}
        selectedBranch={null}
        onBranchChange={vi.fn()}
        showAllOption
      />,
    );

    expect(screen.getByText('All branches')).toBeInTheDocument();
  });
});

describe('BranchSelector — async mode', () => {
  it('async mode: lifts search up and does not filter client-side', () => {
    const onSearchChange = vi.fn();
    render(
      <BranchSelector
        branches={[{ name: 'main', isDefault: true } as any]}
        selectedBranch={null}
        onBranchChange={() => {}}
        async
        onSearchChange={onSearchChange}
        onLoadMore={() => {}}
        hasMore={false}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'zzz' } });
    expect(onSearchChange).toHaveBeenCalledWith('zzz');
    expect(screen.getByText('main')).toBeInTheDocument(); // NOT filtered out despite 'zzz'
  });

  it('async mode: scrolling near the bottom triggers onLoadMore', () => {
    const onLoadMore = vi.fn();
    render(
      <BranchSelector
        branches={Array.from({ length: 30 }, (_, i) => ({ name: `b${i}` } as any))}
        selectedBranch={null}
        onBranchChange={() => {}}
        async
        onSearchChange={() => {}}
        onLoadMore={onLoadMore}
        hasMore
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    const list = screen.getByTestId('branch-options');
    Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 240, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 800, configurable: true });
    fireEvent.scroll(list);
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('full-list mode unchanged: still filters client-side', () => {
    render(
      <BranchSelector
        branches={[{ name: 'main' } as any, { name: 'feature' } as any]}
        selectedBranch={null}
        onBranchChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'feat' } });
    expect(screen.queryByText('main')).not.toBeInTheDocument();
    expect(screen.getByText('feature')).toBeInTheDocument();
  });

  // Regression: when an async (server-side) search returned zero branches the
  // whole selector unmounted (early `return null`) because `branches.length === 0`
  // && `!showAllOption`. The user — mid-search inside the open dropdown — lost the
  // trigger AND the search input and could no longer try another query.
  describe('async mode — empty search results', () => {
    it('stays mounted when a search returns zero branches (showAllOption=false)', () => {
      render(
        <BranchSelector
          branches={[]}
          selectedBranch="main"
          onBranchChange={() => {}}
          async
          onSearchChange={() => {}}
          onLoadMore={() => {}}
          hasMore={false}
          showAllOption={false}
        />,
      );
      // Before the fix this rendered nothing → no trigger button at all.
      expect(screen.getByRole('button')).toBeInTheDocument();
      // The previously-selected branch label must still be shown on the trigger.
      expect(screen.getByText('main')).toBeInTheDocument();
    });

    it('shows a "no results" message and keeps the search input when an open search yields nothing', () => {
      render(
        <BranchSelector
          branches={[]}
          selectedBranch="main"
          onBranchChange={() => {}}
          async
          onSearchChange={() => {}}
          onLoadMore={() => {}}
          hasMore={false}
          searching={false}
          showAllOption={false}
        />,
      );
      fireEvent.click(screen.getByRole('button')); // open dropdown
      expect(screen.getByText('No branches found')).toBeInTheDocument();
      // The input must remain so the user can try another branch name.
      expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
    });

    it('shows the searching spinner — not "no results" — while a query is in flight', () => {
      render(
        <BranchSelector
          branches={[]}
          selectedBranch="main"
          onBranchChange={() => {}}
          async
          onSearchChange={() => {}}
          onLoadMore={() => {}}
          hasMore={false}
          searching
          showAllOption={false}
        />,
      );
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText('Searching…')).toBeInTheDocument();
      expect(screen.queryByText('No branches found')).not.toBeInTheDocument();
    });

    it('full-list mode is unchanged: still renders nothing with no branches and no "All" option', () => {
      const { container } = render(
        <BranchSelector
          branches={[]}
          selectedBranch={null}
          onBranchChange={() => {}}
          showAllOption={false}
        />,
      );
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('async mode: archived toggle is available and calls onToggleArchived', () => {
    const onToggleArchived = vi.fn();
    render(
      <BranchSelector
        branches={[{ name: 'main', isDefault: true } as any]}
        selectedBranch={null}
        onBranchChange={() => {}}
        async
        onSearchChange={() => {}}
        onLoadMore={() => {}}
        hasMore={false}
        includeArchived={false}
        onToggleArchived={onToggleArchived}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    // With Fix 1, the footer toggle renders whenever onToggleArchived is provided,
    // regardless of whether any archived branches are currently loaded.
    // The i18n mock returns the positional string arg: 'Show archived ({{count}})'
    const toggle = screen.getByText(/show archived/i);
    fireEvent.click(toggle);
    expect(onToggleArchived).toHaveBeenCalled();
  });
});

// The async selector loads the archived branches only once they are shown:
// before that it holds none of them, and « Show archived (0) » was false while
// the project had some. It
// prints a count only when every archived branch is loaded.
describe('BranchSelector — async archived count', () => {
  const open = (props: Record<string, unknown>) => {
    render(
      <BranchSelector
        branches={[{ name: 'main', isDefault: true }, { name: 'old', isDefault: false, archived: true }] as any}
        selectedBranch={null}
        onBranchChange={() => {}}
        async
        onSearchChange={() => {}}
        onLoadMore={() => {}}
        onToggleArchived={() => {}}
        {...props}
      />,
    );
    fireEvent.click(screen.getAllByRole('button')[0]);
  };

  it('names no count while the archived branches are not loaded', () => {
    open({ includeArchived: false, hasMore: false });
    expect(screen.getByText('Show archived')).toBeInTheDocument();
    expect(screen.queryByText(/show archived \(/i)).not.toBeInTheDocument();
  });

  it('counts them once all are loaded', () => {
    open({ includeArchived: true, hasMore: false });
    expect(screen.getByText('Hide archived (1)')).toBeInTheDocument();
  });

  it('names no count while more pages may hold some', () => {
    open({ includeArchived: true, hasMore: true });
    expect(screen.getByText('Hide archived')).toBeInTheDocument();
  });
});

// Regression: in dark mode the branch name rendered with the page's
// inherited (dark) text colour on the selector's dark surface
// (`dark:bg-neutral-800`), so e.g. "main" showed near-black-on-black and was
// unreadable. Every branch-name element must therefore carry an explicit
// dark-mode text colour (a `dark:text-*` class) somewhere in its style chain —
// on the text node itself or on a styled ancestor row/trigger.
describe('BranchSelector — dark mode text colour', () => {
  // Walk from the text node up through its ancestors looking for a `dark:text-*`
  // class. Robust to whether the colour sits on the text span or a styled parent.
  const hasDarkTextColour = (start: HTMLElement | null): boolean => {
    for (let node: HTMLElement | null = start; node; node = node.parentElement) {
      if (/dark:text-/.test(node.className || '')) return true;
    }
    return false;
  };

  it('renders the selected branch name on the trigger with a dark-mode text colour', () => {
    render(
      <BranchSelector
        branches={branches as any}
        selectedBranch="main"
        onBranchChange={vi.fn()}
      />,
    );
    // The closed trigger shows the selected branch name — it must stay readable
    // against the dark trigger background.
    expect(hasDarkTextColour(screen.getByText('main'))).toBe(true);
  });

  it('renders unselected branch names in the open list with a dark-mode text colour', () => {
    render(
      <BranchSelector
        branches={branches as any}
        selectedBranch="main"
        onBranchChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button')); // open the dropdown
    // 'feature' is not the selected branch, so it uses the default row colour
    // (selected rows get `text-secondary`); that default must be readable in dark mode.
    expect(hasDarkTextColour(screen.getByText('feature'))).toBe(true);
  });
});
