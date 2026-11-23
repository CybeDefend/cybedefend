import { SERVICE_AUTH_POLICY } from './service-auth.policy';

describe('gateway service-auth policy', () => {
  it('signs as gateway', () => {
    expect(SERVICE_AUTH_POLICY.caller).toBe('gateway');
  });

  it('lets no unsigned caller in', () => {
    expect(SERVICE_AUTH_POLICY.scannerMethods).toEqual([]);
    expect(SERVICE_AUTH_POLICY.services).toEqual({});
    expect(SERVICE_AUTH_POLICY.methods).toEqual({});
  });
});
