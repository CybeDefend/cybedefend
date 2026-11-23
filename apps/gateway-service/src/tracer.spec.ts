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
import type { IncomingMessage } from 'node:http';
import {
  buildInstrumentations,
  buildSpanProcessor,
  ingestTokenHeaders,
  installSdkDiagnostics,
  isHealthProbe,
  nameServerSpanAfterRoute,
  routeSdkDiagnostics,
  sdkOptions,
} from './tracer';
import { rememberMatchedRoute } from './core/http/route-tracing';

let mockFetcherLoaded = false;
const mockFetchOtelIngestToken = jest.fn<Promise<string | undefined>, []>();
jest.mock('./core/logger/otel-token-fetcher', () => {
  mockFetcherLoaded = true;
  return { fetchOtelIngestToken: () => mockFetchOtelIngestToken() };
});

const request = (
  url: string,
  userAgent?: string,
  method = 'GET',
): IncomingMessage =>
  ({
    url,
    method,
    headers: userAgent ? { 'user-agent': userAgent } : {},
  }) as IncomingMessage;

/** A provider exporting through the gateway's own processor chain. */
function providerWithGatewayChain() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [buildSpanProcessor(exporter)],
  });
  return { exporter, provider, tracer: provider.getTracer('spec') };
}

describe('the ingest token is resolved lazily', () => {
  beforeEach(() => mockFetchOtelIngestToken.mockReset());

  it('loads no secrets client when the tracer module is loaded', () => {
    ingestTokenHeaders();
    expect(mockFetcherLoaded).toBe(false);
    expect(mockFetchOtelIngestToken).not.toHaveBeenCalled();
  });

  it('fetches the token on the first export, once', async () => {
    mockFetchOtelIngestToken.mockResolvedValue('ingest-token');
    const headers = ingestTokenHeaders();

    expect(await headers()).toEqual({ Authorization: 'Bearer ingest-token' });
    expect(await headers()).toEqual({ Authorization: 'Bearer ingest-token' });
    expect(mockFetchOtelIngestToken).toHaveBeenCalledTimes(1);
  });

  it('sends no Authorization header when there is no token', async () => {
    mockFetchOtelIngestToken.mockResolvedValue(undefined);
    expect(await ingestTokenHeaders()()).toEqual({});
  });
});

describe('kubelet probes are not traced', () => {
  it('ignores the kubelet probe of /', () => {
    expect(isHealthProbe(request('/', 'kube-probe/1.31'))).toBe(true);
  });

  it('traces any other caller of /', () => {
    expect(isHealthProbe(request('/', 'cybedefend-cli/1.4.0'))).toBe(false);
    expect(isHealthProbe(request('/projects'))).toBe(false);
  });

  // The User-Agent is the caller's to choose: anywhere but the probed request,
  // a kube-probe/ agent would hide its own AuthGuard and PermissionsGuard spans
  // from the authentication alerts.
  it('traces a kube-probe/ agent on any other path or method', () => {
    expect(isHealthProbe(request('/projects', 'kube-probe/1.31'))).toBe(false);
    expect(isHealthProbe(request('/?x=1', 'kube-probe/1.31'))).toBe(false);
    expect(isHealthProbe(request('/health', 'kube-probe/1.31'))).toBe(false);
    expect(isHealthProbe(request('/', 'kube-probe/1.31', 'POST'))).toBe(false);
  });
});

describe('HTTP span attributes', () => {
  it('names a server span after the route Fastify matched', async () => {
    const { exporter, provider, tracer } = providerWithGatewayChain();
    const req = request('/projects/42?page=2');
    rememberMatchedRoute(req, '/projects/:projectId');

    const span = tracer.startSpan('GET', { kind: SpanKind.SERVER });
    nameServerSpanAfterRoute(span, req);
    span.end();
    await provider.forceFlush();

    const [exported] = exporter.getFinishedSpans();
    expect(exported.name).toBe('GET /projects/:projectId');
    expect(exported.attributes['http.route']).toBe('/projects/:projectId');
  });

  it('leaves a span without matched route (a 404) as it is', async () => {
    const { exporter, provider, tracer } = providerWithGatewayChain();
    const span = tracer.startSpan('GET', { kind: SpanKind.SERVER });
    nameServerSpanAfterRoute(span, request('/nowhere'));
    span.end();
    await provider.forceFlush();

    const [exported] = exporter.getFinishedSpans();
    expect(exported.name).toBe('GET');
    expect(exported.attributes['http.route']).toBeUndefined();
  });

  it('exports no query string, client IP nor path secret', async () => {
    const { exporter, provider, tracer } = providerWithGatewayChain();
    tracer
      .startSpan('POST', {
        kind: SpanKind.SERVER,
        attributes: {
          'http.url':
            'http://api.local/webhooks/jira/s3cr3t?email=alice%40example.com',
          'http.target': '/webhooks/jira/s3cr3t?email=alice%40example.com',
          'url.path': '/webhooks/jira/s3cr3t',
          'url.query': 'email=alice%40example.com',
          'http.client_ip': '203.0.113.7',
          'client.address': '203.0.113.7',
          'http.method': 'POST',
        },
      })
      .end();
    tracer
      .startSpan('GET', {
        kind: SpanKind.CLIENT,
        attributes: { 'url.full': 'http://ingestion/api/v1/x?search=alice' },
      })
      .end();
    await provider.forceFlush();

    const [server, client] = exporter.getFinishedSpans();
    expect(server.attributes).toEqual({
      'http.url': 'http://api.local/webhooks/jira/[REDACTED]',
      'http.target': '/webhooks/jira/[REDACTED]',
      'url.path': '/webhooks/jira/[REDACTED]',
      'http.method': 'POST',
    });
    expect(client.attributes['url.full']).toBe('http://ingestion/api/v1/x');
  });
});

describe('instrumentations', () => {
  const instrumentations = buildInstrumentations('test');
  const named = (name: string) =>
    instrumentations.filter((i) => i.instrumentationName === name);

  it('traces HTTP, gRPC and Redis', () => {
    for (const name of ['http', 'grpc', 'ioredis']) {
      expect(named(`@opentelemetry/instrumentation-${name}`)).toHaveLength(1);
    }
  });

  it('skips nestjs-core (it doubles the @Span() of every controller), net and dns', () => {
    for (const name of ['nestjs-core', 'net', 'dns']) {
      expect(named(`@opentelemetry/instrumentation-${name}`)).toEqual([]);
    }
  });

  it('keeps the Redis keys (client IPs, user ids) out of db.statement', () => {
    const [ioredis] = named('@opentelemetry/instrumentation-ioredis');
    const { dbStatementSerializer } = ioredis.getConfig() as {
      dbStatementSerializer: (command: string, args: unknown[]) => string;
    };
    expect(
      dbStatementSerializer('incr', ['rl:count:gateway:ip:203.0.113.7']),
    ).toBe('incr');
  });

  it('patches pino once, without a second log pipeline', () => {
    const pino = named('@opentelemetry/instrumentation-pino');
    expect(pino).toHaveLength(1);
    expect(pino[0].getConfig()).toMatchObject({ disableLogSending: true });
  });
});

describe('SDK diagnostics (dropped spans, failed exports)', () => {
  afterEach(() => diag.disable());

  it('reports warnings and errors, nothing below', () => {
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
      // What the http instrumentation records on every request.
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
