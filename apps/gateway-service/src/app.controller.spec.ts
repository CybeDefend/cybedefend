/**
 * GET /robots.txt.
 *
 * A 404 on /robots.txt reads as "everything is allowed" to a well-behaved
 * crawler, which then walks every path of the public OpenAPI reference without
 * a token. The API has nothing to index, so it says so.
 */
import {
  Logger,
  RequestMethod,
  ValidationPipe,
  type CanActivate,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  HEADERS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DECORATORS, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GlobalExceptionFilter } from './core/exceptions';

const ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

const appServiceStub = {
  getHello: () => ({
    service: 'Gateway Service',
    version: 'test',
    commit: 'test',
    environment: 'test',
    deploymentEnv: 'test',
  }),
  getClientApps: () => ({}),
} as unknown as AppService;

describe('AppController — robots.txt', () => {
  const handler = AppController.prototype.getRobotsTxt;

  it('disallows every path to every crawler', () => {
    expect(new AppController(appServiceStub).getRobotsTxt()).toBe(ROBOTS_TXT);
  });

  it('is a GET on robots.txt', () => {
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('robots.txt');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
  });

  it('is public: no guard on the route nor on the controller', () => {
    const methodGuards: CanActivate[] | undefined = Reflect.getMetadata(
      GUARDS_METADATA,
      handler,
    );
    const classGuards: CanActivate[] | undefined = Reflect.getMetadata(
      GUARDS_METADATA,
      AppController,
    );
    expect(methodGuards).toBeUndefined();
    expect(classGuards).toBeUndefined();
  });

  it('declares a text/plain UTF-8 Content-Type', () => {
    expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toEqual([
      { name: 'Content-Type', value: 'text/plain; charset=utf-8' },
    ]);
  });

  it('is excluded from the OpenAPI document', () => {
    expect(
      Reflect.getMetadata(DECORATORS.API_EXCLUDE_ENDPOINT, handler),
    ).toEqual({ disable: true });
  });
});

describe('GET /robots.txt over HTTP', () => {
  let app: NestFastifyApplication;
  let warnSpy: jest.SpyInstance;

  beforeEach(async () => {
    // The exception filter logs every 4xx; keep a 404 regression readable.
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: appServiceStub }],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    // Verbatim copies of main.ts, which sets no global prefix nor versioning:
    // the route must answer at the root, where crawlers look for it.
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
    warnSpy.mockRestore();
  });

  it('answers 200 text/plain at the root path, without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/robots.txt' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(res.body).toBe(ROBOTS_TXT);
  });

  it('is absent from the Swagger document', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );

    expect(document.paths['/']).toBeDefined();
    expect(document.paths['/robots.txt']).toBeUndefined();
  });
});
