import { computeSecretPriority } from './secret-priority';

describe('computeSecretPriority', () => {
  // A leaked credential is always the worst case. Exploitability does not apply
  // (the secret IS the exploit) and the file context is NOT a demotion signal —
  // a secret committed into a test file is still a real leaked secret.
  // Every secret is therefore deterministically `critical_urgent` / 100.
  it('always returns critical_urgent / 100', () => {
    expect(computeSecretPriority()).toEqual({
      priority: 'critical_urgent',
      priorityScore: 100,
    });
  });
});
