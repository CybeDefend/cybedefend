// Generic: byte-identical in every service with an edition layer
// (scripts/tests/service-auth-parity.bats). Change all copies together.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { decodeMasterKey, deriveKey } from '../secrets/secret-key';
import {
  SERVICE_AUTH_COMMUNITY_INFO,
  registerServiceAuthCredentials,
  registerServiceAuthKeySource,
  registerServiceAuthRules,
  registerScannerCredentials,
  resetServiceAuthSingleKeyWarning,
  resolveScannerAuthMode,
  resolveServiceAuthCallerKeys,
  resolveServiceAuthLegacyKeys,
  resolveServiceAuthMode,
  resolveServiceAuthSigningKey,
  serviceAuthAllowsScannerCalls,
  serviceAuthClientChannelOptions,
  serviceAuthCommunityPairInfo,
  serviceAuthCredentials,
  serviceAuthPolicy,
  scannerCredentials,
  serviceAuthServerChannelOptions,
} from './service-auth.edition';
import { checkServiceToken, mintServiceToken } from './service-auth';
import { SERVICE_AUTH_POLICY } from './service-auth.policy';

const MASTER = Buffer.alloc(32, 7).toString('base64');
const CLOUD_KEY = 'c'.repeat(64);
const OWN = SERVICE_AUTH_POLICY.caller;
const derived = (caller: string, server: string) =>
  deriveKey(
    decodeMasterKey(MASTER),
    serviceAuthCommunityPairInfo(caller, server),
  ).toString('hex');
