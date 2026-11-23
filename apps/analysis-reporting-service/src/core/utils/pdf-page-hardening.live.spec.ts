// pdf-page-hardening.live.spec.ts
//
// Opt-in proof on a real Chromium that the hardened page runs no script and
// sends no request. Jest maps `puppeteer` to a stub (it ships as native ESM),
// so the browser is driven from a child Node process that imports the real
// package and the compiled hardening module.
//
//   pnpm build
//   PDF_RENDER_LIVE=1 pnpm exec jest src/core/utils/pdf-page-hardening.live.spec.ts
//
// PUPPETEER_EXECUTABLE_PATH may name the browser (unset: Puppeteer's own).

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as path from 'path';
import { getReportFontFaceCss } from '../../modules/reports/shared/report-fonts';

const live = process.env.PDF_RENDER_LIVE === '1';
const describeLive = live ? describe : describe.skip;

const SERVICE_ROOT = path.resolve(__dirname, '../../..');
const COMPILED = path.join(
  SERVICE_ROOT,
  'dist/core/utils/pdf-page-hardening.js',
);

const CHILD = `
import puppeteer from 'puppeteer';
import { createRequire } from 'module';
const require = createRequire(process.cwd() + '/');
const { hardenReportPage } = require(process.env.HARDENING_MODULE);
const harden = process.env.HARDEN === '1';
const browser = await puppeteer.launch({
  headless: 'shell',
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  const blocked = [];
  if (harden) await hardenReportPage(page, (scheme) => blocked.push(scheme));
  await page.setContent(process.env.REPORT_HTML, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.footer', { visible: true, timeout: 5000 });
  await new Promise((r) => setTimeout(r, 300));
  const title = await page.title();
  const documentUrl = page.url();
  const fontLoaded = await page.evaluate(() =>
    [...document.fonts].some((f) => f.family.includes('Rubik') && f.status === 'loaded'),
  );
  const pdf = await page.pdf({ format: 'A4' });
  process.stdout.write(JSON.stringify({ title, documentUrl, blocked, fontLoaded, pdfBytes: pdf.length }));
} finally {
  await browser.close();
}
`;

// a 1x1 transparent PNG
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function render(html: string, harden: boolean) {
  return new Promise<{
    title: string;
    documentUrl: string;
    blocked: string[];
    fontLoaded: boolean;
    pdfBytes: number;
  }>((resolve, reject) => {
    execFile(
      process.execPath,
      ['--input-type=module', '-e', CHILD],
      {
        cwd: SERVICE_ROOT,
        env: {
          ...process.env,
          HARDENING_MODULE: COMPILED,
          HARDEN: harden ? '1' : '0',
          REPORT_HTML: html,
        },
        timeout: 60_000,
      },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`${error.message}\n${stderr}`));
        else resolve(JSON.parse(stdout));
      },
    );
  });
}

describeLive('hardened report page on a real Chromium', () => {
  let server: http.Server;
  let hits: string[];
  let base: string;

  beforeAll(async () => {
    if (!fs.existsSync(COMPILED)) {
      throw new Error(`run pnpm build first: ${COMPILED} is missing`);
    }
    hits = [];
    server = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      res.end('x');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  beforeEach(() => {
    hits.length = 0;
  });

  // the unhardened control leaves the refresh out: it would navigate away
  // before the probe could read the page
  const hostile = (refresh = true) => `<!doctype html><html><head>
<link rel="stylesheet" href="${base}/css">
<link rel="stylesheet" href="file:///tmp/report-probe.css">
${refresh ? `<meta http-equiv="refresh" content="0;url=${base}/refresh">` : ''}
<style>${getReportFontFaceCss()} body { font-family: 'Rubik'; }</style>
</head><body>
<script>document.title = 'script ran'; fetch('${base}/fetch');</script>
<img src="${base}/img">
<img src="data:image/png;base64,${PNG}">
<iframe src="${base}/frame"></iframe>
<div class="footer">footer</div>
</body></html>`;

  it('the probe is real: an unhardened page runs the script and calls the server', async () => {
    const out = await render(hostile(false), false);
    expect(out.title).toBe('script ran');
    expect(hits.length).toBeGreaterThan(0);
  }, 90_000);

  it('a hardened page runs no script, sends no request, and still prints', async () => {
    const out = await render(hostile(), true);
    expect(out.title).toBe('');
    expect(hits).toEqual([]);
    // the refresh was cancelled: the report is still the document printed
    expect(out.documentUrl).toBe('about:blank');
    expect(out.blocked).toContain('http:');
    expect(out.pdfBytes).toBeGreaterThan(1000);
    // the embedded fonts are data: URIs and still load offline
    expect(out.fontLoaded).toBe(true);
    for (const scheme of out.blocked) {
      expect(scheme).toMatch(/^[a-z][a-z0-9+.-]*:$|^invalid$/);
    }
  }, 90_000);
});
