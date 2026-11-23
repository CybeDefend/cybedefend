import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import BeatGlyph from './BeatGlyph';
import { BeatGlyph as Named } from '.';

const glyph = (container: HTMLElement) => container.querySelector('svg')?.getAttribute('class') ?? '';
const dot = (container: HTMLElement) => container.querySelector('[data-beat-dot]') as HTMLElement;

/**
 * A UI glyph is a stroked lucide icon in zinc, 1.5 px,
 * with nothing behind it (no tile, no tinted square). Where the beat needs a
 * colour, it becomes a 6 px dot instead: amber warned, red refused.
 */
describe('BeatGlyph', () => {
  it.each([
    ['did', undefined, 'cybe-icon-git-branch'],
    ['did', 'scan', 'cybe-icon-git-branch'],
    ['did', 'session', 'cybe-icon-activity'],
    ['served', undefined, 'cybe-icon-brain'],
    ['stopped', undefined, 'cybe-icon-shield-alert'],
    ['stopped', 'guard', 'cybe-icon-shield-alert'],
    ['stopped', 'denied', 'cybe-icon-shield-x'],
  ] as const)('draws %s (%s) with the registry glyph %s', (beat, variant, icon) => {
    const { container } = render(<BeatGlyph beat={beat} variant={variant} size="sm" />);
    expect(glyph(container)).toContain(icon);
  });

  it.each([
    ['did', undefined],
    ['served', undefined],
    ['stopped', 'guard'],
    ['stopped', 'denied'],
  ] as const)('draws %s (%s) as a zinc glyph on nothing, stroked at 1.5', (beat, variant) => {
    const { container } = render(<BeatGlyph beat={beat} variant={variant} size="sm" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('text-zinc-400', 'dark:text-zinc-500');
    expect(root.className).not.toMatch(/(?:^|\s)(?:dark:)?bg-|rounded-md|sky-|amber-|red-|secondary/);
    expect(container.querySelector('svg')).toHaveAttribute('stroke-width', '1.5');
  });

  it.each([
    ['did', undefined, ['bg-zinc-400', 'dark:bg-zinc-500']],
    ['served', undefined, ['bg-zinc-900', 'dark:bg-zinc-100']],
    ['stopped', 'guard', ['bg-amber-500', 'dark:bg-amber-400']],
    ['stopped', 'denied', ['bg-red-500', 'dark:bg-red-400']],
  ] as const)('becomes a 6 px dot for %s (%s) when asked', (beat, variant, classes) => {
    const { container } = render(<BeatGlyph beat={beat} variant={variant} size="sm" as="dot" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(dot(container)).toHaveClass('h-1.5', 'w-1.5', 'rounded-full', ...classes);
  });

  it('is an image of its title when it has one, in either form', () => {
    render(<BeatGlyph beat="stopped" variant="denied" size="sm" title="Refused" />);
    expect(screen.getByRole('img', { name: 'Refused' })).not.toHaveAttribute('aria-hidden');
    render(<BeatGlyph beat="stopped" size="sm" as="dot" title="Warned" />);
    expect(screen.getByRole('img', { name: 'Warned' })).not.toHaveAttribute('aria-hidden');
  });

  it('is decorative without a title', () => {
    const { container } = render(<BeatGlyph beat="did" size="sm" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it.each([
    ['xs', ['h-3.5', 'w-3.5', '[&>svg]:h-3.5', '[&>svg]:w-3.5']],
    ['sm', ['h-4', 'w-4', '[&>svg]:h-4', '[&>svg]:w-4']],
    ['md', ['h-5', 'w-5', '[&>svg]:h-5', '[&>svg]:w-5']],
  ] as const)('sizes %s (14, 16, 20 px)', (size, classes) => {
    const { container } = render(<BeatGlyph beat="served" size={size} />);
    expect(container.firstElementChild).toHaveClass(...classes);
  });

  it('forwards className and attributes, and is exported from the folder', () => {
    render(<Named beat="did" size="xs" className="mt-0.5" data-testid="g" />);
    expect(screen.getByTestId('g')).toHaveClass('mt-0.5', 'inline-flex');
  });
});
