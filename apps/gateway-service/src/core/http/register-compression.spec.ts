import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import zlib from 'node:zlib';
import { registerCompression } from './register-compression';

@Controller()
class CompressionTestController {
  // 2 KB payload — comfortably over the 1 KB compression threshold.
  @Get('/big')
  big() {
    return { payload: 'x'.repeat(2048) };
  }

  // ~10 byte payload — under the threshold, must NOT be compressed.
  @Get('/small')
  small() {
    return { ok: true };
  }

  @Post('/echo')
  echo(@Body() body: unknown) {
    return { received: body };
  }
}

@Module({ controllers: [CompressionTestController] })
class CompressionTestModule {}

async function buildApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    CompressionTestModule,
    new FastifyAdapter(),
    { logger: false },
  );
  await registerCompression(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('registerCompression', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('compresses with gzip when client only accepts gzip and payload exceeds the threshold', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/big',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
  });

  it('compresses with brotli when the client accepts br (br ranks above gzip)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/big',
      headers: { 'accept-encoding': 'br, gzip' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
  });

  it('does not compress when the response is under the 1 KB threshold', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/small',
      headers: { 'accept-encoding': 'br, gzip' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('does not compress when the client does not advertise an accepted encoding', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/big',
      headers: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
  });
});

// Node2Shell (CVE-2026-111497): an out-of-bounds write in the Brotli DECODER
// bundled with Node.js, reachable by anyone who can send a body. With no option,
// @fastify/compress also decompresses request bodies (`br`, `gzip`, `deflate`)
// in a preParsing hook, i.e. before any guard runs. The gateway never needed
// that: it only compresses its responses. zlib's exports are read-only, so the
// proof is the outcome: a well-formed compressed body that reached a decoder
// would come back decoded with a 201.
describe('registerCompression — request bodies are never decompressed', () => {
  let app: NestFastifyApplication;
  const payload = JSON.stringify({ hello: 'world' });

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('never hands a Brotli request body to the Brotli decoder', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'br',
      },
      payload: zlib.brotliCompressSync(Buffer.from(payload)),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('world');
  });

  it('does not decode a gzip request body either', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      },
      payload: zlib.gzipSync(Buffer.from(payload)),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('world');
  });

  it('still parses an ordinary JSON body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ received: { hello: 'world' } });
  });

  it('still compresses responses with brotli (the encoder is not affected)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/big',
      headers: { 'accept-encoding': 'br' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
  });
});
