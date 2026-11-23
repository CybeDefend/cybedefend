import { redactCloneUrl } from './redact-clone-url';

describe('redactCloneUrl', () => {
  const cloneUrl =
    'https://x-access-token:ghs_abcdefghijklmnop@github.com/owner/repo.git';

  it('removes the whole clone URL', () => {
    const out = redactCloneUrl(`fetch ${cloneUrl} failed`, cloneUrl);
    expect(out).toBe('fetch <REDACTED_CLONE_URL> failed');
  });

  it('removes the token when it appears on its own', () => {
    const out = redactCloneUrl(
      'remote: invalid credentials ghs_abcdefghijklmnop',
      cloneUrl,
    );
    expect(out).not.toContain('ghs_abcdefghijklmnop');
  });

  it('removes credentials of any other URL', () => {
    const out = redactCloneUrl(
      "unable to access 'https://oauth2:glpat-secret@gitlab.example/x.git'",
      cloneUrl,
    );
    expect(out).not.toContain('glpat-secret');
    expect(out).toContain('https://<REDACTED>@gitlab.example/x.git');
  });

  it('leaves the text readable when the clone URL is empty', () => {
    expect(redactCloneUrl('git fetch failed', '')).toBe('git fetch failed');
  });
});
