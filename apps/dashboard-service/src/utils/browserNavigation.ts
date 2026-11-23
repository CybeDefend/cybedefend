/**
 * A full-page navigation to another origin (a payment page). Kept in its own
 * module so a test can replace it; callers check the URL before calling it.
 */
export function assignLocation(url: string): void {
  window.location.assign(url);
}
