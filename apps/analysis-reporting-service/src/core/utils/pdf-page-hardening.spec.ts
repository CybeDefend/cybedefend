// pdf-page-hardening.spec.ts
//
// The report HTML carries text from scanner output, imported SARIF / SBOM
// files and LLM answers. Any escaping gap would let that text run in the
// headless Chromium that prints the PDF, on a network where the internal
// services answer. The page is therefore locked before any HTML reaches it:
// no script, no service worker, offline, and every request that is not an
// inline `data:` / `about:` resource is aborted. These tests pin that set-up
// on a recorded page; `pdf-page-hardening.live.spec.ts` proves it on a real
// browser.

import {
  hardenReportPage,
  isAllowedReportRequest,
  requestScheme,
  type HardenablePage,
  type InterceptedRequest,
} from './pdf-page-hardening';

type Handler = (request: InterceptedRequest) => void;

function recordingPage() {
  const calls: string[] = [];
  const handlers: Handler[] = [];
  const page: HardenablePage = {
    setJavaScriptEnabled: jest.fn(async (v: boolean) => {
      calls.push(`setJavaScriptEnabled(${v})`);
    }),
    setBypassServiceWorker: jest.fn(async (v: boolean) => {
      calls.push(`setBypassServiceWorker(${v})`);
    }),
    setOfflineMode: jest.fn(async (v: boolean) => {
      calls.push(`setOfflineMode(${v})`);
    }),
    setRequestInterception: jest.fn(async (v: boolean) => {
      calls.push(`setRequestInterception(${v})`);
    }),
    on: jest.fn((event: 'request', handler: Handler) => {
      calls.push(`on(${event})`);
      handlers.push(handler);
      return page;
    }),
  };
  return { page, calls, handlers };
}

function request(url: string, navigation = false) {
  return {
    url: () => url,
    isNavigationRequest: () => navigation,
    abort: jest.fn(async () => undefined),
    continue: jest.fn(async () => undefined),
    respond: jest.fn(async () => undefined),
  };
}

describe('requestScheme', () => {
  it('names the scheme only', () => {
    expect(requestScheme('http://10.0.0.1:50051/secret?token=abc')).toBe(
      'http:',
    );
    expect(requestScheme('file:///tmp/x')).toBe('file:');
    expect(requestScheme('DATA:font/woff2;base64,AAAA')).toBe('data:');
  });

  it('never echoes a value it cannot parse', () => {
    expect(requestScheme('not a url with secret')).toBe('invalid');
    expect(requestScheme('')).toBe('invalid');
  });
});

describe('isAllowedReportRequest', () => {
  it.each([
    'data:font/woff2;base64,AAAA',
    'data:image/png;base64,AAAA',
    'about:blank',
  ])('lets an inline resource through: %s', (url) => {
    expect(isAllowedReportRequest(url, false)).toBe(true);
  });

  it.each([
    'http://analysis-reporting:50051/',
    'https://example.com/a.png',
    'file:///tmp/a.css',
    'ws://127.0.0.1:1/',
    'blob:null/abc',
    'chrome://version',
    'javascript:alert(1)',
    'filesystem:http://x/temporary/a',
    '//example.com/a.png',
    'garbage',
  ])('aborts %s', (url) => {
    expect(isAllowedReportRequest(url, false)).toBe(false);
  });

  it('aborts any navigation, even to an inline document', () => {
    expect(isAllowedReportRequest('data:text/html,<p>x</p>', true)).toBe(false);
    expect(isAllowedReportRequest('about:blank', true)).toBe(false);
    expect(isAllowedReportRequest('https://example.com/', true)).toBe(false);
  });
});

describe('hardenReportPage', () => {
  it('turns scripts off, bypasses service workers, goes offline and intercepts every request', async () => {
    const { page, calls } = recordingPage();
    await hardenReportPage(page, jest.fn());
    expect(calls).toEqual(
      expect.arrayContaining([
        'setJavaScriptEnabled(false)',
        'setBypassServiceWorker(true)',
        'setOfflineMode(true)',
        'setRequestInterception(true)',
        'on(request)',
      ]),
    );
    // the handler is registered before interception starts, so no request
    // can be paused with nobody to resolve it
    expect(calls.indexOf('on(request)')).toBeLessThan(
      calls.indexOf('setRequestInterception(true)'),
    );
  });

  it('continues an inline resource and aborts the rest, reporting the scheme only', async () => {
    const { page, handlers } = recordingPage();
    const onBlocked = jest.fn();
    await hardenReportPage(page, onBlocked);
    const [handle] = handlers;

    const font = request('data:font/woff2;base64,AAAA');
    handle(font);
    expect(font.continue).toHaveBeenCalled();
    expect(font.abort).not.toHaveBeenCalled();

    const internal = request('http://internal-api:50051/internal?key=s3cr3t');
    handle(internal);
    expect(internal.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(internal.continue).not.toHaveBeenCalled();

    const local = request('file:///var/run/secrets/token');
    handle(local);
    expect(local.abort).toHaveBeenCalled();

    // a navigation is cancelled with a 204, which keeps the report: an abort
    // would commit Chromium's error page in its place
    const away = request('http://10.0.0.1/refresh', true);
    handle(away);
    expect(away.respond).toHaveBeenCalledWith({ status: 204 });
    expect(away.abort).not.toHaveBeenCalled();
    expect(away.continue).not.toHaveBeenCalled();

    expect(onBlocked.mock.calls).toEqual([['http:'], ['file:'], ['http:']]);
    for (const [arg] of onBlocked.mock.calls) {
      expect(arg).not.toMatch(/internal-api|s3cr3t|secrets|token/);
    }
  });

  it('swallows a resolution that loses a race with the page closing', async () => {
    const { page, handlers } = recordingPage();
    await hardenReportPage(page, jest.fn());
    const closing = request('https://example.com/a.png');
    closing.abort.mockRejectedValueOnce(new Error('Target closed'));
    expect(() => handlers[0](closing)).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});
