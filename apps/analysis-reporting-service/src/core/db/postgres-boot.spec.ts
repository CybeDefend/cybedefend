import { Test } from '@nestjs/testing';
import type { Type } from '@nestjs/common';

/**
 * The postgres twin of src/edition/community-boot.spec.ts: the same contexts
 * and the same BOOT_ENV, plus DB_TYPE=postgres. The modules are imported
 * dynamically in the test, after beforeAll set the environment, because
 * ConfigModule.forRoot validates at import time and @cybedefend/db-dialect
 * reads DB_TYPE at import time. Preview mode opens no connection.
 */
const BOOT_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  GRPC_URL_ANALYSIS_REPORTING_SERVICE: '127.0.0.1:1',
  GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:1',
  GRPC_URL_GLOBAL_MANAGEMENT_SERVICE: '127.0.0.1:1',
  GRPC_URL_AGENT_SERVICE: '127.0.0.1:1',
  GRPC_URL_BILLING_SERVICE: '127.0.0.1:1',
  REDIS_URL: 'redis://127.0.0.1:1',
  OTEL_DISABLED: 'true',
  CYBEDEFEND_EDITION: 'community',
  DB_TYPE: 'postgres',
};

// The Community contexts only: cron-osv, cron-epss and the autofix worker are
// cloud-only (src/ee/) and refused on postgres (DB_CONTEXT_MYSQL_ONLY).
const CONTEXTS: Array<[string, () => Promise<Record<string, unknown>>]> = [
  ['AppModule', () => import('../../app.module')],
  ['WorkerModule', () => import('../../worker.module')],
  ['WorkerReportsModule', () => import('../../worker-reports.module')],
  ['ReportMailCronModule', () => import('../../report.mail.cron.module')],
  [
    'ReportRetentionCronModule',
    () => import('../../report-retention.cron.module'),
  ],
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
