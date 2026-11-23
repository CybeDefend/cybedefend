import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import IconTile from './IconTile';

/**
 * The beat tones (the kit's activity rows) are additive: a tile without a
 * tone, or with `accent` / `neutral`, renders the exact class string it always
 * had, which AppSec and `src/test/appsecUntouched.test.tsx` rely on. The beat
 * tones themselves render neutral: that space uses no icon tiles.
 */
describe('IconTile beat tones', () => {
  it('renders the default tile byte for byte as before', () => {
    render(<IconTile data-testid="t"><svg /></IconTile>);
    expect(screen.getByTestId('t').className).toBe(
      'inline-flex shrink-0 items-center justify-center h-9 w-9 [&>svg]:h-5 [&>svg]:w-5 bg-secondary/10 text-secondary dark:bg-secondary/20 dark:text-secondary-light rounded-lg',
    );
  });

  it('keeps the neutral tone as it was', () => {
    render(<IconTile tone="neutral" data-testid="t"><svg /></IconTile>);
    expect(screen.getByTestId('t').className).toBe(
      'inline-flex shrink-0 items-center justify-center h-9 w-9 [&>svg]:h-5 [&>svg]:w-5 bg-gray-100 text-gray-500 dark:bg-neutral-800 dark:text-gray-400 rounded-lg',
    );
  });

  it.each(['did', 'served', 'stopped'] as const)(
    'renders the %s beat as a bare zinc glyph: no tile, no tint behind it',
    (tone) => {
      render(<IconTile tone={tone} data-testid="t"><svg /></IconTile>);
      const tile = screen.getByTestId('t');
      expect(tile).toHaveClass('text-zinc-400', 'dark:text-zinc-500', 'h-9', 'w-9');
      // Nothing paints behind the glyph, and no hue reaches it.
      expect(tile.className).not.toMatch(/(?:^|\s)(?:dark:)?bg-(?!transparent)/);
      expect(tile.className).not.toMatch(/sky-|amber-|red-|emerald-|secondary/);
    },
  );

  it('keeps the accent token out of the beat tones', () => {
    for (const tone of ['did', 'served', 'stopped'] as const) {
      const { unmount } = render(<IconTile tone={tone} data-testid="t"><svg /></IconTile>);
      expect(screen.getByTestId('t').className, tone).not.toMatch(/secondary/);
      unmount();
    }
  });
});
