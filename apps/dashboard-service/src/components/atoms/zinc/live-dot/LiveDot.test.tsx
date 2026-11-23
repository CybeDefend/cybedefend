import React from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AtRule, Root } from 'postcss';

import { compileAppCss } from '@/test/productAccentCss';

const motion = vi.hoisted(() => ({ calm: false }));
vi.mock('@/components/molecules/kit/motion/useLivingMotion', () => {
  const useLivingMotion = () => ({ calm: motion.calm, setCalm: () => {}, reducedMotion: false });
  return { useLivingMotion, default: useLivingMotion };
});

import LiveDot, { LIVE_DOT_TONE_TEXT } from './LiveDot';
import { LiveDot as Named } from '.';

describe('LiveDot', () => {
  beforeEach(() => {
    motion.calm = false;
  });

  it.each(['live', 'did', 'served', 'stopped', 'denied', 'idle'] as const)(
    'draws no dot and nothing that breathes for the %s tone (no dot, no « live »)',
    (tone) => {
      const { container } = render(<LiveDot tone={tone} pulse />);
      expect(container.innerHTML).toBe('');
    },
  );

  it('still says its label to assistive tech, as the dot did', () => {
    render(<LiveDot tone="live" label="Working now" />);
    expect(screen.getByText('Working now')).toHaveClass('sr-only');
  });

  it('puts the colour into the word: red, amber, mint, at least 4.5:1 in both themes', () => {
    expect(LIVE_DOT_TONE_TEXT.denied).toBe('text-red-700 dark:text-red-400');
    expect(LIVE_DOT_TONE_TEXT.stopped).toBe('text-amber-700 dark:text-amber-400');
    expect(LIVE_DOT_TONE_TEXT.live).toBe('text-mint');
    expect(Object.values(LIVE_DOT_TONE_TEXT).join(' ')).not.toMatch(/secondary|sky-/);
  });

  it('is exported from the folder', () => {
    expect(Named).toBe(LiveDot);
  });
});

describe('the breathe animation of tailwind.config.js', () => {
  let app: Root;
  beforeAll(async () => {
    app = await compileAppCss(['motion-safe:animate-breathe']);
  }, 60_000);

  it('scales a fading halo, and only for a viewer who accepts motion', () => {
    const keyframes: AtRule[] = [];
    app.walkAtRules('keyframes', (rule) => {
      if (rule.params === 'breathe') keyframes.push(rule);
    });
    expect(keyframes, '@keyframes breathe is missing').toHaveLength(1);
    const frames = keyframes[0].toString().replace(/\s+/g, ' ');
    expect(frames).toMatch(/0%, 100% \{ transform: scale\(1\); opacity: \.55;? \}/);
    expect(frames).toMatch(/50% \{ transform: scale\(1\.6\); opacity: 0;? \}/);

    const found: { media: string; animation: string }[] = [];
    app.walkRules('.motion-safe\\:animate-breathe', (rule) => {
      if (rule.parent?.type !== 'atrule') return;
      rule.walkDecls('animation', (decl) => {
        found.push({ media: (rule.parent as AtRule).params, animation: decl.value });
      });
    });
    expect(found).toHaveLength(1);
    expect(found[0].media).toBe('(prefers-reduced-motion: no-preference)');
    expect(found[0].animation).toMatch(/^breathe .*infinite/);
  });
});
