import { Test } from '@nestjs/testing';
import type { Type } from '@nestjs/common';

/**
 * The same graph as src/edition/community-boot.spec.ts, plus DB_TYPE:
 * every core context must also compile with DB_TYPE=postgres in the
 * Community Edition (preview mode: no connection, no secret-store call).
 * CYBEDEFEND_EDITION and DB_TYPE are set in beforeAll, before any dynamic
 * import of a module, because the edition layer reads them at import time.
 */

const BOOT_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:1',
  STORAGE_PROVIDER: 's3',
  S3_BUCKET_NAME: 'bucket',
  S3_ENDPOINT: 'http://127.0.0.1:1',
  AWS_REGION: 'us-east-1',
  OTEL_DISABLED: 'true',
  CYBEDEFEND_EDITION: 'community',
  DB_TYPE: 'postgres',
};

const CONTEXTS: Array<[string, () => Promise<Record<string, unknown>>]> = [
  ['AppModule', () => import('../../app.module')],
  ['CronAppModule', () => import('../../cron.app.module')],
];

describe.each(CONTEXTS)(
  '%s with DB_TYPE=postgres and CYBEDEFEND_EDITION=community',
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
        Test.createTestingModule({ imports: [mod] }).compile({
          preview: true,
        }),
      ).resolves.toBeDefined();
    }, 120_000);
  },
);
