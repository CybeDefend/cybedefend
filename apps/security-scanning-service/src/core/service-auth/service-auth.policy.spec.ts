import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { allowedServiceCallers } from './service-auth';
import { SERVICE_AUTH_POLICY } from './service-auth.policy';

const PROTOS = join(__dirname, '..', '..', '..', '..', '..', 'libs', 'protos');

describe('security-scanning service-auth policy', () => {
  it('signs as security-scanning', () => {
    expect(SERVICE_AUTH_POLICY.caller).toBe('security-scanning');
  });

  it('lets the scanner pods in on methods the protos declare only', () => {
    const proto = 'security-scanning/security_scanning.proto';
    const text = readFileSync(join(PROTOS, proto), 'utf8');
    const pkg = /^package\s+([\w.]+);/m.exec(text)?.[1];
    for (const path of SERVICE_AUTH_POLICY.scannerMethods) {
      const [, service, rpc] = /^\/[\w.]+\.(\w+)\/(\w+)$/.exec(path) ?? [];
      expect(path.startsWith(`/${pkg}.`)).toBe(true);
      expect(text).toMatch(
        new RegExp(`service ${service}\\s*\\{[^}]*rpc ${rpc}\\s*\\(`),
      );
    }
  });

  it('the scanner methods are the ones the scanner pods call', () => {
    expect(SERVICE_AUTH_POLICY.scannerMethods).toEqual([
      '/cybedefend.security_scanning.ScanService/GetScan',
      '/cybedefend.security_scanning.ScanService/UpdateScan',
      '/cybedefend.security_scanning.ScanService/UpdateScanData',
    ]);
  });

  it('closes every method no rule names, and names only services its protos declare', () => {
    const dir = join(PROTOS, 'security-scanning');
    const declared = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.proto'))) {
      const text = readFileSync(join(dir, file), 'utf8');
      for (const m of text.matchAll(/^service\s+(\w+)/gm)) {
        declared.add(`cybedefend.security_scanning.${m[1]}`);
      }
    }
    for (const key of Object.keys(SERVICE_AUTH_POLICY.services)) {
      expect([key, declared.has(key)]).toEqual([key, true]);
    }
    expect(SERVICE_AUTH_POLICY.methods).toEqual({});
    expect(
      allowedServiceCallers(
        SERVICE_AUTH_POLICY,
        '/cybedefend.security_scanning.Unknown/Do',
      ),
    ).toEqual([]);
  });

  it('lets only the data purge runner purge', () => {
    expect(
      allowedServiceCallers(
        SERVICE_AUTH_POLICY,
        '/cybedefend.security_scanning.DataPurgeService/PurgeProjectData',
      ),
    ).toEqual(['global-management']);
  });
});
