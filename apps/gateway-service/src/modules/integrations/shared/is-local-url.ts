/**
 * Detect local/loopback URLs that an external issue tracker (Jira Cloud,
 * Linear) cannot reach. Covers localhost, 127.x.x.x, 0.0.0.0, [::1] and
 * `.local` suffixes. Same rule as `JiraController.isLocalUrl`.
 */
export function isLocalUrl(url: string): boolean {
  return /localhost|127\.\d|0\.0\.0\.0|\[::1\]|\.local(?:$|[:\/])/i.test(url);
}
