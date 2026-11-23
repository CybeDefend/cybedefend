import { readFileSync } from 'fs';
import { join } from 'path';
import { Readable, finished } from 'stream';
import { createGzip, gzipSync } from 'zlib';
import {
  ImportError,
  SARIF_IMPORT_LIMITS,
  SarifLimits,
  SarifSource,
} from './import-limits';
import { forEachSarifResult, readSarifHeaders } from './sarif-stream';

const FIXTURES = join(__dirname, '../../../../../../libs/test-fixtures/sarif');

const fixture = (name: string): Buffer => readFileSync(join(FIXTURES, name));

const sourceOf =
  (buf: Buffer): SarifSource =>
  async () =>
    Readable.from([buf]);

const chunkedSource =
  (chunks: Buffer[]): SarifSource =>
  async () =>
    Readable.from(chunks);

const codeOf = async (p: Promise<unknown>): Promise<string | null> => {
  try {
    await p;
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(ImportError);
    return (err as ImportError).code;
  }
};

/** Splits generated parts into 64 KiB chunks; never one big string. */
const toChunks = (parts: string[], chunkSize = 64 * 1024): Buffer[] => {
  const chunks: Buffer[] = [];
  let pending = '';
  for (const part of parts) {
    pending += part;
    while (pending.length >= chunkSize) {
      chunks.push(Buffer.from(pending.slice(0, chunkSize)));
      pending = pending.slice(chunkSize);
    }
  }
  if (pending.length > 0) chunks.push(Buffer.from(pending));
  return chunks;
};

const MB = 1024 * 1024;

/**
 * A generated SARIF file with `count` results in one run, followed by
 * `paddingBytes` of whitespace inside `runs[0].properties`.
 */
const resultsFile = (
  count: number,
  paddingBytes = 0,
): { chunks: Buffer[]; total: number } => {
  const parts: string[] = [
    '{"version":"2.1.0","runs":[{"tool":{"driver":{"name":"gen-tool"}},"results":[',
  ];
  const one =
    '{"ruleId":"gen-rule","level":"warning","message":{"text":"generated result"}}';
  for (let i = 0; i < count; i += 1) {
    parts.push(i === count - 1 ? one : `${one},`);
  }
  parts.push('],"properties":{');
  for (let i = 0; i < paddingBytes; i += MB) {
    parts.push(' '.repeat(Math.min(MB, paddingBytes - i)));
  }
  parts.push('}}]}');
  const chunks = toChunks(parts);
  return { chunks, total: chunks.reduce((n, c) => n + c.length, 0) };
};

