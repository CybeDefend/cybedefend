import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import ThemeToggleButton from './ThemeToggleButton';

/**
 * The DOM it renders without `ariaLabel` (AppSec renders it so), as of the
 * Platform refresh: zinc glyphs at 16 px, a 32 px square with a 44 px reach on
 * phones, the rail focus ring, no accent and no hover scale. Same elements as
 * before (button, two wrappers, the glyph), classes only.
 */
const RENDERED_DARK = "<button class=\"relative flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors duration-[120ms] hover:bg-white/[0.04] hover:text-zinc-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/25 max-md:after:absolute max-md:after:left-1/2 max-md:after:top-1/2 max-md:after:h-11 max-md:after:w-11 max-md:after:-translate-x-1/2 max-md:after:-translate-y-1/2 max-md:after:content-['']\" aria-label=\"Activer le mode clair\"><div><div class=\"transform transition-transform duration-500 rotate-0\"><svg class=\"w-4 h-4\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z\"></path></svg></div></div></button>";
const RENDERED_LIGHT = "<button class=\"relative flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors duration-[120ms] hover:bg-white/[0.04] hover:text-zinc-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/25 max-md:after:absolute max-md:after:left-1/2 max-md:after:top-1/2 max-md:after:h-11 max-md:after:w-11 max-md:after:-translate-x-1/2 max-md:after:-translate-y-1/2 max-md:after:content-['']\" aria-label=\"Activer le mode sombre\"><div><div class=\"transform transition-transform duration-500 -rotate-90\"><svg class=\"w-4 h-4\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"4\"></circle><path d=\"M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41\"></path></svg></div></div></button>";

describe('ThemeToggleButton', () => {
  it('renders exactly its approved DOM when no label is given', () => {
    const { container, rerender } = render(<ThemeToggleButton isDarkMode onToggle={() => {}} />);
    expect(container.innerHTML).toBe(RENDERED_DARK);
    rerender(<ThemeToggleButton isDarkMode={false} onToggle={() => {}} />);
    expect(container.innerHTML).toBe(RENDERED_LIGHT);
  });

  it('keeps its French default names', () => {
    const { rerender } = render(<ThemeToggleButton isDarkMode onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: 'Activer le mode clair' })).toBeInTheDocument();
    rerender(<ThemeToggleButton isDarkMode={false} onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: 'Activer le mode sombre' })).toBeInTheDocument();
  });

  it('takes the name a caller translated', () => {
    const { rerender } = render(
      <ThemeToggleButton isDarkMode onToggle={() => {}} ariaLabel="Switch to the light theme" />,
    );
    expect(screen.getByRole('button', { name: 'Switch to the light theme' })).toBeInTheDocument();
    rerender(<ThemeToggleButton isDarkMode={false} onToggle={() => {}} ariaLabel="Passer au thème sombre" />);
    expect(screen.getByRole('button', { name: 'Passer au thème sombre' })).toBeInTheDocument();
  });

  it('toggles on click', () => {
    const onToggle = vi.fn();
    render(<ThemeToggleButton isDarkMode={false} onToggle={onToggle} ariaLabel="Switch to the dark theme" />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to the dark theme' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
