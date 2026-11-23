import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import Eyebrow from './Eyebrow';
import { Eyebrow as Named } from '.';

describe('Eyebrow', () => {
  it('is a small uppercase kicker above a title, in a paragraph by default', () => {
    render(<Eyebrow>This week in figures</Eyebrow>);
    const eyebrow = screen.getByText('This week in figures');
    expect(eyebrow.tagName).toBe('P');
    expect(eyebrow).toHaveClass(
      'text-xs',
      'font-medium',
      'uppercase',
      'tracking-[0.08em]',
      'text-zinc-500',
      'dark:text-zinc-400',
    );
    // Quiet: never semibold or bold, never the wide 0.14em letter-spacing.
    expect(eyebrow.className).not.toMatch(/font-(?:semibold|bold)|tracking-\[0\.14em\]/);
  });

  it.each(['span', 'h2', 'h3'] as const)('renders as a %s when asked', (as) => {
    render(<Eyebrow as={as}>Brain mode</Eyebrow>);
    expect(screen.getByText('Brain mode').tagName).toBe(as.toUpperCase());
  });

  it('is a heading of its level when rendered as one', () => {
    render(<Eyebrow as="h2">Guards</Eyebrow>);
    expect(screen.getByRole('heading', { level: 2, name: 'Guards' })).toBeInTheDocument();
  });

  it('forwards className and attributes, and is exported from the folder', () => {
    render(
      <Named className="text-white/60" data-testid="e">
        x
      </Named>,
    );
    expect(screen.getByTestId('e')).toHaveClass('text-white/60', 'uppercase');
  });
});
