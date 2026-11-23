import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import IconTile from './IconTile';

describe('IconTile', () => {
  it('defaults to an md accent square, hidden from assistive tech', () => {
    render(<IconTile data-testid="t"><svg /></IconTile>);
    const tile = screen.getByTestId('t');
    expect(tile.tagName).toBe('SPAN');
    expect(tile).toHaveClass('h-9', 'w-9', 'rounded-lg', 'bg-secondary/10', 'text-secondary', 'dark:text-secondary-light');
    expect(tile).toHaveAttribute('aria-hidden', 'true');
  });

  it.each([
    ['sm', ['h-7', 'w-7', '[&>svg]:h-4', '[&>svg]:w-4']],
    ['md', ['h-9', 'w-9']],
    ['lg', ['h-11', 'w-11']],
  ] as const)('sizes %s', (size, classes) => {
    render(<IconTile size={size} data-testid="t"><svg /></IconTile>);
    expect(screen.getByTestId('t')).toHaveClass(...classes);
  });

  it('has a neutral tone with dark variants', () => {
    render(<IconTile tone="neutral" data-testid="t"><svg /></IconTile>);
    const tile = screen.getByTestId('t');
    expect(tile.className).toMatch(/bg-gray-100/);
    expect(tile.className).toMatch(/dark:bg-neutral-800/);
    expect(tile.className).not.toMatch(/secondary/);
  });

  it('is round with shape="circle"', () => {
    render(<IconTile shape="circle" data-testid="t"><svg /></IconTile>);
    expect(screen.getByTestId('t')).toHaveClass('rounded-full');
  });

  it('becomes an image with a name when given an aria-label', () => {
    render(<IconTile aria-label="Repository"><svg /></IconTile>);
    const tile = screen.getByRole('img', { name: 'Repository' });
    expect(tile).not.toHaveAttribute('aria-hidden');
  });

  it('forwards attributes, className and ref', () => {
    const ref = React.createRef<HTMLSpanElement>();
    render(<IconTile ref={ref} className="shrink-0" title="x" data-testid="t"><svg /></IconTile>);
    expect(screen.getByTestId('t')).toHaveClass('shrink-0');
    expect(screen.getByTestId('t')).toHaveAttribute('title', 'x');
    expect(ref.current).toBe(screen.getByTestId('t'));
  });
});
