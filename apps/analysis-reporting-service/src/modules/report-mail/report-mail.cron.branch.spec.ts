import { ReportMailCron } from './report-mail.cron';

/**
 * `baseToVulnItem` used to hard-code `branch: ''` for the daily /
 * weekly / monthly reports. It must now forward the branch carried by the
 * aggregated vulnerability so global-management can group / label by branch.
 */
function makeCron(): ReportMailCron {
  return new ReportMailCron(
    { log: jest.fn(), error: jest.fn() } as any, // logger
    {} as any, // aggregation
    {} as any, // gmClient
    {} as any, // eiClient
    {} as any, // entitlements
  );
}

const baseVuln = (over: Record<string, unknown> = {}) => ({
  id: 'v1',
  type: 'SAST',
  title: 'Some issue',
  severity: 'critical',
  state: 'to_verify',
  createdAt: new Date().toISOString(),
  ...over,
});

describe('ReportMailCron.baseToVulnItem — branch forwarding', () => {
  it('forwards the aggregated branch onto the proto VulnerabilityItem', () => {
    const cron = makeCron();
    const item = (cron as any).baseToVulnItem(baseVuln({ branch: 'main' }));
    expect(item.branch).toBe('main');
  });

  it('forwards the branch for SCA/CONTAINER vulnerabilities too', () => {
    const cron = makeCron();
    const item = (cron as any).baseToVulnItem(
      baseVuln({
        type: 'SCA',
        packageName: 'redis',
        version: '6.2.0',
        branch: 'dev',
      }),
    );
    expect(item.branch).toBe('dev');
    expect(item.packageName).toBe('redis');
  });

  it('emits an empty string (proto-safe) when the vuln has no branch', () => {
    const cron = makeCron();
    const item = (cron as any).baseToVulnItem(baseVuln({ branch: undefined }));
    expect(item.branch).toBe('');
  });
});
