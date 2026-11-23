import type React from 'react';

import { Activity, Brain, GitBranch, ShieldAlert, ShieldX, type IconProps } from '@/components/atoms/icon/icons';

/**
 * The beat system: one story, told in the same order on every agents-space screen.
 *
 * - `did`: what the coding agents did (sessions, diff scans).
 * - `served`: what the brain served them (rules injected, proposals).
 * - `stopped`: what was stopped (guards that warned, findings caught before a
 *   commit); a refused action is `denied`.
 *
 * `live` is not a beat but a signal (a session seen in the last 15 minutes),
 * painted the same way so a dot can sit beside any of them.
 *
 * Colour is information, never decoration.
 * - Words, fills and borders are neutral zinc for EVERY tone: a beat is told
 *   by its place in the page and by a 6 px dot, never by a tinted card, a
 *   coloured rail or a coloured title.
 * - Semantic colour lives only in the `dot` (HTML) and the `mark` (SVG,
 *   through `currentColor`): amber warned, red refused, mint (the brand
 *   green) live.
 * - The accent token is the brain series alone: `served`'s `series` and
 *   `mark` (a chart line, the particles of the rules flow). The brain's dot
 *   is the strongest neutral, so a page can show the beat without spending
 *   one of its two accent uses.
 *
 * Every class string carries its `dark:` twin (the accent token follows the
 * surface by itself), and none names a fixed accent ramp: the accent is only
 * ever reached through the token (see `__guards__/product-accent`).
 */
export type Beat = 'did' | 'served' | 'stopped';

/** A palette entry: the three beats, `denied` (the red side of stopped) and `live`. */
export type BeatTone = Beat | 'denied' | 'live';

/**
 * Which piece of an element a class string paints.
 * - `text`: the quiet ink of the words and glyphs of a beat (neutral for all).
 * - `tint`: the one subtle fill a row may take (neutral for all: hover, highlight).
 * - `border`: a hairline (neutral for all).
 * - `dot`: the fill of a 6 px status dot, the only place a semantic hue shows in HTML.
 * - `mark`: the same hue as `text-*`, for an SVG mark drawn with `currentColor` (a particle, a point).
 * - `series`: the stroke of a chart series through `currentColor`: ink, the accent for the brain.
 * - `ring`: a ring around a dot, in the dot's hue at 30 %.
 * - `rail`: the former name of `dot`, kept for callers (there is no coloured rail any more).
 */
export type BeatPart = 'text' | 'tint' | 'ring' | 'rail' | 'border' | 'dot' | 'mark' | 'series';

/** The glyph a beat is drawn with, when it has more than one. */
export type BeatVariant = 'scan' | 'session' | 'guard' | 'denied';

export interface BeatSpec {
  /** The beat's short name, under `components.kit.beats`. */
  labelKey: string;
  /** One class string per part, dark twin inside. */
  classes: Readonly<Record<BeatPart, string>>;
  /**
   * The colour a canvas paints it with, per skin. A canvas cannot read `var()`:
   * resolve a token colour with `resolveCanvasColor` before handing it over.
   */
  canvas: Readonly<{ light: string; dark: string }>;
}

export const BEAT_ORDER: readonly Beat[] = ['did', 'served', 'stopped'];

export const BEAT_PARTS: readonly BeatPart[] = ['text', 'tint', 'ring', 'rail', 'border', 'dot', 'mark', 'series'];

/** The parts every tone shares: colour never reaches a word, a fill or a border. */
const NEUTRAL = {
  text: 'text-zinc-500 dark:text-zinc-400',
  tint: 'bg-zinc-100 dark:bg-white/[0.04]',
  border: 'border-zinc-200 dark:border-vd-line',
  series: 'text-zinc-900/70 dark:text-zinc-100/70',
} as const;

/** The parts that carry a tone's hue: its dot, the same dot as an SVG mark, its ring. */
const signal = (dot: string, mark: string, ring: string) => ({ dot, rail: dot, mark, ring });

export const BEATS: Readonly<Record<BeatTone, BeatSpec>> = {
  did: {
    labelKey: 'components.kit.beats.did',
    classes: {
      ...NEUTRAL,
      ...signal('bg-zinc-400 dark:bg-zinc-500', 'text-zinc-400 dark:text-zinc-500', 'ring-zinc-400/30 dark:ring-zinc-500/30'),
    },
    canvas: { light: '#71717A', dark: '#A1A1AA' },
  },
  served: {
    labelKey: 'components.kit.beats.served',
    classes: {
      ...NEUTRAL,
      ...signal('bg-zinc-900 dark:bg-zinc-100', 'text-secondary dark:text-secondary-light', 'ring-secondary/30'),
      series: 'text-secondary dark:text-secondary-light',
    },
    canvas: { light: 'rgb(var(--color-secondary-rgb))', dark: 'rgb(var(--color-secondary-light-rgb))' },
  },
  stopped: {
    labelKey: 'components.kit.beats.stopped',
    classes: {
      ...NEUTRAL,
      ...signal('bg-amber-500 dark:bg-amber-400', 'text-amber-500 dark:text-amber-400', 'ring-amber-500/30 dark:ring-amber-400/30'),
    },
    canvas: { light: '#F59E0B', dark: '#FBBF24' },
  },
  denied: {
    // Still the stopped beat, in its red shade: it shares the beat's name.
    labelKey: 'components.kit.beats.stopped',
    classes: {
      ...NEUTRAL,
      ...signal('bg-red-500 dark:bg-red-400', 'text-red-500 dark:text-red-400', 'ring-red-500/30 dark:ring-red-400/30'),
    },
    canvas: { light: '#EF4444', dark: '#F87171' },
  },
  live: {
    labelKey: 'components.kit.beats.live',
    classes: {
      ...NEUTRAL,
      ...signal('bg-mint', 'text-mint', 'ring-mint/30'),
    },
    canvas: { light: '#10B981', dark: '#34D399' },
  },
};

/** The class string that paints `part` of an element in `tone`. */
export const beatClasses = (tone: BeatTone, part: BeatPart): string => BEATS[tone].classes[part];

type Glyph = React.ForwardRefExoticComponent<IconProps & React.RefAttributes<SVGSVGElement>>;

/**
 * The registry glyph of a beat: a diff scan or a session for `did`, the brain
 * for `served`, a guard or a refusal for `stopped`. All stroked lucide glyphs,
 * so they share one weight.
 */
export const glyphOf = (beat: Beat, variant?: BeatVariant): Glyph => {
  if (beat === 'served') return Brain;
  if (beat === 'did') return variant === 'session' ? Activity : GitBranch;
  return variant === 'denied' ? ShieldX : ShieldAlert;
};

/** What a canvas paints when a token it needs is not set: zinc-400, readable on both skins. */
const CANVAS_FALLBACK = 'rgb(161 161 170)';

const readCssVariable = (name: string): string => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return '';
  return window.getComputedStyle(document.documentElement).getPropertyValue(name);
};

/**
 * A colour a canvas can use: `var(--x)` replaced by the value the page
 * resolves (read on `<html>` by default), so the served beat follows the
 * product's accent like every class does. A colour without `var()` is
 * returned as is.
 */
export const resolveCanvasColor = (color: string, read: (name: string) => string = readCssVariable): string => {
  if (!color.includes('var(')) return color;
  let missing = false;
  const resolved = color.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
    const value = read(name).trim();
    if (!value) missing = true;
    return value;
  });
  return missing ? CANVAS_FALLBACK : resolved;
};
