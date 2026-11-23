import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { of, throwError } from 'rxjs';
import { GlobalExceptionFilter } from 'src/core/exceptions';
import { JwksController } from './jwks.controller';
import { LocalAuthService } from './local-auth.service';

const KEY = {
  kid: 'k1',
  kty: 'EC',
  crv: 'P-256',
  x: 'x',
  y: 'y',
  alg: 'ES256',
  use: 'sig',
};

describe('JwksController', () => {
  let app: NestFastifyApplication;
  const getJwks = jest.fn();

  beforeEach(async () => {
    getJwks.mockReset();
    const moduleRef = await Test.createTestingModule({
      controllers: [JwksController],
      providers: [
        LocalAuthService,
        { provide: ConfigService, useValue: new ConfigService({}) },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => ({ getJwks }) },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves the keys with a 10-minute public cache', async () => {
    getJwks.mockReturnValue(of({ keys: [KEY] }));
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/jwks.json',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ keys: [KEY] });
    expect(res.headers['cache-control']).toBe('public, max-age=600');
  });

  it('answers 503 without a public cache when global-management is unreachable', async () => {
    const spy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    getJwks.mockReturnValue(
      throwError(() =>
        Object.assign(new Error('14 UNAVAILABLE'), {
          code: GrpcStatus.UNAVAILABLE,
          details: 'down',
        }),
      ),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/jwks.json',
    });
    spy.mockRestore();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'AUTH_UNAVAILABLE' });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
