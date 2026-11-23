import { redactSignedUrl } from './signed-url';

/**
 * A signed URL must never be logged in full: it is a bearer credential that
 * grants read access to the object for its validity window. Pino's
 * `redact.paths` (core/logger/logger.ts) cannot help, because it rewrites
 * structured fields such as `req.headers.authorization`, while these URLs are
 * interpolated into the message string itself. Redaction therefore happens at
 * the call site.
 *
 * The bucket and object key are kept: they are what makes a log line useful
 * for diagnosis, and they are not secret on their own.
 */
describe('redactSignedUrl', () => {
  const SIGNED =
    'https://storage.example.test/example-files/filtered/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.zip' +
    '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD' +
    '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20000101%2Fus-east-1%2Fs3%2Faws4_request' +
    '&X-Amz-Date=20000101T000000Z&X-Amz-Expires=1200' +
    '&X-Amz-Signature=0000000000000000000000000000000000000000000000000000000000000000' +
    '&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject';

  it('drops the signature', () => {
    expect(redactSignedUrl(SIGNED)).not.toContain('X-Amz-Signature');
    expect(redactSignedUrl(SIGNED)).not.toContain(
      '0000000000000000000000000000000000000000000000000000000000000000',
    );
  });

  it('drops every query parameter, not just the signature', () => {
    // The credential (access key id) and the SignedHeaders set are also
    // needless in a log line; keeping any of them invites re-signing games.
    // Asserted on the parameters themselves rather than on the absence of '?',
    // because the redaction marker legitimately carries one.
    expect(redactSignedUrl(SIGNED)).not.toContain('X-Amz-');
    expect(redactSignedUrl(SIGNED)).not.toContain('&');
    expect(redactSignedUrl(SIGNED)).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('keeps the bucket and object key so the log stays diagnosable', () => {
    const redacted = redactSignedUrl(SIGNED);
    expect(redacted).toContain('example-files');
    expect(redacted).toContain(
      'filtered/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.zip',
    );
  });

  it('marks the URL as redacted rather than looking like a usable link', () => {
    // Without a marker, a reader cannot tell a redacted URL from an unsigned
    // one and may waste time wondering why the link 403s.
    expect(redactSignedUrl(SIGNED)).toMatch(/redacted/i);
  });

  it('is idempotent', () => {
    const once = redactSignedUrl(SIGNED);
    expect(redactSignedUrl(once)).toBe(once);
  });

  it('leaves a URL without a query string alone apart from the marker', () => {
    const plain = 'https://storage.example.test/bucket/key.zip';
    expect(redactSignedUrl(plain)).toContain('bucket/key.zip');
    expect(redactSignedUrl(plain)).not.toContain('?');
  });

  // These run inside logger calls on the scan hot path, so throwing would turn
  // a log line into a failed scan.
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['not a url', 'n/a'],
  ])('never throws on %s input', (_label, input) => {
    expect(() => redactSignedUrl(input as unknown as string)).not.toThrow();
    expect(typeof redactSignedUrl(input as unknown as string)).toBe('string');
  });

  it('does not leak the signature when the input is malformed', () => {
    // A value that carries a signature but does not parse as a URL must still
    // be scrubbed — falling back to "return the input" would defeat the point.
    const malformed = 'not-a-url?X-Amz-Signature=deadbeefcafe';
    expect(redactSignedUrl(malformed)).not.toContain('deadbeefcafe');
  });
});
