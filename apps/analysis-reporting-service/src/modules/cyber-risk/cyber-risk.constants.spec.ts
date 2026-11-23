import { ACTIVE_VULN_STATES } from './cyber-risk.constants';

describe('ACTIVE_VULN_STATES', () => {
  it('is exactly the two canonical active lifecycle states', () => {
    // `proposed_not_exploitable` was an exploitability verdict masquerading as a
    // lifecycle state. Migration 1803 remapped it to `to_verify`, so the active
    // set used for counters / scoring is now just to_verify + confirmed.
    expect([...ACTIVE_VULN_STATES]).toEqual(['to_verify', 'confirmed']);
  });

  it('excludes exploitability-derived and terminal states', () => {
    for (const excluded of [
      'proposed_not_exploitable',
      'not_exploitable',
      'resolved',
      'ignored',
    ]) {
      expect(ACTIVE_VULN_STATES).not.toContain(excluded);
    }
  });
});
