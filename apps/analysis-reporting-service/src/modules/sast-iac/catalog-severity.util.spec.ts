import { isCatalogSeverityRequested } from './catalog-severity.util';

describe('isCatalogSeverityRequested', () => {
  it('accepts a severity the scan asked for, whatever the case', () => {
    expect(isCatalogSeverityRequested('high', 'CRITICAL,HIGH,MEDIUM')).toBe(
      true,
    );
    expect(isCatalogSeverityRequested('HIGH', 'critical,high')).toBe(true);
  });

  it('tolerates spaces around the requested severities', () => {
    expect(isCatalogSeverityRequested('MEDIUM', 'HIGH, MEDIUM ')).toBe(true);
  });

  it('refuses a severity the scan did not ask for', () => {
    expect(isCatalogSeverityRequested('LOW', 'CRITICAL,HIGH,MEDIUM')).toBe(
      false,
    );
  });

  it('refuses a rule without a severity', () => {
    expect(isCatalogSeverityRequested(null, 'CRITICAL,HIGH')).toBe(false);
    expect(isCatalogSeverityRequested('', 'CRITICAL,HIGH')).toBe(false);
  });

  it('refuses everything when the scan asked for no severity', () => {
    expect(isCatalogSeverityRequested('CRITICAL', '')).toBe(false);
    expect(isCatalogSeverityRequested('CRITICAL', undefined)).toBe(false);
  });
});