describe('sarif stream reader', () => {
  it('reads the run headers of minimal.sarif', async () => {
    const headers = await readSarifHeaders(sourceOf(fixture('minimal.sarif')));
    expect(headers).toHaveLength(1);
    expect(headers[0].index).toBe(0);
    expect(headers[0].tool.driver.name).toBe('Semgrep');
    expect(headers[0].resultCount).toBe(2);
    expect(headers[0].originalUriBaseIds).toEqual({});
    expect(headers[0].artifacts).toEqual([]);
  });

  it('reads run.properties.imageID into the header and nothing else of run.properties', async () => {
    const headers = await readSarifHeaders(
      sourceOf(fixture('trivy-image.sarif')),
    );
    expect(headers).toHaveLength(1);
    expect(headers[0].imageId).toBe(
      'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    );
    // nothing else of run.properties reaches the header
    expect(Object.keys(headers[0]).sort()).toEqual([
      'artifacts',
      'imageId',
      'index',
      'originalUriBaseIds',
      'resultCount',
      'tool',
    ]);
    expect(JSON.stringify(headers[0])).not.toContain('repoTags');
    expect(JSON.stringify(headers[0])).not.toContain('imageName');

    // a run without it, an imageID that is not a string, or one nested
    // deeper: no imageId
    const without = await readSarifHeaders(sourceOf(fixture('minimal.sarif')));
    expect(without[0].imageId).toBeUndefined();
    const odd = await readSarifHeaders(
      sourceOf(
        Buffer.from(
          JSON.stringify({
            version: '2.1.0',
            runs: [
              { tool: { driver: { name: 'a' } }, properties: { imageID: 42 } },
              {
                tool: { driver: { name: 'b' } },
                properties: { nested: { imageID: 'sha256:nested' } },
              },
              {
                tool: { driver: { name: 'c' } },
                results: [{ properties: { imageID: 'sha256:result' } }],
              },
            ],
          }),
        ),
      ),
    );
    expect(odd.map((h) => h.imageId)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('reads originalUriBaseIds of uri-base-id.sarif', async () => {
    const headers = await readSarifHeaders(
      sourceOf(fixture('uri-base-id.sarif')),
    );
    expect(headers).toHaveLength(1);
    expect(headers[0].originalUriBaseIds).toEqual({
      SRCROOT: { uri: 'file:///home/runner/work/app/app/' },
      WEB: { uri: 'web/', uriBaseId: 'SRCROOT' },
    });
    expect(headers[0].resultCount).toBe(4);
  });

  it('reads a gzip file the same as the plain one', async () => {
    const plain = await readSarifHeaders(sourceOf(fixture('minimal.sarif')));
    const gzipped = await readSarifHeaders(
      sourceOf(fixture('minimal.sarif.gz')),
    );
    expect(gzipped).toEqual(plain);
  });

  it('ignores a UTF-8 BOM', async () => {
    const headers = await readSarifHeaders(sourceOf(fixture('bom.sarif')));
    expect(headers).toHaveLength(1);
    expect(headers[0].tool.driver.name).toBe('Semgrep');
    expect(headers[0].resultCount).toBe(1);
  });

  it('accepts an empty runs array', async () => {
    const headers = await readSarifHeaders(
      chunkedSource(toChunks(['{"version":"2.1.0","runs":[]}'])),
    );
    expect(headers).toEqual([]);
  });

  it('refuses a malformed file with IMPORT_INVALID_SARIF', async () => {
    expect(
      await codeOf(readSarifHeaders(sourceOf(fixture('malformed.sarif')))),
    ).toBe('IMPORT_INVALID_SARIF');
  });

  it('refuses a root without runs with IMPORT_INVALID_SARIF', async () => {
    expect(
      await codeOf(readSarifHeaders(sourceOf(fixture('not-sarif.json')))),
    ).toBe('IMPORT_INVALID_SARIF');
  });

  it('accepts a result nested 64 levels deep', async () => {
    // root (1) > runs (2) > run (3) > results (4) > result (5) > 59 nested
    // arrays (the properties value and 58 inside it): 64 open values.
    const nested = '['.repeat(59) + ']'.repeat(59);
    const body = `{"runs":[{"tool":{"driver":{}},"results":[{"properties":${nested}}]}]}`;
    const headers = await readSarifHeaders(chunkedSource(toChunks([body])));
    expect(headers[0].resultCount).toBe(1);
  });

  it('refuses a file nested deeper than 64 levels with IMPORT_INVALID_SARIF', async () => {
    const nested = '['.repeat(60) + ']'.repeat(60);
    const body = `{"runs":[{"tool":{"driver":{}},"results":[{"properties":${nested}}]}]}`;
    expect(
      await codeOf(readSarifHeaders(chunkedSource(toChunks([body])))),
    ).toBe('IMPORT_INVALID_SARIF');
  });

  it('refuses 40,000 nested arrays fast, on both passes', async () => {
    // Each open value used to rebuild the whole path: quadratic in the depth
    // (seconds at this size, hours on a small gzip of brackets).
    const depth = 40_000;
    const body = `{"runs":[{"tool":{"driver":{}},"x":${'['.repeat(depth)}${']'.repeat(depth)}}]}`;
    const source = chunkedSource(toChunks([body]));
    const started = Date.now();
    expect(await codeOf(readSarifHeaders(source))).toBe('IMPORT_INVALID_SARIF');
    expect(
      await codeOf(forEachSarifResult(source, async () => undefined)),
    ).toBe('IMPORT_INVALID_SARIF');
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('refuses 21 runs with IMPORT_TOO_MANY_RUNS', async () => {
    expect(
      await codeOf(readSarifHeaders(sourceOf(fixture('too-many-runs.sarif')))),
    ).toBe('IMPORT_TOO_MANY_RUNS');
  });

  it('accepts 20 runs', async () => {
    const headers = await readSarifHeaders(
      sourceOf(fixture('twenty-runs.sarif')),
    );
    expect(headers).toHaveLength(20);
    expect(headers[19].tool.driver.name).toBe('tool-20');
  });

  it('refuses 100,001 results with IMPORT_TOO_MANY_RESULTS before reading the end', async () => {
    const { chunks, total } = resultsFile(100_001, 50 * MB);
    let bytes = 0;
    const source: SarifSource = async () => {
      let i = 0;
      return new Readable({
        read() {
          if (i >= chunks.length) {
            this.push(null);
            return;
          }
          const chunk = chunks[i];
          i += 1;
          bytes += chunk.length;
          this.push(chunk);
        },
      });
    };
    expect(await codeOf(readSarifHeaders(source))).toBe(
      'IMPORT_TOO_MANY_RESULTS',
    );
    expect(bytes).toBeLessThan(total);
  }, 120_000);

  it('accepts exactly 100,000 results', async () => {
    const { chunks } = resultsFile(100_000);
    const headers = await readSarifHeaders(chunkedSource(chunks));
    expect(headers).toHaveLength(1);
    expect(headers[0].resultCount).toBe(100_000);
  }, 120_000);

  it('refuses more than 200 MB decoded with IMPORT_TOO_LARGE', async () => {
    const gzip = createGzip();
    const out: Buffer[] = [];
    gzip.on('data', (chunk: Buffer) => out.push(chunk));
    gzip.write('{"version":"2.1.0","runs":[]');
    for (let i = 0; i < 201; i += 1) gzip.write(' '.repeat(MB));
    gzip.write('}');
    gzip.end();
    await new Promise<void>((resolve, reject) => {
      finished(gzip, (err) => (err ? reject(err) : resolve()));
    });
    expect(await codeOf(readSarifHeaders(sourceOf(Buffer.concat(out))))).toBe(
      'IMPORT_TOO_LARGE',
    );
  }, 120_000);

  it('refuses more than 50 MB stored with IMPORT_TOO_LARGE', async () => {
    const parts = ['{"version":"2.1.0","runs":[]'];
    for (let i = 0; i < 53; i += 1) parts.push(' '.repeat(MB));
    parts.push('}');
    expect(await codeOf(readSarifHeaders(chunkedSource(toChunks(parts))))).toBe(
      'IMPORT_TOO_LARGE',
    );
  }, 120_000);

  it('hands every result to onResult in order, one at a time', async () => {
    const seen: string[] = [];
    let active = 0;
    await forEachSarifResult(
      sourceOf(fixture('multi-run.sarif')),
      async (runIndex, result) => {
        active += 1;
        expect(active).toBe(1);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        seen.push(`${runIndex}:${result.ruleId ?? ''}`);
      },
    );
    expect(seen).toEqual(['0:sql-injection', '1:sql-injection', '2:B608']);
  });

  it('keeps the heap bounded on 100,000 results', async () => {
    const { chunks } = resultsFile(100_000);
    const source = chunkedSource(chunks);
    const before = process.memoryUsage().heapUsed;
    let count = 0;
    await forEachSarifResult(source, async () => {
      count += 1;
    });
    const after = process.memoryUsage().heapUsed;
    expect(count).toBe(100_000);
    expect(after - before).toBeLessThan(150 * MB);
  }, 120_000);
});

describe('sarif stream reader: prototype keys in an imported file', () => {
  // An imported SARIF is untrusted. A `__proto__` key must stay an own
  // property of the parsed value, as with JSON.parse, never replace that
  // value's prototype nor touch Object.prototype; a `constructor` key is
  // plain data too.
  const hostile = Buffer.from(
    JSON.stringify({
      version: '2.1.0',
      runs: [
        {
          tool: { driver: { name: 'gen-tool' } },
          results: [
            {
              ruleId: 'sql-injection',
              message: { text: 'found' },
              constructor: { prototype: { polluted: 'yes' } },
            },
          ],
        },
      ],
    })
      .replace(
        '"driver":{"name":"gen-tool"}',
        '"driver":{"name":"gen-tool","__proto__":{"version":"9.9.9","polluted":"yes"}}',
      )
      .replace(
        '"ruleId":"sql-injection"',
        '"ruleId":"sql-injection","__proto__":{"level":"error","polluted":"yes"}',
      ),
  );

  const own = (o: object, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(o, key);

  it('keeps __proto__ in a result as an own key and leaves its prototype alone', async () => {
    const results: Record<string, unknown>[] = [];
    await forEachSarifResult(sourceOf(hostile), async (_run, result) => {
      results.push(result as unknown as Record<string, unknown>);
    });
    expect(results).toHaveLength(1);
    const result = results[0];
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(own(result, '__proto__')).toBe(true);
    expect(result.level).toBeUndefined();
    expect(result.polluted).toBeUndefined();
    expect(result.ruleId).toBe('sql-injection');
    expect(own(result, 'constructor')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty('polluted')).toBe(false);
  });

  it('keeps __proto__ in a run header as an own key and leaves its prototype alone', async () => {
    const [run] = await readSarifHeaders(sourceOf(hostile));
    const driver = run.tool.driver as unknown as Record<string, unknown>;
    expect(Object.getPrototypeOf(driver)).toBe(Object.prototype);
    expect(own(driver, '__proto__')).toBe(true);
    expect(driver.name).toBe('gen-tool');
    expect(driver.version).toBeUndefined();
    expect(driver.polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('sarif stream reader: bounded memory on hostile input', () => {
  /**
   * Gzips `head`, `body` repeated `times`, then `tail`, without ever holding
   * the expanded document: a small stored file that expands to `times`
   * copies of `body`.
   */
  const gzipOf = async (
    head: string,
    body: string,
    times: number,
    tail: string,
  ): Promise<Buffer> => {
    const gzip = createGzip({ level: 9 });
    const out: Buffer[] = [];
    gzip.on('data', (chunk: Buffer) => out.push(chunk));
    const perChunk = Math.max(1, Math.floor(MB / body.length));
    const block = body.repeat(perChunk);
    gzip.write(head);
    let left = times;
    while (left >= perChunk) {
      if (!gzip.write(block)) {
        await new Promise((resolve) => gzip.once('drain', resolve));
      }
      left -= perChunk;
    }
    gzip.write(body.repeat(left));
    gzip.end(tail);
    await new Promise<void>((resolve, reject) => {
      finished(gzip, (err) => (err ? reject(err) : resolve()));
    });
    return Buffer.concat(out);
  };

  /** Runs `work` and reports the highest heap it saw, sampled every 5 ms. */
  const peakHeapOf = async (
    work: () => Promise<unknown>,
  ): Promise<{ code: string | null; peak: number }> => {
    const base = process.memoryUsage().heapUsed;
    let peak = 0;
    const timer = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().heapUsed - base);
    }, 5);
    try {
      return { code: await codeOf(work()), peak };
    } finally {
      clearInterval(timer);
    }
  };

  const limits = (over: Partial<SarifLimits>): SarifLimits => ({
    ...SARIF_IMPORT_LIMITS,
    ...over,
  });

  it('refuses a gzip bomb of empty rules with IMPORT_TOO_LARGE, heap bounded', async () => {
    // About 180 MB of `{},` once expanded, a few hundred KB stored.
    const bomb = await gzipOf(
      '{"version":"2.1.0","runs":[{"tool":{"driver":{"name":"x","rules":[',
      '{},',
      60_000_000,
      '{}]}},"results":[]}]}',
    );
    expect(bomb.length).toBeLessThan(SARIF_IMPORT_LIMITS.maxUploadedBytes);
    const { code, peak } = await peakHeapOf(() =>
      readSarifHeaders(sourceOf(bomb)),
    );
    expect(code).toBe('IMPORT_TOO_LARGE');
    expect(peak).toBeLessThan(200 * MB);
  }, 120_000);

  it('refuses more rules in one run than the limit', async () => {
    const file = Buffer.from(
      JSON.stringify({
        version: '2.1.0',
        runs: [
          {
            tool: {
              driver: { name: 'x', rules: [{ id: 'a' }, { id: 'b' }] },
              extensions: [{ name: 'y', rules: [{ id: 'c' }] }],
            },
            results: [],
          },
        ],
      }),
    );
    expect(
      await codeOf(
        readSarifHeaders(sourceOf(file), limits({ maxRulesPerRun: 2 })),
      ),
    ).toBe('IMPORT_TOO_LARGE');
    expect(
      await codeOf(
        readSarifHeaders(sourceOf(file), limits({ maxRulesPerRun: 3 })),
      ),
    ).toBeNull();
  });

  it('refuses more artifacts in one run than the limit', async () => {
    const file = Buffer.from(
      JSON.stringify({
        version: '2.1.0',
        runs: [
          {
            tool: { driver: { name: 'x' } },
            artifacts: [
              { location: { uri: 'a' } },
              { location: { uri: 'b' } },
              { location: { uri: 'c' } },
            ],
            results: [],
          },
        ],
      }),
    );
    expect(
      await codeOf(
        readSarifHeaders(sourceOf(file), limits({ maxArtifactsPerRun: 2 })),
      ),
    ).toBe('IMPORT_TOO_LARGE');
    const [run] = await readSarifHeaders(
      sourceOf(file),
      limits({ maxArtifactsPerRun: 3 }),
    );
    expect(run.artifacts).toHaveLength(3);
  });

  it('refuses run headers holding more values than the limit', async () => {
    // One rule only, but a property bag of many values.
    const file = Buffer.from(
      JSON.stringify({
        version: '2.1.0',
        runs: [
          {
            tool: {
              driver: {
                name: 'x',
                rules: [{ id: 'a', properties: { v: new Array(50).fill(1) } }],
              },
            },
            results: [],
          },
        ],
      }),
    );
    expect(
      await codeOf(
        readSarifHeaders(sourceOf(file), limits({ maxHeaderValues: 40 })),
      ),
    ).toBe('IMPORT_TOO_LARGE');
    expect(
      await codeOf(
        readSarifHeaders(sourceOf(file), limits({ maxHeaderValues: 100 })),
      ),
    ).toBeNull();
  });

  it('refuses run headers holding more text than the limit', async () => {
    const file = Buffer.from(
      JSON.stringify({
        version: '2.1.0',
        runs: [
          {
            tool: {
              driver: {
                name: 'x',
                rules: [{ id: 'a', help: { markdown: 'm'.repeat(5000) } }],
              },
            },
            results: [],
          },
        ],
      }),
    );
    expect(
      await codeOf(
        readSarifHeaders(sourceOf(file), limits({ maxHeaderChars: 4000 })),
      ),
    ).toBe('IMPORT_TOO_LARGE');
    expect(
      await codeOf(
        readSarifHeaders(sourceOf(file), limits({ maxHeaderChars: 6000 })),
      ),
    ).toBeNull();
  });

  const oneResult = (result: Record<string, unknown>): Buffer =>
    Buffer.from(
      JSON.stringify({
        version: '2.1.0',
        runs: [{ tool: { driver: { name: 'x' } }, results: [result] }],
      }),
    );

  it('refuses one result holding more values than the limit', async () => {
    const file = oneResult({
      ruleId: 'r',
      properties: { v: new Array(200).fill(1) },
    });
    const noop = async (): Promise<void> => undefined;
    expect(
      await codeOf(
        forEachSarifResult(
          sourceOf(file),
          noop,
          limits({ maxValuesPerResult: 100 }),
        ),
      ),
    ).toBe('IMPORT_TOO_LARGE');
    expect(
      await codeOf(
        forEachSarifResult(
          sourceOf(file),
          noop,
          limits({ maxValuesPerResult: 1000 }),
        ),
      ),
    ).toBeNull();
  });

  it('refuses one result holding more text than the limit', async () => {
    const file = oneResult({
      ruleId: 'r',
      message: { text: 't'.repeat(5000) },
    });
    const noop = async (): Promise<void> => undefined;
    expect(
      await codeOf(
        forEachSarifResult(
          sourceOf(file),
          noop,
          limits({ maxCharsPerResult: 4000 }),
        ),
      ),
    ).toBe('IMPORT_TOO_LARGE');
    expect(
      await codeOf(
        forEachSarifResult(
          sourceOf(file),
          noop,
          limits({ maxCharsPerResult: 6000 }),
        ),
      ),
    ).toBeNull();
  });

  it('refuses a gzip bomb inside one result with IMPORT_TOO_LARGE, heap bounded', async () => {
    // One result whose property bag expands to about 120 MB of numbers.
    const bomb = await gzipOf(
      '{"version":"2.1.0","runs":[{"tool":{"driver":{"name":"x"}},"results":[{"ruleId":"r","properties":{"v":[',
      '1,',
      60_000_000,
      '1]}}]}]}',
    );
    const { code, peak } = await peakHeapOf(() =>
      forEachSarifResult(sourceOf(bomb), async () => undefined),
    );
    expect(code).toBe('IMPORT_TOO_LARGE');
    expect(peak).toBeLessThan(200 * MB);
  }, 120_000);

  it('still imports a legitimate 20-run file near the header limits', async () => {
    // A merged report of 20 runs, each a full rule pack of 1,000 documented
    // rules (about 5,000 characters of help each) and 5,000 artifacts: about
    // 100 M characters and a million values in the run headers, all runs
    // together, well under the decompressed-size limit.
    const help = 'Explains the issue and how to fix it. '.repeat(130);
    const runOf = (r: number): string => {
      const rules = Array.from({ length: 1_000 }, (_, i) => ({
        id: `pack-${r}.lang.rule-${i}`,
        name: `Rule ${i}`,
        shortDescription: { text: `Rule ${i} of pack ${r}` },
        help: { text: 'help', markdown: help },
        properties: { tags: ['security', 'CWE-89'], precision: 'high' },
      }));
      const artifacts = Array.from({ length: 5_000 }, (_, i) => ({
        location: { uri: `pkg-${r}/src/file-${i}.ts` },
      }));
      return JSON.stringify({
        tool: { driver: { name: `tool-${r}`, rules } },
        artifacts,
        results: [
          { ruleId: `pack-${r}.lang.rule-0`, message: { text: 'found' } },
        ],
      });
    };
    const chunks: Buffer[] = [Buffer.from('{"version":"2.1.0","runs":[')];
    for (let r = 0; r < 20; r += 1) {
      chunks.push(Buffer.from(`${r === 0 ? '' : ','}${runOf(r)}`));
    }
    chunks.push(Buffer.from(']}'));
    const total = chunks.reduce((n, c) => n + c.length, 0);
    expect(total).toBeLessThan(SARIF_IMPORT_LIMITS.maxDecompressedBytes);

    // Over 50 MB as plain JSON: such a file is sent gzipped.
    const stored = gzipSync(Buffer.concat(chunks));
    expect(stored.length).toBeLessThan(SARIF_IMPORT_LIMITS.maxUploadedBytes);

    const runs = await readSarifHeaders(sourceOf(stored));
    expect(runs).toHaveLength(20);
    expect(runs[19].tool.driver.rules).toHaveLength(1_000);
    expect(runs[19].artifacts).toHaveLength(5_000);
  }, 180_000);

  it('still imports a large realistic report with the default limits', async () => {
    // 5,000 documented rules, 50,000 artifacts and 2,000 results with code
    // flows: well past real scanner output, well under every limit.
    const rules = Array.from({ length: 5_000 }, (_, i) => ({
      id: `pack.lang.rule-${i}`,
      name: `Rule ${i}`,
      shortDescription: { text: `Short description of rule ${i}` },
      fullDescription: { text: 'A longer description. '.repeat(20) },
      help: { text: 'help', markdown: '## Help\n'.repeat(200) },
      properties: { tags: ['security', 'CWE-89'], precision: 'high' },
    }));
    const artifacts = Array.from({ length: 50_000 }, (_, i) => ({
      location: { uri: `src/module-${i % 100}/file-${i}.ts` },
    }));
    const step = (i: number): Record<string, unknown> => ({
      location: {
        physicalLocation: {
          artifactLocation: { uri: `src/file-${i}.ts` },
          region: { startLine: i + 1, snippet: { text: 'x = y;'.repeat(20) } },
        },
        message: { text: `step ${i}` },
      },
    });
    const results = Array.from({ length: 2_000 }, (_, i) => ({
      ruleId: `pack.lang.rule-${i % 5_000}`,
      level: 'error',
      message: { text: 'Untrusted data reaches a sink. '.repeat(10) },
      locations: [step(i)],
      codeFlows: [
        {
          threadFlows: [
            { locations: Array.from({ length: 40 }, (_, j) => step(j)) },
          ],
        },
      ],
    }));
    const file = Buffer.from(
      JSON.stringify({
        version: '2.1.0',
        runs: [{ tool: { driver: { name: 'x', rules } }, artifacts, results }],
      }),
    );
    const [run] = await readSarifHeaders(sourceOf(file));
    expect(run.tool.driver.rules).toHaveLength(5_000);
    expect(run.artifacts).toHaveLength(50_000);
    let count = 0;
    await forEachSarifResult(sourceOf(file), async () => {
      count += 1;
    });
    expect(count).toBe(2_000);
  }, 120_000);
});
