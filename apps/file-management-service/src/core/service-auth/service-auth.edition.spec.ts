// Generic: byte-identical in every service with an edition layer
// (scripts/tests/service-auth-parity.bats). Change all copies together.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeMasterKey, deriveKey } from '../secrets/secret-key';
import {
  SERVICE_AUTH_COMMUNITY_INFO,
  registerServiceAuthCredentials,
  registerServiceAuthKeySource,
  registerServiceAuthRules,
  registerScannerCredentials,
  resolveScannerAuthMode,
  resolveServiceAuthCallerKeys,
  resolveServiceAuthLegacyKeys,
  resolveServiceAuthMode,
  resolveServiceAuthSigningKey,
  serviceAuthAllowsScannerCalls,
  serviceAuthClientChannelOptions,
  serviceAuthCommunityInfo,
  serviceAuthCredentials,
  serviceAuthPolicy,
  scannerCredentials,
  serviceAuthServerChannelOptions,
} from './service-auth.edition';
import { SERVICE_AUTH_POLICY } from './service-auth.policy';

const MASTER = Buffer.alloc(32, 7).toString('base64');
const CLOUD_KEY = 'c'.repeat(64);
const OWN = SERVICE_AUTH_POLICY.caller;
const derived = (caller: string) =>
  deriveKey(decodeMasterKey(MASTER), serviceAuthCommunityInfo(caller)).toString(
    'hex',
  );

const VARIABLES = [
  'CYBEDEFEND_EDITION',
  'CYBEDEFEND_SECRET_KEY',
  'CYBEDEFEND_SECRET_KEY_FILE',
  'SERVICE_AUTH_KEY',
  'SERVICE_AUTH_KEY_FILE',
  'SERVICE_AUTH_LEGACY_KEY',
  'SERVICE_AUTH_PEER_KEYS_DIR',
  'SERVICE_AUTH_PEER_KEY_TEST_CALLER',
  'SERVICE_AUTH_PEER_KEY_TEST_CALLER_FILE',
  'SERVICE_AUTH_PEER_KEY_TEST_CALLER_PREVIOUS',
  'SERVICE_AUTH_MODE',
  'SERVICE_AUTH_ALLOW_SCANNER_CALLS',
  'SCANNER_AUTH_MODE',
];

describe('service-auth edition wiring', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const v of VARIABLES) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
    registerServiceAuthKeySource(null);
    registerServiceAuthRules(null);
  });
  afterEach(() => {
    for (const v of VARIABLES) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
    registerServiceAuthKeySource(null);
    registerServiceAuthRules(null);
  });

  describe('Community Edition', () => {
    beforeEach(() => {
      process.env.CYBEDEFEND_EDITION = 'community';
      process.env.CYBEDEFEND_SECRET_KEY = MASTER;
    });

    it('always enforces, whatever SERVICE_AUTH_MODE says', () => {
      expect(resolveServiceAuthMode()).toBe('enforce');
      process.env.SERVICE_AUTH_MODE = 'verify';
      expect(resolveServiceAuthMode()).toBe('enforce');
    });

    it('derives one key per caller from CYBEDEFEND_SECRET_KEY', () => {
      expect(SERVICE_AUTH_COMMUNITY_INFO).toBe('service-to-service-auth');
      expect(serviceAuthCommunityInfo('test-caller')).toBe(
        'service-to-service-auth/test-caller',
      );
      expect(resolveServiceAuthSigningKey()).toBe(derived(OWN));
      expect(resolveServiceAuthCallerKeys('test-caller')).toEqual([
        derived('test-caller'),
      ]);
      expect(derived('test-caller')).not.toBe(derived(OWN));
    });

    it('reads the registered source, then SERVICE_AUTH_KEY, before deriving one', () => {
      process.env.SERVICE_AUTH_KEY = CLOUD_KEY;
      expect(resolveServiceAuthSigningKey()).toBe(CLOUD_KEY);
      registerServiceAuthKeySource((name) =>
        name === 'SERVICE_AUTH_KEY' ? 'r'.repeat(40) : undefined,
      );
      expect(resolveServiceAuthSigningKey()).toBe('r'.repeat(40));
    });

    it("reads its own key and its callers' keys from files when the service holds no master key (the keys the packaging derives)", () => {
      delete process.env.CYBEDEFEND_SECRET_KEY;
      const dir = mkdtempSync(join(tmpdir(), 'service-auth-'));
      writeFileSync(join(dir, 'SERVICE_AUTH_KEY'), `${'f'.repeat(64)}\n`);
      writeFileSync(
        join(dir, 'SERVICE_AUTH_PEER_KEY_TEST_CALLER'),
        `${'g'.repeat(64)}\n`,
      );
      process.env.SERVICE_AUTH_KEY_FILE = join(dir, 'SERVICE_AUTH_KEY');
      process.env.SERVICE_AUTH_PEER_KEYS_DIR = dir;
      expect(resolveServiceAuthSigningKey()).toBe('f'.repeat(64));
      expect(resolveServiceAuthCallerKeys('test-caller')).toEqual([
        'g'.repeat(64),
      ]);
      // A caller whose key it was not handed: none.
      expect(resolveServiceAuthCallerKeys('some-other-service')).toEqual([]);
      // Its own calls to itself verify with its own key.
      expect(resolveServiceAuthCallerKeys(OWN)).toEqual(['f'.repeat(64)]);
    });

    it('never builds a path from a caller name it cannot trust', () => {
      process.env.SERVICE_AUTH_PEER_KEYS_DIR = tmpdir();
      expect(resolveServiceAuthCallerKeys('../etc/passwd')).toEqual([]);
    });

    it('knows no former shared key', () => {
      process.env.SERVICE_AUTH_LEGACY_KEY = 'l'.repeat(64);
      expect(resolveServiceAuthLegacyKeys()).toEqual([]);
    });

    it('applies only its own rules, never rules registered by other code', () => {
      registerServiceAuthRules({
        services: { 'test.Extra': ['someone'] },
        methods: {},
      });
      expect(serviceAuthPolicy()).toBe(SERVICE_AUTH_POLICY);
    });

    it('signs with its HMAC keys, never with credentials registered by other code', () => {
      registerServiceAuthCredentials({
        tokenFor: () => 'k8s.token',
        verify: () => ({ caller: 'gateway' }),
      });
      expect(serviceAuthCredentials()).toBeNull();
      registerServiceAuthCredentials(null);
    });

    it('never accepts unauthenticated scanner calls', () => {
      process.env.SERVICE_AUTH_ALLOW_SCANNER_CALLS = 'true';
      expect(serviceAuthAllowsScannerCalls()).toBe(false);
    });

    it('verifies no scanner token with credentials registered by other code', () => {
      registerScannerCredentials({
        verify: () => ({
          pod: 'pod',
          podUid: 'uid',
          namespace: 'ns',
          scanId: 's-1',
          projectId: 'p-1',
        }),
      });
      expect(scannerCredentials()).toBeNull();
      registerScannerCredentials(null);
    });

    it('enforces scanner authentication, whatever SCANNER_AUTH_MODE says', () => {
      expect(resolveScannerAuthMode()).toBe('enforce');
      process.env.SCANNER_AUTH_MODE = 'verify';
      expect(resolveScannerAuthMode()).toBe('enforce');
    });
  });

  it('builds one server and one client interceptor', () => {
    expect(serviceAuthServerChannelOptions().interceptors).toHaveLength(1);
    expect(serviceAuthClientChannelOptions().interceptors).toHaveLength(1);
  });
});
