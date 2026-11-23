import { Test } from '@nestjs/testing';
import type { Type } from '@nestjs/common';

/**
 * The same proof as src/edition/community-boot.spec.ts, with DB_TYPE=postgres:
 * every application module of the service compiles in community mode on the
 * PostgreSQL engine (`preview: true`: no connection is opened). CYBEDEFEND_EDITION
 * and DB_TYPE are set in beforeAll, before any dynamic import of a module,
 * because the entity decorators and editionImports() read them at import time.
 */

const BOOT_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  GRPC_URL_ANALYSIS_REPORTING_SERVICE: '127.0.0.1:1',
  GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:1',
  GRPC_URL_EXTERNAL_INTEGRATIONS_SERVICE: '127.0.0.1:1',
  PERMIFY_ENDPOINT: '127.0.0.1:1',
  FRONTEND_URL: 'http://127.0.0.1:1',
  OTEL_DISABLED: 'true',
  CYBEDEFEND_EDITION: 'community',
  // Required in community by the Joi schema (a placeholder value,
  // nothing connects in preview mode).
  CYBEDEFEND_SETUP_TOKEN: 'boot-spec-placeholder-of-32-characters',
  DB_TYPE: 'postgres',
};

const CONTEXTS: Array<[string, () => Promise<Record<string, unknown>>]> = [
  ['AppModule', () => import('../../app.module')],
  ['DataPurgeCronModule', () => import('../../data-purge.cron.module')],
  // The lead follow-up cron is closed entirely: the Community Edition has no
  // such context.
];

describe.each(CONTEXTS)(
  '%s with DB_TYPE=postgres in community mode',
  (name, load) => {
    const savedEnv = process.env;

    beforeAll(() => {
      process.env = { ...savedEnv, ...BOOT_ENV };
    }, 120_000);

    afterAll(() => {
      process.env = savedEnv;
    });

    it('compiles in preview mode', async () => {
      const mod = (await load())[name] as Type<unknown>;
      await expect(
        Test.createTestingModule({ imports: [mod] }).compile({ preview: true }),
      ).resolves.toBeDefined();
    }, 120_000);
  },
);
