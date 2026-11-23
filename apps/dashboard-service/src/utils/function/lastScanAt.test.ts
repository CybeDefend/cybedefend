import { describe, expect, it } from 'vitest';
import { resolveLastScanAt } from './lastScanAt';

// The Results pages hold the project's latest scan (`scanInfo`).
// The detail drawer compares an agent verdict against it to say "this
// analysis dates from a previous scan". Only a FINISHED scan that actually
// ran the drawer's family counts: a running scan is still producing its
// analysis, and a container-only scan says nothing about a SAST verdict.
const scan = (over: Partial<{ state: string; scanType: string; createAt: string }> = {}) => ({
  scanId: 's1',
  state: 'completed',
  createAt: '2026-09-18T09:30:00Z',
  scanType: 'sast,iac,secret',
  ...over,
});

describe('resolveLastScanAt', () => {
  it('returns the creation date of a completed scan that ran the family', () => {
    expect(resolveLastScanAt(scan(), 'sast')).toBe('2026-09-18T09:30:00Z');
    expect(resolveLastScanAt(scan(), 'iac')).toBe('2026-09-18T09:30:00Z');
  });

  it('accepts a degraded completion too', () => {
    expect(resolveLastScanAt(scan({ state: 'completed_degraded' }), 'sast')).toBe(
      '2026-09-18T09:30:00Z',
    );
  });

  it.each(['running', 'queued', 'waiting_for_file', 'failed', 'cancelled'])(
    'returns null while the scan is %s',
    (state) => {
      expect(resolveLastScanAt(scan({ state }), 'sast')).toBeNull();
    },
  );

  it('returns null when the scan did not run the family (container-only scan)', () => {
    expect(resolveLastScanAt(scan({ scanType: 'container' }), 'sast')).toBeNull();
    expect(resolveLastScanAt(scan({ scanType: 'sast,secret' }), 'cicd')).toBeNull();
  });

  it('treats a scan with no recorded scanType as covering every family', () => {
    expect(resolveLastScanAt(scan({ scanType: '' }), 'cicd')).toBe('2026-09-18T09:30:00Z');
  });

  it('returns null without scan info', () => {
    expect(resolveLastScanAt(null, 'sast')).toBeNull();
    expect(resolveLastScanAt(undefined, 'sast')).toBeNull();
  });
});
