import { loadSync } from '@grpc/proto-loader';
import { join } from 'node:path';

/**
 * The local identity contract: `local_auth.proto` declares
 * the Community Edition's local identity service. These specs read the real
 * `.proto` through `@grpc/proto-loader` (keepCase, as written) and pin the
 * RPC list, the message fields and the non-collision with `user.proto`'s
 * `PersonalAccessToken*` family — a collision would make protoc fail in all
 * nine `proto:generate` consumers.
 */

interface FieldDescriptor {
  name: string;
  number: number;
  type: string;
  label: string;
  typeName?: string;
  proto3Optional?: boolean;
}

interface MessageDefinition {
  type: { field: FieldDescriptor[] };
}

interface ServiceDefinition {
  [method: string]: unknown;
}

type PackageDefinition = Record<string, MessageDefinition | ServiceDefinition>;

const PROTO_DIR = join(__dirname, '../../../../libs/protos');

const load = (files: string | string[]): PackageDefinition =>
  loadSync(files, {
    keepCase: true,
    includeDirs: [PROTO_DIR],
  }) as unknown as PackageDefinition;

const fieldsOf = (
  pkg: PackageDefinition,
  messageName: string,
): FieldDescriptor[] => {
  const def = pkg[messageName];
  if (!def || !('type' in def)) {
    throw new Error(`message not found in loaded protos: ${messageName}`);
  }
  return (def as MessageDefinition).type.field;
};

const fieldNames = (pkg: PackageDefinition, messageName: string): string[] =>
  fieldsOf(pkg, messageName).map((f) => f.name);

const fieldByNumber = (
  pkg: PackageDefinition,
  messageName: string,
  number: number,
): FieldDescriptor => {
  const field = fieldsOf(pkg, messageName).find((f) => f.number === number);
  if (!field) {
    throw new Error(`${messageName} has no field ${number}`);
  }
  return field;
};

describe('local_auth.proto — Community local identity contract', () => {
  // Loaded per test so a missing file or field fails that test, not the suite.
  const pkg = (): PackageDefinition =>
    load('global-management/local_auth.proto');

  it('declares the fifteen RPCs of the local identity service', () => {
    const service = pkg()[
      'cybedefend.global_management.LocalAuthService'
    ] as ServiceDefinition;
    expect(Object.keys(service)).toEqual([
      'GetSetupStatus',
      'SetupInstance',
      'SignUp',
      'Login',
      'Refresh',
      'Logout',
      'ChangePassword',
      'RequestPasswordReset',
      'ResetPassword',
      'AcceptInvitation',
      'GetJwks',
      'CreatePersonalAccessToken',
      'ListPersonalAccessTokens',
      'RevokePersonalAccessToken',
      'VerifyPersonalAccessToken',
    ]);
  });

  it('carries the sign-up and password-change fields', () => {
    expect(
      fieldNames(pkg(), 'cybedefend.global_management.LocalSignUpRequest'),
    ).toEqual(['email', 'name', 'password', 'clientIp']);
    expect(
      fieldNames(
        pkg(),
        'cybedefend.global_management.LocalChangePasswordRequest',
      ),
    ).toEqual(['userId', 'currentPassword', 'newPassword', 'refreshToken']);

    for (const msg of [
      'cybedefend.global_management.LocalSignUpRequest',
      'cybedefend.global_management.LocalChangePasswordRequest',
    ]) {
      for (const field of fieldsOf(pkg(), msg)) {
        expect(field.type).toBe('TYPE_STRING');
      }
    }

    for (const msg of [
      'cybedefend.global_management.LocalSignUpResponse',
      'cybedefend.global_management.LocalChangePasswordResponse',
    ]) {
      const session = fieldByNumber(pkg(), msg, 1);
      expect(session.name).toBe('session');
      expect(session.type).toBe('TYPE_MESSAGE');
      expect(session.typeName).toMatch(/LocalAuthSession$/);
    }
  });

  it('keeps the personal access token messages apart from user.proto', () => {
    // Loading both files in one package definition throws on a duplicate
    // message name in package cybedefend.global_management.
    const both = load([
      'global-management/global_management.proto',
      'global-management/local_auth.proto',
    ]);
    expect(
      both[
        'cybedefend.global_management.CreateLocalPersonalAccessTokenRequest'
      ],
    ).toBeDefined();
    expect(
      both['cybedefend.global_management.CreatePersonalAccessTokenRequest'],
    ).toBeDefined();
  });

  it('carries the session fields', () => {
    expect(
      fieldNames(pkg(), 'cybedefend.global_management.LocalAuthSession'),
    ).toEqual([
      'accessToken',
      'accessTokenExpiresAt',
      'refreshToken',
      'refreshTokenExpiresAt',
      'userId',
      'email',
      'name',
    ]);
  });

  it('is generated for the service', () => {
    // Lazy require: until `pnpm run proto:generate` runs after the proto
    // lands, this module does not exist and the test fails on the require.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const generated = require('@grpc/global-management/local_auth') as {
      LOCAL_AUTH_SERVICE_NAME: string;
    };
    expect(generated.LOCAL_AUTH_SERVICE_NAME).toBe('LocalAuthService');
  });
});
