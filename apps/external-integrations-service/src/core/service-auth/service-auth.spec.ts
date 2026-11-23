// Generic: byte-identical in every service that holds src/core/service-auth/
// (scripts/tests/service-auth-parity.bats). Change all copies together.
import { timingSafeEqual } from 'node:crypto';
import {
  Metadata,
  Server,
  ServerCredentials,
  ServiceDefinition,
  credentials,
  makeGenericClientConstructor,
  status,
} from '@grpc/grpc-js';
import {
  SERVICE_AUTH_CALLER_HEADER,
  SERVICE_AUTH_MAX_SKEW_SECONDS,
  SERVICE_AUTH_TOKEN_HEADER,
  ServiceAuthCredentialCheck,
  ServiceAuthCredentials,
  ServiceAuthMode,
  ServiceAuthPolicy,
  allowedServiceCallers,
  checkServiceToken,
  createServiceAuthClientInterceptor,
  createServiceAuthServerInterceptor,
  decideServiceCall,
  mergeServiceAuthRules,
  mintServiceToken,
  serviceAuthCallersOf,
  serviceAuthPeerKeyName,
} from './service-auth';
import {
  SCANNER_AUTH_HEADER,
  SCANNER_AUTH_REQUIRED,
  SCANNER_IDENTITY_HEADERS,
  SCANNER_NAMESPACE_HEADER,
  SCANNER_POD_HEADER,
  SCANNER_POD_UID_HEADER,
  SCANNER_PROJECT_ID_HEADER,
  SCANNER_SCAN_ID_HEADER,
  SCANNER_TOKEN_HEADER,
  ScannerAuthMode,
  ScannerAuthReporter,
  ScannerCredentials,
  ScannerTokenCheck,
} from './scanner-call-auth';

jest.mock('node:crypto', () => {
  const actual =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { ...actual, timingSafeEqual: jest.fn(actual.timingSafeEqual) };
});

const KEY = 'k'.repeat(64);
const OTHER_KEY = 'o'.repeat(64);
const LEGACY_KEY = 'l'.repeat(64);
const NOW = 1_800_000_000;
const SAY = '/test.Echo/Say';
const GRANT = '/test.Echo/Grant';
const CLOSED = '/test.Hidden/Peek';
const SCAN = '/test.Echo/ReportScan';
const HEALTH = '/grpc.health.v1.Health/Check';

const POLICY: ServiceAuthPolicy = {
  caller: 'test-service',
  services: { 'test.Echo': ['gateway', 'security-scanning', 'throttle-probe'] },
  methods: { [GRANT]: ['gateway'] },
  scannerMethods: [SCAN],
};

describe('policy rules', () => {
  it('closes every method no rule names, and lets a method rule win over its service rule', () => {
    expect(allowedServiceCallers(POLICY, SAY)).toEqual([
      'gateway',
      'security-scanning',
      'throttle-probe',
    ]);
    expect(allowedServiceCallers(POLICY, GRANT)).toEqual(['gateway']);
    expect(allowedServiceCallers(POLICY, CLOSED)).toEqual([]);
    expect(allowedServiceCallers(POLICY, 'not-a-path')).toEqual([]);
  });

  it('merges more rules as the union of the callers of each entry', () => {
    const merged = mergeServiceAuthRules(POLICY, {
      services: { 'test.Hidden': ['billing'] },
      methods: { [GRANT]: ['billing'] },
    });
    expect(allowedServiceCallers(merged, CLOSED)).toEqual(['billing']);
    expect(allowedServiceCallers(merged, GRANT)).toEqual([
      'gateway',
      'billing',
    ]);
    // The base policy is left as it was.
    expect(allowedServiceCallers(POLICY, GRANT)).toEqual(['gateway']);
  });

  it('adds the scanner methods more rules name, once each', () => {
    const merged = mergeServiceAuthRules(POLICY, {
      services: {},
      methods: {},
      scannerMethods: [SCAN, GRANT],
    });
    expect(merged.scannerMethods).toEqual([...POLICY.scannerMethods, GRANT]);
    expect(
      mergeServiceAuthRules(POLICY, { services: {}, methods: {} })
        .scannerMethods,
    ).toEqual(POLICY.scannerMethods);
    // The base policy is left as it was.
    expect(POLICY.scannerMethods).not.toContain(GRANT);
  });

  it('lists every caller a policy names', () => {
    expect(serviceAuthCallersOf(POLICY)).toEqual([
      'gateway',
      'security-scanning',
      'throttle-probe',
    ]);
  });

  it("names the variable of each caller's verification key", () => {
    expect(serviceAuthPeerKeyName('gateway')).toBe(
      'SERVICE_AUTH_PEER_KEY_GATEWAY',
    );
    expect(serviceAuthPeerKeyName('security-scanning')).toBe(
      'SERVICE_AUTH_PEER_KEY_SECURITY_SCANNING',
    );
    expect(() => serviceAuthPeerKeyName('../x')).toThrow();
  });
});

