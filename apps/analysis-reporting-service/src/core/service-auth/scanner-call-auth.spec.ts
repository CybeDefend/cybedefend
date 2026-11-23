// Generic: byte-identical in every gRPC service
// (scripts/tests/service-auth-parity.bats). Change all copies together.
import { status } from '@grpc/grpc-js';
import {
  DEFAULT_SCANNER_AUTH_CLOSED_GRACE_SECONDS,
  DEFAULT_SCANNER_AUTH_NAMESPACES,
  DEFAULT_SCANNER_AUTH_SERVICE_ACCOUNT,
  SCANNER_AUDIENCE_PATTERN,
  SCANNER_AUTH_HEADER,
  SCANNER_AUTH_LOOKUP_FAILED,
  SCANNER_AUTH_NOT_BOUND,
  SCANNER_AUTH_REFUSED,
  SCANNER_AUTH_REQUIRED,
  SCANNER_AUTH_SUMMARY,
  SCANNER_IDENTITY_HEADERS,
  SCANNER_NAMESPACE_HEADER,
  SCANNER_POD_HEADER,
  SCANNER_POD_UID_HEADER,
  SCANNER_PROJECT_ID_HEADER,
  SCANNER_SCAN_ID_HEADER,
  SCANNER_SERVER_HEADERS,
  SCANNER_TOKEN_HEADER,
  ScannerAuthReporter,
  parseScannerAudience,
  readScannerAuthClosedGraceSeconds,
  readScannerAuthNamespaces,
  readScannerAuthServiceAccount,
  scannerAudience,
  scannerAuthRefusedLine,
  scannerAuthSummaryLine,
  scannerRefusal,
} from './scanner-call-auth';

const PROJECT = '6f1c2a9e-0b7d-4c3e-9a51-2d8e4f6a7b10';
const SCAN = 'a2b4c6d8-1e3f-4a5b-8c7d-9e0f1a2b3c4d';

