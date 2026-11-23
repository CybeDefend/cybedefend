/**
 * The public site's address an upsell slot of the Community Edition links to,
 * tagged with the slot that showed it. `path` is a page of the
 * site (`/pricing`), absent for its home. Every upsell link goes through here:
 * the site is the only host the Community upsells name.
 *
 * The pricing page opens on its Open Source section: its
 * `#open-source` fragment goes after the tags, where a URL keeps it.
 */
const PAGE_FRAGMENTS: Readonly<Record<string, string>> = { '/pricing': '#open-source' };

export function upsellLink(slotId: string, path?: string): string {
  const fragment = (path && PAGE_FRAGMENTS[path]) ?? '';
  return `https://cybedefend.com${path ?? ''}?utm_source=community&utm_medium=app&utm_campaign=${slotId}${fragment}`;
}
