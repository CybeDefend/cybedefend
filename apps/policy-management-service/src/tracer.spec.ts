import {
  context,
  diag,
  DiagLogLevel,
  metrics,
  propagation,
  trace,
} from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildSpanProcessor, sdkOptions } from './tracer';

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
    const errors: string[] = [];
    resetOtelGlobals();
    diag.setLogger(
      {
        error: (message) => void errors.push(message),
        warn: () => undefined,
        info: () => undefined,
        debug: () => undefined,
        verbose: () => undefined,
      },
      DiagLogLevel.WARN,
    );
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
    const sdk = new NodeSDK({
      ...sdkOptions(new SimpleSpanProcessor(new InMemorySpanExporter())),
      autoDetectResources: false,
    });
    try {
      sdk.start();
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
    expect(errors).toEqual([]);
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