describe('scanner call authentication contract', () => {
  describe('metadata', () => {
    it('names the token the scanner sends and the identity the server writes', () => {
      expect(SCANNER_TOKEN_HEADER).toBe('x-cybedefend-scanner-token');
      expect(SCANNER_IDENTITY_HEADERS).toEqual([
        'x-cybedefend-scanner-pod',
        'x-cybedefend-scanner-pod-uid',
        'x-cybedefend-scanner-namespace',
        'x-cybedefend-scanner-scan-id',
        'x-cybedefend-scanner-project-id',
      ]);
      expect([
        SCANNER_POD_HEADER,
        SCANNER_POD_UID_HEADER,
        SCANNER_NAMESPACE_HEADER,
        SCANNER_SCAN_ID_HEADER,
        SCANNER_PROJECT_ID_HEADER,
      ]).toEqual(SCANNER_IDENTITY_HEADERS);
      expect(SCANNER_AUTH_HEADER).toBe('x-cybedefend-scanner-auth');
    });

    it('lists every header only the server may write, never the token', () => {
      expect(SCANNER_SERVER_HEADERS).toEqual([
        ...SCANNER_IDENTITY_HEADERS,
        SCANNER_AUTH_HEADER,
      ]);
      expect(SCANNER_SERVER_HEADERS).not.toContain(SCANNER_TOKEN_HEADER);
    });

    it('uses lower-case names, as gRPC metadata keys are', () => {
      for (const h of [...SCANNER_SERVER_HEADERS, SCANNER_TOKEN_HEADER]) {
        expect(h).toBe(h.toLowerCase());
      }
    });
  });

  describe('audience', () => {
    it('binds a token to one project and one scan', () => {
      expect(scannerAudience(PROJECT, SCAN)).toBe(
        `cybedefend:scanner:${PROJECT}:${SCAN}`,
      );
      expect(
        SCANNER_AUDIENCE_PATTERN.test(scannerAudience(PROJECT, SCAN)),
      ).toBe(true);
      expect(parseScannerAudience(scannerAudience(PROJECT, SCAN))).toEqual({
        projectId: PROJECT,
        scanId: SCAN,
      });
    });

    it('reads a single audience given as a one-element list', () => {
      expect(parseScannerAudience([`cybedefend:scanner:p-1:s-1`])).toEqual({
        projectId: 'p-1',
        scanId: 's-1',
      });
    });

    it.each([
      ['no ids', 'cybedefend:scanner'],
      ['one id', 'cybedefend:scanner:p-1'],
      ['an empty id', 'cybedefend:scanner::s-1'],
      ['extra colons', 'cybedefend:scanner:p-1:s-1:x'],
      ['a colon inside an id', 'cybedefend:scanner:p:1:s-1'],
      ['a 65-character project id', `cybedefend:scanner:${'a'.repeat(65)}:s-1`],
      ['a 65-character scan id', `cybedefend:scanner:p-1:${'a'.repeat(65)}`],
      ['another prefix', 'cybedefend:security-scanning:p-1:s-1'],
      ['a trailing newline', 'cybedefend:scanner:p-1:s-1\n'],
      ['a slash', 'cybedefend:scanner:p/1:s-1'],
    ])('refuses %s', (_label, aud) => {
      expect(SCANNER_AUDIENCE_PATTERN.test(aud)).toBe(false);
      expect(parseScannerAudience(aud)).toBeNull();
    });

    it('accepts 64-character ids', () => {
      const id = 'a'.repeat(64);
      expect(parseScannerAudience(`cybedefend:scanner:${id}:${id}`)).toEqual({
        projectId: id,
        scanId: id,
      });
    });

    it('refuses two audiences, even when each would pass alone', () => {
      expect(
        parseScannerAudience([
          'cybedefend:scanner:p-1:s-1',
          'cybedefend:scanner:p-2:s-2',
        ]),
      ).toBeNull();
      expect(
        parseScannerAudience([
          'cybedefend:scanner:p-1:s-1',
          'cybedefend:gateway',
        ]),
      ).toBeNull();
    });

    it('refuses anything that is not a string or a list of one string', () => {
      for (const aud of [undefined, null, 42, {}, [], [42]]) {
        expect(parseScannerAudience(aud)).toBeNull();
      }
    });

    it('never builds an audience the verifier would refuse', () => {
      expect(() => scannerAudience('', SCAN)).toThrow();
      expect(() => scannerAudience(PROJECT, 'a:b')).toThrow();
      expect(() => scannerAudience('a'.repeat(65), SCAN)).toThrow();
    });
  });

  describe('server settings', () => {
    it('has the defaults of an unset environment', () => {
      expect(DEFAULT_SCANNER_AUTH_NAMESPACES).toEqual([
        'scanners-namespace',
        'scanners-container-namespace',
      ]);
      expect(DEFAULT_SCANNER_AUTH_SERVICE_ACCOUNT).toBe('scanner-grpc');
      expect(DEFAULT_SCANNER_AUTH_CLOSED_GRACE_SECONDS).toBe(120);
      expect(readScannerAuthNamespaces({})).toEqual(
        DEFAULT_SCANNER_AUTH_NAMESPACES,
      );
      expect(readScannerAuthServiceAccount({})).toBe('scanner-grpc');
      expect(readScannerAuthClosedGraceSeconds({})).toBe(120);
    });

    it('treats an empty value as unset', () => {
      const env = {
        SCANNER_AUTH_NAMESPACES: ' , ',
        SCANNER_AUTH_SERVICE_ACCOUNT: '',
        SCANNER_AUTH_CLOSED_GRACE_SECONDS: '',
      };
      expect(readScannerAuthNamespaces(env)).toEqual(
        DEFAULT_SCANNER_AUTH_NAMESPACES,
      );
      expect(readScannerAuthServiceAccount(env)).toBe('scanner-grpc');
      expect(readScannerAuthClosedGraceSeconds(env)).toBe(120);
    });

    it('reads the configured values', () => {
      const env = {
        SCANNER_AUTH_NAMESPACES: ' scan-a ,scan-b,, ',
        SCANNER_AUTH_SERVICE_ACCOUNT: 'other-sa',
        SCANNER_AUTH_CLOSED_GRACE_SECONDS: '0',
      };
      expect(readScannerAuthNamespaces(env)).toEqual(['scan-a', 'scan-b']);
      expect(readScannerAuthServiceAccount(env)).toBe('other-sa');
      expect(readScannerAuthClosedGraceSeconds(env)).toBe(0);
    });

    it.each(['-1', '3601', '1.5', 'abc', '12s'])(
      'falls back to the default grace for %s',
      (raw) => {
        expect(
          readScannerAuthClosedGraceSeconds({
            SCANNER_AUTH_CLOSED_GRACE_SECONDS: raw,
          }),
        ).toBe(120);
      },
    );
  });

  describe('refusals', () => {
    it('answers a missing or bad token UNAUTHENTICATED', () => {
      for (const reason of ['missing', 'invalid', 'expired'] as const) {
        expect(scannerRefusal(reason)).toEqual({
          code: status.UNAUTHENTICATED,
          details: SCANNER_AUTH_REQUIRED,
        });
      }
    });

    it('answers a token not bound to the request, or a closed container, PERMISSION_DENIED with the same details', () => {
      for (const reason of ['not-bound', 'closed'] as const) {
        expect(scannerRefusal(reason)).toEqual({
          code: status.PERMISSION_DENIED,
          details: SCANNER_AUTH_NOT_BOUND,
        });
      }
    });

    it('answers a failed lookup UNAVAILABLE', () => {
      expect(scannerRefusal('lookup-failed')).toEqual({
        code: status.UNAVAILABLE,
        details: SCANNER_AUTH_LOOKUP_FAILED,
      });
    });

    it('has the literal details clients and alerts match', () => {
      expect(SCANNER_AUTH_REQUIRED).toBe('SCANNER_AUTH_REQUIRED');
      expect(SCANNER_AUTH_NOT_BOUND).toBe('SCANNER_AUTH_NOT_BOUND');
      expect(SCANNER_AUTH_LOOKUP_FAILED).toBe('SCANNER_AUTH_LOOKUP_FAILED');
    });
  });

  describe('log lines', () => {
    it('writes a refusal with its fields in the fixed order', () => {
      expect(SCANNER_AUTH_REFUSED).toBe('SCANNER_AUTH_REFUSED');
      expect(
        scannerAuthRefusedLine({
          method: '/pkg.Service/Method',
          reason: 'not-bound',
          mode: 'verify',
          pod: 'sca-pod-1',
          scan: 's-1',
          peer: 'ipv4:10.0.0.1:5000',
          origin: 'interceptor',
        }),
      ).toBe(
        'SCANNER_AUTH_REFUSED method=/pkg.Service/Method reason=not-bound mode=verify pod=sca-pod-1 scan=s-1 peer=ipv4:10.0.0.1:5000 origin=interceptor',
      );
    });

    it('writes unknown and none for a pod or scan it does not know', () => {
      expect(
        scannerAuthRefusedLine({
          method: '/pkg.Service/Method',
          reason: 'missing',
          mode: 'enforce',
          peer: 'unknown',
          origin: 'guard',
        }),
      ).toBe(
        'SCANNER_AUTH_REFUSED method=/pkg.Service/Method reason=missing mode=enforce pod=unknown scan=none peer=unknown origin=guard',
      );
    });

    it('never lets a field value add a field of its own', () => {
      const line = scannerAuthRefusedLine({
        method: '/pkg.Service/Method',
        reason: 'missing',
        mode: 'verify',
        pod: 'a reason=ok\nSCANNER_AUTH_SUMMARY',
        peer: 'p',
        origin: 'o',
      });
      expect(line).not.toMatch(/\n/);
      expect(line.match(/ reason=/g)).toHaveLength(1);
    });

    it('writes the summary with every counter, in the fixed order', () => {
      expect(SCANNER_AUTH_SUMMARY).toBe('SCANNER_AUTH_SUMMARY');
      expect(scannerAuthSummaryLine({ ok: 3, 'not-bound': 1 })).toBe(
        'SCANNER_AUTH_SUMMARY window=60s ok=3 missing=0 invalid=0 expired=0 not-bound=1 closed=0 lookup-failed=0',
      );
    });
  });
});

