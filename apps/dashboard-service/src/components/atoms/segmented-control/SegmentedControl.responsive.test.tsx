import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SegmentedControl from './SegmentedControl';

const options = [
  { value: '7', label: '7 d' },
  { value: '30', label: '30 d' },
];

/**
 * At 375 px the small size was 26 px tall, under a finger's
 * reach (the overview's 7 / 30 / 90 days). Below `sm` it is 40 px tall; from
 * `sm` up it keeps its size.
 */
describe('SegmentedControl tap target', () => {
  it('makes the small size a 40 px target below sm, unchanged from sm up', () => {
    render(<SegmentedControl options={options} value="7" onChange={() => {}} ariaLabel="Period" size="sm" />);
    const button = screen.getByRole('button', { name: '7 d' });
    expect(button).toHaveClass('py-3', 'sm:py-1', 'px-2.5', 'text-xs');
  });

  it('leaves the medium size as it was', () => {
    render(<SegmentedControl options={options} value="7" onChange={() => {}} ariaLabel="Period" size="md" />);
    expect(screen.getByRole('button', { name: '7 d' })).toHaveClass('py-1.5');
    expect(screen.getByRole('button', { name: '7 d' })).not.toHaveClass('py-3');
  });
});
