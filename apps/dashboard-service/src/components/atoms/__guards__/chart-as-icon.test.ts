import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * recharts and the icon registry share names — `PieChart` is a chart container
 * in one and a glyph in the other. Import the chart and the glyph disappears
 * from the call site: the JSX still compiles, still type-checks, and renders a
 * container that draws nothing without data or a sized parent.
 *
 * That is exactly what shipped on both Overview pages. `AnalysisTypeOverview`
 * and `OrganizationAnalysisTypeOverview` each rendered `<PieChart className="h-5
 * w-5 …" />` in the card header, so the accent box sat empty next to a filled
 * one on the severity card beside it. Nothing failed — it just looked unfinished.
 *
 * A chart component sized like an icon is always this mistake. Icons come from
 * `@/components/atoms/icon/icons`, which stamps every glyph with `cybe-icon`.
 */
const SRC = path.resolve(__dirname, '../../..');

/** Tailwind height step in the icon range — charts are never sized this way. */
const ICON_SIZED = /className=(["'])[^"']*\bh-(?:2|2\.5|3|3\.5|4|4\.5|5|6|7|8|9|10|12)\b/;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') sourceFiles(full, acc);
    } else if (entry.name.endsWith('.tsx') && !/\.(test|spec)\./.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Names this file pulled out of recharts, honouring `X as Y` aliases. */
function rechartsImports(text: string): string[] {
  const block = text.match(/import\s*\{([^}]*)\}\s*from\s*['"]recharts['"]/s);
  if (!block) return [];
  return block[1]
    .split(',')
    .map((n) => n.trim().split(/\s+as\s+/).pop()!.trim())
    .filter(Boolean);
}

describe('icon registry', () => {
  it('never lets a recharts component stand in for a glyph', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const text = fs.readFileSync(file, 'utf8');
      const names = rechartsImports(text);
      if (names.length === 0) continue;

      for (const name of names) {
        const usage = new RegExp(`<${name}\\b((?:[^<>]|\\n)*?)/?>`, 'g');
        for (const match of text.matchAll(usage)) {
          if (!ICON_SIZED.test(match[1])) continue;
          const line = text.slice(0, match.index).split('\n').length;
          const rel = path.relative(SRC, file).split(path.sep).join('/');
          offenders.push(
            `src/${rel}:${line} — <${name}> comes from recharts but is sized like an icon; ` +
              `import the glyph from @/components/atoms/icon/icons instead`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
