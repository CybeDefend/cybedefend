import 'reflect-metadata';
import type { ClassProvider, Provider } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Test } from '@nestjs/testing';
import { editionBindings } from 'src/edition/edition-imports';
import {
  IDENTITY_PROVIDER_PORT,
  type IdentityProviderPort,
} from 'src/edition/ports/identity-provider.port';
import { PersonalAccessTokenStore } from './personal-access-token.store';
import { RefreshTokenStore } from './refresh-token.store';

/**
 * In the Community Edition the generic token routes (UserService's
 * CreatePersonalAccessToken, behind POST /user/personal-access-tokens) reach
 * the identity-provider binding the edition chooses. That binding refuses to
 * create a token: the path carries no password, and a token outlives every
 * session. The refusal is FAILED_PRECONDITION (a client error at the
 * gateway) with the stable PAT_PASSWORD_REQUIRED reason, and nothing is
 * written.
 */
describe('Generic personal access token creation, Community Edition', () => {
  const saved = process.env.CYBEDEFEND_EDITION;

  beforeAll(() => {
    process.env.CYBEDEFEND_EDITION = 'community';
  });

  afterAll(() => {
    if (saved === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = saved;
  });

  it('is refused by the binding the edition chooses, with nothing created', async () => {
    const binding = editionBindings().find(
      (p: Provider) =>
        typeof p === 'object' &&
        (p as ClassProvider).provide === IDENTITY_PROVIDER_PORT,
    );
    expect(binding).toBeDefined();
    const pats = { create: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        binding as Provider,
        { provide: PersonalAccessTokenStore, useValue: pats },
        { provide: RefreshTokenStore, useValue: {} },
      ],
    }).compile();
    const port = module.get<IdentityProviderPort>(IDENTITY_PROVIDER_PORT);

    const thrown = await port
      .createPersonalAccessToken('u1', 'ci', 0)
      .catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(RpcException);
    const error = (thrown as RpcException).getError() as {
      code: number;
      message: string;
    };
    expect(error.code).toBe(status.FAILED_PRECONDITION);
    expect(error.message).toMatch(
      /^PAT_PASSWORD_REQUIRED: .*POST \/me\/personal-access-tokens/,
    );
    expect(pats.create).not.toHaveBeenCalled();
    await module.close();
  });
});
