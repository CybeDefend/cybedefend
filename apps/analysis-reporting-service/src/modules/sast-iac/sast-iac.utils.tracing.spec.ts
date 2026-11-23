import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { Span } from 'nestjs-otel';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { SastIacUtilsService } from './sast-iac.utils';

/**
 * `areVulnsSimilar` is a pure comparison, called in the nested
 * loops of the line-shift repair (per pair of candidates), and its `@Span()`
 * made it the largest span producer of the platform: 17.4 M spans in 14 days.
 */
class Probe {
  @Span()
  async traced(): Promise<boolean> {
    return true;
  }
}

describe('SastIacUtilsService.areVulnsSimilar tracing', () => {
  const exporter = new InMemorySpanExporter();

  beforeAll(() => {
    trace.setGlobalTracerProvider(
      new BasicTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      }),
    );
  });
  afterAll(() => trace.disable());
  beforeEach(() => exporter.reset());

  it('captures a @Span() method here (control)', async () => {
    await new Probe().traced();
    expect(exporter.getFinishedSpans().map((s) => s.name)).toEqual([
      'Probe.traced',
    ]);
  });

  it('creates no span per comparison', async () => {
    // Pure method: none of the injected dependencies is touched.
    const utils = Object.create(
      SastIacUtilsService.prototype,
    ) as SastIacUtilsService;
    const detection = (id: string) =>
      Object.assign(new IacVulnerabilityDetections(), {
        id,
        path: 'charts/app/templates/deployment.yaml',
        vulnerableStartLine: 12,
        vulnerableEndLine: 12,
        vulnerability: { id: 'cat-readiness' },
        codeSnippets: [
          { code: JSON.stringify([{ line: 12, content: 'containers:' }]) },
        ],
      });

    expect(await utils.areVulnsSimilar(detection('a'), detection('b'))).toBe(
      true,
    );
    expect(exporter.getFinishedSpans()).toEqual([]);
  });
});
