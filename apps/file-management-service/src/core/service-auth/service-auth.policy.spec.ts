import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { allowedServiceCallers } from './service-auth';
import { SERVICE_AUTH_POLICY } from './service-auth.policy';

const PROTOS = join(__dirname, '..', '..', '..', '..', '..', 'libs', 'protos');

describe('file-management service-auth policy', () => {
  it('signs as file-management', () => {
    expect(SERVICE_AUTH_POLICY.caller).toBe('file-management');
  });

  it('lets no unsigned caller in', () => {
    expect(SERVICE_AUTH_POLICY.scannerMethods).toEqual([]);
  });

  it('closes every method no rule names, and names only services its protos declare', () => {
    const dir = join(PROTOS, 'file-management');
    const declared = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.proto'))) {
      const text = readFileSync(join(dir, file), 'utf8');
      for (const m of text.matchAll(/^service\s+(\w+)/gm)) {
        declared.add(`cybedefend.file_management.${m[1]}`);
      }
    }
    for (const key of Object.keys(SERVICE_AUTH_POLICY.services)) {
      expect([key, declared.has(key)]).toEqual([key, true]);
    }
    expect(SERVICE_AUTH_POLICY.methods).toEqual({});
    expect(
      allowedServiceCallers(
        SERVICE_AUTH_POLICY,
        '/cybedefend.file_management.Unknown/Do',
      ),
    ).toEqual([]);
  });

  it('lets only the data purge runner purge', () => {
    expect(
      allowedServiceCallers(
        SERVICE_AUTH_POLICY,
        '/cybedefend.file_management.DataPurgeService/PurgeProjectData',
      ),
    ).toEqual(['global-management']);
  });
});
