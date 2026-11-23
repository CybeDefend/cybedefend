import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SeverityCount from './SeverityCount';

describe('SeverityCount', () => {
  // The figure takes the colour of its letter.
  it('writes the figure in the colour of its letter', () => {
    render(<SeverityCount severity="critical" count={1} label="C" />);

    const figure = screen.getByText('1');
    const letter = screen.getByText('C');
    expect(figure).toHaveClass('text-red-700', 'dark:text-red-400');
    expect(letter).toHaveClass('text-red-700', 'dark:text-red-400');
    expect(figure).not.toHaveClass('text-zinc-900');
  });

  it('gives each severity its own colour', () => {
    render(<SeverityCount severity="high" count={31} label="H" />);

    expect(screen.getByText('31')).toHaveClass('text-orange-700', 'dark:text-orange-400');
  });

  it('keeps a zero quiet, its figure and letter alike', () => {
    render(<SeverityCount severity="critical" count={0} label="C" />);

    expect(screen.getByText('0')).toHaveClass('text-zinc-500');
    expect(screen.getByText('C')).toHaveClass('text-zinc-500');
    expect(screen.getByText('0')).not.toHaveClass('text-red-700');
  });
});
