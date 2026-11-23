import { describe, expect, it } from 'vitest';
import { themes, type PrismTheme } from 'prism-react-renderer';
import { CODE_THEME_DARK, CODE_THEME_LIGHT } from './codeThemes';

/**
 * The code viewer's two themes are prism's `github` and `dracula`, minus their
 * pink, which the dashboard does not use anywhere: `github` prints strings in #E3116C, `dracula` in #FF79C6. Their
 * comments did not read either (#999988 is 2.7:1 on #F6F8FA, #6272A4 3.6:1 on
 * the raised dark surface), so they are recoloured with the strings.
 */
type Rgb = readonly [number, number, number];
const hex = (value: string): Rgb => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as unknown as Rgb;
const rgb = (value: string): Rgb => {
  if (value.startsWith('#')) return hex(value);
  const parts = value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
  if (!parts || parts.length !== 3) throw new Error(`not a colour: ${value}`);
  return parts as unknown as Rgb;
};
const linear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const ratio = (a: Rgb, b: Rgb) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};
/** Hue in degrees, or null for a grey. */
const hue = ([r, g, b]: Rgb): number | null => {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const d = max - Math.min(rr, gg, bb);
  if (d < 0.12) return null;
  const h = max === rr ? ((gg - bb) / d) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return (h * 60 + 360) % 360;
};
/** Magenta to pink, the family the dashboard does not use (violet #7845FF is 256°, #DD50FF 288°, #FF79C6 326°). */
const isPink = (colour: Rgb) => {
  const h = hue(colour);
  return h !== null && h >= 275 && h <= 345;
};

const colourOf = (theme: PrismTheme, type: string): Rgb => {
  const entry = theme.styles.find((style) => style.types.includes(type));
  if (!entry?.style.color) throw new Error(`no colour for ${type}`);
  return rgb(entry.style.color);
};
const colours = (theme: PrismTheme) => [theme.plain.color, ...theme.styles.map((s) => s.style.color)].filter(Boolean) as string[];

// The surfaces the viewer paints under the code (CodeSnippet), and its flagged line: rgba(232, 73, 42, 0.2) over them.
const LIGHT_SURFACE = hex('#f6f8fa');
const DARK_SURFACES = { 'as-raised (AppSec)': hex('#1b1b20'), 'dracula (agents space)': hex('#282a36') };
const band = (surface: Rgb): Rgb => surface.map((c, i) => [232, 73, 42][i] * 0.2 + c * 0.8) as unknown as Rgb;

describe('the code viewer themes', () => {
  it('start from the prism themes the viewer always used', () => {
    expect(CODE_THEME_LIGHT.plain).toEqual(themes.github.plain);
    expect(CODE_THEME_DARK.plain).toEqual(themes.dracula.plain);
    expect(CODE_THEME_LIGHT.styles.map((s) => s.types)).toEqual(themes.github.styles.map((s) => s.types));
    expect(CODE_THEME_DARK.styles.map((s) => s.types)).toEqual(themes.dracula.styles.map((s) => s.types));
  });

  it('hold no pink or magenta', () => {
    for (const [name, theme] of Object.entries({ light: CODE_THEME_LIGHT, dark: CODE_THEME_DARK })) {
      const pinks = colours(theme).filter((c) => isPink(rgb(c)));
      expect(pinks, name).toEqual([]);
    }
  });

  it('print strings and comments at 4.5:1 on the surface and on the flagged line', () => {
    for (const type of ['string', 'comment']) {
      const light = colourOf(CODE_THEME_LIGHT, type);
      expect(ratio(light, LIGHT_SURFACE), `light ${type}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(light, band(LIGHT_SURFACE)), `light ${type}, flagged line`).toBeGreaterThanOrEqual(4.5);
      const dark = colourOf(CODE_THEME_DARK, type);
      for (const [name, surface] of Object.entries(DARK_SURFACES)) {
        expect(ratio(dark, surface), `dark ${type} on ${name}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(dark, band(surface)), `dark ${type} on ${name}, flagged line`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('leave every other token as prism draws it', () => {
    const others = (theme: PrismTheme) =>
      theme.styles.filter((s) => !s.types.some((t) => ['string', 'comment'].includes(t))).map((s) => s.style);
    expect(others(CODE_THEME_LIGHT)).toEqual(others(themes.github));
    expect(others(CODE_THEME_DARK)).toEqual(others(themes.dracula));
  });
});
