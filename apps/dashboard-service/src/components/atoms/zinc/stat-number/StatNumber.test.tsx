import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const motion = vi.hoisted(() => ({ calm: false }));
vi.mock('@/components/molecules/kit/motion/useLivingMotion', () => {
  const useLivingMotion = () => ({ calm: motion.calm, setCalm: () => {}, reducedMotion: false });
  return { useLivingMotion, default: useLivingMotion };
});

import StatNumber from './StatNumber';
import { StatNumber as Named } from '.';

const NNBSP = ' ';
const NBSP = ' ';

/** A browser that accepts motion, whose frames the test hands out at the times it chooses. */
let frames: FrameRequestCallback[] = [];
const browserWithMotion = () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => {});
};
const frameAt = (time: number) =>
  act(() => {
    const run = frames;
    frames = [];
    run.forEach((callback) => callback(time));
  });

describe('StatNumber', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    frames = [];
  });

  it('reads as one sentence, the number in <strong> and the space kept', () => {
    const { container } = render(
      <StatNumber value={6} sentence="6 in the last 7 days" size="hero" unavailableLabel="Not available" />,
    );
    expect(container).toHaveTextContent('6 in the last 7 days');
    expect(container.textContent).toBe('6 in the last 7 days');
    const strong = container.querySelector('strong');
    expect(strong).toHaveTextContent(/^6$/);
    // Big, light, tabular: 500, never 600 or 700.
    expect(strong).toHaveClass('text-[40px]', 'font-medium', 'tracking-[-0.03em]', 'tabular-nums');
    expect(strong?.className).not.toMatch(/font-(?:semibold|bold)/);
    // The words around it are quiet.
    expect(container.querySelector('span:not(strong span)')).toHaveClass('text-zinc-500', 'dark:text-zinc-400');
  });

  it('counts the figure up on first paint, and lands on the count grouped by thousands', () => {
    browserWithMotion();
    const sentence = '12345 in the last 7 days';
    const { container } = render(<StatNumber value={12345} sentence={sentence} size="hero" unavailableLabel="n/a" />);
    const strong = container.querySelector('strong') as HTMLElement;
    expect(strong.querySelector('[aria-hidden="true"]')).toHaveTextContent(/^0$/);

    frameAt(0);
    frameAt(700);
    // The translation wrote a bare run of digits: the figure lands grouped, as Intl writes it.
    expect(strong.textContent).toBe('12,345');
    expect(container.textContent).toBe('12,345 in the last 7 days');
  });

  it('finds the count wherever the sentence puts it', () => {
    const { container } = render(
      <StatNumber value={41} sentence="Diff scans: 41 in total" size="md" unavailableLabel="n/a" />,
    );
    expect(container.textContent).toBe('Diff scans: 41 in total');
    expect(container.querySelector('strong')?.textContent).toBe('41');
  });

  it('prefers the value itself over another number written before it', () => {
    const { container } = render(<StatNumber value={6} sentence="In 7 days: 6 scans" size="md" unavailableLabel="n/a" />);
    expect(container.querySelector('strong')?.textContent).toBe('6');
    expect(container.textContent).toBe('In 7 days: 6 scans');
  });

  it.each([
    ['12,345 in the last 7 days', '12,345'],
    [`12${NNBSP}345 dans les 7 derniers jours`, `12${NNBSP}345`],
    [`12${NBSP}345 dans les 7 derniers jours`, `12${NBSP}345`],
    ['12.345 in den letzten 7 Tagen', '12.345'],
  ])('keeps the locale separators of %j', (sentence, number) => {
    const { container } = render(<StatNumber value={12345} sentence={sentence} size="lg" unavailableLabel="n/a" />);
    expect(container.querySelector('strong')?.textContent).toBe(number);
    expect(container.textContent).toBe(sentence);
  });

  it('says « Not available » in a small word, with no dash and no digit, when the value is unknown', () => {
    const { container } = render(
      <StatNumber value={null} sentence="0 in the last 7 days" size="hero" unavailableLabel="Not available" />,
    );
    expect(screen.getByText('Not available')).toHaveClass('text-sm');
    expect(container.textContent).not.toMatch(/\d|—/);
  });

  it('keeps the figure in ink whatever its beat: colour is information, never decoration', () => {
    for (const tone of ['did', 'served', 'stopped', undefined] as const) {
      const { container, unmount } = render(
        <StatNumber value={3} sentence="3 rules served" size="lg" tone={tone} unavailableLabel="n/a" />,
      );
      const strong = container.querySelector('strong');
      expect(strong, String(tone)).toHaveClass('text-zinc-900', 'dark:text-zinc-50');
      expect(strong?.className, String(tone)).not.toMatch(/secondary|amber|sky|red-/);
      unmount();
    }
  });

  it.each([
    ['hero', 'text-[40px]'],
    ['lg', 'text-2xl'],
    ['md', 'text-lg'],
  ] as const)('sizes %s', (size, cls) => {
    const { container } = render(<StatNumber value={1} sentence="1 scan" size={size} unavailableLabel="n/a" />);
    expect(container.querySelector('strong')).toHaveClass(cls);
  });

  it('grows the hero figure to 48 px from xl, as the landing tiles want it', () => {
    const { container } = render(<StatNumber value={6} sentence="6 scans" size="hero" unavailableLabel="n/a" />);
    expect(container.querySelector('strong')).toHaveClass('text-[40px]', 'xl:text-[48px]');
    // Only the hero figure takes the wide step; the smaller sizes keep theirs at every width.
    for (const size of ['lg', 'md'] as const) {
      const { container: other } = render(<StatNumber value={6} sentence="6 scans" size={size} unavailableLabel="n/a" />);
      expect(other.querySelector('strong')?.className, size).not.toMatch(/xl:text-/);
    }
  });

  it('renders the sentence as is when it does not hold the number', () => {
    const { container } = render(<StatNumber value={5} sentence="None yet" size="md" unavailableLabel="n/a" />);
    expect(container.textContent).toBe('None yet');
    expect(container.querySelector('strong')).toBeNull();
  });

  it('forwards className and attributes, and is exported from the folder', () => {
    render(<Named value={2} sentence="2 x" size="md" unavailableLabel="n/a" className="mt-1" data-testid="s" />);
    expect(screen.getByTestId('s')).toHaveClass('mt-1');
    expect(screen.getByTestId('s').tagName).toBe('P');
  });
});
