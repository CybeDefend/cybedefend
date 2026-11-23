import { permifyPacer, permifyRate } from './team-org-membership-audit-cli';

/**
 * The CLI of the team/organisation membership data audit, a one-off script that
 * lives outside jest's
 * rootDir: what it reads from its environment, tested here. The script
 * itself is a cloud data audit (MySQL and the cloud Permify schema), so it is
 * covered by a cloud-only spec, not by this one.
 */
describe('team/organisation membership data audit CLI', () => {
  it('paces Permify at 50 calls a second unless PERMIFY_AUDIT_RPS says otherwise', () => {
    expect(permifyRate({})).toBe(50);
    expect(permifyRate({ PERMIFY_AUDIT_RPS: '200' })).toBe(200);
  });

  it.each(['0', '-3', 'fast', '1e9'])(
    'refuses PERMIFY_AUDIT_RPS=%s',
    (value) => {
      expect(() => permifyRate({ PERMIFY_AUDIT_RPS: value })).toThrow(
        'PERMIFY_AUDIT_RPS must be an integer between 1 and 1000',
      );
    },
  );

  it('spaces two calls by at least 1000 / rate milliseconds', async () => {
    const pace = permifyPacer(100);
    const started = Date.now();
    await pace();
    await pace();
    await pace();
    expect(Date.now() - started).toBeGreaterThanOrEqual(18);
  });
});
