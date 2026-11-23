// The platform derives "base OS end-of-life" itself.
// Trivy only sets `EOSL` inside its vulnerability scanner; in inventory mode
// (no database in the pod) the flag is gone, and the alert would go
// dark exactly when it matters most.
import { isOsEndOfLife } from './os-eol';

const AT = new Date('2026-09-10T12:00:00Z');

describe('isOsEndOfLife', () => {
  it.each([
    // [family, version, expected]
    ['alpine', '3.18.12', true], // 3.18 reached end-of-life in May 2025
    ['alpine', '3.24.1', false],
    ['debian', '10.13', true], // buster: LTS ended June 2024
    ['debian', '12.7', false],
    ['ubuntu', '18.04', true],
    ['ubuntu', '22.04', false],
    ['centos', '7', true],
    ['rocky', '9.3', false],
    ['alma', '8.9', false],
  ])('%s %s → %s', (family, version, expected) => {
    expect(isOsEndOfLife(family, version, AT)).toBe(expected);
  });

  it('answers null for an unknown family so the caller keeps the scanner flag', () => {
    expect(isOsEndOfLife('photonx', '4.0', AT)).toBeNull();
    expect(isOsEndOfLife('', '3.18', AT)).toBeNull();
  });

  it('answers null for a release absent from the table', () => {
    expect(isOsEndOfLife('alpine', '9.99.0', AT)).toBeNull();
  });

  it('is case-insensitive on the family and tolerant to trailing patch levels', () => {
    expect(isOsEndOfLife('Alpine', '3.18', AT)).toBe(true);
    expect(isOsEndOfLife('DEBIAN', '10', AT)).toBe(true);
  });

  it('flips exactly at the published date', () => {
    // Alpine 3.20 is supported until 2026-04-01 per endoflife.date.
    expect(
      isOsEndOfLife('alpine', '3.20.3', new Date('2026-03-31T00:00:00Z')),
    ).toBe(false);
    expect(
      isOsEndOfLife('alpine', '3.20.3', new Date('2026-04-02T00:00:00Z')),
    ).toBe(true);
  });
});
