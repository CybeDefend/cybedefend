import { ConfigService } from '@nestjs/config';
import Fastify, { FastifyInstance } from 'fastify';
import { Logger } from 'nestjs-pino';

import { GatewayClientService } from './gateway-client.service';

/**
 * The query string the gateway client sends must be read by the gateway's
 * own HTTP parser as the filter the tool asked for.
 *
 * The gateway runs on Fastify with its default query-string parser, and its
 * list DTO declares `severity`, `status`, `priority` and `packageType` as
 * arrays (a single value or a comma-joined string is split). A key spelled
 * `severity[]` is a different, undeclared key that the global validation
 * pipe (`whitelist: true`) drops without an error, so the list comes back
 * unfiltered. This spec sends real requests through axios to a real Fastify
 * server, the same parser, and reads back what it parsed.
 */
describe('GatewayClientService query string, read by the gateway parser', () => {
  let app: FastifyInstance;
  let received: Record<string, unknown> | undefined;
  let service: GatewayClientService;

  beforeAll(async () => {
    app = Fastify();
    app.get('/mcp/project/:projectId/results/:scanner', async (req) => {
      received = req.query as Record<string, unknown>;
      return { vulnerabilities: [] };
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as { port: number };
    const config = {
      get: (key: string) =>
        key === 'CYBEDEFEND_API_RESOURCE'
          ? `http://127.0.0.1:${address.port}`
          : undefined,
    } as unknown as ConfigService;
    const logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger;
    service = new GatewayClientService(config, logger);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    received = undefined;
  });

  it('sends every array filter under its own plain key, once per value', async () => {
    await service.listVulnerabilities(
      'p1',
      'sca',
      {
        severity: ['critical', 'high'],
        status: ['to_verify'],
        priority: ['urgent', 'normal'],
        packageType: ['direct'],
        pageNumber: 2,
      },
      'tok',
    );

    expect(received).toEqual({
      severity: ['critical', 'high'],
      status: 'to_verify',
      priority: ['urgent', 'normal'],
      packageType: 'direct',
      pageNumber: '2',
    });
    expect(Object.keys(received ?? {}).some((k) => k.includes('['))).toBe(
      false,
    );
  });

  it('keeps scalar filters unchanged', async () => {
    await service.listVulnerabilities(
      'p1',
      'sast',
      { branch: 'main', searchQuery: 'a b&c', malwareOnly: true },
      'tok',
    );

    expect(received).toEqual({
      branch: 'main',
      searchQuery: 'a b&c',
      malwareOnly: 'true',
    });
  });
});