/** A method served by `server`: its proto package is cybedefend.<server>. */
const pathOf = (server: string) =>
  `/cybedefend.${server.replace(/-/g, '_')}.TestService/Call`;

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

    it('derives one key per (caller, server) pair from CYBEDEFEND_SECRET_KEY', () => {
      expect(SERVICE_AUTH_COMMUNITY_INFO).toBe('service-to-service-auth');
      expect(serviceAuthCommunityPairInfo('test-caller', 'test-server')).toBe(
        'service-to-service-auth/test-caller/test-server',
      );
      // Its calls to each server, with the key of that pair.
      expect(resolveServiceAuthSigningKey(pathOf('test-server'))).toBe(
        derived(OWN, 'test-server'),
      );
      expect(resolveServiceAuthSigningKey(pathOf('test-other-server'))).toBe(
        derived(OWN, 'test-other-server'),
      );
      // A method of no known server, or no method at all: no key.
      expect(resolveServiceAuthSigningKey('/test.Echo/Say')).toBeUndefined();
      expect(resolveServiceAuthSigningKey()).toBeUndefined();
      // The calls of each caller to this server, with the key of that pair.
      expect(resolveServiceAuthCallerKeys('test-caller')).toEqual([
        derived('test-caller', OWN),
      ]);
      expect(resolveServiceAuthCallerKeys(OWN)).toEqual([derived(OWN, OWN)]);
      expect(derived(OWN, 'test-server')).not.toBe(
        derived(OWN, 'test-other-server'),
      );
      expect(derived('test-caller', OWN)).not.toBe(derived(OWN, 'test-caller'));
    });

    it('signs its calls to each server with the key of that pair, read from its own secrets', () => {
      delete process.env.CYBEDEFEND_SECRET_KEY;
      const dir = mkdtempSync(join(tmpdir(), 'service-auth-'));
      writeFileSync(
        join(dir, 'SERVICE_AUTH_KEY_FOR_TEST_SERVER'),
        `${'a'.repeat(64)}\n`,
      );
      writeFileSync(
        join(dir, 'SERVICE_AUTH_KEY_FOR_TEST_OTHER_SERVER'),
        `${'b'.repeat(64)}\n`,
      );
      process.env.SERVICE_AUTH_PEER_KEYS_DIR = dir;
      expect(resolveServiceAuthSigningKey(pathOf('test-server'))).toBe(
        'a'.repeat(64),
      );
      expect(resolveServiceAuthSigningKey(pathOf('test-other-server'))).toBe(
        'b'.repeat(64),
      );
      // A server it was handed no key for: none, so the call goes unsigned.
      expect(
        resolveServiceAuthSigningKey(pathOf('test-third-server')),
      ).toBeUndefined();
      expect(resolveServiceAuthSigningKey('/test.Echo/Say')).toBeUndefined();
    });

    it('refuses at this server a key the caller holds for another server', () => {
      delete process.env.CYBEDEFEND_SECRET_KEY;
      const now = 1_800_000_000;
      const own = pathOf(OWN);
      // The caller's own secrets: one key for this server, one for another.
      const callerDir = mkdtempSync(join(tmpdir(), 'service-auth-caller-'));
      const ownFile = `SERVICE_AUTH_KEY_FOR_${OWN.toUpperCase().replace(/-/g, '_')}`;
      writeFileSync(join(callerDir, ownFile), 'y'.repeat(64));
      writeFileSync(
        join(callerDir, 'SERVICE_AUTH_KEY_FOR_TEST_OTHER_SERVER'),
        'x'.repeat(64),
      );
      // This server's secrets: the key of the pair (test-caller, this server).
      const serverDir = mkdtempSync(join(tmpdir(), 'service-auth-server-'));
      writeFileSync(
        join(serverDir, 'SERVICE_AUTH_PEER_KEY_TEST_CALLER'),
        'y'.repeat(64),
      );

      process.env.SERVICE_AUTH_PEER_KEYS_DIR = callerDir;
      const forOther = resolveServiceAuthSigningKey(
        pathOf('test-other-server'),
      );
      const forThis = resolveServiceAuthSigningKey(own);
      process.env.SERVICE_AUTH_PEER_KEYS_DIR = serverDir;
      const keys = resolveServiceAuthCallerKeys('test-caller');
      expect([forOther, forThis]).toEqual(['x'.repeat(64), 'y'.repeat(64)]);

      const token = (key: string | undefined) =>
        mintServiceToken(key ?? '', 'test-caller', own, now);
      expect(
        checkServiceToken(keys, 'test-caller', own, token(forOther), now),
      ).toBe('invalid');
      expect(
        checkServiceToken(keys, 'test-caller', own, token(forThis), now),
      ).toBe('ok');
    });

    it('signs with SERVICE_AUTH_KEY a call to a server it holds no key of its own for (one key per service)', () => {
      delete process.env.CYBEDEFEND_SECRET_KEY;
      const dir = mkdtempSync(join(tmpdir(), 'service-auth-'));
      writeFileSync(
        join(dir, 'SERVICE_AUTH_KEY_FOR_TEST_SERVER'),
        'a'.repeat(64),
      );
      process.env.SERVICE_AUTH_PEER_KEYS_DIR = dir;
      process.env.SERVICE_AUTH_KEY = CLOUD_KEY;
      expect(resolveServiceAuthSigningKey(pathOf('test-server'))).toBe(
        'a'.repeat(64),
      );
      expect(resolveServiceAuthSigningKey(pathOf('test-other-server'))).toBe(
        CLOUD_KEY,
      );
      expect(resolveServiceAuthSigningKey('/test.Echo/Say')).toBe(CLOUD_KEY);
      expect(resolveServiceAuthSigningKey()).toBe(CLOUD_KEY);
    });

    describe('the earlier single-key layout', () => {
      let warn: jest.SpyInstance;
      beforeEach(() => {
        delete process.env.CYBEDEFEND_SECRET_KEY;
        resetServiceAuthSingleKeyWarning();
        warn = jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined);
      });
      afterEach(() => warn.mockRestore());
      const singleKeyLines = () =>
        warn.mock.calls
          .map(([line]) => String(line))
          .filter((line) => line.startsWith('S2S_AUTH_SINGLE_KEY'));

      it('says so once per process when a call is signed with the single key, naming no key', () => {
        process.env.SERVICE_AUTH_KEY = CLOUD_KEY;
        expect(resolveServiceAuthSigningKey(pathOf('test-server'))).toBe(
          CLOUD_KEY,
        );
        resolveServiceAuthSigningKey(pathOf('test-other-server'));
        resolveServiceAuthSigningKey(pathOf('test-server'));
        expect(singleKeyLines()).toEqual([
          `S2S_AUTH_SINGLE_KEY caller=${OWN}: the internal gRPC keys are the earlier single-key layout, one key for all of this service's calls, held by every server it calls. Take docker-compose.yml and its runtime/ folder from the same release as the images.`,
        ]);
        expect(singleKeyLines()[0]).not.toContain(CLOUD_KEY);
      });

      it('says so at start, when the client options are built', () => {
        const dir = mkdtempSync(join(tmpdir(), 'service-auth-'));
        writeFileSync(join(dir, 'SERVICE_AUTH_KEY'), 'f'.repeat(64));
        process.env.SERVICE_AUTH_KEY_FILE = join(dir, 'SERVICE_AUTH_KEY');
        serviceAuthClientChannelOptions();
        serviceAuthClientChannelOptions();
        expect(singleKeyLines()).toHaveLength(1);
        expect(singleKeyLines()[0]).not.toContain('f'.repeat(64));
      });

      it('stays silent when every call is signed with the key of its pair', () => {
        const dir = mkdtempSync(join(tmpdir(), 'service-auth-'));
        writeFileSync(
          join(dir, 'SERVICE_AUTH_KEY_FOR_TEST_SERVER'),
          'a'.repeat(64),
        );
        process.env.SERVICE_AUTH_PEER_KEYS_DIR = dir;
        serviceAuthClientChannelOptions();
        resolveServiceAuthSigningKey(pathOf('test-server'));
        expect(singleKeyLines()).toEqual([]);
      });
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
