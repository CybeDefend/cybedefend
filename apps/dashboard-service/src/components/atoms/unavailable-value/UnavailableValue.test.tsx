import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import UnavailableValue from './UnavailableValue';

describe('UnavailableValue', () => {
  // No dash in displayed text. The words are what everyone reads.
  it('shows the words themselves, to the eye and to assistive tech alike, never a dash', () => {
    const { container } = render(<UnavailableValue label="Not available" />);
    const words = screen.getByText('Not available');
    expect(words).not.toHaveClass('sr-only');
    expect(words).not.toHaveAttribute('aria-hidden');
    expect(words).toHaveAttribute('data-unavailable');
    expect(container.textContent).toBe('Not available');
    expect(container.innerHTML).not.toMatch(/—|–/);
    expect(container.firstElementChild?.tagName).toBe('SPAN');
  });

  it('forwards attributes and className to the outer span', () => {
    render(<UnavailableValue label="n/a" className="text-gray-400" data-testid="u" />);
    expect(screen.getByTestId('u')).toHaveClass('text-gray-400');
  });
});
