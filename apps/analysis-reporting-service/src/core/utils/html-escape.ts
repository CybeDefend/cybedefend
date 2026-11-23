/**
 * Escape user-controlled strings for safe inclusion in HTML templates.
 * Applies to text content and attribute values (covers &, <, >, ", ').
 *
 * Used by the report builders (aggregated AI Act, EU AI Act) where
 * `projectName`, `branch`, component fields, etc. flow into the Puppeteer
 * pipeline. Without escaping, a tenant-controlled string can execute JS
 * inside the headless browser context (XSS -> SSRF/exfil via `fetch`).
 *
 * Non-ASCII characters are also converted to numeric entities — Puppeteer
 * sometimes ignores the declared meta charset and produces mojibake (Â§, â)
 * on §/— in the AI Act report when the raw bytes are passed through.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/[-￿]/g, (c) => `&#${c.charCodeAt(0)};`);
}