describe('mintServiceToken / checkServiceToken', () => {
  it('accepts a token minted with the same key, caller, method and a time within the skew', () => {
    const token = mintServiceToken(KEY, 'gateway', SAY, NOW);
    expect(token).toMatch(/^v1\.1800000000\.[A-Za-z0-9_-]{43}$/);
    expect(checkServiceToken([KEY], 'gateway', SAY, token, NOW)).toBe('ok');
    expect(
      checkServiceToken(
        [KEY],
        'gateway',
        SAY,
        token,
        NOW + SERVICE_AUTH_MAX_SKEW_SECONDS,
      ),
    ).toBe('ok');
  });

  it('reads a missing or empty token as missing', () => {
    expect(checkServiceToken([KEY], 'gateway', SAY, undefined, NOW)).toBe(
      'missing',
    );
    expect(checkServiceToken([KEY], 'gateway', SAY, '', NOW)).toBe('missing');
  });

  it('refuses a token of another key, caller or method, and a malformed one', () => {
    const token = mintServiceToken(KEY, 'gateway', SAY, NOW);
    expect(checkServiceToken([OTHER_KEY], 'gateway', SAY, token, NOW)).toBe(
      'invalid',
    );
    expect(checkServiceToken([KEY], 'billing', SAY, token, NOW)).toBe(
      'invalid',
    );
    expect(checkServiceToken([KEY], 'gateway', GRANT, token, NOW)).toBe(
      'invalid',
    );
    for (const bad of [
      'v1',
      'v2.1800000000.abc',
      'v1.notanumber.abc',
      `v1.${NOW}.`,
      `v1.${NOW}.${'A'.repeat(500)}`,
      token + 'x',
    ]) {
      expect(checkServiceToken([KEY], 'gateway', SAY, bad, NOW)).toBe(
        'invalid',
      );
    }
  });

  it('refuses a token older or newer than the skew', () => {
    const token = mintServiceToken(KEY, 'gateway', SAY, NOW);
    const skew = SERVICE_AUTH_MAX_SKEW_SECONDS;
    expect(
      checkServiceToken([KEY], 'gateway', SAY, token, NOW + skew + 1),
    ).toBe('expired');
    expect(
      checkServiceToken([KEY], 'gateway', SAY, token, NOW - skew - 1),
    ).toBe('expired');
  });

  it('accepts the previous key during a rotation', () => {
    const token = mintServiceToken(OTHER_KEY, 'gateway', SAY, NOW);
    expect(
      checkServiceToken([KEY, OTHER_KEY], 'gateway', SAY, token, NOW),
    ).toBe('ok');
  });

  it('compares the signature in constant time', () => {
    const compare = timingSafeEqual as jest.MockedFunction<
      typeof timingSafeEqual
    >;
    compare.mockClear();
    const token = mintServiceToken(KEY, 'gateway', SAY, NOW);
    checkServiceToken([KEY, OTHER_KEY], 'gateway', SAY, token, NOW);
    // Every key is compared, whatever the first answer.
    expect(compare).toHaveBeenCalledTimes(2);
  });

  it('refuses a caller name outside the allowed alphabet', () => {
    expect(() => mintServiceToken(KEY, 'Gate way', SAY, NOW)).toThrow();
    const token = mintServiceToken(KEY, 'gateway', SAY, NOW);
    expect(checkServiceToken([KEY], 'gate\nway', SAY, token, NOW)).toBe(
      'invalid',
    );
  });
});

describe('decideServiceCall', () => {
  const base = {
    keys: [KEY],
    nowSeconds: NOW,
    policy: POLICY,
    allowScannerCalls: false,
  };
  const signed = (caller: string, path: string) => ({
    ...base,
    path,
    caller,
    token: mintServiceToken(KEY, caller, path, NOW),
  });

  it('allows a signed call to an unrestricted method', () => {
    expect(decideServiceCall(signed('security-scanning', SAY))).toEqual(
      expect.objectContaining({ allow: true, reason: 'ok' }),
    );
  });

  it('refuses a call without a token as UNAUTHENTICATED', () => {
    expect(
      decideServiceCall({
        ...base,
        path: SAY,
        caller: undefined,
        token: undefined,
      }),
    ).toEqual({
      allow: false,
      reason: 'missing',
      caller: 'unknown',
      code: status.UNAUTHENTICATED,
    });
  });

  it('refuses everything but the exempt methods when the server has no key', () => {
    const call = signed('gateway', SAY);
    expect(decideServiceCall({ ...call, keys: [] })).toEqual(
      expect.objectContaining({ allow: false, reason: 'no-key' }),
    );
    expect(
      decideServiceCall({
        ...base,
        keys: [],
        path: HEALTH,
        caller: undefined,
        token: undefined,
      }),
    ).toEqual(expect.objectContaining({ allow: true, reason: 'exempt' }));
  });

  it('refuses a signed call to a method no rule names', () => {
    expect(decideServiceCall(signed('gateway', CLOSED))).toEqual({
      allow: false,
      reason: 'not-allowed',
      caller: 'gateway',
      code: status.PERMISSION_DENIED,
    });
  });

  it("checks the token with the key of the caller it claims, never with another caller's", () => {
    // A service holding its own key only cannot sign as the gateway.
    const forged = {
      ...base,
      path: GRANT,
      caller: 'gateway',
      token: mintServiceToken(OTHER_KEY, 'gateway', GRANT, NOW),
    };
    expect(decideServiceCall(forged)).toEqual(
      expect.objectContaining({ allow: false, reason: 'invalid' }),
    );
  });

  it('refuses a caller the server holds no key for', () => {
    expect(decideServiceCall({ ...signed('gateway', SAY), keys: [] })).toEqual(
      expect.objectContaining({ allow: false, reason: 'no-key' }),
    );
  });

  it('recognises the former shared key as legacy-key, never as a trusted call', () => {
    const legacy = {
      ...base,
      path: SAY,
      caller: 'gateway',
      token: mintServiceToken(LEGACY_KEY, 'gateway', SAY, NOW),
      legacyKeys: [LEGACY_KEY],
    };
    expect(decideServiceCall(legacy)).toEqual({
      allow: false,
      reason: 'legacy-key',
      caller: 'gateway',
      code: status.UNAUTHENTICATED,
    });
    // Even when the server holds no key of that caller yet.
    expect(decideServiceCall({ ...legacy, keys: [] })).toEqual(
      expect.objectContaining({ reason: 'legacy-key' }),
    );
    // The policy still applies first.
    expect(
      decideServiceCall({
        ...legacy,
        path: GRANT,
        caller: 'security-scanning',
        token: mintServiceToken(LEGACY_KEY, 'security-scanning', GRANT, NOW),
      }),
    ).toEqual(expect.objectContaining({ reason: 'not-allowed' }));
    // A token of no known key stays invalid.
    expect(
      decideServiceCall({
        ...legacy,
        token: mintServiceToken(OTHER_KEY, 'gateway', SAY, NOW),
      }),
    ).toEqual(expect.objectContaining({ reason: 'invalid' }));
  });

  it('lets only the listed callers reach a restricted method', () => {
    expect(decideServiceCall(signed('gateway', GRANT))).toEqual(
      expect.objectContaining({ allow: true, reason: 'ok' }),
    );
    expect(decideServiceCall(signed('security-scanning', GRANT))).toEqual({
      allow: false,
      reason: 'not-allowed',
      caller: 'security-scanning',
      code: status.PERMISSION_DENIED,
    });
  });

  it('accepts an unsigned scanner method only when scanner calls are allowed', () => {
    const unsigned = {
      ...base,
      path: SCAN,
      caller: undefined,
      token: undefined,
    };
    expect(decideServiceCall(unsigned)).toEqual(
      expect.objectContaining({ allow: false, reason: 'missing' }),
    );
    expect(decideServiceCall({ ...unsigned, allowScannerCalls: true })).toEqual(
      expect.objectContaining({ allow: true, reason: 'scanner' }),
    );
    // Allowing scanner calls opens no other method.
    expect(
      decideServiceCall({ ...unsigned, path: SAY, allowScannerCalls: true }),
    ).toEqual(expect.objectContaining({ allow: false, reason: 'missing' }));
  });

  it('checks a token sent on a scanner method like any other', () => {
    const forged = {
      ...base,
      path: SCAN,
      caller: 'gateway',
      token: mintServiceToken(OTHER_KEY, 'gateway', SCAN, NOW),
      allowScannerCalls: true,
    };
    expect(decideServiceCall(forged)).toEqual(
      expect.objectContaining({ allow: false, reason: 'invalid' }),
    );
  });

  it('names a caller it cannot trust as invalid in its answer', () => {
    expect(
      decideServiceCall({
        ...base,
        path: SAY,
        caller: 'x'.repeat(80),
        token: 'v1.1.a',
      }).caller,
    ).toBe('invalid');
  });
});

