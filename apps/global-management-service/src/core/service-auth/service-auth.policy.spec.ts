import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Metadata,
  Server,
  ServerCredentials,
  credentials,
  loadPackageDefinition,
  status,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import {
  ClientGrpc,
  ClientProxyFactory,
  ServerGrpc,
  Transport,
} from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { decodeMasterKey, deriveKey } from '../secrets/secret-key';
import {
  allowedServiceCallers,
  createServiceAuthClientInterceptor,
} from './service-auth';
import {
  serviceAuthClientChannelOptions,
  serviceAuthCommunityInfo,
  serviceAuthServerChannelOptions,
} from './service-auth.edition';
import { SERVICE_AUTH_POLICY } from './service-auth.policy';

const PROTOS = join(__dirname, '..', '..', '..', '..', '..', 'libs', 'protos');
const LOCAL_AUTH = 'global-management/local_auth.proto';
const PREFIX = '/cybedefend.global_management.LocalAuthService/';

function rpcsOf(file: string, service: string): string[] {
  const text = readFileSync(join(PROTOS, file), 'utf8');
  const body = text.split(new RegExp(`service ${service}\\s*\\{`))[1];
  return [...body.split(/\n\}/)[0].matchAll(/rpc\s+(\w+)/g)].map((m) => m[1]);
}

describe('global-management service-auth policy', () => {
  it('signs as global-management', () => {
    expect(SERVICE_AUTH_POLICY.caller).toBe('global-management');
    expect(SERVICE_AUTH_POLICY.scannerMethods).toEqual([]);
  });

  const GM = '/cybedefend.global_management.';
  const callersOf = (path: string) =>
    allowedServiceCallers(SERVICE_AUTH_POLICY, `${GM}${path}`);

  it('keeps every LocalAuthService method to the gateway', () => {
    const rpcs = rpcsOf(LOCAL_AUTH, 'LocalAuthService');
    expect(rpcs).toContain('CreatePersonalAccessToken');
    for (const rpc of rpcs) {
      expect([
        rpc,
        allowedServiceCallers(SERVICE_AUTH_POLICY, PREFIX + rpc),
      ]).toEqual([rpc, ['gateway']]);
    }
  });

  it('keeps to the gateway the methods that grant credentials or roles, or create or delete an organisation, a team or a project', () => {
    for (const path of [
      'UserService/CreateUser',
      'UserService/UpdateUser',
      'UserService/DeleteUser',
      'UserService/CreatePersonalAccessToken',
      'UserService/ListPersonalAccessTokens',
      'UserService/DeletePersonalAccessToken',
      'UserService/UpdatePersonalAccessTokenName',
      'UserService/DeleteAllPatsForOrg',
      'TeamService/addMember',
      'TeamService/removeMember',
      'TeamService/updateMemberRole',
      'TeamService/createTeam',
      'TeamService/deleteTeam',
      'ProjectService/Create',
      'ProjectService/Delete',
      'OrganizationService/Invite',
      'OrganizationService/CancelInvitation',
      'OrganizationService/CancelAllPendingInvitations',
      'OrganizationService/AcceptInvitation',
      'OrganizationService/UpdateMember',
      'OrganizationService/RemoveMember',
      'OrganizationService/Create',
      'OrganizationService/Delete',
      'OrganizationService/ConfirmOrganizationDeletion',
      'OrganizationService/RequestOrganizationDeletionCode',
    ]) {
      expect([path, callersOf(path)]).toEqual([path, ['gateway']]);
    }
  });

  it('lets file-management reach none of its methods', () => {
    expect(
      [
        ...Object.values(SERVICE_AUTH_POLICY.services),
        ...Object.values(SERVICE_AUTH_POLICY.methods),
      ].flat(),
    ).not.toContain('file-management');
  });

  it('closes every method no rule names', () => {
    expect(callersOf('UnknownService/Anything')).toEqual([]);
    expect(
      allowedServiceCallers(SERVICE_AUTH_POLICY, '/cybedefend.other.X/Y'),
    ).toEqual([]);
  });

  it('names only services and methods the exported protos declare', () => {
    const files = [
      'global-management/global_management.proto',
      'global-management/mail.proto',
      LOCAL_AUTH,
    ];
    const services = new Map<string, string[]>();
    for (const file of files) {
      const text = readFileSync(join(PROTOS, file), 'utf8');
      for (const m of text.matchAll(/^service\s+(\w+)/gm)) {
        services.set(m[1], rpcsOf(file, m[1]));
      }
    }
    for (const key of Object.keys(SERVICE_AUTH_POLICY.services)) {
      const [pkg, service] = [key.replace(/\.\w+$/, ''), key.split('.').pop()];
      expect([key, pkg, services.has(service)]).toEqual([
        key,
        'cybedefend.global_management',
        true,
      ]);
    }
    for (const path of Object.keys(SERVICE_AUTH_POLICY.methods)) {
      const [, service, rpc] =
        /^\/cybedefend\.global_management\.(\w+)\/(\w+)$/.exec(path) ?? [];
      expect([path, services.get(service)?.includes(rpc)]).toEqual([
        path,
        true,
      ]);
    }
  });
});

