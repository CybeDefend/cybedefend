// report-fonts.ts
//
// Fonts embedded in every HTML/PDF report. The Alpine runtime image installs
// only ttf-freefont: without them, the whole `-apple-system, Segoe UI,
// Roboto…` stack fell back to FreeSans and the code to FreeMono (a thin
// Courier). So the brand font (Rubik, the dashboard's) and a real monospace
// (JetBrains Mono) are embedded as base64 data URIs: no network access while
// rendering the PDF (isolated deployments), and the dashboard preview
// (sandboxed iframe, CSP `font-src data:`) shows them too. Latin subset only
// (~20 KB per weight); a non-latin glyph falls back to the next font of the
// stack.

import * as fs from 'fs';

interface FontFace {
  family: string;
  pkg: string;
  file: string;
  weight: number;
}

export const REPORT_FONT_FACES: readonly FontFace[] = [
  ...[400, 500, 600, 700].map((weight) => ({
    family: 'Rubik',
    pkg: '@fontsource/rubik',
    file: `rubik-latin-${weight}-normal.woff2`,
    weight,
  })),
  ...[400, 500].map((weight) => ({
    family: 'JetBrains Mono',
    pkg: '@fontsource/jetbrains-mono',
    file: `jetbrains-mono-latin-${weight}-normal.woff2`,
    weight,
  })),
];

/** File of an @fontsource package (its `exports` publish `./files/*.woff2`). */
function readFontFile(pkg: string, file: string): Buffer | null {
  try {
    return fs.readFileSync(require.resolve(`${pkg}/files/${file}`));
  } catch {
    return null;
  }
}

const faceCss = (face: FontFace): string => {
  const data = readFontFile(face.pkg, face.file);
  if (!data) return '';
  return `@font-face { font-family: '${face.family}'; font-style: normal; font-weight: ${face.weight}; font-display: block; src: url(data:font/woff2;base64,${data.toString('base64')}) format('woff2'); }`;
};

let cached: string | null = null;
let cachedFooter: string | null = null;

/**
 * `@font-face` rules of the report fonts. A font that cannot be found is
 * simply left out: the report falls back to the system stack instead of
 * failing.
 */
export function getReportFontFaceCss(): string {
  if (cached !== null) return cached;
  cached = REPORT_FONT_FACES.map(faceCss).filter(Boolean).join('\n');
  return cached;
}

/**
 * Rubik 400 alone, for the running footer of the PDF: Chromium renders it in
 * an isolated context that does not inherit the page's fonts.
 */
export function getFooterFontFaceCss(): string {
  if (cachedFooter !== null) return cachedFooter;
  cachedFooter = REPORT_FONT_FACES.filter(
    (f) => f.family === 'Rubik' && f.weight === 400,
  )
    .map(faceCss)
    .join('');
  return cachedFooter;
}
