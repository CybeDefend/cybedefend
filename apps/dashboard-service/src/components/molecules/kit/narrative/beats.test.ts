import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { Activity, Brain, GitBranch, ShieldAlert, ShieldX } from '@/components/atoms/icon/icons';
import { darkCompanionReport, fixedAccentReport } from '@/components/atoms/__guards__/product-accent';

import {
  BEAT_ORDER,
  BEAT_PARTS,
  BEATS,
  type BeatPart,
  type BeatTone,
  beatClasses,
  glyphOf,
  resolveCanvasColor,
} from './beats';

const SRC = path.resolve(__dirname, '../../../..');
const TONES = Object.keys(BEATS) as BeatTone[];
const BANNED = /\b(?:violet|purple|fuchsia)-(?:50|[1-9]00|950)\b|#7845FF|#DD50FF/i;
/** Hues kept out of the space: decoration in them is rejected on sight. */
const OFF_PALETTE = /\b(?:sky|blue|cyan|orange|green|teal|indigo|pink|lime|rose|yellow)-\d/;
/** The only class words naming the accent token that the space may use (no new one: productAccent.css.test). */
const ACCENT_WORDS = new Set(['text-secondary', 'dark:text-secondary-light', 'bg-secondary', 'ring-secondary/30']);
/** A colour that is not one: zinc, white or black at any alpha, the hairline tokens, or transparent. */
const NEUTRAL = /^(?:dark:)?(?:text|bg|ring|border|fill|stroke)-(?:zinc-\d{2,3}(?:\/\d+)?|white\/\[[\d.]+\]|black\/\[[\d.]+\]|vd-line(?:-strong)?|transparent)$/;

/** The `dark:` twin each part needs: text → `dark:text-`, tint → `dark:bg-`, … */
const DARK_TWIN: Record<BeatPart, RegExp> = {
  text: /(^|\s)dark:text-/,
  tint: /(^|\s)dark:bg-/,
  ring: /(^|\s)dark:ring-/,
  rail: /(^|\s)dark:bg-/,
  border: /(^|\s)dark:border-/,
  dot: /(^|\s)dark:bg-/,
  mark: /(^|\s)dark:text-/,
  series: /(^|\s)dark:text-/,
};

const words = (classes: string) => classes.split(/\s+/).filter(Boolean);
const isNeutral = (classes: string) => words(classes).every((w) => NEUTRAL.test(w));
const namesAccent = (classes: string) => /secondary/.test(classes);
/** The brand hints `mint` and `iris` (index.css) follow the theme by themselves, like the accent token: no `dark:` twin needed. */
const namesBrandHint = (classes: string) => /-(?:mint|iris)(?=\/|\s|$)/.test(classes);

