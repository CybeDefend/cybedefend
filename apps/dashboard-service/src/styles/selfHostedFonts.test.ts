import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The dashboard serves its own fonts. A font fetched from a third-party host tells that host who
 * opens the dashboard and when, and breaks an installation without Internet access: no page, no
 * Content-Security-Policy and no `@font-face` may name an outside font host.
 *
 * Read from the files the image ships: the HTML pages, the nginx configurations, the development
 * server's headers, and the self-hosted deployment's proxy template where the tree holds it.
 */
const SERVICE_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(SERVICE_ROOT, '../..');

const EXTERNAL_FONT_HOSTS = /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net|fonts\.cdnfonts\.com/;

const filesIn = (dir: string, pattern: RegExp): string[] =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((name) => pattern.test(name))
        .map((name) => path.join(dir, name))
    : [];

/** Every file that loads a page's fonts or sets a Content-Security-Policy, as far as this tree holds it. */
const shippedFiles = (): string[] =>
  [
    path.join(SERVICE_ROOT, 'index.html'),
    path.join(SERVICE_ROOT, 'public/index.html'),
    path.join(SERVICE_ROOT, 'vite.config.ts'),
    ...filesIn(path.join(SERVICE_ROOT, 'nginx'), /\.conf$/),
    ...filesIn(path.join(SERVICE_ROOT, 'public/fonts'), /\.css$/),
    // The self-hosted deployment's reverse proxy, where it sits in the tree.
    ...filesIn(path.join(REPO_ROOT, 'deploy/community/nginx/templates'), /\.template$/),
    ...filesIn(path.join(REPO_ROOT, 'opencore/public-root/deploy/community/nginx/templates'), /\.template$/),
    // The replacement files of the public tree, where it sits in this one.
    path.join(REPO_ROOT, 'opencore/overlay/apps/dashboard-service/vite.config.ts'),
    ...filesIn(path.join(REPO_ROOT, 'opencore/overlay/apps/dashboard-service/nginx'), /\.conf$/),
  ].filter((file) => fs.existsSync(file));

describe('self-hosted fonts', () => {
  it('reads the pages and the Content-Security-Policies it guards', () => {
    const files = shippedFiles().map((file) => path.relative(SERVICE_ROOT, file));
    expect(files).toEqual(expect.arrayContaining(['index.html', 'vite.config.ts', 'nginx/community.conf']));
  });

  it('names no external font host in a page or a Content-Security-Policy', () => {
    const offenders = shippedFiles().filter((file) => EXTERNAL_FONT_HOSTS.test(fs.readFileSync(file, 'utf8')));
    expect(offenders.map((file) => path.relative(REPO_ROOT, file))).toEqual([]);
  });

  it('leaves no instruction about an external font service in those files', () => {
    const stale = shippedFiles().filter((file) => /google fonts/i.test(fs.readFileSync(file, 'utf8')));
    expect(stale.map((file) => path.relative(REPO_ROOT, file))).toEqual([]);
  });

  it('loads Rubik, Geist and Geist Mono from the dashboard itself, each with its licence', () => {
    const html = fs.readFileSync(path.join(SERVICE_ROOT, 'index.html'), 'utf8');
    expect(html).toMatch(/<link\b[^>]*href="\/fonts\/fonts\.css"[^>]*rel="stylesheet"|<link\b[^>]*rel="stylesheet"[^>]*href="\/fonts\/fonts\.css"/);

    const css = fs.readFileSync(path.join(SERVICE_ROOT, 'public/fonts/fonts.css'), 'utf8');
    const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((match) => match[1]);
    const families = new Set(faces.map((face) => /font-family:\s*['"]([^'"]+)['"]/.exec(face)?.[1]));
    expect([...families].sort()).toEqual(['Geist', 'Geist Mono', 'Rubik']);

    for (const face of faces) {
      const urls = [...face.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1].replace(/['"]/g, ''));
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(url.startsWith('/fonts/'), url).toBe(true);
        expect(fs.existsSync(path.join(SERVICE_ROOT, 'public', url)), url).toBe(true);
      }
    }
    for (const dir of ['rubik', 'geist', 'geist-mono']) {
      const licence = fs.readFileSync(path.join(SERVICE_ROOT, 'public/fonts', dir, 'OFL.txt'), 'utf8');
      expect(licence).toContain('SIL Open Font License');
    }
  });
});
