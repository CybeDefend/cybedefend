/**
 * The only way the Community sign-in pages read a `returnTo`: a path of this
 * app, or null. Refused: anything that does not start with a single `/`, any
 * character up to 0x20, DEL or a backslash, an encoded slash or backslash in
 * the path, and anything that resolves to another origin.
 */
export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f || code === 0x5c) return null;
  }
  const path = value.split(/[?#]/, 1)[0];
  if (/%(2f|5c)/i.test(path)) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname.startsWith('//')) return null;
  } catch {
    return null;
  }
  return value;
}
