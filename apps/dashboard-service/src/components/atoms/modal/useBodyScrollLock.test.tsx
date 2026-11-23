import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useBodyScrollLock } from './useBodyScrollLock';

/**
 * The lock the `Modal` atom has always carried, lifted out so a second dialog
 * can share it instead of copying it.
 *
 * Copying is what makes it wrong: the count of open dialogs has to be ONE
 * number. With two independent locks, closing the first restores the body
 * while the second is still open, and the page starts scrolling behind it.
 * The `Modal` atom now calls this hook, so both go through the same counter.
 *
 * `position:fixed` + `top:-scrollY` rather than `overflow:hidden` alone: the
 * latter clamps the scrollable height and snaps the page back to the top, which
 * is the bug the atom's own comment records.
 */
const Locker: React.FC = () => {
  useBodyScrollLock();
  return <div>locked</div>;
};

describe('useBodyScrollLock', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
  });

  it('pins the body while mounted', () => {
    render(<Locker />);
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.width).toBe('100%');
  });

  it('keeps the scroll position and restores it on unmount', () => {
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(420);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    const { unmount } = render(<Locker />);
    expect(document.body.style.top).toBe('-420px');

    unmount();
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.position).toBe('');
    expect(scrollTo).toHaveBeenCalledWith(0, 420);
  });

  it('stays locked until the LAST dialog closes', () => {
    const first = render(<Locker />);
    const second = render(<Locker />);

    first.unmount();
    expect(document.body.style.overflow, 'one dialog is still open').toBe('hidden');

    second.unmount();
    expect(document.body.style.overflow).toBe('');
  });
});

describe('a dialog that stays mounted while closed', () => {
  const Conditional: React.FC<{ open: boolean }> = ({ open }) => {
    useBodyScrollLock(open);
    return <div>{open ? 'open' : 'closed'}</div>;
  };

  it('does not pin a page it is not covering', () => {
    const { rerender } = render(<Conditional open={false} />);
    expect(document.body.style.overflow).toBe('');

    rerender(<Conditional open />);
    expect(document.body.style.overflow).toBe('hidden');

    rerender(<Conditional open={false} />);
    expect(document.body.style.overflow).toBe('');
  });
});
