import { ChannelCredentials } from '@grpc/grpc-js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildGrpcChannelCredentials,
  GRPC_TLS_CA_FILE_ENV,
} from './grpc-channel-credentials';

// A throwaway self-signed CA certificate (public part only).
const CA_PEM = `-----BEGIN CERTIFICATE-----
MIIBgzCCASmgAwIBAgIUQok6S+LB8vy3Kdk4zqwYKGmnrfEwCgYIKoZIzj0EAwIw
FzEVMBMGA1UEAwwMdGVzdC1ncnBjLWNhMB4XDTI2MTEwOTE2MDMzM1oXDTM2MTEw
NjE2MDMzM1owFzEVMBMGA1UEAwwMdGVzdC1ncnBjLWNhMFkwEwYHKoZIzj0CAQYI
KoZIzj0DAQcDQgAEAuXyrdIkeVb9GWQVHNjXV36JwU7fuGb+907YJPgfIc1pFd3S
aAr8tvRnMqbISsFzHobGY/lUeuBKv/Y4ErHmMKNTMFEwHQYDVR0OBBYEFGDpqJg+
udIXxjrix1A6dgQLJ62YMB8GA1UdIwQYMBaAFGDpqJg+udIXxjrix1A6dgQLJ62Y
MA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIgNUSbVtpmNcPcZXaK
QwwWL774cTs78tv9ErWWcbhafzMCIQDdiMe4+d5JI+LMwKcMLDIE2hbzwkRM7kM1
GmwNHUycBQ==
-----END CERTIFICATE-----
`;

describe('buildGrpcChannelCredentials', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'grpc-ca-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('names the environment variable it reads', () => {
    expect(GRPC_TLS_CA_FILE_ENV).toBe('GRPC_TLS_CA_FILE');
  });

  it.each([undefined, '', '   '])(
    'returns plaintext credentials when the CA file is %p',
    (caFile) => {
      const creds = buildGrpcChannelCredentials(caFile);
      expect(creds).toBeInstanceOf(ChannelCredentials);
      expect(creds._isSecure()).toBe(false);
    },
  );

  it('returns TLS credentials trusting the CA read from the file', () => {
    const file = join(dir, 'ca.crt');
    writeFileSync(file, CA_PEM);
    const read = jest.fn(() => Buffer.from(CA_PEM));
    const creds = buildGrpcChannelCredentials(file, read);
    expect(creds._isSecure()).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(file);
  });

  it('refuses a CA file that cannot be read, naming the variable', () => {
    const missing = join(dir, 'missing.crt');
    expect(() => buildGrpcChannelCredentials(missing)).toThrow(
      /GRPC_TLS_CA_FILE.*missing\.crt.*cannot be read/,
    );
  });

  it('refuses an empty CA file', () => {
    const empty = join(dir, 'empty.crt');
    writeFileSync(empty, '');
    expect(() => buildGrpcChannelCredentials(empty)).toThrow(
      /GRPC_TLS_CA_FILE.*empty\.crt.*empty/,
    );
  });
});

