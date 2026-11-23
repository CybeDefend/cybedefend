/**
 * The profiler seam. The core's services and hooks wrap their calls with
 * `profiler('name')(fn)` and import it from here, never from a tracker: the
 * closed tree plugs its own profiler in at boot with `registerProfiler`, and
 * in the Community Edition no boot hook ever registers one, so the wrap is
 * the identity and nothing is measured or sent anywhere.
 */
export type Profiler = (name: string) => <F extends (...args: never[]) => unknown>(fn: F) => F;

const identity: Profiler = () => (fn) => fn;

let registered: Profiler = identity;

/** Wrap `fn` under `name` with the registered profiler; the identity by default. */
export function profiler(name: string): <F extends (...args: never[]) => unknown>(fn: F) => F {
  return registered(name);
}

/** Plug the edition's profiler in. Called once, by an ee boot hook. */
export function registerProfiler(p: Profiler): void {
  registered = p;
}
