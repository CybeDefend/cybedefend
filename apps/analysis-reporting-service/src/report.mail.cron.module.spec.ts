// Prevent ConfigModule.forRoot() from running Joi validation when
// report.mail.cron.module is imported. NestJS calls
// ConfigModule.forRoot({ validationSchema }) synchronously at decoration time
// (when the @Module() decorator evaluates its imports array), so in CI — where
// the secrets / gRPC / OTEL env vars are not set — the Joi schema throws before
// Jest can even run a test. Mirrors cron.osv.module.spec.ts.
jest.mock('@nestjs/config', () => ({
  ConfigModule: {
    forRoot: jest.fn().mockReturnValue({ module: class MockConfigModule {} }),
  },
  ConfigService: jest.fn(),
}));

// This is a metadata-only assertion (we read ReportMailCronModule's `imports`
// array, never boot it), so stub the heavy transitive graph that ts-jest /
// jest module-resolution cannot load: ResultModule / ScanQueueModule pull in
// @grpc/grpc.module (unmapped in this service's jest config) plus a large
// provider tree. Stubbing them does NOT affect what ReportMailCronModule
// declares in its OWN imports — the only thing under test
// (RealtimePublisherModule, which stays unmocked).
jest.mock(
  '@grpc/grpc.module',
  () => ({
    GrpcModule: { register: () => ({ module: class GrpcModule {} }) },
  }),
  { virtual: true },
);
jest.mock('./modules/result/result.module', () => ({
  ResultModule: class ResultModule {},
}));
jest.mock('./modules/scan-queue/scan-queue.module', () => ({
  ScanQueueModule: class ScanQueueModule {},
}));

describe('ReportMailCronModule', () => {
  let ReportMailCronModule: any;
  let RealtimePublisherModule: any;

  beforeAll(async () => {
    ({ ReportMailCronModule } = await import('./report.mail.cron.module'));
    ({ RealtimePublisherModule } =
      await import('@cybedefend/realtime-publisher'));
  });

  // Regression guard for the boot crash:
  //   UnknownDependenciesException: Nest can't resolve dependencies of the
  //   AggregatedReportsService (..., ?). RealtimeEventPublisher at index [5]
  //   is not available in the AggregatedReportsModule module.
  // ReportMailCronModule imports forwardRef(() => ResultModule) -> ResultModule
  // imports AggregatedReportsModule, whose AggregatedReportsService injects a
  // NON-optional RealtimeEventPublisher. That token is exported by the GLOBAL
  // RealtimePublisherModule, which must be registered once at the entrypoint
  // (as app.module / worker.module / cron.osv.module already do).
  it('registers the global RealtimePublisherModule so AggregatedReportsService can resolve RealtimeEventPublisher at bootstrap', () => {
    const imports = Reflect.getMetadata('imports', ReportMailCronModule) as
      | unknown[]
      | undefined;
    expect(imports).toBeDefined();

    const hasRealtime = (imports ?? []).some(
      (m: any) =>
        m &&
        (m.module === RealtimePublisherModule || m === RealtimePublisherModule),
    );
    expect(hasRealtime).toBe(true);
  });
});
