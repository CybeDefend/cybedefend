import type { MultipartFile } from '@fastify/multipart';
import {
  Body,
  Controller,
  Module,
  PayloadTooLargeException,
  Post,
  Req,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  WEBHOOK_BODY_CAP_PROVIDER,
  WEBHOOK_MAX_BODY_BYTES,
} from '../../modules/integrations/webhook-body-cap';
import {
  GATEWAY_BODY_LIMIT_BYTES,
  gatewayAdapterOptions,
  gatewayBodyLimitFromEnv,
  registerUploadRoutesMultipartOnly,
} from './body-limit';
import {
  IMPORT_MULTIPART_LIMITS,
  registerMultipart,
} from './register-multipart';

const MIB = 1024 * 1024;
const handled: string[] = [];

@Controller()
class OrdinaryController {
  @Post('/project/:projectId/vulnerabilities')
  ordinary(@Body() body: { blob?: string }) {
    handled.push('ordinary');
    return { size: body?.blob?.length ?? 0 };
  }

  @Post('/webhooks/github')
  webhook(@Body() body: { blob?: string }) {
    handled.push('webhook');
    return { size: body?.blob?.length ?? 0 };
  }
}

/** Reads the files as the upload routes do; a file over the limit is a 413. */
async function readFileBytes(req: FastifyRequest): Promise<number> {
  let bytes = 0;
  try {
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        bytes += (await (part as MultipartFile).toBuffer()).length;
      }
    }
  } catch (error) {
    if ((error as { code?: unknown }).code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new PayloadTooLargeException();
    }
    throw error;
  }
  return bytes;
}

@Controller()
class UploadController {
  @Post('/project/:projectId/scan/import/start')
  async importStart(@Req() req: FastifyRequest) {
    handled.push('import');
    return { bytes: await readFileBytes(req) };
  }

  @Post('/scan-runs/:scanId/results')
  async scanRunResults(@Req() req: FastifyRequest) {
    handled.push('scan-run');
    return { bytes: await readFileBytes(req) };
  }
}

@Module({
  controllers: [OrdinaryController, UploadController],
  providers: [WEBHOOK_BODY_CAP_PROVIDER],
})
class BodyLimitTestModule {}

/** Boots the HTTP adapter the way main.ts does, before app.init(). */
async function buildApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    BodyLimitTestModule,
    new FastifyAdapter(gatewayAdapterOptions({})),
    { logger: false, rawBody: true },
  );
  await registerMultipart(app);
  registerUploadRoutesMultipartOnly(app.getHttpAdapter().getInstance());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

