const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * True for absolute http(s) URLs that are safe to surface as a clickable,
 * new-tab anchor (e.g. `https://docs.cybedefend.com/...`).
 *
 * We deliberately allow ONLY `http:` / `https:` — never `javascript:`,
 * `data:`, `vbscript:`, `file:`, `blob:`, `mailto:`, `tel:` or
 * protocol-relative (`//host`) hrefs — so the XSS-hardening contract is
 * preserved while legitimate documentation / source links become clickable.
 * The URL parser is the authoritative scheme gate, independent of
 * react-markdown's own `urlTransform`.
 *
 * Conscious sign-off: cleartext `http:` is intentionally allowed (not just
 * `https:`). The scheme makes no XSS difference — `javascript:`/`data:` are
 * the executable vectors, and both are blocked here — and markdown/source
 * links commonly use `http:`; dropping them would silently break valid
 * links for no security gain beyond the MITM exposure the browser already
 * surfaces.
 */
export const isSafeExternalUrl = (href: string): boolean => {
    if (href.length === 0 || href.length > 2048) return false;
    // Protocol-relative URLs inherit the page scheme and dodge an explicit
    // scheme check — reject them; real links carry an explicit http(s) scheme.
    if (href.startsWith('//')) return false;
    let parsed: URL;
    try {
        parsed = new URL(href);
    } catch {
        return false;
    }
    return SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol);
};