describe('the beat system', () => {
  it('tells the story in three beats, in order: did, served, stopped', () => {
    expect(BEAT_ORDER).toEqual(['did', 'served', 'stopped']);
    expect(TONES).toEqual(expect.arrayContaining(['did', 'served', 'stopped', 'denied', 'live']));
  });

  it('gives every tone and part one class string with its dark twin, unless it is the accent token', () => {
    for (const tone of TONES) {
      for (const part of BEAT_PARTS) {
        const classes = beatClasses(tone, part);
        expect(classes, `${tone}.${part}`).toMatch(/\S/);
        expect(classes, `${tone}.${part} names a banned ramp`).not.toMatch(BANNED);
        expect(classes, `${tone}.${part} names a hue the space does not use`).not.toMatch(OFF_PALETTE);
        // The token follows the surface by itself (index.css), so `bg-secondary` needs no twin.
        if (!namesAccent(classes) && !namesBrandHint(classes)) expect(classes, `${tone}.${part} has no dark twin`).toMatch(DARK_TWIN[part]);
      }
    }
  });

  it('never colours a word, a fill or a border: text, tint and border are neutral zinc for every tone', () => {
    for (const tone of TONES) {
      for (const part of ['text', 'tint', 'border'] as const) {
        expect(isNeutral(beatClasses(tone, part)), `${tone}.${part}: ${beatClasses(tone, part)}`).toBe(true);
      }
    }
    // One quiet ink for the words of every beat; the beat is told by position and by a dot, not by a hue.
    expect(new Set(TONES.map((tone) => beatClasses(tone, 'text'))).size).toBe(1);
    expect(beatClasses('did', 'text')).toBe('text-zinc-500 dark:text-zinc-400');
  });

  it('keeps did neutral in every part', () => {
    for (const part of BEAT_PARTS) expect(isNeutral(beatClasses('did', part)), `did.${part}`).toBe(true);
    expect(beatClasses('did', 'dot')).toBe('bg-zinc-400 dark:bg-zinc-500');
  });

  it('shows the semantic colours as a 6 px dot or a mark only: amber warned, red refused, mint live', () => {
    expect(beatClasses('stopped', 'dot')).toBe('bg-amber-500 dark:bg-amber-400');
    expect(beatClasses('denied', 'dot')).toBe('bg-red-500 dark:bg-red-400');
    expect(beatClasses('live', 'dot')).toBe('bg-mint');
    expect(beatClasses('stopped', 'mark')).toBe('text-amber-500 dark:text-amber-400');
    expect(beatClasses('denied', 'mark')).toBe('text-red-500 dark:text-red-400');
    expect(beatClasses('live', 'mark')).toBe('text-mint');
    // The rail is the old name of the dot, kept for callers.
    for (const tone of TONES) expect(beatClasses(tone, 'rail'), tone).toBe(beatClasses(tone, 'dot'));
  });

  it('draws every chart series in ink, the brain series alone in the accent', () => {
    for (const tone of TONES.filter((t) => t !== 'served')) {
      expect(beatClasses(tone, 'series'), tone).toBe('text-zinc-900/70 dark:text-zinc-100/70');
    }
    expect(beatClasses('served', 'series')).toBe('text-secondary dark:text-secondary-light');
    expect(beatClasses('served', 'mark')).toBe('text-secondary dark:text-secondary-light');
  });

  it('reserves the accent for what the brain served, and only where it is the brain series', () => {
    for (const tone of TONES) {
      for (const part of BEAT_PARTS) {
        const classes = beatClasses(tone, part);
        if (!namesAccent(classes)) continue;
        expect(tone, `${tone}.${part} names the accent`).toBe('served');
        expect(['series', 'mark', 'ring'], `served.${part} names the accent`).toContain(part);
        for (const word of words(classes).filter((w) => /secondary/.test(w))) {
          expect(ACCENT_WORDS.has(word), `${word} is not a token form the space already uses`).toBe(true);
        }
      }
    }
    // The brain's dot is the strongest neutral, not the accent: a dot is not the series.
    expect(beatClasses('served', 'dot')).toBe('bg-zinc-900 dark:bg-zinc-100');
  });

  it('never puts a white label on the light shade of the accent', () => {
    for (const tone of TONES) {
      for (const part of BEAT_PARTS) {
        const classes = beatClasses(tone, part);
        if (/(?:to|via|bg)-secondary-light(?!\/)/.test(classes)) expect(classes).not.toMatch(/text-white/);
      }
    }
  });

  it('passes both accent guards of its space as a file of that space', () => {
    const rel = 'components/molecules/kit/narrative/beats.ts';
    const source = fs.readFileSync(path.join(SRC, rel), 'utf8');
    expect(fixedAccentReport(rel, source, 0).regressions).toEqual([]);
    expect(darkCompanionReport(rel, source, 0).regressions).toEqual([]);
  });

  it('draws each beat with its registry glyph, all of them stroked lucide glyphs', () => {
    expect(glyphOf('did')).toBe(GitBranch);
    expect(glyphOf('did', 'scan')).toBe(GitBranch);
    expect(glyphOf('did', 'session')).toBe(Activity);
    expect(glyphOf('served')).toBe(Brain);
    expect(glyphOf('stopped')).toBe(ShieldAlert);
    expect(glyphOf('stopped', 'guard')).toBe(ShieldAlert);
    expect(glyphOf('stopped', 'denied')).toBe(ShieldX);
  });

  it('carries a canvas colour per skin: did neutral, the semantic hues, the accent read from the token', () => {
    expect(BEATS.did.canvas).toEqual({ light: '#71717A', dark: '#A1A1AA' });
    expect(BEATS.stopped.canvas).toEqual({ light: '#F59E0B', dark: '#FBBF24' });
    expect(BEATS.denied.canvas).toEqual({ light: '#EF4444', dark: '#F87171' });
    expect(BEATS.live.canvas).toEqual({ light: '#10B981', dark: '#34D399' });
    expect(BEATS.served.canvas.light).toBe('rgb(var(--color-secondary-rgb))');
    expect(BEATS.served.canvas.dark).toBe('rgb(var(--color-secondary-light-rgb))');
  });

  it('resolves a token colour for a canvas, which cannot read var()', () => {
    const vars: Record<string, string> = { '--color-secondary-rgb': ' 162 28 175 ' };
    const read = (name: string) => vars[name] ?? '';
    expect(resolveCanvasColor('rgb(var(--color-secondary-rgb))', read)).toBe('rgb(162 28 175)');
    expect(resolveCanvasColor('#0284C7', read)).toBe('#0284C7');
    // An unset variable falls back to the neutral grey of the space (zinc-400) rather than an invalid colour.
    expect(resolveCanvasColor('rgb(var(--color-secondary-light-rgb))', read)).toBe('rgb(161 161 170)');
  });

  it('names every beat with a key present in en and fr', () => {
    const fragment = (lang: string) => {
      const file = path.join(SRC, `i18n/locales/${lang}/components/kit.json`);
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    };
    const lookup = (tree: unknown, key: string) =>
      key.split('.').reduce<unknown>((cur, k) => (cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined), tree);
    for (const lang of ['en', 'fr']) {
      const tree = fragment(lang);
      for (const tone of TONES) {
        const key = BEATS[tone].labelKey;
        expect(typeof lookup(tree, key), `${lang}: ${key}`).toBe('string');
      }
    }
  });
});
