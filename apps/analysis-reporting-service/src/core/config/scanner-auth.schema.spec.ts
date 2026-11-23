import { validationSchema } from './validation.schema';

// Scanner-call authentication (src/core/scanner-auth/scanner-auth.contract.ts).
describe('scanner-call authentication settings', () => {
  const key = (name: string) => validationSchema.extract(name);

  it.each([
    ['SCANNER_AUTH_MODE', 'verify'],
    [
      'SCANNER_AUTH_NAMESPACES',
      'scanners-namespace,scanners-container-namespace',
    ],
    ['SCANNER_AUTH_CLOSED_GRACE_SECONDS', 120],
  ])('defaults %s', (name, expected) => {
    const { error, value } = key(name).validate(undefined);
    expect(error).toBeUndefined();
    expect(value).toBe(expected);
  });

  // @nestjs/config copies Joi defaults into process.env, and the pod builder
  // gives scanner pods a token only when this variable is set.
  it('gives SCANNER_AUTH_SERVICE_ACCOUNT no default', () => {
    const { error, value } = key('SCANNER_AUTH_SERVICE_ACCOUNT').validate(
      undefined,
    );
    expect(error).toBeUndefined();
    expect(value).toBeUndefined();
    expect(
      key('SCANNER_AUTH_SERVICE_ACCOUNT').validate('scanner-grpc').value,
    ).toBe('scanner-grpc');
  });

  it('accepts verify and enforce, refuses any other mode', () => {
    expect(key('SCANNER_AUTH_MODE').validate('enforce').error).toBeUndefined();
    expect(key('SCANNER_AUTH_MODE').validate('verify').error).toBeUndefined();
    for (const raw of ['off', 'ENFORCE', 'true']) {
      expect(key('SCANNER_AUTH_MODE').validate(raw).error).toBeDefined();
    }
  });

  it('bounds the grace of a closed container to an hour', () => {
    const grace = key('SCANNER_AUTH_CLOSED_GRACE_SECONDS');
    expect(grace.validate('0').value).toBe(0);
    expect(grace.validate('3600').value).toBe(3600);
    for (const raw of ['-1', '3601', '1.5', 'soon']) {
      expect(grace.validate(raw).error).toBeDefined();
    }
  });
});
