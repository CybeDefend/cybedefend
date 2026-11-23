import { isFakeSecret } from './fake-secret-detector';

// Provider-shaped values are assembled at run time, so that no literal of this
// file matches a secret scanner's pattern (a public repository's push
// protection would refuse it) while the value under test stays the same.
const joined = (...parts: string[]): string => parts.join('');
const pemBlock = (kind: string, body: string): string =>
  [
    ['-----BEGIN', kind, 'PRIVATE', 'KEY-----'].join(' '),
    body,
    ['-----END', kind, 'PRIVATE', 'KEY-----'].join(' '),
  ].join('\n');

describe('isFakeSecret', () => {
  // High-precision rule: only flag a value as fake when we are confident. A
  // false negative (a fake slips through) is just noise; a false positive (a
  // real leaked secret silently dropped) is a security miss. So the realistic
  // high-entropy secrets below MUST NOT be flagged.

  describe('detects fakes — the exact examples from the ticket', () => {
    it.each([
      ['0123456789ab', 'sequential hex'],
      ['your_api_key', 'placeholder keyword'],
      ['0123456789abcdef01234567', 'sequential hex'],
      ['TEST_MCP_JWT_PRIVATE_KEY_B64', 'env-var identifier, not a value'],
      ['s3cr3t-from-infisical', 'secret-manager reference / placeholder'],
      [
        'sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz',
        'known prefix + sequential body',
      ],
    ])('flags %j (%s)', (value) => {
      expect(isFakeSecret(value)).toBe(true);
    });
  });

  describe('detects other obvious placeholders', () => {
    it.each([
      'changeme',
      'change-me',
      'your-secret-here',
      'placeholder',
      'EXAMPLE_API_KEY',
      'xxxxxxxxxxxx',
      'aaaaaaaaaaaa',
      '${API_KEY}',
      'process.env.SECRET_KEY',
      '<your-token-here>',
      'redacted',
      'dummy-token',
    ])('flags %j', (value) => {
      expect(isFakeSecret(value)).toBe(true);
    });
  });

  describe('does NOT flag realistic, high-entropy secrets (anti-false-positive)', () => {
    it.each([
      // AWS secret access key shape (random body)
      'wJalrXUtnFEMI/K7MDENG/bPxRfiCYz9aQ1LmZ4kP',
      // GitHub PAT (random body after a known prefix)
      joined('gh', 'p_', '16C7e42F292c6912E7710c838347Ae178B4a9b'),
      // OpenAI key with a genuinely random body
      'sk-proj-T3xQ9vL2mP8wF1bN7kZ4dR6yH0aJ5cVu',
      // Slack bot token (random)
      joined('xo', 'xb-', '2492837465-3920184756-Xz9Qd2Lm4Kp7Rf1Nv8Wb'),
      // Generic high-entropy random secret
      'Z9aQ1LmZ4kP7Rf1Nv8WbXz9Qd2Lm4Kp7Rf1Nv8',
      // A real-looking JWT header.payload (base64url, high entropy)
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eYde2Q9vL2mP8wF1bN7kZ4dR6yH0',
    ])('keeps %j (real secret must not be dropped)', (value) => {
      expect(isFakeSecret(value)).toBe(false);
    });
  });

  describe('is conservative when the value is missing or empty', () => {
    it.each([null, undefined, '', '   '])(
      'keeps %j (unknown → not fake)',
      (value) => {
        expect(isFakeSecret(value as any)).toBe(false);
      },
    );
  });

  describe('never drops a realistic secret — regression guards', () => {
    it.each([
      joined('sk', '_live_', '8fJ2aaaaa9bQ2cVx8ZmKpLwR3tYuIo'), // realistic Stripe-shaped key that contains "aaaaa"
      '$2y$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', // bcrypt hash
      '$apr1$k9Lm2Qx7$pN4vR8wT2bL6mK1jH9dC3.', // apache apr1 hash
      pemBlock(
        'RSA',
        'MIIEpAIBAAKCAQEAt6t9F2nQ8zVAAAAAQ4j7kPzR2mYxW1vBnLcHd5sKfTgUe',
      ), // PEM body has "AAAA" runs
      pemBlock(
        'OPENSSH',
        'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB',
      ),
      '7Hs3cr3tNq9XmWpL2vKdR4', // random token that merely contains "s3cr3t"
      'Xy7-foo-Q3kZ9mWpL2qR', // dash-delimited token with embedded "foo"
      'postgres://u:p@db.example.com/prod', // DSN whose host is example.com
      'vK9your-passQ2mZ7XpL', // embedded "your-pass"
      'aB9-dummy-Q2mZ7XpL', // embedded "dummy"
      'V5RL_MK2B_Q9XZ_T7WP_NJ3F', // base32 recovery code (SCREAMING_SNAKE, no secret word)
      'K4M9_R2X7_W8Q3_L5N6', // grouped license/activation key
      'A1B2C3_D4E5F6_KEYMAT',
      'x7$Gq!9Lm#Wp2&Zv', // strong password containing "$G"
      'jH8$kQ2mVx9PwL', // password containing "$k"
      'c0ffeec0ffeec0ff', // low-variety hex token
      'c4c4c4c4c4c4c4',
      'f00df00df00d',
      'D1d1D1d1D1d1',
      '10101010', // numeric shared secret
      '20202020',
      'glpat-stu789vwxyz0', // GitLab token with incidental runs (below threshold)
    ])('keeps %j', (value) => {
      expect(isFakeSecret(value)).toBe(false);
    });
  });

  describe('also flags common weak / placeholder credentials (recall)', () => {
    it.each([
      'password',
      'letmein',
      'hunter2',
      'qwerty12345',
      'Passw0rd!',
      'welcome2024',
      'test123',
    ])('flags %j', (value) => {
      expect(isFakeSecret(value)).toBe(true);
    });
  });
});