// Credentials registered by the deployment: a test token names its caller,
// the method it was minted for and the second it expires, `cred.<caller>|<path>|<exp>`.
function credentialToken(caller: string, path: string, expires: number) {
  return `cred.${caller}|${path}|${expires}`;
}
function verifyCredential(
  token: string,
  path: string,
  nowSeconds: number,
): ServiceAuthCredentialCheck {
  const match = /^cred\.([^|]+)\|([^|]+)\|([0-9]+)$/.exec(token);
  if (match === null || match[2] !== path) return { reason: 'invalid' };
  if (Number(match[3]) < nowSeconds) return { reason: 'expired' };
  return { caller: match[1] };
}

describe('decideServiceCall with credentials', () => {
  const base = {
    keys: [] as string[],
    nowSeconds: NOW,
    policy: POLICY,
    allowScannerCalls: false,
    verify: verifyCredential,
  };
  const proven = (caller: string, path: string, header: string = caller) => ({
    ...base,
    path,
    caller: header,
    token: credentialToken(caller, path, NOW + 60),
  });

  it('serves the caller the token proves when the policy allows it', () => {
    expect(decideServiceCall(proven('security-scanning', SAY))).toEqual({
      allow: true,
      reason: 'ok',
      caller: 'security-scanning',
    });
    expect(decideServiceCall(proven('gateway', GRANT))).toEqual(
      expect.objectContaining({ allow: true, reason: 'ok' }),
    );
  });

  it('applies the policy to the proven caller', () => {
    expect(decideServiceCall(proven('security-scanning', GRANT))).toEqual({
      allow: false,
      reason: 'not-allowed',
      caller: 'security-scanning',
      code: status.PERMISSION_DENIED,
    });
    expect(decideServiceCall(proven('gateway', CLOSED))).toEqual(
      expect.objectContaining({ allow: false, reason: 'not-allowed' }),
    );
  });

  it('takes the caller from the token when the call names none', () => {
    expect(
      decideServiceCall({ ...proven('gateway', GRANT), caller: undefined }),
    ).toEqual({ allow: true, reason: 'ok', caller: 'gateway' });
  });

  it('refuses a call that names another caller than the one its token proves', () => {
    expect(
      decideServiceCall(proven('security-scanning', GRANT, 'gateway')),
    ).toEqual({
      allow: false,
      reason: 'invalid',
      caller: 'gateway',
      code: status.UNAUTHENTICATED,
    });
  });

  it('answers the reason the credentials give', () => {
    expect(
      decideServiceCall({
        ...proven('gateway', SAY),
        token: credentialToken('gateway', SAY, NOW - 1),
      }),
    ).toEqual({
      allow: false,
      reason: 'expired',
      caller: 'gateway',
      code: status.UNAUTHENTICATED,
    });
    expect(
      decideServiceCall({
        ...proven('gateway', SAY),
        token: credentialToken('gateway', GRANT, NOW + 60),
      }),
    ).toEqual(expect.objectContaining({ allow: false, reason: 'invalid' }));
  });

  it('refuses a proven caller whose name is outside the allowed alphabet', () => {
    expect(
      decideServiceCall({
        ...base,
        path: SAY,
        caller: undefined,
        token: 'any',
        verify: () => ({ caller: 'Not A Name' }),
      }),
    ).toEqual(expect.objectContaining({ allow: false, reason: 'invalid' }));
  });

  it('refuses a call without a token as missing, and exempts the probes', () => {
    expect(
      decideServiceCall({ ...base, path: SAY, caller: 'gateway', token: '' }),
    ).toEqual({
      allow: false,
      reason: 'missing',
      caller: 'gateway',
      code: status.UNAUTHENTICATED,
    });
    expect(
      decideServiceCall({
        ...base,
        path: HEALTH,
        caller: undefined,
        token: undefined,
      }),
    ).toEqual(expect.objectContaining({ allow: true, reason: 'exempt' }));
  });

  it('ignores the HMAC keys, current and former, once credentials decide', () => {
    const hmac = {
      ...base,
      path: SAY,
      caller: 'gateway',
      keys: [KEY],
      legacyKeys: [LEGACY_KEY],
      token: mintServiceToken(KEY, 'gateway', SAY, NOW),
    };
    expect(decideServiceCall(hmac)).toEqual(
      expect.objectContaining({ allow: false, reason: 'invalid' }),
    );
    expect(
      decideServiceCall({
        ...hmac,
        token: mintServiceToken(LEGACY_KEY, 'gateway', SAY, NOW),
      }),
    ).toEqual(expect.objectContaining({ allow: false, reason: 'invalid' }));
  });

  it('keeps the scanner methods as they are', () => {
    const unsigned = {
      ...base,
      path: SCAN,
      caller: undefined,
      token: undefined,
    };
    expect(decideServiceCall(unsigned)).toEqual(
      expect.objectContaining({ allow: false, reason: 'missing' }),
    );
    expect(decideServiceCall({ ...unsigned, allowScannerCalls: true })).toEqual(
      expect.objectContaining({ allow: true, reason: 'scanner' }),
    );
    // A token sent on a scanner method is checked like any other.
    expect(
      decideServiceCall({
        ...unsigned,
        allowScannerCalls: true,
        caller: 'gateway',
        token: 'forged',
      }),
    ).toEqual(expect.objectContaining({ allow: false, reason: 'invalid' }));
  });
});

