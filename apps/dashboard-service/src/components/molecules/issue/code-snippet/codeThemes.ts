import { themes, type PrismTheme } from 'prism-react-renderer';

/**
 * The code viewer's themes: prism's `github` (light) and `dracula` (dark),
 * without their pink. Both printed strings in pink (#E3116C, #FF79C6), which the
 * dashboard does not use anywhere; their comments did not read either
 * (#999988 is 2.7:1 on #F6F8FA, #6272A4 3.6:1 on the raised dark surface).
 *
 * Strings take GitHub's own string colours (Primer: #0A3069 on light, #A5D6FF on
 * dark), comments a zinc that reads at 4.5:1 on the viewer and on its flagged
 * line. Every other token is drawn as prism draws it (codeThemes.test.ts).
 */
const recolour = (theme: PrismTheme, colourByType: Record<string, string>): PrismTheme => ({
  ...theme,
  styles: theme.styles.map((entry) => {
    const colour = entry.types.map((type) => colourByType[type]).find(Boolean);
    return colour ? { ...entry, style: { ...entry.style, color: colour } } : entry;
  }),
});

export const CODE_THEME_LIGHT: PrismTheme = recolour(themes.github, {
  string: '#0a3069', // 12.0:1 on #F6F8FA, 9.3:1 on the flagged line
  comment: '#57606a', // 6.0:1, 4.6:1
});

export const CODE_THEME_DARK: PrismTheme = recolour(themes.dracula, {
  string: '#a5d6ff',
  comment: '#a1a1aa', // zinc-400: 6.7:1 on as-raised, 5.6:1 on dracula's #282A36
});
