import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The dashboard carries no Preline UI. Preline
 * 2.x is « MIT and Preline UI Fair Use License », and that Fair Use part adds
 * use restrictions (no competing product) that AGPL-3.0 §10 forbids on the
 * Community Edition.
 *
 * Nothing in the dashboard needed it any more: the mobile drawer opens on React
 * state (`Header`), no element ever named a Preline toggle (`data-hs-*`), so its
 * overlay variant never applied, and its tabs plugin only threw on our React
 * tablists, which carried its opt-out class to stop it. This guard keeps the
 * package, its init calls, its Tailwind plugin, its markers and its opt-outs out.
 */
const ROOT = path.resolve(__dirname, '../../../..');
const SELF = path.relative(ROOT, __filename).split(path.sep).join('/');

const FILES_AT_ROOT = ['package.json', 'tailwind.config.js', 'vite.config.ts', 'index.html', 'public/index.html'];

/** Preline's plugin markers, its JS and its Tailwind variants (`hs-overlay-open:`…). */
const PRELINE_PLUGINS =
  'accordion|carousel|collapse|combo-box|copy-markup|datatable|dropdown|file-upload|input-number|layout-splitter|mega-menu|overlay|pin-input|range-slider|remove-element|removing|scrollspy|select|stepper|strong-password|tab|tabs|textarea-auto-height|theme-switch|toggle-count|toggle-password|tooltip|tree-view';
const FORBIDDEN: { what: string; re: RegExp }[] = [
  { what: 'the preline package', re: /preline/i },
  { what: "Preline's runtime (HSStaticMethods, HSOverlay…)", re: /\bHS(?:StaticMethods|Overlay|Tabs|Dropdown|Accordion|Tooltip|Collapse|Select)\b/ },
  { what: 'a Preline data attribute', re: /\bdata-hs-/ },
  { what: "Preline's auto-init opt-out", re: /--prevent-on-load-init/ },
  { what: 'a Preline marker class or variant', re: new RegExp(`(?<![\\w-])hs-(?:${PRELINE_PLUGINS})(?:[-:\\s"'\`]|$)`) },
];

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs|css|html|json)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

describe('preline', () => {
  it('appears nowhere in the dashboard: core, ee, tests, configuration', () => {
    const files = [
      ...walk(path.join(ROOT, 'src')),
      ...FILES_AT_ROOT.map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f)),
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (rel === SELF) continue;
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const { what, re } of FORBIDDEN) {
          if (re.test(line)) offenders.push(`${rel}:${i + 1} ${what}: ${line.trim().slice(0, 120)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('is not installed', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies };
    expect(Object.keys(all)).not.toContain('preline');
    expect(fs.readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')).not.toMatch(/\bpreline@/);
  });
});