// A real grpc-js server and client, the interceptors installed the way Nest
// installs them (channelOptions.interceptors).
const json = {
  requestStream: false,
  responseStream: false,
  requestSerialize: (v: unknown) => Buffer.from(JSON.stringify(v)),
  requestDeserialize: (b: Buffer) => JSON.parse(b.toString()),
  responseSerialize: (v: unknown) => Buffer.from(JSON.stringify(v)),
  responseDeserialize: (b: Buffer) => JSON.parse(b.toString()),
};
const DEFINITION: ServiceDefinition = {
  Say: { ...json, path: SAY, originalName: 'Say' },
  Grant: { ...json, path: GRANT, originalName: 'Grant' },
  Check: { ...json, path: HEALTH, originalName: 'Check' },
} as unknown as ServiceDefinition;

interface Seen {
  caller: string | null;
  tokenSeen: boolean;
}

type Unary = (
  req: unknown,
  md: Metadata,
  cb: (err: { code?: number } | null, res?: Seen) => void,
) => void;
type TestClient = Record<'Say' | 'Grant' | 'Check', Unary> & {
  close(): void;
};

// The refusal line ends with the address the call came from (the test client
// connects from 127.0.0.1 on a random port), then the forwarding headers.
function logged(line: string, after = ''): unknown {
  const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return expect.stringMatching(
    new RegExp(`^${escaped(line)} peer=127\\.0\\.0\\.1:\\d+${escaped(after)}$`),
  );
}