describe('grpcClientChannelCredentials', () => {
  const saved = process.env.GRPC_TLS_CA_FILE;

  afterEach(() => {
    load().registerGrpcTlsServerPackages([]);
    if (saved === undefined) delete process.env.GRPC_TLS_CA_FILE;
    else process.env.GRPC_TLS_CA_FILE = saved;
  });

  function load(): typeof import('./grpc-channel-credentials') {
    let mod!: typeof import('./grpc-channel-credentials');
    jest.isolateModules(() => {
      mod = jest.requireActual('./grpc-channel-credentials');
    });
    return mod;
  }

  const TLS_SERVERS = [
    'cybedefend.global_management',
    'cybedefend.security_scanning',
    'cybedefend.analysis_reporting',
    'cybedefend.file_management',
    'cybedefend.external_integrations',
    'cybedefend.policy_management',
  ];

  function writeCa(): string {
    const dir = mkdtempSync(join(tmpdir(), 'grpc-ca-'));
    const file = join(dir, 'ca.crt');
    writeFileSync(file, CA_PEM);
    return file;
  }

  it('lists the exported servers as the packages served behind TLS', () => {
    const { GRPC_TLS_SERVER_PACKAGES } = load();
    expect([...GRPC_TLS_SERVER_PACKAGES].sort()).toEqual(
      [...TLS_SERVERS].sort(),
    );
  });

  it('is plaintext when the variable is unset, and the same object on every call', () => {
    delete process.env.GRPC_TLS_CA_FILE;
    const { grpcClientChannelCredentials } = load();
    const first = grpcClientChannelCredentials('cybedefend.file_management');
    expect(first._isSecure()).toBe(false);
    expect(grpcClientChannelCredentials('cybedefend.policy_management')).toBe(
      first,
    );
  });

  it.each(TLS_SERVERS)('is TLS for %s when the CA is set', (pkg) => {
    process.env.GRPC_TLS_CA_FILE = writeCa();
    const { grpcClientChannelCredentials } = load();
    expect(grpcClientChannelCredentials(pkg)._isSecure()).toBe(true);
    expect(grpcClientChannelCredentials([pkg])._isSecure()).toBe(true);
  });

  it.each(['example.without_tls', 'other'])(
    'stays plaintext for %s, which serves no TLS, even with the CA set',
    (pkg) => {
      process.env.GRPC_TLS_CA_FILE = writeCa();
      const { grpcClientChannelCredentials } = load();
      expect(grpcClientChannelCredentials(pkg)._isSecure()).toBe(false);
    },
  );

  it('stays plaintext for a client mixing a TLS server and another package', () => {
    process.env.GRPC_TLS_CA_FILE = writeCa();
    const { grpcClientChannelCredentials } = load();
    expect(
      grpcClientChannelCredentials([
        'cybedefend.global_management',
        'example.without_tls',
      ])._isSecure(),
    ).toBe(false);
  });

  describe('warns when a CA is set but a TLS server is dialled in plaintext', () => {
    function loadWithWarnings(): {
      mod: typeof import('./grpc-channel-credentials');
      warnings: string[];
    } {
      const warnings: string[] = [];
      let mod!: typeof import('./grpc-channel-credentials');
      jest.isolateModules(() => {
        const { Logger } = jest.requireActual('@nestjs/common');
        jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation((message: unknown) => {
            warnings.push(String(message));
          });
        mod = jest.requireActual('./grpc-channel-credentials');
      });
      return { mod, warnings };
    }

    afterEach(() => jest.restoreAllMocks());

    it('names the packages of a mixed client, once per package set', () => {
      process.env.GRPC_TLS_CA_FILE = writeCa();
      const { mod, warnings } = loadWithWarnings();
      const mixed = ['cybedefend.global_management', 'example.without_tls'];
      mod.grpcClientChannelCredentials(mixed);
      mod.grpcClientChannelCredentials(mixed);
      expect(warnings).toEqual([
        'GRPC_TLS_PLAINTEXT_FALLBACK packages=cybedefend.global_management,example.without_tls ' +
          'without_tls=example.without_tls: the channel stays plaintext',
      ]);
    });

    it('stays silent for a package that serves no TLS, or without a CA', () => {
      process.env.GRPC_TLS_CA_FILE = writeCa();
      const first = loadWithWarnings();
      first.mod.grpcClientChannelCredentials('example.without_tls');
      first.mod.grpcClientChannelCredentials('cybedefend.file_management');
      expect(first.warnings).toEqual([]);

      delete process.env.GRPC_TLS_CA_FILE;
      const second = loadWithWarnings();
      second.mod.grpcClientChannelCredentials([
        'cybedefend.global_management',
        'example.without_tls',
      ]);
      expect(second.warnings).toEqual([]);
    });
  });

  it('is TLS for a package registered by the edition, plaintext before', () => {
    process.env.GRPC_TLS_CA_FILE = writeCa();
    const mod = load();
    expect(mod.grpcClientChannelCredentials('example.added')._isSecure()).toBe(
      false,
    );
    mod.registerGrpcTlsServerPackages(['example.added']);
    expect(mod.grpcClientChannelCredentials('example.added')._isSecure()).toBe(
      true,
    );
    expect(mod.GRPC_TLS_SERVER_PACKAGES.has('example.added')).toBe(false);
  });

  it('forgets the registered packages when given an empty list', () => {
    process.env.GRPC_TLS_CA_FILE = writeCa();
    const mod = load();
    mod.registerGrpcTlsServerPackages(['example.added']);
    mod.registerGrpcTlsServerPackages([]);
    expect(mod.grpcClientChannelCredentials('example.added')._isSecure()).toBe(
      false,
    );
  });

  it('fails on first TLS use when the variable names an unreadable file', () => {
    process.env.GRPC_TLS_CA_FILE = '/nonexistent/grpc-ca/ca.crt';
    const { grpcClientChannelCredentials } = load();
    expect(() =>
      grpcClientChannelCredentials('cybedefend.global_management'),
    ).toThrow(/cannot be read/);
  });
});
