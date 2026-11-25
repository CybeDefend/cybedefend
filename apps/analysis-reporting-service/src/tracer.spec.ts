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
  SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import {
  buildInstrumentations,
  buildSpanProcessor,
  GRPC_HEALTH_CHECK_SPAN,
  installSdkDiagnostics,
  routeSdkDiagnostics,
  sdkOptions,
} from './tracer';

/**
 * Regression guard for the worker `MaxListenersExceededWarning`.
 *
 * `@opentelemetry/instrumentation-express` patches every Express layer's
 * `handle` and attaches a `res.once('finish', …)` listener per async layer a
 * request traverses. A NestJS request flows through >10 layers, so each traced
 * request piled >10 `finish` listeners onto a single ServerResponse and tripped
 * Node's 10-listener heuristic on the worker (the only entrypoint that serves an
 * Express HTTP app — for the internal KEDA `/internal/queue-metrics` endpoint).
 *
 * The fix disables express instrumentation, which has no value in this service
 * (main is gRPC, crons are application-contexts, the worker's only route is an
 * internal metrics endpoint we don't want traced).
 */
describe('tracer buildInstrumentations', () => {
  const names = () => buildInstrumentations().map((i) => i.instrumentationName);

  it('disables @opentelemetry/instrumentation-express (avoids per-layer finish-listener pileup)', () => {
    expect(names()).not.toContain('@opentelemetry/instrumentation-express');
  });

  it('keeps @opentelemetry/instrumentation-http enabled (outbound call tracing)', () => {
    expect(names()).toContain('@opentelemetry/instrumentation-http');
  });
});

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

    // 43 200 checks per pod and per day become 1 440: enough for an alert
    // on a service that stopped sending telemetry, nothing more.
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
        'grpc.cybedefend.analysis_reporting.ResultService/GetVulnerabilitiesCount',
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

describe('span losses are reported', () => {
  const saved = {
    queue: process.env.OTEL_BSP_MAX_QUEUE_SIZE,
    batch: process.env.OTEL_BSP_MAX_EXPORT_BATCH_SIZE,
  };
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  afterEach(() => {
    restore('OTEL_BSP_MAX_QUEUE_SIZE', saved.queue);
    restore('OTEL_BSP_MAX_EXPORT_BATCH_SIZE', saved.batch);
    diag.disable();
  });

  it('drops past OTEL_BSP_MAX_QUEUE_SIZE and says how many, at WARN', async () => {
    process.env.OTEL_BSP_MAX_QUEUE_SIZE = '2';
    process.env.OTEL_BSP_MAX_EXPORT_BATCH_SIZE = '1';
    const sink = { warn: jest.fn(), error: jest.fn() };
    installSdkDiagnostics();
    routeSdkDiagnostics(sink);

    // An export that hangs, as a slow collector does: the queue fills behind it.
    const exported: string[] = [];
    let release: (() => void) | undefined;
    const exporter: SpanExporter = {
      export: (batch, done) => {
        exported.push(...batch.map((s) => s.name));
        if (release) done({ code: 0 });
        else release = () => done({ code: 0 });
      },
      shutdown: async () => undefined,
    };
    const provider = new BasicTracerProvider({
      spanProcessors: [buildSpanProcessor(exporter)],
    });
    const tracer = provider.getTracer('spec');

    for (let i = 0; i < 6; i += 1) tracer.startSpan(`span-${i}`).end();
    release?.();
    await new Promise((r) => setTimeout(r, 20));
    tracer.startSpan('after').end();
    await provider.forceFlush();

    // One in flight, two queued (the size read from the environment), three lost.
    expect(exported).toEqual(['span-0', 'span-1', 'span-2', 'after']);
    expect(sink.warn).toHaveBeenCalledWith(
      '[otel] Dropped 3 spans because maxQueueSize reached',
    );
  });

  it('reports errors too, and nothing below WARN', () => {
    const sink = { warn: jest.fn(), error: jest.fn() };
    installSdkDiagnostics();
    routeSdkDiagnostics(sink);

    diag.error('export failed');
    diag.info('exporting');
    diag.debug('noise');

    expect(sink.error).toHaveBeenCalledWith('[otel] export failed');
    expect(sink.warn).not.toHaveBeenCalled();
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

describe('a failed statement’s span leaves without its values', () => {
  it('scrubs the exception, the status and the statement before export', async () => {
    const email = 'jane.doe+private@example.test';
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [buildSpanProcessor(exporter)],
    });
    const error = new Error(
      `Duplicate entry '${email}' for key 'user.IDX_user_email_unique'`,
    );

    const span = provider.getTracer('spec').startSpan('mysql INSERT');
    span.setAttribute(
      'db.statement',
      `INSERT INTO \`user\` (\`email\`) VALUES ('${email}')`,
    );
    span.recordException(error);
    span.setStatus({ code: 2, message: error.message });
    span.end();
    await provider.forceFlush();

    const [exported] = exporter.getFinishedSpans();
    expect(
      JSON.stringify({
        attributes: exported.attributes,
        status: exported.status,
        events: exported.events,
      }),
    ).not.toContain(email);
  });
});