describe('the interceptors on a real gRPC server', () => {
  let servers: Server[] = [];
  // The server the next client calls.
  let address: string;
  // Without credentials (as today), then with them: each its own log throttle.
  let keysAddress: string;
  let credentialsAddress: string;
  let mode: ServiceAuthMode;
  let serverKeys: Record<string, string[]>;
  let legacyKeys: string[];
  let serverCredentials: ServiceAuthCredentials | null;
  const warn = jest.fn();

  async function start(
    withCredentials: (() => ServiceAuthCredentials | null) | undefined,
  ): Promise<string> {
    const server = new Server({
      interceptors: [
        createServiceAuthServerInterceptor({
          policy: () => POLICY,
          keys: (caller) => serverKeys[caller] ?? [],
          legacyKeys: () => legacyKeys,
          mode: () => mode,
          allowScannerCalls: () => false,
          logger: { warn },
          credentials: withCredentials,
        }),
      ],
    } as never);
    const handler = (
      call: { metadata: Metadata },
      cb: (e: null, r: Seen) => void,
    ) =>
      cb(null, {
        caller:
          (call.metadata.get(SERVICE_AUTH_CALLER_HEADER)[0] as string) ?? null,
        tokenSeen: call.metadata.get(SERVICE_AUTH_TOKEN_HEADER).length > 0,
      });
    server.addService(DEFINITION, {
      Say: handler,
      Grant: handler,
      Check: handler,
    });
    const port = await new Promise<number>((resolve, reject) =>
      server.bindAsync(
        '127.0.0.1:0',
        ServerCredentials.createInsecure(),
        (err, p) => (err ? reject(err) : resolve(p)),
      ),
    );
    servers.push(server);
    return `127.0.0.1:${port}`;
  }

  beforeAll(async () => {
    keysAddress = await start(undefined);
    credentialsAddress = await start(() => serverCredentials);
  });

  afterAll(() => {
    for (const server of servers) server.forceShutdown();
    servers = [];
  });

  beforeEach(() => {
    mode = 'enforce';
    serverKeys = { gateway: [KEY], 'security-scanning': [OTHER_KEY] };
    legacyKeys = [];
    serverCredentials = null;
    address = keysAddress;
    warn.mockClear();
  });

  const Ctor = makeGenericClientConstructor(DEFINITION, 'Echo');
  const OWN_KEYS: Record<string, string> = {
    gateway: KEY,
    'security-scanning': OTHER_KEY,
  };
  function client(
    caller?: string,
    key: string | null = caller ? OWN_KEYS[caller] : null,
    clientCredentials: ServiceAuthCredentials | null = null,
  ): TestClient {
    const interceptors = caller
      ? [
          createServiceAuthClientInterceptor({
            caller,
            key: () => key ?? undefined,
            logger: { warn },
            credentials: () => clientCredentials,
          }),
        ]
      : [];
    return new Ctor(address, credentials.createInsecure(), {
      interceptors,
    }) as unknown as TestClient;
  }
  function call(
    c: TestClient,
    method: 'Say' | 'Grant' | 'Check',
    md = new Metadata(),
  ): Promise<{ code: number; res?: Seen }> {
    return new Promise((resolve) =>
      c[method]({}, md, (err, res) =>
        resolve(err ? { code: err.code ?? -1 } : { code: status.OK, res }),
      ),
    );
  }

  it('refuses a caller without a token, and logs it', async () => {
    const c = client();
    expect((await call(c, 'Say')).code).toBe(status.UNAUTHENTICATED);
    c.close();
    expect(warn).toHaveBeenCalledWith(
      logged(
        'S2S_AUTH_MISSING caller=unknown method=/test.Echo/Say reason=missing mode=enforce',
      ),
    );
  });

  it('refuses a forged token', async () => {
    const c = client();
    const md = new Metadata();
    md.set(SERVICE_AUTH_CALLER_HEADER, 'gateway');
    md.set(
      SERVICE_AUTH_TOKEN_HEADER,
      mintServiceToken(
        OTHER_KEY,
        'gateway',
        SAY,
        Math.floor(Date.now() / 1000),
      ),
    );
    expect((await call(c, 'Say', md)).code).toBe(status.UNAUTHENTICATED);
    c.close();
  });

  it('serves a signed caller, and the handler never sees the token', async () => {
    const c = client('security-scanning');
    const answer = await call(c, 'Say');
    c.close();
    expect(answer).toEqual({
      code: status.OK,
      res: { caller: 'security-scanning', tokenSeen: false },
    });
  });

  it('refuses a service that signs as the gateway with its own key', async () => {
    const forger = client('gateway', OTHER_KEY);
    expect((await call(forger, 'Grant')).code).toBe(status.UNAUTHENTICATED);
    forger.close();
  });

  it('in verify mode serves a call signed with the former shared key, and reports it', async () => {
    mode = 'verify';
    legacyKeys = [LEGACY_KEY];
    const c = client('gateway', LEGACY_KEY);
    expect((await call(c, 'Say')).code).toBe(status.OK);
    mode = 'enforce';
    expect((await call(c, 'Say')).code).toBe(status.UNAUTHENTICATED);
    c.close();
    expect(warn).toHaveBeenCalledWith(
      logged(
        'S2S_AUTH_MISSING caller=gateway method=/test.Echo/Say reason=legacy-key mode=verify',
      ),
    );
  });

  it('keeps a restricted method to its listed callers', async () => {
    const other = client('security-scanning');
    expect((await call(other, 'Grant')).code).toBe(status.PERMISSION_DENIED);
    other.close();
    const gateway = client('gateway');
    expect((await call(gateway, 'Grant')).code).toBe(status.OK);
    gateway.close();
  });

  it('answers the health check without a token', async () => {
    const c = client();
    expect((await call(c, 'Check')).code).toBe(status.OK);
    c.close();
  });

  it('in verify mode serves the call and logs the failure', async () => {
    mode = 'verify';
    const c = client();
    expect((await call(c, 'Grant')).code).toBe(status.OK);
    c.close();
    expect(warn).toHaveBeenCalledWith(
      logged(
        'S2S_AUTH_MISSING caller=unknown method=/test.Echo/Grant reason=missing mode=verify',
      ),
    );
  });

  it('logs one line a minute per caller, method and reason', async () => {
    const c = client();
    await call(c, 'Check');
    // A fresh method path, so earlier tests' throttling does not interfere.
    mode = 'verify';
    const md = () => {
      const m = new Metadata();
      m.set(SERVICE_AUTH_CALLER_HEADER, 'throttle-probe');
      return m;
    };
    await call(c, 'Say', md());
    await call(c, 'Say', md());
    c.close();
    const lines = warn.mock.calls.filter(([l]) =>
      String(l).includes('caller=throttle-probe'),
    );
    expect(lines).toHaveLength(1);
  });

  it('refuses every call of a caller it holds no key for, and says so once a minute whatever the method', async () => {
    serverKeys = {};
    const c = client('gateway');
    expect((await call(c, 'Say')).code).toBe(status.UNAUTHENTICATED);
    expect((await call(c, 'Grant')).code).toBe(status.UNAUTHENTICATED);
    c.close();
    expect(
      warn.mock.calls.filter(([l]) => String(l).includes('reason=no-key')),
    ).toHaveLength(1);
  });

  it('sends the call without a token, and says so once, when the client has no key', async () => {
    const c = client('gateway', null);
    expect((await call(c, 'Say')).code).toBe(status.UNAUTHENTICATED);
    expect((await call(c, 'Say')).code).toBe(status.UNAUTHENTICATED);
    c.close();
    expect(
      warn.mock.calls.filter(
        ([l]) => l === 'S2S_AUTH_KEY_MISSING caller=gateway',
      ),
    ).toHaveLength(1);
  });

  describe('the origin of a refused call', () => {
    // A caller name no other case uses, so the log throttle lets each line out.
    let probe = 0;
    async function refused(headers: Record<string, string>): Promise<string> {
      probe += 1;
      const caller = `origin-probe-${probe}`;
      const md = new Metadata();
      md.set(SERVICE_AUTH_CALLER_HEADER, caller);
      for (const [name, value] of Object.entries(headers)) md.set(name, value);
      const c = client();
      expect((await call(c, 'Say', md)).code).toBe(status.UNAUTHENTICATED);
      c.close();
      const lines = warn.mock.calls
        .map(([l]) => String(l))
        .filter((l) => l.includes(`caller=${caller} `));
      expect(lines).toHaveLength(1);
      return lines[0];
    }
    const prefix = (n: number) =>
      `S2S_AUTH_MISSING caller=origin-probe-${n} method=/test.Echo/Say reason=missing mode=enforce`;

    it('names the peer of the connection, and no forwarding field when none was sent', async () => {
      expect(await refused({})).toEqual(logged(prefix(probe)));
    });

    it('adds the address the proxy forwarded, then the origin, after the peer', async () => {
      expect(
        await refused({
          'x-cybedefend-peer': '10.4.2.17:43210',
          'x-cybedefend-origin': '[fd00::1]:5000',
        }),
      ).toEqual(
        logged(
          prefix(probe),
          ' forwarded=10.4.2.17:43210 origin=[fd00::1]:5000',
        ),
      );
    });

    it('adds the origin alone when no forwarded address was sent', async () => {
      expect(
        await refused({ 'x-cybedefend-origin': '10.4.9.3:51000' }),
      ).toEqual(logged(prefix(probe), ' origin=10.4.9.3:51000'));
    });

    it('never copies a hostile value into the line', async () => {
      expect(
        await refused({
          'x-cybedefend-peer': '10.0.0.1 reason=ok mode=verify',
          'x-cybedefend-origin': '1'.repeat(101),
        }),
      ).toEqual(logged(prefix(probe), ' forwarded=invalid origin=invalid'));
      expect(
        await refused({
          'x-cybedefend-peer': 'gateway"}{"level":"info',
          'x-cybedefend-origin': '10.0.0.1/../etc',
        }),
      ).toEqual(logged(prefix(probe), ' forwarded=invalid origin=invalid'));
    });

    it('keeps a value of exactly 100 allowed characters', async () => {
      const longest = '1'.repeat(100);
      expect(await refused({ 'x-cybedefend-peer': longest })).toEqual(
        logged(prefix(probe), ` forwarded=${longest}`),
      );
    });
  });

  describe('with credentials registered', () => {
    const minted: string[] = [];
    // The token a client holds proves `proves`, whatever name it sends.
    const holder = (proves: string): ServiceAuthCredentials => ({
      tokenFor: (path) => {
        const token = credentialToken(
          proves,
          path,
          Math.floor(Date.now() / 1000) + 60,
        );
        minted.push(token);
        return token;
      },
      verify: () => ({ reason: 'invalid' }),
    });
    const none: ServiceAuthCredentials = {
      tokenFor: () => undefined,
      verify: () => ({ reason: 'invalid' }),
    };
    const verifier: ServiceAuthCredentials = {
      tokenFor: () => undefined,
      verify: jest.fn(verifyCredential),
    };

    beforeEach(() => {
      address = credentialsAddress;
      serverCredentials = verifier;
      minted.length = 0;
      (verifier.verify as jest.Mock).mockClear();
    });

    it('sends the token the credentials hold for the method, never an HMAC token, and the server checks it with them', async () => {
      const c = client('gateway', KEY, holder('gateway'));
      expect(await call(c, 'Grant')).toEqual({
        code: status.OK,
        res: { caller: 'gateway', tokenSeen: false },
      });
      c.close();
      expect(minted).toEqual([
        expect.stringMatching(/^cred\.gateway\|\/test\.Echo\/Grant\|/),
      ]);
      expect(verifier.verify).toHaveBeenCalledWith(
        minted[0],
        GRANT,
        expect.any(Number),
      );
    });

    it('refuses a proven caller the policy does not allow', async () => {
      const c = client(
        'security-scanning',
        OTHER_KEY,
        holder('security-scanning'),
      );
      expect((await call(c, 'Grant')).code).toBe(status.PERMISSION_DENIED);
      c.close();
    });

    it('refuses a call naming another caller than its token proves', async () => {
      const c = client('gateway', KEY, holder('security-scanning'));
      expect((await call(c, 'Say')).code).toBe(status.UNAUTHENTICATED);
      c.close();
      expect(warn).toHaveBeenCalledWith(
        logged(
          'S2S_AUTH_MISSING caller=gateway method=/test.Echo/Say reason=invalid mode=enforce',
        ),
      );
    });

    it('refuses an HMAC-signed call, the keys being ignored', async () => {
      const c = client('gateway');
      expect((await call(c, 'Say')).code).toBe(status.UNAUTHENTICATED);
      c.close();
    });

    it('answers the health check without a token', async () => {
      const c = client();
      expect((await call(c, 'Check')).code).toBe(status.OK);
      c.close();
    });

    it('in verify mode serves the refused call and logs it', async () => {
      mode = 'verify';
      // A caller no earlier case logged, so the throttle lets its line out.
      const c = client('throttle-probe', null, holder('throttle-probe'));
      expect((await call(c, 'Grant')).code).toBe(status.OK);
      c.close();
      expect(warn).toHaveBeenCalledWith(
        logged(
          'S2S_AUTH_MISSING caller=throttle-probe method=/test.Echo/Grant reason=not-allowed mode=verify',
        ),
      );
    });

    it('sends no token, and says so once, when the credentials hold none for the method', async () => {
      const c = client('gateway', KEY, none);
      expect((await call(c, 'Say')).code).toBe(status.UNAUTHENTICATED);
      expect((await call(c, 'Say')).code).toBe(status.UNAUTHENTICATED);
      c.close();
      expect(
        warn.mock.calls.filter(
          ([l]) => l === 'S2S_AUTH_KEY_MISSING caller=gateway',
        ),
      ).toHaveLength(1);
      expect(warn).toHaveBeenCalledWith(
        logged(
          'S2S_AUTH_MISSING caller=unknown method=/test.Echo/Say reason=missing mode=enforce',
        ),
      );
    });
  });
});

