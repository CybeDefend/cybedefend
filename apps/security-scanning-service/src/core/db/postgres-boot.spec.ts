import { Test } from '@nestjs/testing';
import type { Type } from '@nestjs/common';

/**
 * The postgres twin of src/edition/community-boot.spec.ts: the same contexts
 * and the same BOOT_ENV, plus DB_TYPE=postgres. The modules are imported
 * dynamically in the test, after beforeAll set the environment, because
 * ConfigModule.forRoot validates at import time and @cybedefend/db-dialect
 * reads DB_TYPE at import time.
 */
const BOOT_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  GRPC_URL_GLOBAL_MANAGEMENT_SERVICE: '127.0.0.1:1',
  GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:1',
  GRPC_URL_FILE_MANAGEMENT_SERVICE: '127.0.0.1:1',
  GCR_NAME: 'gcr.invalid',
  GCP_BUCKET_NAME: 'bucket',
  OTEL_DISABLED: 'true',
  CYBEDEFEND_EDITION: 'community',
  DB_TYPE: 'postgres',
};

const CONTEXTS: Array<[string, () => Promise<Record<string, unknown>>]> = [
  ['AppModule', () => import('../../app.module')],
  ['CronAppModule', () => import('../../cron.app.module')],
];

describe.each(CONTEXTS)('%s with DB_TYPE=postgres', (name, load) => {
  const savedEnv = process.env;

  beforeAll(() => {
    process.env = { ...savedEnv, ...BOOT_ENV };
  }, 120_000);

  afterAll(() => {
    process.env = savedEnv;
  });

  it('compiles with DB_TYPE=postgres and CYBEDEFEND_EDITION=community in preview mode', async () => {
    const mod = (await load())[name] as Type<unknown>;
    const app = await Test.createTestingModule({ imports: [mod] }).compile({
      preview: true,
    });
    expect(app).toBeDefined();
  }, 120_000);
});
