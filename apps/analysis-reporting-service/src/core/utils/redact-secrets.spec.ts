/**
 * Outbound prose must not carry credential material out of the platform: a
 * catalogue description can quote a credential (Stripe and AWS keys, Slack
 * tokens, PEM and PGP private key blocks), and the catalogue is shared between
 * projects. Redaction works on the content of the text.
 */
import { redactSecrets } from './redact-secrets.util';

// Provider-shaped values are assembled at run time, so that no literal of this
// file matches a secret scanner's pattern (a public repository's push
// protection would refuse it) while the value under test stays the same.
const joined = (...parts: string[]): string => parts.join('');
const STRIPE_EXAMPLE = joined('sk', '_live_', 'EXAMPLEKEYEXAMPLEKEY0000');
const STRIPE_SHORT = joined('sk', '_live_', 'abcdefgh12345678');
const RSA_HEADER = ['BEGIN', 'RSA', 'PRIVATE', 'KEY'].join(' ');
const RSA_FOOTER = ['END', 'RSA', 'PRIVATE', 'KEY'].join(' ');

describe('redactSecrets', () => {
  it('redacts a Stripe secret key quoted in a finding description', () => {
    const prose =
      'The codebase contains a hardcoded **Stripe secret API key** ' +
      `(\`${STRIPE_EXAMPLE}\`) in plaintext.`;
    const out = redactSecrets(prose) as string;
    expect(out).not.toContain(STRIPE_EXAMPLE);
    expect(out).toContain('[REDACTED STRIPE KEY]');
    // The sentence must still read: an auditor needs to know what was found.
    expect(out).toContain('hardcoded');
  });

  it('redacts an armoured private key block whole, not line by line', () => {
    const prose = [
      'Found in config.pem:',
      `-----${RSA_HEADER}-----`,
      'MIIEowIBAAKCAQEAx7Vn8xQ2p3',
      'kQm1Nn0pQrStUvWxYz0123456',
      `-----${RSA_FOOTER}-----`,
      'Rotate it immediately.',
    ].join('\n');
    const out = redactSecrets(prose) as string;
    expect(out).not.toContain('MIIEowIBAAKCAQEAx7Vn8xQ2p3');
    expect(out).not.toContain(RSA_HEADER);
    expect(out).toContain('[REDACTED PRIVATE KEY]');
    expect(out).toContain('Rotate it immediately.');
  });

  it.each([
    [joined('AK', 'IA', 'IOSFODNN7EXAMPLE'), 'AWS KEY'],
    [joined('gh', 'p_', '1234567890abcdefghijklmnopqrstuvwx'), 'GITHUB TOKEN'],
    [joined('xo', 'xb-', '1234567890-abcdefghij'), 'SLACK TOKEN'],
    [joined('gl', 'pat-', 'abcdefghij1234567890'), 'GITLAB TOKEN'],
  ])('redacts %s', (secret, label) => {
    const out = redactSecrets(`token is ${secret} here`) as string;
    expect(out).not.toContain(secret);
    expect(out).toContain(`[REDACTED ${label}]`);
  });

  it('redacts a signed JWT, which is itself a bearer credential', () => {
    const jwt =
      joined('ey', 'JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', '.') +
      joined(
        'ey',
        'JzdWIiOiIxMjM0NTY3ODkwIn0',
        '.',
        'dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      );
    const out = redactSecrets(`Authorization: Bearer ${jwt}`) as string;
    expect(out).not.toContain(jwt);
    expect(out).toContain('[REDACTED JWT]');
  });

  it('redacts several distinct secrets in one text', () => {
    const out = redactSecrets(
      `first ${STRIPE_SHORT} then ${joined('AK', 'IA', 'IOSFODNN7EXAMPLE')}`,
    ) as string;
    expect(out).toContain('[REDACTED STRIPE KEY]');
    expect(out).toContain('[REDACTED AWS KEY]');
  });

  // A module-level /g regex carries lastIndex between calls; without a reset the
  // SECOND finding of a page silently keeps its secret. The whole point of this
  // guard is that it holds on every row, not on the first one.
  it('redacts the same shape on repeated calls', () => {
    const prose = `key ${STRIPE_SHORT} here`;
    const first = redactSecrets(prose) as string;
    const second = redactSecrets(prose) as string;
    expect(second).toEqual(first);
    expect(second).not.toContain(STRIPE_SHORT);
  });

  it('leaves ordinary prose untouched', () => {
    const prose =
      'Use a secret manager rather than committing credentials. See sk_ and AKIA prefixes.';
    expect(redactSecrets(prose)).toEqual(prose);
  });

  it('passes null and empty through unchanged', () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets('')).toEqual('');
  });
});
