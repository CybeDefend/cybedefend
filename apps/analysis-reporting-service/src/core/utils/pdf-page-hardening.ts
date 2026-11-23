/**
 * Locks the headless Chromium page that prints a report before any HTML
 * reaches it.
 *
 * Report HTML carries text from scanner output, imported SARIF / SBOM files,
 * project names and LLM answers. Every template escapes it, but an escaping
 * gap must not become a script able to call the services that share the
 * renderer's network, nor a request to one of them. So the page runs no
 * script, uses no service worker, is offline, and aborts every request that
 * is not an inline `data:` or `about:` resource, plus every navigation. The
 * templates need nothing else: fonts and images are inlined as data URIs and
 * charts are static SVG (`modules/reports/shared/`).
 *
 * Chromium's own sandbox is off (`--no-sandbox`): the pods and the Community
 * Edition containers run with no-new-privileges and every capability
 * dropped, which leaves the setuid sandbox no way in, and the default seccomp
 * profile refuses the user namespace the namespace sandbox needs. These page
 * settings are what holds a hostile document instead.
 */

/** A puppeteer request as the interception handler sees it. */
export interface InterceptedRequest {
  url(): string;
  isNavigationRequest(): boolean;
  abort(errorCode?: 'blockedbyclient'): Promise<void>;
  continue(): Promise<void>;
  respond(response: { status: number }): Promise<void>;
}

/** The part of a puppeteer `Page` the hardening drives. */
export interface HardenablePage {
  setJavaScriptEnabled(enabled: boolean): Promise<void>;
  setBypassServiceWorker(bypass: boolean): Promise<void>;
  setOfflineMode(enabled: boolean): Promise<void>;
  setRequestInterception(enabled: boolean): Promise<void>;
  on(event: 'request', handler: (request: InterceptedRequest) => void): unknown;
}

const INLINE_SCHEMES: ReadonlySet<string> = new Set(['data:', 'about:']);

/**
 * The scheme of a URL, lower-cased with its colon, or `invalid`. This is
 * all that may be logged of a blocked request: a URL can carry an internal
 * host, a token, or the data an injected document tried to send.
 */
export function requestScheme(url: string): string {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url ?? '');
  return match ? `${match[1].toLowerCase()}:` : 'invalid';
}

/** Whether a request of the report page may go through. */
export function isAllowedReportRequest(
  url: string,
  isNavigation: boolean,
): boolean {
  if (isNavigation) return false;
  return INLINE_SCHEMES.has(requestScheme(url));
}

/**
 * Applies the lock. `onBlocked` receives the scheme of each aborted request,
 * never its URL. Call it before `setContent`.
 */
export async function hardenReportPage(
  page: HardenablePage,
  onBlocked: (scheme: string) => void,
): Promise<void> {
  await page.setJavaScriptEnabled(false);
  await page.setBypassServiceWorker(true);
  await page.setOfflineMode(true);
  page.on('request', (request) => {
    const url = request.url();
    if (isAllowedReportRequest(url, request.isNavigationRequest())) {
      request.continue().catch(() => undefined);
      return;
    }
    onBlocked(requestScheme(url));
    // An aborted navigation commits Chromium's error page in place of the
    // report; a 204 answer cancels it and the report stays.
    const refusal = request.isNavigationRequest()
      ? request.respond({ status: 204 })
      : request.abort('blockedbyclient');
    refusal.catch(() => undefined);
  });
  await page.setRequestInterception(true);
}