// Scanner pods send their own token on the scanner methods; the interceptor
// turns it into identity headers the handlers trust, and nothing else may
// write those headers.
describe('scanner tokens on a real gRPC server', () => {
  const IDENTITY = {
    pod: 'scan-pod-1',
    podUid: 'uid-1',
    namespace: 'scanners',
    scanId: 'scan-1',
    projectId: 'project-1',
  };
  const SCANNER_DEFINITION: ServiceDefinition = {
    Say: { ...json, path: SAY, originalName: 'Say' },
    ReportScan: { ...json, path: SCAN, originalName: 'ReportScan' },
  } as unknown as ServiceDefinition;
  type ScannerClient = Record<
    'Say' | 'ReportScan',
    (
      req: unknown,
      md: Metadata,
      cb: (
        err: { code?: number; details?: string } | null,
        res?: Record<string, string[]>,
      ) => void,
    ) => void
  > & { close(): void };
  const Ctor = makeGenericClientConstructor(SCANNER_DEFINITION, 'Echo');
  const WATCHED = [
    ...SCANNER_IDENTITY_HEADERS,
    SCANNER_AUTH_HEADER,
    SCANNER_TOKEN_HEADER,
    SERVICE_AUTH_TOKEN_HEADER,
  ];

  let server: Server;
  let address: string;
  let scannerMode: ScannerAuthMode;
  let registered: ScannerCredentials | null;
  let allowScannerCalls: boolean;
  const warn = jest.fn();
  const scannerWarn = jest.fn();
  const verify = jest.fn(
    (token: string): ScannerTokenCheck =>
      token === 'k8s.good'
        ? IDENTITY
        : token === 'k8s.old'
          ? { reason: 'expired' }
          : { reason: 'invalid' },
  );
  // A reporter per case: its refusal lines are throttled per method and reason.
  let reporter: ScannerAuthReporter;
  let ok: jest.SpyInstance;

  beforeAll(async () => {
    server = new Server({
      interceptors: [
        createServiceAuthServerInterceptor({
          policy: () => POLICY,
          keys: (caller) => (caller === 'gateway' ? [KEY] : []),
          mode: () => 'enforce',
          allowScannerCalls: () => allowScannerCalls,
          logger: { warn },
          scannerCredentials: () => registered,
          scannerMode: () => scannerMode,
          scannerReporter: { refused: (entry) => reporter.refused(entry) },
        }),
      ],
    } as never);
    // The handler answers the headers it was handed.
    const handler = (
      call: { metadata: Metadata },
      cb: (e: null, r: Record<string, string[]>) => void,
    ) =>
      cb(
        null,
        Object.fromEntries(
          WATCHED.map((h) => [h, call.metadata.get(h) as string[]]),
        ),
      );
    server.addService(SCANNER_DEFINITION, {
      Say: handler,
      ReportScan: handler,
    });
    const port = await new Promise<number>((resolve, reject) =>
      server.bindAsync(
        '127.0.0.1:0',
        ServerCredentials.createInsecure(),
        (err, p) => (err ? reject(err) : resolve(p)),
      ),
    );
    address = `127.0.0.1:${port}`;
  });

  afterAll(() => server.forceShutdown());

  beforeEach(() => {
    scannerMode = 'verify';
    registered = { verify };
    allowScannerCalls = true;
    warn.mockClear();
    scannerWarn.mockClear();
    verify.mockClear();
    reporter = new ScannerAuthReporter({ warn: scannerWarn });
    ok = jest.spyOn(reporter, 'ok');
  });

  function client(signed: boolean): ScannerClient {
    const interceptors = signed
      ? [
          createServiceAuthClientInterceptor({
            caller: 'gateway',
            key: () => KEY,
            logger: { warn },
          }),
        ]
      : [];
    return new Ctor(address, credentials.createInsecure(), {
      interceptors,
    }) as unknown as ScannerClient;
  }

  function call(
    method: 'Say' | 'ReportScan',
    headers: Record<string, string>,
    signed = false,
  ): Promise<{
    code: number;
    details?: string;
    seen?: Record<string, string[]>;
  }> {
    const c = client(signed);
    const md = new Metadata();
    for (const [name, value] of Object.entries(headers)) md.set(name, value);
    return new Promise((resolve) =>
      c[method]({}, md, (err, res) => {
        c.close();
        resolve(
          err
            ? { code: err.code ?? -1, details: err.details }
            : { code: status.OK, seen: res },
        );
      }),
    );
  }

  const forged = {
    [SCANNER_POD_HEADER]: 'forged-pod',
    [SCANNER_POD_UID_HEADER]: 'forged-uid',
    [SCANNER_NAMESPACE_HEADER]: 'forged-ns',
    [SCANNER_SCAN_ID_HEADER]: 'forged-scan',
    [SCANNER_PROJECT_ID_HEADER]: 'forged-project',
    [SCANNER_AUTH_HEADER]: 'ok',
  };
  const none = Object.fromEntries(WATCHED.map((h) => [h, []]));

  function refusedLine(reason: string, mode: ScannerAuthMode): unknown {
    return expect.stringMatching(
      new RegExp(
        `^SCANNER_AUTH_REFUSED method=/test\\.Echo/ReportScan reason=${reason} mode=${mode} pod=unknown scan=none peer=127\\.0\\.0\\.1:\\d+ origin=interceptor$`,
      ),
    );
  }

  it('strips client-sent x-cybedefend-scanner-* headers on every call', async () => {
    // A signed service call.
    expect(await call('Say', forged, true)).toEqual({
      code: status.OK,
      seen: none,
    });
    // A scanner call whose token is refused: only the outcome is written.
    expect(
      await call('ReportScan', { ...forged, [SCANNER_TOKEN_HEADER]: 'k8s.x' }),
    ).toEqual({
      code: status.OK,
      seen: { ...none, [SCANNER_AUTH_HEADER]: ['invalid'] },
    });
    // A refused service call in a server that only verifies scanners.
    allowScannerCalls = false;
    expect(await call('ReportScan', forged)).toEqual({
      code: status.UNAUTHENTICATED,
      details: 'SERVICE_AUTH_REQUIRED',
    });
  });

  it('a scanner method without a scanner token is admitted in verify and marked missing', async () => {
    expect(await call('ReportScan', {})).toEqual({
      code: status.OK,
      seen: { ...none, [SCANNER_AUTH_HEADER]: ['missing'] },
    });
    expect(verify).not.toHaveBeenCalled();
    expect(scannerWarn).toHaveBeenCalledWith(refusedLine('missing', 'verify'));
    // The service-auth line is not written for an admitted scanner call.
    expect(warn).not.toHaveBeenCalled();
  });

  it('a scanner method without a scanner token is refused UNAUTHENTICATED SCANNER_AUTH_REQUIRED in enforce', async () => {
    scannerMode = 'enforce';
    expect(await call('ReportScan', {})).toEqual({
      code: status.UNAUTHENTICATED,
      details: SCANNER_AUTH_REQUIRED,
    });
    expect(scannerWarn).toHaveBeenCalledWith(refusedLine('missing', 'enforce'));
  });

  it('refuses an invalid or expired scanner token in enforce, and marks it in verify', async () => {
    scannerMode = 'enforce';
    for (const token of ['k8s.bad', 'k8s.old']) {
      expect(
        await call('ReportScan', { [SCANNER_TOKEN_HEADER]: token }),
      ).toEqual({
        code: status.UNAUTHENTICATED,
        details: SCANNER_AUTH_REQUIRED,
      });
    }
    expect(scannerWarn).toHaveBeenCalledWith(refusedLine('invalid', 'enforce'));
    expect(scannerWarn).toHaveBeenCalledWith(refusedLine('expired', 'enforce'));
    scannerMode = 'verify';
    expect(
      await call('ReportScan', { [SCANNER_TOKEN_HEADER]: 'k8s.old' }),
    ).toEqual({
      code: status.OK,
      seen: { ...none, [SCANNER_AUTH_HEADER]: ['expired'] },
    });
  });

  it('reads a scanner token as invalid when no verifier is registered', async () => {
    registered = null;
    expect(
      await call('ReportScan', { [SCANNER_TOKEN_HEADER]: 'k8s.good' }),
    ).toEqual({
      code: status.OK,
      seen: { ...none, [SCANNER_AUTH_HEADER]: ['invalid'] },
    });
    expect(await call('ReportScan', {})).toEqual({
      code: status.OK,
      seen: { ...none, [SCANNER_AUTH_HEADER]: ['missing'] },
    });
  });

  it('a valid scanner token writes the five identity headers and removes the token', async () => {
    scannerMode = 'enforce';
    expect(
      await call('ReportScan', {
        ...forged,
        [SCANNER_TOKEN_HEADER]: 'k8s.good',
      }),
    ).toEqual({
      code: status.OK,
      seen: {
        ...none,
        [SCANNER_POD_HEADER]: ['scan-pod-1'],
        [SCANNER_POD_UID_HEADER]: ['uid-1'],
        [SCANNER_NAMESPACE_HEADER]: ['scanners'],
        [SCANNER_SCAN_ID_HEADER]: ['scan-1'],
        [SCANNER_PROJECT_ID_HEADER]: ['project-1'],
        [SCANNER_AUTH_HEADER]: ['ok'],
      },
    });
    // The verifier is handed the header's whole value.
    expect(verify).toHaveBeenCalledWith('k8s.good', expect.any(Number));
    // The handler's guard counts the call once it is bound, not the interceptor.
    expect(ok).not.toHaveBeenCalled();
    expect(scannerWarn).not.toHaveBeenCalled();
  });

  it('a scanner token on a non-scanner method is ignored and stripped', async () => {
    scannerMode = 'enforce';
    expect(
      await call('Say', { [SCANNER_TOKEN_HEADER]: 'k8s.good' }, true),
    ).toEqual({ code: status.OK, seen: none });
    // Unsigned, the call is refused as any unsigned service call.
    expect(await call('Say', { [SCANNER_TOKEN_HEADER]: 'k8s.good' })).toEqual({
      code: status.UNAUTHENTICATED,
      details: 'SERVICE_AUTH_REQUIRED',
    });
    expect(verify).not.toHaveBeenCalled();
    expect(scannerWarn).not.toHaveBeenCalled();
  });

  it('a service-signed call is not affected by scanner mode', async () => {
    scannerMode = 'enforce';
    // Signed, on a scanner method, with and without a scanner token.
    expect(await call('ReportScan', {}, true)).toEqual({
      code: status.OK,
      seen: none,
    });
    expect(
      await call('ReportScan', { [SCANNER_TOKEN_HEADER]: 'k8s.good' }, true),
    ).toEqual({ code: status.OK, seen: none });
    expect(await call('Say', {}, true)).toEqual({
      code: status.OK,
      seen: none,
    });
    expect(verify).not.toHaveBeenCalled();
    expect(scannerWarn).not.toHaveBeenCalled();
  });
});
