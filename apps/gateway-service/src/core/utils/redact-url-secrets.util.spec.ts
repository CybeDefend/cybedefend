import { redactUrlSecrets } from './redact-url-secrets.util';

// Low-entropy fixture: realistic-looking secrets are flagged by our own secret
// scanner on every scan of this repository.
const SECRET = 'fixture-jira-webhook-secret-value';
// The invitation token of POST /auth/invitations/:token/accept: a
// repeated hex pattern, not a realistic secret.
const INVITE = '0123456789abcdef'.repeat(4);

describe('redactUrlSecrets', () => {
  describe('masks the Jira webhook secret carried in the path', () => {
    it.each([
      [`/webhooks/jira/${SECRET}`, '/webhooks/jira/[REDACTED]'],
      // The query string is not part of the secret and stays readable.
      [`/webhooks/jira/${SECRET}?foo=bar`, '/webhooks/jira/[REDACTED]?foo=bar'],
      // An extra segment 404s, and the filter logs 4xx URLs: mask all of it.
      [`/webhooks/jira/${SECRET}/extra`, '/webhooks/jira/[REDACTED]'],
      [
        `https://api.example.test/webhooks/jira/${SECRET}`,
        'https://api.example.test/webhooks/jira/[REDACTED]',
      ],
      // Unanchored on purpose: a global prefix must not reopen the leak.
      [`/api/v1/webhooks/jira/${SECRET}`, '/api/v1/webhooks/jira/[REDACTED]'],
      [`/WEBHOOKS/Jira/${SECRET}`, '/WEBHOOKS/Jira/[REDACTED]'],
    ])('%s', (url, expected) => {
      const redacted = redactUrlSecrets(url);

      expect(redacted).toBe(expected);
      expect(redacted).not.toContain(SECRET);
    });
  });

  describe('masks the invitation token carried in the path', () => {
    it.each([
      [`/auth/invitations/${INVITE}/accept`, '/auth/invitations/[REDACTED]'],
      // The query string is not part of the token and stays readable.
      [
        `/auth/invitations/${INVITE}/accept?foo=bar`,
        '/auth/invitations/[REDACTED]?foo=bar',
      ],
      [
        `https://api.example.test/auth/invitations/${INVITE}/accept`,
        'https://api.example.test/auth/invitations/[REDACTED]',
      ],
      // Unanchored on purpose: a global prefix must not reopen the leak.
      [
        `/api/auth/invitations/${INVITE}/accept`,
        '/api/auth/invitations/[REDACTED]',
      ],
    ])('%s', (url, expected) => {
      const redacted = redactUrlSecrets(url);

      expect(redacted).toBe(expected);
      expect(redacted).not.toContain(INVITE);
      expect(redacted).not.toMatch(/[0-9a-f]{64}/);
    });
  });

  it.each([
    '/webhooks/gitlab',
    '/webhooks/jira',
    '/webhooks/jira/',
    '/auth/invitations',
    '/auth/invitations/',
    '/auth/login',
    '/project/7b1c/jira/issues?page=2',
    '/organizations/7b1c/chat/conversations',
  ])('leaves %s unchanged', (url) => {
    expect(redactUrlSecrets(url)).toBe(url);
  });
});
