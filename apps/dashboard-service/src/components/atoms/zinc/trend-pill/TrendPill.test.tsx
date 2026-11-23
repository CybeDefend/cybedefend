import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const lang = vi.hoisted(() => ({ current: 'en' }));
vi.mock('react-i18next', async () => {
  const mock = (await import('@/test/i18n-mock')).reactI18nextMock();
  return {
    ...mock,
    useTranslation: () => ({
      ...mock.useTranslation(),
      i18n: { language: lang.current, changeLanguage: () => Promise.resolve() },
    }),
  };
});

import TrendPill from './TrendPill';
import { TrendPill as Named } from '.';

const NNBSP = ' ';
const MINUS = '−';

const delta = (container: HTMLElement) => container.querySelector('[data-trend-delta]') as HTMLElement;

/**
 * Numbers: the change is a quiet mono `+12` / `−8` in
 * zinc-500, never a pill, never an arrow in a tinted capsule. The full sentence
 * stays for a screen reader and on hover; a 6 px red dot says "bad news" when
 * the caller says so.
 */
describe('TrendPill', () => {
  beforeEach(() => {
    lang.current = 'en';
  });

  it('shows a rise as a quiet mono +n, the whole sentence read out and on hover', () => {
    const { container } = render(<TrendPill delta={3} label="3 more than the previous 7 days" tone="neutral" data-testid="t" />);
    const root = screen.getByTestId('t');
    expect(delta(container)).toHaveTextContent(/^\+3$/);
    expect(delta(container)).toHaveAttribute('aria-hidden', 'true');
    expect(root).toHaveClass('font-mono', 'text-[13px]', 'tabular-nums', 'text-zinc-500', 'dark:text-zinc-400');
    expect(screen.getByText('3 more than the previous 7 days')).toHaveClass('sr-only');
    expect(root).toHaveAttribute('title', '3 more than the previous 7 days');
  });

  it('writes a fall with a true minus sign', () => {
    const { container } = render(<TrendPill delta={-8} label="8 fewer" tone="neutral" />);
    expect(delta(container).textContent).toBe(`${MINUS}8`);
  });

  it('writes the change in the language of the interface', () => {
    lang.current = 'fr';
    const { container } = render(<TrendPill delta={12345} label="12 345 de plus" tone="neutral" />);
    expect(delta(container).textContent).toBe(`+12${NNBSP}345`);
  });

  it('is no pill: no background, no rounded capsule, no arrow', () => {
    const { container } = render(<TrendPill delta={2} label="2 more" tone="good" data-testid="t" />);
    expect(screen.getByTestId('t').className).not.toMatch(/(?:^|\s)(?:dark:)?bg-|rounded-full|px-2/);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.innerHTML).not.toMatch(/emerald|green-/);
  });

  it('writes the figure in red only when the change is bad news, with no dot', () => {
    const { container } = render(<TrendPill delta={4} label="4 more refusals" tone="bad" />);
    expect(container.querySelector('[data-trend-dot]')).toBeNull();
    expect(container.querySelector('[data-trend-delta]')).toHaveClass('text-red-700', 'dark:text-red-400');
    for (const tone of ['neutral', 'good'] as const) {
      const { container: other, unmount } = render(<TrendPill delta={4} label="x" tone={tone} />);
      expect(other.querySelector('[data-trend-delta]')?.className ?? '', tone).not.toMatch(/red/);
      unmount();
    }
  });

  it('renders nothing when nothing changed', () => {
    const { container } = render(<TrendPill delta={0} label="no change" tone="neutral" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('forwards className and attributes, and is exported from the folder', () => {
    render(<Named delta={-1} label="1 fewer" tone="bad" className="ml-2" data-testid="p" />);
    expect(screen.getByTestId('p')).toHaveClass('ml-2');
    expect(screen.getByTestId('p').tagName).toBe('SPAN');
  });
});