const BOUNDARY = '----cdbodylimit';
function multipartBody(fileBytes: number): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="type"\r\n\r\nsast\r\n` +
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="r.sarif"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
    ),
    Buffer.alloc(fileBytes, 0x61),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
}

describe('gateway body limit', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    handled.length = 0;
  });

  it('is 1 MiB by default', () => {
    expect(GATEWAY_BODY_LIMIT_BYTES).toBe(MIB);
    expect(gatewayAdapterOptions({}).bodyLimit).toBe(MIB);
  });

  it('refuses a 2 MiB JSON body on an ordinary route with 413, before the handler', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/project/p1/vulnerabilities',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ blob: 'x'.repeat(2 * MIB) }),
    });
    expect(res.statusCode).toBe(413);
    expect(handled).toEqual([]);
  });

  it('refuses a body that declares no length once it passes the limit', async () => {
    const { Readable } = await import('node:stream');
    const res = await app.inject({
      method: 'POST',
      url: '/project/p1/vulnerabilities',
      headers: { 'content-type': 'application/json' },
      payload: Readable.from([
        Buffer.from('{"blob":"'),
        Buffer.alloc(2 * MIB, 0x78),
        Buffer.from('"}'),
      ]),
    });
    expect(res.statusCode).toBe(413);
    expect(handled).toEqual([]);
  });

  it('still accepts an ordinary body under the limit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/project/p1/vulnerabilities',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ blob: 'x'.repeat(512 * 1024) }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ size: 512 * 1024 });
  });

  it('keeps the webhook routes at their own, larger cap', async () => {
    expect(WEBHOOK_MAX_BODY_BYTES).toBeGreaterThan(2 * MIB);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ blob: 'x'.repeat(2 * MIB) }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ size: 2 * MIB });
  });

  const UPLOAD_ROUTES = [
    ['/project/p1/scan/import/start', 'import'],
    ['/scan-runs/s1/results', 'scan-run'],
  ];

  it.each(UPLOAD_ROUTES)(
    'refuses a 2 MiB JSON body on %s before it is parsed or handled',
    async (url) => {
      const res = await app.inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ blob: 'x'.repeat(2 * MIB) }),
      });
      expect([413, 415]).toContain(res.statusCode);
      expect(handled).toEqual([]);
    },
  );

  it.each(UPLOAD_ROUTES)(
    'refuses any body that is not multipart on %s, small or large, with 415',
    async (url) => {
      for (const [type, payload] of [
        ['application/json', '{}'],
        ['text/plain', 'x'.repeat(2 * MIB)],
        ['application/octet-stream', Buffer.alloc(16)],
      ] as const) {
        const res = await app.inject({
          method: 'POST',
          url,
          headers: { 'content-type': type },
          payload,
        });
        expect({ type, status: res.statusCode }).toEqual({
          type,
          status: 415,
        });
      }
      const none = await app.inject({ method: 'POST', url });
      expect(none.statusCode).toBe(415);
      expect(handled).toEqual([]);
    },
  );

  it.each(UPLOAD_ROUTES)(
    'takes on %s a multipart file of exactly the size the product allows, and refuses one byte more',
    async (url, name) => {
      const { fileSize } = IMPORT_MULTIPART_LIMITS;
      expect(fileSize).toBe(50 * MIB);
      const ok = await app.inject({
        method: 'POST',
        url,
        headers: {
          'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
        },
        payload: multipartBody(fileSize),
      });
      expect(ok.statusCode).toBe(201);
      expect(ok.json()).toEqual({ bytes: fileSize });
      expect(handled).toEqual([name]);

      const over = await app.inject({
        method: 'POST',
        url,
        headers: {
          'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
        },
        payload: multipartBody(fileSize + 1),
      });
      expect(over.statusCode).toBe(413);
    },
  );

  it('keeps every content type on the other routes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/project/p1/vulnerabilities',
      headers: { 'content-type': 'application/json' },
      payload: '{"blob":"x"}',
    });
    expect(res.statusCode).toBe(201);
  });

  describe('gatewayBodyLimitFromEnv', () => {
    it('reads GATEWAY_BODY_LIMIT_BYTES when it is a sane number', () => {
      expect(
        gatewayBodyLimitFromEnv({ GATEWAY_BODY_LIMIT_BYTES: '2097152' }),
      ).toBe(2 * MIB);
    });

    it.each(['', 'abc', '-1', '0', '1.5', '1e9', String(64 * MIB)])(
      'falls back to the default on %p',
      (raw) => {
        expect(gatewayBodyLimitFromEnv({ GATEWAY_BODY_LIMIT_BYTES: raw })).toBe(
          GATEWAY_BODY_LIMIT_BYTES,
        );
      },
    );
  });

  it('main.ts builds its adapter from these options and guards the upload routes before listen', () => {
    const main = readFileSync(join(__dirname, '..', '..', 'main.ts'), 'utf8');
    expect(main).toContain(
      'new FastifyAdapter(gatewayAdapterOptions(process.env))',
    );
    expect(main).not.toMatch(/bodyLimit:\s*50/);
    expect(main).not.toContain('registerUploadBodyLimits');
    const guard = main.indexOf('registerUploadRoutesMultipartOnly(');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(main.indexOf('app.listen('));
  });
});
