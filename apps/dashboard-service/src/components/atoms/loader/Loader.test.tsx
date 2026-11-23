import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Loader, { LoaderInline, LoaderSection } from './Loader';
import LoaderIcon from './LoaderIcon';

/**
 * The small spinners: a short hairline arc on a faint
 * track instead of the bordered rotating circle. Every prop and size stays,
 * so the callers do not change; the colour still comes from the variant.
 */
describe('Loader', () => {
  it('stays a named status for assistive technology', () => {
    render(<Loader />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('keeps its sizes', () => {
    const sizes = { xs: 'h-3 w-3', sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-10 w-10', xl: 'h-16 w-16' } as const;
    for (const [size, cls] of Object.entries(sizes)) {
      const { unmount } = render(<Loader size={size as keyof typeof sizes} />);
      expect(screen.getByRole('status').getAttribute('class')).toContain(cls);
      unmount();
    }
  });

  it('is an arc drawn in the colour of its variant, never a bordered circle', () => {
    render(<Loader variant="white" className="ml-2" />);
    const spinner = screen.getByRole('status');
    expect(spinner.tagName.toLowerCase()).toBe('svg');
    expect(spinner.getAttribute('class')).toContain('text-white');
    expect(spinner.getAttribute('class')).toContain('ml-2');
    expect(spinner.getAttribute('class')).not.toMatch(/\bborder-/);
    expect(spinner.querySelector('[data-arc]')?.getAttribute('stroke')).toBe('currentColor');
  });

  it('shows its text beside the arc, without a pulse', () => {
    render(<LoaderSection text="Loading projects" />);
    const text = screen.getByText('Loading projects');
    expect(text.getAttribute('class')).not.toContain('animate-pulse');
  });

  it('keeps the inline loader small and white, for a button', () => {
    render(<LoaderInline />);
    const spinner = screen.getByRole('status');
    expect(spinner.getAttribute('class')).toContain('h-3 w-3');
    expect(spinner.getAttribute('class')).toContain('text-white');
  });
});

describe('LoaderIcon', () => {
  it('is the same arc, 16 px, inline in a line of text or a button', () => {
    const { container } = render(<LoaderIcon />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('h-4 w-4');
    expect(svg?.getAttribute('class')).toContain('inline-block');
    expect(svg?.querySelector('[data-arc]')).not.toBeNull();
    expect(svg?.getAttribute('class')).not.toMatch(/\bborder-/);
  });
});
