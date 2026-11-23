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

import Meter from './Meter';
import { Meter as Named } from '.';

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
const nextFrame = () =>
  act(() => {
    const run = frames;
    frames = [];
    run.forEach((callback) => callback(16));
  });

const fillOf = (meter: HTMLElement) => meter.querySelector('[data-meter-fill]') as HTMLElement;

/**
 * Meters: 2 px tall, a zinc track and an ink fill (the
 * accent only for the brain series), growing from zero on first paint
 * (`scaleX`, 600 ms). It is a `meter` for assistive tech, its value in percent.
 */
describe('Meter', () => {
  beforeEach(() => {
    lang.current = 'en';
    motion.calm = false;
    frames = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a meter named by its label, its value in percent', () => {
    render(<Meter value={0.33} label="Claude Code" />);
    const meter = screen.getByRole('meter', { name: 'Claude Code' });
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter).toHaveAttribute('aria-valuenow', '33');
    expect(meter).toHaveAttribute('aria-valuetext', '33%');
  });

  it('writes the value in the language of the interface', () => {
    lang.current = 'fr';
    render(<Meter value={0.33} label="Claude Code" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '33\u00a0%');
  });

  it('takes the value text it is given', () => {
    render(<Meter value={0.5} label="Steps" valueText="2 of 4" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '2 of 4');
  });

  it('is 2 px: a zinc track and an ink fill, no accent', () => {
    render(<Meter value={0.5} label="x" />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveClass('h-0.5', 'w-full', 'overflow-hidden', 'rounded-full', 'bg-zinc-100', 'dark:bg-white/[0.06]');
    expect(fillOf(meter)).toHaveClass('bg-zinc-900', 'dark:bg-zinc-100', 'origin-left');
    expect(meter.outerHTML).not.toMatch(/secondary|fuchsia|gradient/);
  });

  it('fills with the accent only for the brain series', () => {
    render(<Meter value={0.5} label="Rules served" tone="accent" />);
    const fill = fillOf(screen.getByRole('meter'));
    expect(fill).toHaveClass('bg-secondary');
    expect(fill.className).not.toMatch(/zinc/);
  });

  it('keeps the value between 0 and 1, and reads nothing from a broken one', () => {
    const { rerender } = render(<Meter value={1.4} label="x" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '100');
    rerender(<Meter value={-1} label="x" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
    rerender(<Meter value={Number.NaN} label="x" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
    expect(fillOf(screen.getByRole('meter')).style.transform).toBe('scaleX(0)');
  });

  it('draws the fill at its value at once where nothing can animate (jsdom)', () => {
    render(<Meter value={0.33} label="x" />);
    const fill = fillOf(screen.getByRole('meter'));
    expect(fill.style.transform).toBe('scaleX(0.33)');
    expect(fill.style.transition).toBe('');
  });

  it('grows from zero on first paint, in 600 ms', () => {
    browserWithMotion();
    render(<Meter value={0.33} label="x" />);
    const fill = fillOf(screen.getByRole('meter'));
    expect(fill.style.transform).toBe('scaleX(0)');
    nextFrame();
    expect(fill.style.transform).toBe('scaleX(0.33)');
    expect(fill.style.transition).toMatch(/^transform 600ms/);
  });

  it('is at its value at once on a calm page', () => {
    browserWithMotion();
    motion.calm = true;
    render(<Meter value={0.33} label="x" />);
    expect(fillOf(screen.getByRole('meter')).style.transform).toBe('scaleX(0.33)');
    expect(frames).toHaveLength(0);
  });

  it('is made of spans, so it may sit under the text of a link or a button row', () => {
    const { container } = render(<Meter value={0.5} label="x" />);
    expect(container.querySelector('div')).toBeNull();
    expect(screen.getByRole('meter').tagName).toBe('SPAN');
    expect(screen.getByRole('meter')).toHaveClass('block');
    expect(fillOf(screen.getByRole('meter'))).toHaveClass('block');
  });

  it('forwards className and attributes, and is exported from the folder', () => {
    render(<Named value={0.2} label="x" className="mt-1.5" data-testid="m" />);
    expect(screen.getByTestId('m')).toHaveClass('mt-1.5');
    expect(screen.getByTestId('m')).toBe(screen.getByRole('meter'));
  });
});
