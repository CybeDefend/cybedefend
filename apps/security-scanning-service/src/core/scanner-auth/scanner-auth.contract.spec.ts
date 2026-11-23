// Generic: byte-identical in security-scanning-service and
// analysis-reporting-service (scripts/tests/service-auth-parity.bats).
import * as generic from '../service-auth/scanner-call-auth';
import * as contract from './scanner-auth.contract';
import {
  DEFAULT_SCANNER_GRPC_CA_SECRET,
  SCANNER_AUDIENCE_PATTERN,
  SCANNER_BINDING_ANSWERS,
  SCANNER_CA_FILE,
  SCANNER_CA_MOUNT_PATH,
  SCANNER_CA_SECRET_KEY,
  SCANNER_CA_VOLUME,
  SCANNER_GRPC_CA_SECRET_VARIABLE,
  SCANNER_GRPC_TLS_VARIABLE,
  SCANNER_POD_GRPC_TLS_CA_FILE_ENV,
  SCANNER_POD_GRPC_TLS_MODE,
  SCANNER_POD_GRPC_TLS_MODE_ENV,
  SCANNER_POD_TOKEN_FILE_ENV,
  SCANNER_TOKEN_EXPIRATION_SECONDS,
  SCANNER_TOKEN_FILE,
  SCANNER_TOKEN_MOUNT_PATH,
  SCANNER_TOKEN_PATH,
  SCANNER_TOKEN_VOLUME,
  parseScannerAudience,
  scannerAudience,
} from './scanner-auth.contract';

describe('scanner-auth contract', () => {
  it('re-exports every shared value of the generic scanner-call file unchanged', () => {
    for (const [name, value] of Object.entries(generic)) {
      expect(contract).toHaveProperty(name);
      expect((contract as Record<string, unknown>)[name]).toBe(value);
    }
  });

  it('accepts the audience of one project and one scan', () => {
    const aud = 'cybedefend:scanner:6f1c2a9e-0b7d:a2b4c6d8-1e3f';
    expect(SCANNER_AUDIENCE_PATTERN.test(aud)).toBe(true);
    expect(scannerAudience('6f1c2a9e-0b7d', 'a2b4c6d8-1e3f')).toBe(aud);
  });

  it.each([
    ['no ids', 'cybedefend:scanner'],
    ['extra colons', 'cybedefend:scanner:p-1:s-1:extra'],
    ['a 65-character id', `cybedefend:scanner:${'a'.repeat(65)}:s-1`],
  ])('refuses an audience with %s', (_label, aud) => {
    expect(parseScannerAudience(aud)).toBeNull();
  });

  it('refuses two audiences', () => {
    expect(
      parseScannerAudience([
        'cybedefend:scanner:p-1:s-1',
        'cybedefend:scanner:p-1:s-2',
      ]),
    ).toBeNull();
  });

  it('lists the answers of the call binding', () => {
    expect(SCANNER_BINDING_ANSWERS).toEqual([
      'ok',
      'not-bound',
      'closed',
      'lookup-failed',
    ]);
  });

  it('mounts the scanner token where the scanners read it', () => {
    expect(SCANNER_TOKEN_VOLUME).toBe('scanner-auth');
    expect(SCANNER_TOKEN_MOUNT_PATH).toBe(
      '/var/run/secrets/cybedefend/scanner',
    );
    expect(SCANNER_TOKEN_PATH).toBe('token');
    expect(SCANNER_TOKEN_FILE).toBe(
      '/var/run/secrets/cybedefend/scanner/token',
    );
    expect(SCANNER_POD_TOKEN_FILE_ENV).toBe('SCANNER_AUTH_TOKEN_FILE');
    expect(SCANNER_TOKEN_EXPIRATION_SECONDS).toBe(600);
  });

  it('mounts only the CA certificate of the scanner TLS listeners', () => {
    expect(SCANNER_GRPC_TLS_VARIABLE).toBe('SCANNER_GRPC_TLS');
    expect(SCANNER_GRPC_CA_SECRET_VARIABLE).toBe('SCANNER_GRPC_CA_SECRET');
    expect(DEFAULT_SCANNER_GRPC_CA_SECRET).toBe('scanner-grpc-ca');
    expect(SCANNER_CA_VOLUME).toBe('scanner-grpc-ca');
    expect(SCANNER_CA_SECRET_KEY).toBe('ca.crt');
    expect(SCANNER_CA_MOUNT_PATH).toBe('/etc/cybedefend/scanner-ca');
    expect(SCANNER_CA_FILE).toBe('/etc/cybedefend/scanner-ca/ca.crt');
    expect(SCANNER_POD_GRPC_TLS_MODE_ENV).toBe('GRPC_TLS_MODE');
    expect(SCANNER_POD_GRPC_TLS_MODE).toBe('tls');
    expect(SCANNER_POD_GRPC_TLS_CA_FILE_ENV).toBe('GRPC_TLS_CA_FILE');
  });
});