describe('ScannerAuthReporter', () => {
  const entry = {
    method: '/scan.ScanService/UpdateScan',
    reason: 'not-bound' as const,
    mode: 'verify' as const,
    pod: 'sast-1',
    scan: 's1',
    peer: '10.0.0.1',
    origin: 'guard',
  };

  function make() {
    let now = 1_000_000;
    const lines: string[] = [];
    const reporter = new ScannerAuthReporter(
      { warn: (m: string) => lines.push(m) },
      () => now,
    );
    return { reporter, lines, advance: (ms: number) => (now += ms) };
  }

  it('logs a refusal once a minute per method, reason and pod', () => {
    const { reporter, lines, advance } = make();
    reporter.refused(entry);
    reporter.refused(entry);
    reporter.refused({ ...entry, pod: 'sast-2' });
    expect(lines).toEqual([
      scannerAuthRefusedLine(entry),
      scannerAuthRefusedLine({ ...entry, pod: 'sast-2' }),
    ]);
    advance(60_000);
    reporter.refused(entry);
    expect(lines).toHaveLength(3);
  });

  it('counts every outcome and flushes one summary line, then resets', () => {
    const { reporter, lines } = make();
    reporter.ok();
    reporter.ok();
    reporter.refused(entry);
    reporter.refused(entry);
    reporter.refused({ ...entry, reason: 'missing' });
    lines.length = 0;
    reporter.flush();
    expect(lines).toEqual([
      scannerAuthSummaryLine({ ok: 2, 'not-bound': 2, missing: 1 }),
    ]);
    reporter.flush();
    expect(lines).toHaveLength(1);
  });

  it("start() schedules an unref'd minute timer and stop() clears it", () => {
    jest.useFakeTimers();
    try {
      const { reporter, lines } = make();
      reporter.start();
      reporter.start();
      reporter.ok();
      jest.advanceTimersByTime(60_000);
      expect(lines).toEqual([scannerAuthSummaryLine({ ok: 1 })]);
      reporter.stop();
      reporter.ok();
      jest.advanceTimersByTime(60_000);
      expect(lines).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
