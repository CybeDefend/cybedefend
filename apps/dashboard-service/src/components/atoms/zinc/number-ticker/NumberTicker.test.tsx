import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const motion = vi.hoisted(() => ({ calm: false }));
vi.mock('@/components/molecules/kit/motion/useLivingMotion', () => {
  const useLivingMotion = () => ({ calm: motion.calm, setCalm: () => {}, reducedMotion: false });
  return { useLivingMotion, default: useLivingMotion };
});

import NumberTicker from './NumberTicker';
import { NumberTicker as Named } from '.';

const NNBSP = '\u202f';

/** A browser that accepts motion, whose frames the test hands out one by one at the times it chooses. */
let frames: FrameRequestCallback[] = [];
const cancel = vi.fn();
const browserWithMotion = () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', cancel);
};
const frameAt = (time: number) =>
  act(() => {
    const run = frames;
    frames = [];
    run.forEach((callback) => callback(time));
  });

/** What the eye sees: the visible figure (the one hidden from a screen reader while it counts). */
const visible = (root: HTMLElement) => (root.querySelector('[aria-hidden="true"]') ?? root).textContent;

describe('NumberTicker', () => {
  beforeEach(() => {
    lang.current = 'en';
    motion.calm = false;
    frames = [];
    cancel.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the final figure at once where nothing can animate (jsdom has no matchMedia)', () => {
    const { container } = render(<NumberTicker value={12345} />);
    expect(container.textContent).toBe('12,345');
    expect(container.querySelector('.sr-only')).toBeNull();
  });

  it('writes the figure in the language of the interface', () => {
    lang.current = 'fr';
    const { container } = render(<NumberTicker value={12345} />);
    expect(container.textContent).toBe(`12${NNBSP}345`);
  });

  it('writes the figure with the format it is given', () => {
    const { container } = render(<NumberTicker value={7} format={(n) => `${n} rules`} />);
    expect(container.textContent).toBe('7 rules');
  });

  it('is a tabular figure in a span, forwards className and attributes, and is exported from the folder', () => {
    render(<Named value={3} className="text-4xl" data-testid="n" />);
    const figure = screen.getByTestId('n');
    expect(figure.tagName).toBe('SPAN');
    expect(figure).toHaveClass('tabular-nums', 'text-4xl');
  });

  it('counts up from zero on first paint, in 700 ms, easing out (expo)', () => {
    browserWithMotion();
    const { container } = render(<NumberTicker value={100} data-testid="n" />);
    const root = screen.getByTestId('n');

    // First paint: zero for the eye, the final figure for a screen reader.
    expect(visible(root)).toBe('0');
    expect(container.querySelector('.sr-only')).toHaveTextContent(/^100$/);

    frameAt(1000);
    expect(visible(root)).toBe('0');
    frameAt(1350); // halfway in time, 1 - 2^-5 of the way in value
    expect(visible(root)).toBe('97');
    frameAt(1700);
    expect(root.textContent).toBe('100');
    expect(container.querySelector('.sr-only')).toBeNull();
    expect(frames).toHaveLength(0);
  });

  it('rolls from where it stands to a new value', () => {
    browserWithMotion();
    const { rerender } = render(<NumberTicker value={100} data-testid="n" />);
    frameAt(0);
    frameAt(700);
    expect(screen.getByTestId('n').textContent).toBe('100');

    rerender(<NumberTicker value={200} data-testid="n" />);
    expect(visible(screen.getByTestId('n'))).toBe('100');
    frameAt(5000);
    frameAt(5350);
    expect(visible(screen.getByTestId('n'))).toBe('197');
    frameAt(5700);
    expect(screen.getByTestId('n').textContent).toBe('200');
  });

  it('shows the figure at once on a calm page, without asking for a frame', () => {
    browserWithMotion();
    motion.calm = true;
    render(<NumberTicker value={42} data-testid="n" />);
    expect(screen.getByTestId('n').textContent).toBe('42');
    expect(frames).toHaveLength(0);
  });

  it('stops counting once gone', () => {
    browserWithMotion();
    const { unmount } = render(<NumberTicker value={50} />);
    frameAt(0);
    unmount();
    expect(cancel).toHaveBeenCalled();
  });
});
