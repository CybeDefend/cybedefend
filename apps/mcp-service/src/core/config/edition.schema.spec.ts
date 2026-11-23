import { validationSchema } from './validation.schema';

// `jose@6` ships only as native ESM, which Jest's CJS runtime cannot load,
// and src/edition/ee-modules.ts reaches it through the cloud BEARER_VERIFIER
// binding. Nothing here verifies a token, so a stub is enough.
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => 'mock-jwks'),
  jwtVerify: jest.fn(),
}));

describe('CYBEDEFEND_EDITION', () => {
  const schema = validationSchema.extract('CYBEDEFEND_EDITION');

  it('defaults CYBEDEFEND_EDITION to cloud', () => {
    expect(schema.validate(undefined).value).toBe('cloud');
  });

  it.each(['community', 'cloud', 'enterprise'])('accepts %s', (edition) => {
    expect(schema.validate(edition).error).toBeUndefined();
  });

  it('refuses any other value', () => {
    expect(schema.validate('saas').error).toBeDefined();
  });
});
