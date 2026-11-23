import {
  loadPackageDefinition,
  Server,
  ServerCredentials,
  status,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { ClientGrpcProxy } from '@nestjs/microservices';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { firstValueFrom, Observable } from 'rxjs';
import { buildGrpcChannelCredentials } from './grpc-channel-credentials';

/**
 * A real TLS handshake: a grpc-js server presenting a certificate for
 * `localhost` signed by a throwaway CA, called through the Nest client the
 * services build, with the credentials of the helper. The certificates are
 * made with the openssl CLI; without it the suite is skipped.
 */
function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const OPENSSL = hasOpenssl();
if (!OPENSSL) {
  console.warn('openssl CLI not found: the gRPC TLS round trip is skipped');
}
const describeTls = OPENSSL ? describe : describe.skip;

const PROTO = `syntax = "proto3";
package tlstest;
service Echo { rpc Say (Msg) returns (Msg); }
message Msg { string text = 1; }
`;

interface EchoClient {
  say(msg: { text: string }): Observable<{ text: string }>;
}

describeTls('gRPC client channel over TLS', () => {
  let dir: string;
  let server: Server;
  let port: number;
  let protoPath: string;
  const clients: ClientGrpcProxy[] = [];

  function openssl(...args: string[]): void {
    execFileSync('openssl', args, { cwd: dir, stdio: 'ignore' });
  }

  function makeCa(name: string): void {
    openssl(
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:P-256',
      '-nodes',
      '-keyout',
      `${name}.key`,
      '-out',
      `${name}.crt`,
      '-days',
      '1',
      '-subj',
      `/CN=${name}`,
    );
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'grpc-tls-'));
    makeCa('ca');
    makeCa('other-ca');
    openssl(
      'req',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:P-256',
      '-nodes',
      '-keyout',
      'server.key',
      '-out',
      'server.csr',
      '-subj',
      '/CN=localhost',
    );
    writeFileSync(join(dir, 'san.ext'), 'subjectAltName=DNS:localhost\n');
    openssl(
      'x509',
      '-req',
      '-in',
      'server.csr',
      '-CA',
      'ca.crt',
      '-CAkey',
      'ca.key',
      '-CAcreateserial',
      '-out',
      'server.crt',
      '-days',
      '1',
      '-extfile',
      'san.ext',
    );

    protoPath = join(dir, 'echo.proto');
    writeFileSync(protoPath, PROTO);
    const pkg = loadPackageDefinition(loadSync(protoPath)) as unknown as {
      tlstest: { Echo: { service: never } };
    };
    server = new Server();
    server.addService(pkg.tlstest.Echo.service, {
      Say: (
        call: { request: { text: string } },
        cb: (err: null, res: { text: string }) => void,
      ) => cb(null, { text: `echo ${call.request.text}` }),
    });
    port = await new Promise<number>((resolve, reject) =>
      server.bindAsync(
        'localhost:0',
        ServerCredentials.createSsl(null, [
          {
            private_key: readFileSync(join(dir, 'server.key')),
            cert_chain: readFileSync(join(dir, 'server.crt')),
          },
        ]),
        (err, p) => (err ? reject(err) : resolve(p)),
      ),
    );
  });

  afterAll(async () => {
    clients.forEach((c) => c.close());
    await new Promise<void>((resolve) => server?.tryShutdown(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  function echoThrough(caFile: string): EchoClient {
    const client = new ClientGrpcProxy({
      package: 'tlstest',
      protoPath,
      url: `localhost:${port}`,
      credentials: buildGrpcChannelCredentials(caFile),
    });
    clients.push(client);
    return client.getService<EchoClient>('Echo');
  }

  it('calls a server whose certificate the CA signed', async () => {
    const reply = await firstValueFrom(
      echoThrough(join(dir, 'ca.crt')).say({ text: 'hi' }),
    );
    expect(reply.text).toBe('echo hi');
  });

  it('refuses a server whose certificate another CA signed', async () => {
    await expect(
      firstValueFrom(
        echoThrough(join(dir, 'other-ca.crt')).say({ text: 'hi' }),
      ),
    ).rejects.toMatchObject({ code: status.UNAVAILABLE });
  });
});
