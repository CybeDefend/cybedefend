/** Credentials shorter than this are left alone: they are not secrets. */
const MIN_SECRET_LENGTH = 8;

function urlCredentials(cloneUrl: string): string[] {
  let url: URL;
  try {
    url = new URL(cloneUrl);
  } catch {
    return [];
  }
  const found = new Set<string>();
  for (const raw of [url.username, url.password]) {
    if (!raw) continue;
    found.add(raw);
    try {
      found.add(decodeURIComponent(raw));
    } catch {
      // A malformed escape: the raw form is already listed.
    }
  }
  return [...found].filter((value) => value.length >= MIN_SECRET_LENGTH);
}

function replaceAll(s: string, needle: string, replacement: string): string {
  return needle ? s.split(needle).join(replacement) : s;
}

/**
 * Replaces, in `s`, the clone URL, the credentials it carries, and the
 * credentials of any `http(s)://user:pass@` URL with placeholders.
 * Defence-in-depth: git anonymises the URLs it prints, but nothing it writes
 * to stderr may carry a token into a log sink.
 */
export function redactCloneUrl(s: string, cloneUrl: string): string {
  let out = replaceAll(s, cloneUrl, '<REDACTED_CLONE_URL>');
  for (const secret of urlCredentials(cloneUrl)) {
    out = replaceAll(out, secret, '<REDACTED>');
  }
  return out.replace(
    /https?:\/\/[^\s'"@/]+:[^\s'"@/]+@/g,
    'https://<REDACTED>@',
  );
}
