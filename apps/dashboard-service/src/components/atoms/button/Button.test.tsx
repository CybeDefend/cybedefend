import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Button from './Button';

/**
 * 332 hand-rolled `<button>` elements exist outside the atoms, and the reason
 * they were hand-rolled is that this component accepted 13 named props and
 * silently dropped everything else: an icon-only button could not carry an
 * `aria-label`, a form button could not be `form="x"`, nothing could take a
 * ref. Migrating them requires the atom to behave like a `<button>` first.
 */
describe('Button', () => {
  it('forwards native attributes it does not name explicitly', () => {
    render(
      <Button aria-label="Close" title="Close the panel" name="close" data-testid="btn">
        ×
      </Button>,
    );

    const btn = screen.getByTestId('btn');
    expect(btn).toHaveAttribute('aria-label', 'Close');
    expect(btn).toHaveAttribute('title', 'Close the panel');
    expect(btn).toHaveAttribute('name', 'close');
  });

  it('forwards native event handlers beyond onClick', () => {
    const onMouseEnter = vi.fn();
    const onFocus = vi.fn();

    render(
      <Button onMouseEnter={onMouseEnter} onFocus={onFocus} data-testid="btn">
        Hover me
      </Button>,
    );

    fireEvent.mouseEnter(screen.getByTestId('btn'));
    fireEvent.focus(screen.getByTestId('btn'));

    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('hands the click event to onClick', () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} data-testid="btn">
        Go
      </Button>,
    );

    fireEvent.click(screen.getByTestId('btn'));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0]).toMatchObject({ type: 'click' });
  });

  it('exposes the underlying element through a ref', () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Focus target</Button>);

    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    ref.current?.focus();
    expect(document.activeElement).toBe(ref.current);
  });

  it('keeps an external link accessible when it opens a new tab', () => {
    render(
      <Button href="https://example.com" target="_blank" rel="noreferrer" data-testid="btn">
        Docs
      </Button>,
    );

    const link = screen.getByTestId('btn');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('carries its attributes onto a router link too', () => {
    render(
      <MemoryRouter>
        <Button to="/projects" aria-label="All projects" data-testid="btn">
          Projects
        </Button>
      </MemoryRouter>,
    );

    const link = screen.getByTestId('btn');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/projects');
    expect(link).toHaveAttribute('aria-label', 'All projects');
  });

  it('stays disabled while loading so a double submit cannot happen', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick} data-testid="btn">
        Save
      </Button>,
    );

    const btn = screen.getByTestId('btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  /**
   * 100 call sites across 46 files pass their icon as a child rather than
   * through the `icon` prop. Wrapping every child in one span made those two
   * elements a single flex item: the button's `gap` no longer separated them,
   * `items-center` no longer aligned them, and a narrow container stacked the
   * glyph above the word — which is what the refresh button on the project
   * overview looked like. Text still gets its wrapper; elements become flex
   * children in their own right.
   */
  it('lays an icon passed as a child out beside the label, not inside it', () => {
    const { container } = render(
      <Button data-testid="btn">
        <svg data-testid="glyph" />
        <span>Refresh</span>
      </Button>,
    );

    const btn = screen.getByTestId('btn');
    // Both are direct children of the button, so its gap and alignment apply.
    expect(screen.getByTestId('glyph').parentElement).toBe(btn);
    expect(container.querySelectorAll('button > span').length).toBe(1);
  });

  it('still wraps a plain text label so it cannot break across lines', () => {
    render(<Button data-testid="btn">Refresh</Button>);

    const label = screen.getByTestId('btn').querySelector('span');
    expect(label).toHaveClass('whitespace-nowrap');
    expect(label).toHaveTextContent('Refresh');
  });

  /**
   * The accent tint and the accent outline were hand-written at each call site
   * (an action, a first-visit page, the « Open in
   * AppSec » link). They follow the `secondary` token, so the product's
   * `data-product` decides their hue.
   */
  it('offers a soft variant: an accent tint without a visible border', () => {
    render(<Button variant="soft" data-testid="btn">Create a rule</Button>);

    const btn = screen.getByTestId('btn');
    expect(btn).toHaveClass(
      'bg-secondary/10',
      'text-secondary',
      'hover:bg-secondary/15',
      'dark:bg-secondary/20',
      'dark:text-secondary-light',
      'dark:hover:bg-secondary/30',
      'border-transparent',
      'focus:ring-secondary/50',
    );
    expect(btn).not.toHaveClass('border-secondary');
  });

  it('offers an accent-outline variant: an accent border over a light tint', () => {
    render(<Button variant="accent-outline" size="sm" data-testid="btn">Open in AppSec</Button>);

    const btn = screen.getByTestId('btn');
    expect(btn).toHaveClass(
      'border',
      'border-secondary',
      'bg-secondary/5',
      'text-secondary',
      'hover:bg-secondary/10',
      'dark:border-secondary-light/60',
      'dark:bg-secondary/20',
      'dark:text-secondary-light',
      'dark:hover:bg-secondary/30',
      'focus:ring-secondary/50',
    );
    // Sizes are shared with the other variants.
    expect(btn).toHaveClass('px-3', 'py-1.5', 'text-sm');
  });

  /**
   * A list row that opens a detail (a guard trigger, a diff scan) is a real
   * button: Tab, Enter, Space. It looks like the row it is, not like a pill:
   * full width, its content from the left, the text of the list, no shrink on
   * press, and a focus ring drawn inside the row so the list does not clip it.
   */
  it('offers a row variant: a whole list row, laid out like the row it replaces', () => {
    render(
      <Button variant="row" className="px-4 py-3" data-testid="btn">
        <span>feat/login</span>
      </Button>,
    );

    const btn = screen.getByTestId('btn');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn).toHaveClass(
      'flex',
      'w-full',
      'justify-start',
      'text-left',
      'font-normal',
      'rounded-none',
      'text-inherit',
      'active:scale-100',
      'focus-visible:ring-2',
      'focus-visible:ring-inset',
      'focus-visible:ring-secondary/60',
    );
    expect(btn).not.toHaveClass('inline-flex', 'justify-center', 'rounded-xl', 'font-medium');
    // The row's own spacing wins over the size's.
    expect(btn).toHaveClass('px-4', 'py-3');
    expect(btn).not.toHaveClass('py-2');
  });
});