const MASTER = Buffer.alloc(32, 3).toString('base64');
const keyOf = (caller: string) =>
  deriveKey(decodeMasterKey(MASTER), serviceAuthCommunityInfo(caller)).toString(
    'hex',
  );

describe('LocalAuthService on a real server, Community Edition', () => {
  const saved = { ...process.env };
  let server: Server;
  let address: string;
  const minted: string[] = [];
  type Unary = (
    req: object,
    md: Metadata,
    cb: (err: { code?: number } | null) => void,
  ) => void;
  type LocalAuthClient = { CreatePersonalAccessToken: Unary; close(): void };
  let LocalAuth: new (
    addr: string,
    creds: ReturnType<typeof credentials.createInsecure>,
    opts: object,
  ) => LocalAuthClient;

  beforeAll(async () => {
    process.env.CYBEDEFEND_EDITION = 'community';
    process.env.CYBEDEFEND_SECRET_KEY = MASTER;
    delete process.env.SERVICE_AUTH_KEY;
    const definition = loadSync(join(PROTOS, LOCAL_AUTH), {
      includeDirs: [PROTOS],
      keepCase: false,
      defaults: true,
    });
    const pkg = loadPackageDefinition(definition) as unknown as {
      cybedefend: {
        global_management: {
          LocalAuthService: typeof LocalAuth & {
            service: Parameters<Server['addService']>[0];
          };
        };
      };
    };
    const service = pkg.cybedefend.global_management.LocalAuthService;
    LocalAuth = service;
    server = new Server(serviceAuthServerChannelOptions() as never);
    server.addService(service.service, {
      CreatePersonalAccessToken: (
        call: { request: { userId: string } },
        cb: (e: null, r: object) => void,
      ) => {
        minted.push(call.request.userId);
        cb(null, {});
      },
    });
    const port = await new Promise<number>((resolve, reject) =>
      server.bindAsync(
        '127.0.0.1:0',
        ServerCredentials.createInsecure(),
        (e, p) => (e ? reject(e) : resolve(p)),
      ),
    );
    address = `127.0.0.1:${port}`;
  });

  afterAll(() => {
    server.forceShutdown();
    process.env = saved;
  });

  function mint(interceptors: unknown[]): Promise<number> {
    const client = new LocalAuth(address, credentials.createInsecure(), {
      interceptors,
    });
    return new Promise((resolve) =>
      client.CreatePersonalAccessToken(
        { userId: 'creator', name: 'x' },
        new Metadata(),
        (err) => {
          client.close();
          resolve(err ? (err.code ?? -1) : status.OK);
        },
      ),
    );
  }

  it('refuses a caller that does not sign its call', async () => {
    expect(await mint([])).toBe(status.UNAUTHENTICATED);
    expect(minted).toEqual([]);
  });

  it('refuses another service, even signed', async () => {
    // This service's own clients sign as global-management.
    expect(await mint(serviceAuthClientChannelOptions().interceptors)).toBe(
      status.PERMISSION_DENIED,
    );
    expect(minted).toEqual([]);
  });

  it('signs the calls of a Nest gRPC client built with the client options', async () => {
    const proxy = ClientProxyFactory.create({
      transport: Transport.GRPC,
      options: {
        package: 'cybedefend.global_management',
        protoPath: join(PROTOS, LOCAL_AUTH),
        url: address,
        loader: { includeDirs: [PROTOS] },
        channelOptions: { ...serviceAuthClientChannelOptions() },
      },
    }) as unknown as ClientGrpc & { close(): void };
    const localAuth = proxy.getService<{
      createPersonalAccessToken(req: object): import('rxjs').Observable<object>;
    }>('LocalAuthService');
    // Signed as global-management, so the server knows the caller and refuses
    // it on a gateway-only method; an unsigned call would be UNAUTHENTICATED.
    await expect(
      firstValueFrom(
        localAuth.createPersonalAccessToken({ userId: 'creator' }),
      ),
    ).rejects.toMatchObject({ code: status.PERMISSION_DENIED });
    proxy.close();
    expect(minted).toEqual([]);
  });

  it('hands the server options to the gRPC server Nest starts', async () => {
    const nest = new ServerGrpc({
      url: '127.0.0.1:0',
      package: 'cybedefend.global_management',
      protoPath: join(PROTOS, LOCAL_AUTH),
      loader: { includeDirs: [PROTOS] },
      channelOptions: serviceAuthServerChannelOptions(),
    });
    const grpcServer = (await nest.createClient()) as unknown as {
      interceptors: unknown[];
      forceShutdown(): void;
    };
    expect(grpcServer.interceptors).toHaveLength(1);
    grpcServer.forceShutdown();
  });

  it('refuses another service that signs as the gateway with its own key', async () => {
    const forger = createServiceAuthClientInterceptor({
      caller: 'gateway',
      key: () => keyOf('file-management'),
      logger: { warn: () => undefined },
    });
    expect(await mint([forger])).toBe(status.UNAUTHENTICATED);
    expect(minted).toEqual([]);
  });

  it('serves the gateway', async () => {
    const gateway = createServiceAuthClientInterceptor({
      caller: 'gateway',
      key: () => keyOf('gateway'),
      logger: { warn: () => undefined },
    });
    expect(await mint([gateway])).toBe(status.OK);
    expect(minted).toEqual(['creator']);
  });
});
