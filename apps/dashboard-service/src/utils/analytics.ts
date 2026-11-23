/**
 * The analytics seam. The core reports its events through `track(event, props)`;
 * the closed tree registers the real tracker at boot with `registerTracker`.
 * Without one — and in the Community Edition, where no boot hook ever
 * registers one — `track` is a no-op and no event ever leaves the browser.
 * Events never carry a server's text, a URL or a code.
 */
export type Tracker = (event: string, props?: Record<string, string | number | boolean>) => void;

let registered: Tracker | null = null;

/** Report one event; a no-op unless an edition registered a tracker. */
export function track(event: string, props?: Record<string, string | number | boolean>): void {
  registered?.(event, props);
}

/** Plug the edition's tracker in. Called once, by an ee boot hook. */
export function registerTracker(fn: Tracker): void {
  registered = fn;
}
