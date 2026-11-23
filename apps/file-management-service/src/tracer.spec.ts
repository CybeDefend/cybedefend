import {
  context,
  diag,
  metrics,
  propagation,
  SpanKind,
  trace,
} from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-base';
import {
  buildSpanProcessor,
  GRPC_HEALTH_CHECK_SPAN,
  installSdkDiagnostics,
  routeSdkDiagnostics,
  sdkOptions,
} from './tracer';

describe('gRPC health checks: one span a minute, a heartbeat', () => {
  const t0 = Date.UTC(2026, 9, 9, 12, 0, 0);
  const chain = () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [buildSpanProcessor(exporter)],
    });
    return { exporter, provider, tracer: provider.getTracer('spec') };
  };
  const endedAt = (span: { endTime: [number, number] }) =>
    span.endTime[0] * 1000 + span.endTime[1] / 1e6 - t0;

  it('exports at most one Health/Check server span per minute', async () => {
    const { exporter, provider, tracer } = chain();
    for (const offset of [
      0, 2_000, 30_000, 59_999, 60_000, 61_000, 119_000, 125_000,
    ]) {
      tracer
        .startSpan(GRPC_HEALTH_CHECK_SPAN, {
          kind: SpanKind.SERVER,
          startTime: t0 + offset,
        })
        .end(t0 + offset);
    }
    await provider.forceFlush();

    // 43 200 checks per pod and per day become 1 440: enough for the
    // a liveness alert, nothing more.
    expect(exporter.getFinishedSpans().map(endedAt)).toEqual([
      0, 60_000, 125_000,
    ]);
  });

  it('never holds back any other span', async () => {
    const { exporter, provider, tracer } = chain();
    const others: Array<[string, SpanKind]> = [
      // Permify's Check: same method name, another service.
      ['grpc.base.v1.Permission/Check', SpanKind.CLIENT],
      ['grpc.base.v1.Permission/Check', SpanKind.SERVER],
      [GRPC_HEALTH_CHECK_SPAN, SpanKind.CLIENT],
      [
        'grpc.cybedefend.file_management.FileService/RequestDiffScanUploadUrl',
        SpanKind.SERVER,
      ],
    ];
    for (let second = 0; second < 5; second += 1) {
      const at = t0 + second * 1_000;
      tracer
        .startSpan(GRPC_HEALTH_CHECK_SPAN, {
          kind: SpanKind.SERVER,
          startTime: at,
        })
        .end(at);
      for (const [name, kind] of others) {
        tracer.startSpan(name, { kind, startTime: at }).end(at);
      }
    }
    await provider.forceFlush();

    const exported = exporter.getFinishedSpans();
    for (const [name, kind] of others) {
      expect(
        exported.filter((s) => s.name === name && s.kind === kind),
      ).toHaveLength(5);
    }
    expect(
      exported.filter(
        (s) => s.name === GRPC_HEALTH_CHECK_SPAN && s.kind === SpanKind.SERVER,
      ),
    ).toHaveLength(1);
  });
});

describe('SDK diagnostics', () => {
  afterEach(() => diag.disable());

  it('reports dropped spans and failed exports, nothing below WARN', () => {
    const sink = { warn: jest.fn(), error: jest.fn() };
    installSdkDiagnostics();
    routeSdkDiagnostics(sink);

    diag.warn('Dropped 3 spans because maxQueueSize reached');
    diag.error('export failed');
    diag.info('exporting');
    diag.debug('noise');

    expect(sink.warn).toHaveBeenCalledWith(
      '[otel] Dropped 3 spans because maxQueueSize reached',
    );
    expect(sink.error).toHaveBeenCalledWith('[otel] export failed');
    expect(sink.warn).toHaveBeenCalledTimes(1);
    expect(sink.error).toHaveBeenCalledTimes(1);
  });
});

describe('the SDK exports traces only', () => {
  const resetOtelGlobals = () => {
    trace.disable();
    context.disable();
    propagation.disable();
    metrics.disable();
    diag.disable();
  };

  it('sends no metric to a collector answering 401, so the diag logs no error', async () => {
    const requests: string[] = [];
    const collector = createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      req.resume();
      res.writeHead(401).end();
    });
    await new Promise<void>((done) => collector.listen(0, '127.0.0.1', done));
    const { port } = collector.address() as AddressInfo;
    const savedEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${port}`;
    const realSetTimeout = setTimeout;
    const sink = { warn: jest.fn(), error: jest.fn() };
    resetOtelGlobals();
    installSdkDiagnostics();
    routeSdkDiagnostics(sink);
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
    const sdk = new NodeSDK({
      ...sdkOptions(new InMemorySpanExporter()),
      autoDetectResources: false,
    });
    try {
      sdk.start();
      // What the http instrumentation records on every request in production.
      metrics.getMeter('spec').createCounter('spec.requests').add(1);
      // NodeSDK's default metric reader exports every 60 s. Outside Jest the
      // collector answers 401 (no ingest token); under Jest the exporter fails
      // even before sending (dynamic import), through the same diag.error.
      await jest.advanceTimersByTimeAsync(61_000);
      await new Promise((done) => realSetTimeout(done, 500));
    } finally {
      jest.useRealTimers();
      await sdk.shutdown();
      collector.closeAllConnections();
      await new Promise<void>((done) => collector.close(() => done()));
      if (savedEndpoint === undefined) {
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      } else {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = savedEndpoint;
      }
      resetOtelGlobals();
    }

    // Inert under Jest: the default exporter fails before sending (see above),
    // so no request can arrive either way. Kept for a run outside Jest, where
    // the 401 is what it would catch; the diag assertion below is the one
    // that fails here.
    expect(requests).toEqual([]);
    expect(sink.error).not.toHaveBeenCalled();
  });

  it('builds no metric reader nor log pipeline (logs go through pino)', () => {
    expect(sdkOptions(new InMemorySpanExporter())).toMatchObject({
      metricReaders: [],
      logRecordProcessors: [],
    });
  });
});
