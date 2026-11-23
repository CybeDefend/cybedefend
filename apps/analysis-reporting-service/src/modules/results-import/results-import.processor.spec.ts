import { readFileSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import type { ClientGrpc } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { of, throwError } from 'rxjs';
import type { Job } from 'bullmq';
import type {
  RuleMetadata,
  ScanAddContainerResultRequest,
  ScanAddResultRequest,
} from '@grpc/analysis-reporting/result';
import type { CompleteImportScanRequest } from '@grpc/security-scanning/scan';
import { ResultsImportProcessor } from './results-import.processor';
import { ImportError, SarifSource } from './sarif/import-limits';
import type { ImportFileSource } from './import-file.source';
import type { CatalogueFallbackService } from './catalogue-fallback.service';
import type {
  AdvisoryFallbackService,
  AdvisoryInput,
} from './advisory-fallback.service';
import type { ScaMatchedItem, ScaScanMeta } from '../sca/sca.service';
import type {
  ResultsImportJobData,
  ScanQueueService,
} from '../scan-queue/scan-queue.service';
import type { ScanCompleteNotificationService } from '../scan-queue/scan-complete-notification.service';
import type { RealtimeBatchPublisher } from '../../core/realtime/realtime-batch-publisher.service';

const FIXTURES = join(__dirname, '../../../../../libs/test-fixtures/sarif');
const fixture = (name: string): Buffer => readFileSync(join(FIXTURES, name));

const SCAN = '0193b6a8-1c2d-7e3f-8a9b-0c1d2e3f4a5b';
const PROJECT = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const KEY = `import/${PROJECT}/${SCAN}.sarif`;

const sourceOf =
  (chunks: Buffer[]): SarifSource =>
  async () =>
    Readable.from(chunks);

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

interface GenResult {
  ruleId: string;
  level?: string;
  uri?: string;
  line?: number;
}

interface GenRun {
  tool: string;
  rules?: { id: string; text?: string }[];
  results: GenResult[];
}

/** A generated SARIF file, one part per result. */
const sarifOf = (runs: GenRun[]): Buffer[] => {
  const parts: string[] = ['{"version":"2.1.0","runs":['];
  runs.forEach((run, r) => {
    const rules = (run.rules ?? []).map((rule) =>
      JSON.stringify({
        id: rule.id,
        shortDescription: { text: rule.text ?? `rule ${rule.id}` },
      }),
    );
    parts.push(
      `${r > 0 ? ',' : ''}{"tool":{"driver":{"name":${JSON.stringify(run.tool)},"rules":[${rules.join(',')}]}},"results":[`,
    );
    run.results.forEach((res, i) => {
      parts.push(
        (i > 0 ? ',' : '') +
          JSON.stringify({
            ruleId: res.ruleId,
            ...(res.level ? { level: res.level } : {}),
            message: { text: 'generated result' },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: res.uri ?? `src/file-${i}.py` },
                  region: { startLine: res.line ?? i + 1 },
                },
              },
            ],
          }),
      );
    });
    parts.push(']}');
  });
  parts.push(']}');
  return toChunks(parts);
};

const results = (count: number, ruleIds: string[] = ['gen-rule']) =>
  Array.from({ length: count }, (_, i) => ({
    ruleId: ruleIds[i % ruleIds.length],
    level: 'error',
  }));

describe('ResultsImportProcessor', () => {
  let processSastIacBatch: jest.Mock;
  let finalizeScan: jest.Mock;
  let registerScanQueueType: jest.Mock;
  let tryAcquireFinalizeLock: jest.Mock;
  let releaseFinalizeLock: jest.Mock;
  let clearBatchTracking: jest.Mock;
  let onScannerFinalized: jest.Mock;
  let publishNow: jest.Mock;
  let ensureRules: jest.Mock;
  let completeImportScan: jest.Mock;
  let open: jest.Mock;
  let delay: jest.Mock;
  let ingestMatched: jest.Mock;
  let scaFinalizeScan: jest.Mock;
  let processContainerBatch: jest.Mock;
  let containerFinalizeScan: jest.Mock;
  let ensureAdvisories: jest.Mock;
  let processor: ResultsImportProcessor;

  const jobOf = (
    data: Partial<ResultsImportJobData> = {},
  ): Job<ResultsImportJobData> =>
    ({
      id: `results-import-${SCAN}`,
      data: {
        scanId: SCAN,
        projectId: PROJECT,
        organizationId: 'org-1',
        branch: 'main',
        category: 'sast',
        format: 'sarif',
        fileKey: KEY,
        ...data,
      },
    }) as Job<ResultsImportJobData>;

  const withFile = (chunks: Buffer[]): void => {
    open.mockReturnValue(sourceOf(chunks));
  };

  const batches = (): ScanAddResultRequest[] =>
    processSastIacBatch.mock.calls.map(([req]) => req as ScanAddResultRequest);

  const completion = (): CompleteImportScanRequest =>
    completeImportScan.mock.calls[0][0] as CompleteImportScanRequest;

  // SARIF import is a Community Edition feature: every
  // case here runs there. The worker's refusal elsewhere is in a closed
  // spec.
  const ORIGINAL_EDITION = process.env.CYBEDEFEND_EDITION;
  afterEach(() => {
    if (ORIGINAL_EDITION === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = ORIGINAL_EDITION;
  });

  beforeEach(() => {
    process.env.CYBEDEFEND_EDITION = 'community';
    processSastIacBatch = jest.fn().mockResolvedValue({ success: true });
    finalizeScan = jest.fn().mockResolvedValue(undefined);
    registerScanQueueType = jest.fn().mockResolvedValue(undefined);
    tryAcquireFinalizeLock = jest.fn().mockResolvedValue(true);
    releaseFinalizeLock = jest.fn().mockResolvedValue(undefined);
    clearBatchTracking = jest.fn().mockResolvedValue(undefined);
    onScannerFinalized = jest.fn().mockResolvedValue(undefined);
    publishNow = jest.fn();
    // Every rule keeps its id unless a case says otherwise.
    ensureRules = jest.fn(
      async (_tool: string, _category: string, rules: RuleMetadata[]) =>
        new Map(rules.map((rule) => [rule.ruleId, rule.ruleId])),
    );
    completeImportScan = jest
      .fn()
      .mockReturnValue(of({ success: true, message: '' }));
    open = jest.fn();
    delay = jest.fn().mockResolvedValue(undefined);
    ingestMatched = jest.fn().mockResolvedValue([]);
    scaFinalizeScan = jest.fn().mockResolvedValue(undefined);
    processContainerBatch = jest.fn().mockResolvedValue({ success: true });
    containerFinalizeScan = jest.fn().mockResolvedValue(undefined);
    // the advisory rows, as stored: one per distinct id
    ensureAdvisories = jest.fn(async (items: AdvisoryInput[]) => {
      const map = new Map<string, { id: string }>();
      for (const item of items) map.set(item.id, { id: item.id });
      return map;
    });

    const ssClient = {
      getService: () => ({ completeImportScan }),
    } as unknown as ClientGrpc;

    processor = new ResultsImportProcessor(
      { processSastIacBatch, finalizeScan },
      {
        registerScanQueueType,
        tryAcquireFinalizeLock,
        releaseFinalizeLock,
        clearBatchTracking,
      } as unknown as ScanQueueService,
      { onScannerFinalized } as unknown as ScanCompleteNotificationService,
      { publishNow } as unknown as RealtimeBatchPublisher,
      { catalogueRuleIds: ensureRules } as unknown as CatalogueFallbackService,
      { open } as unknown as ImportFileSource,
      ssClient,
      { ingestMatched, finalizeScan: scaFinalizeScan },
      { processContainerBatch, finalizeScan: containerFinalizeScan },
      { ensureAdvisories } as unknown as AdvisoryFallbackService,
    );
    processor.onModuleInit();
    processor.delay = delay;
  });

  afterEach(() => jest.restoreAllMocks());

  it('sends 1,201 results of one tool as batches of 500, 500, 201, then finalizes once', async () => {
    withFile(sarifOf([{ tool: 'Semgrep', results: results(1201) }]));
    await processor.process(jobOf());

    expect(open).toHaveBeenCalledWith(PROJECT, KEY);
    expect(batches().map((b) => b.vulnerabilities.length)).toEqual([
      500, 500, 201,
    ]);
    for (const batch of batches()) {
      expect(batch).toMatchObject({
        projectId: PROJECT,
        scanId: SCAN,
        scannerName: 'semgrep',
        vulnerabilityType: 'critical,high,medium,low',
        isLastRequest: false,
        runningDockerImage: 'sarif-import',
        runningDockerImageVersion: '',
        startedAt: '',
        finishedAt: '',
      });
    }
    expect(registerScanQueueType).toHaveBeenCalledWith(SCAN, 'sast-iac');
    expect(registerScanQueueType.mock.invocationCallOrder[0]).toBeLessThan(
      processSastIacBatch.mock.invocationCallOrder[0],
    );
    expect(tryAcquireFinalizeLock).toHaveBeenCalledTimes(1);
    expect(tryAcquireFinalizeLock).toHaveBeenCalledWith(
      'sast-iac',
      SCAN,
      'semgrep',
    );
    expect(finalizeScan).toHaveBeenCalledTimes(1);
    expect(finalizeScan).toHaveBeenCalledWith(PROJECT, SCAN, 'semgrep', 'sast');
    expect(publishNow).toHaveBeenCalledTimes(1);
    expect(publishNow.mock.calls[0][0]).toBe(`vuln:${PROJECT}:${SCAN}:sast`);
    expect(publishNow.mock.calls[0][1]).toMatchObject({
      type: 'VULNERABILITY_BATCH_APPENDED',
      scope: { projectId: PROJECT },
      payload: {
        vulnerabilityBatchAppended: { scanId: SCAN, scannerType: 'sast' },
      },
    });
    expect(clearBatchTracking).toHaveBeenCalledWith(
      'sast-iac',
      SCAN,
      'semgrep',
    );
    expect(finalizeScan.mock.invocationCallOrder[0]).toBeGreaterThan(
      processSastIacBatch.mock.invocationCallOrder[2],
    );
    expect(releaseFinalizeLock).not.toHaveBeenCalled();
  });

  it('finalizes each tool once when two runs share a tool', async () => {
    withFile(
      sarifOf([
        { tool: 'Semgrep', results: results(3, ['a']) },
        { tool: 'semgrep', results: results(2, ['b']) },
      ]),
    );
    await processor.process(jobOf());

    // both runs share one buffer: one batch of 5 for the tool
    expect(
      batches().map((b) => [b.scannerName, b.vulnerabilities.length]),
    ).toEqual([['semgrep', 5]]);
    expect(finalizeScan).toHaveBeenCalledTimes(1);
    expect(tryAcquireFinalizeLock).toHaveBeenCalledTimes(1);
    expect(onScannerFinalized).toHaveBeenCalledTimes(1);
    expect(completion().toolName).toBe('semgrep');
  });

  it('dispatches the scan end once, after the last tool', async () => {
    withFile([fixture('multi-run.sarif')]);
    await processor.process(jobOf());

    expect(finalizeScan.mock.calls.map(([, , tool]) => tool)).toEqual([
      'semgrep',
      'codeql',
      'bandit',
      'njsscan',
    ]);
    expect(onScannerFinalized).toHaveBeenCalledTimes(1);
    expect(onScannerFinalized).toHaveBeenCalledWith(
      SCAN,
      PROJECT,
      'sast-iac',
      'njsscan',
    );
    expect(onScannerFinalized.mock.invocationCallOrder[0]).toBeGreaterThan(
      finalizeScan.mock.invocationCallOrder[3],
    );
    expect(onScannerFinalized.mock.invocationCallOrder[0]).toBeGreaterThan(
      clearBatchTracking.mock.invocationCallOrder[3],
    );
  });

  it('sends an empty batch for a tool with no result, so its old findings resolve', async () => {
    withFile([fixture('multi-run.sarif')]);
    await processor.process(jobOf());

    const njsscan = batches().filter((b) => b.scannerName === 'njsscan');
    expect(njsscan).toHaveLength(1);
    expect(njsscan[0].vulnerabilities).toEqual([]);
    expect(njsscan[0].isLastRequest).toBe(false);
    // the empty batch comes before that tool's finalization
    const emptyAt =
      processSastIacBatch.mock.invocationCallOrder[
        batches().indexOf(njsscan[0])
      ];
    expect(emptyAt).toBeLessThan(finalizeScan.mock.invocationCallOrder[3]);
    // no ensureRules for an empty batch
    expect(
      ensureRules.mock.calls.filter(([tool]) => tool === 'njsscan'),
    ).toEqual([]);
  });

  it('calls ensureRules before each batch with the distinct metadata of that batch', async () => {
    withFile(
      sarifOf([
        {
          tool: 'Semgrep',
          rules: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
          results: results(1001, ['r1', 'r2', 'r3']),
        },
      ]),
    );
    await processor.process(jobOf({ category: 'iac' }));

    // The tool is finalized for the import's own type only
    expect(finalizeScan).toHaveBeenCalledWith(PROJECT, SCAN, 'semgrep', 'iac');
    expect(ensureRules).toHaveBeenCalledTimes(3);
    ensureRules.mock.calls.forEach(([tool, category, rules], i) => {
      expect(tool).toBe('semgrep');
      expect(category).toBe('iac');
      const ids = (rules as RuleMetadata[]).map((m) => m.ruleId);
      expect(new Set(ids).size).toBe(ids.length);
      const batchIds = new Set(
        batches()[i].vulnerabilities.map((v) => v.ruleId),
      );
      expect(new Set(ids)).toEqual(batchIds);
      expect(ensureRules.mock.invocationCallOrder[i]).toBeLessThan(
        processSastIacBatch.mock.invocationCallOrder[i],
      );
    });
    // the last batch holds only result 1001 (index 1000 → rule r2)
    expect(
      (ensureRules.mock.calls[2][2] as RuleMetadata[]).map((m) => m.ruleId),
    ).toEqual(['r2']);
  });

  it("ingests each finding under the catalogue rule id of the import's organisation", async () => {
    ensureRules.mockImplementation(
      async (_tool: string, _category: string, rules: RuleMetadata[]) =>
        new Map(rules.map((rule) => [rule.ruleId, `scoped-${rule.ruleId}`])),
    );
    withFile(
      sarifOf([
        {
          tool: 'Semgrep',
          rules: [{ id: 'team.sqli' }, { id: 'team.xss' }],
          results: [
            { ruleId: 'team.sqli', level: 'error' },
            { ruleId: 'team.xss', level: 'error' },
            { ruleId: 'team.sqli', level: 'note' },
          ],
        },
      ]),
    );
    await processor.process(jobOf({ organizationId: 'org-7' }));

    expect(ensureRules).toHaveBeenCalledTimes(1);
    expect(ensureRules.mock.calls[0][3]).toBe('org-7');
    expect(batches()[0].vulnerabilities.map((v) => v.ruleId)).toEqual([
      'scoped-team.sqli',
      'scoped-team.xss',
      'scoped-team.sqli',
    ]);
  });

  it('gives every result of a rule the severity of its first result in RuleMetadata', async () => {
    withFile(
      sarifOf([
        {
          tool: 'Semgrep',
          rules: [{ id: 'one' }],
          results: [
            { ruleId: 'one', level: 'error' },
            { ruleId: 'one', level: 'note' },
          ],
        },
      ]),
    );
    await processor.process(jobOf());

    const dtos = batches()[0].vulnerabilities;
    expect(dtos).toHaveLength(2);
    expect(dtos.map((d) => d.severity)).toEqual(['high', 'low']);
    expect(dtos.map((d) => d.ruleMetadata?.severity)).toEqual(['high', 'high']);
    expect(
      (ensureRules.mock.calls[0][2] as RuleMetadata[]).map((m) => m.severity),
    ).toEqual(['high']);
  });

  it('completes with findingsCount and the joined tool names', async () => {
    withFile([fixture('multi-run.sarif')]);
    await processor.process(jobOf());

    expect(completeImportScan).toHaveBeenCalledTimes(1);
    expect(completion()).toEqual({
      scanId: SCAN,
      status: 'completed',
      errorCode: '',
      findingsCount: 3,
      toolName: 'semgrep,codeql,bandit,njsscan',
    });
    expect(completeImportScan.mock.invocationCallOrder[0]).toBeGreaterThan(
      onScannerFinalized.mock.invocationCallOrder[0],
    );
  });

  it('cuts the joined tool names at 255 characters', async () => {
    const tools = Array.from(
      { length: 6 },
      (_, i) => `${String(i).padStart(2, '0')}${'t'.repeat(60)}`,
    );
    withFile(sarifOf(tools.map((tool) => ({ tool, results: [] }))));
    await processor.process(jobOf());
    expect(completion().toolName).toBe(tools.join(',').slice(0, 255));
  });

  it('fails the scan with IMPORT_TOO_MANY_RESULTS and writes nothing', async () => {
    withFile(sarifOf([{ tool: 'Semgrep', results: results(100_001) }]));
    await processor.process(jobOf());

    expect(registerScanQueueType).not.toHaveBeenCalled();
    expect(ensureRules).not.toHaveBeenCalled();
    expect(processSastIacBatch).not.toHaveBeenCalled();
    expect(finalizeScan).not.toHaveBeenCalled();
    expect(onScannerFinalized).not.toHaveBeenCalled();
    expect(completion()).toEqual({
      scanId: SCAN,
      status: 'failed',
      errorCode: 'IMPORT_TOO_MANY_RESULTS',
      findingsCount: 0,
      toolName: '',
    });
  }, 60_000);

  it('fails the scan with IMPORT_INVALID_SARIF on a malformed file', async () => {
    withFile([fixture('malformed.sarif')]);
    await processor.process(jobOf());
    expect(processSastIacBatch).not.toHaveBeenCalled();
    expect(completion()).toMatchObject({
      status: 'failed',
      errorCode: 'IMPORT_INVALID_SARIF',
    });
  });

  it('fails the scan with IMPORT_STORAGE_UNAVAILABLE when the file cannot be opened', async () => {
    open.mockReturnValue(async () => {
      throw new ImportError('IMPORT_STORAGE_UNAVAILABLE', 'unreachable');
    });
    await processor.process(jobOf());

    expect(processSastIacBatch).not.toHaveBeenCalled();
    expect(finalizeScan).not.toHaveBeenCalled();
    expect(completion()).toEqual({
      scanId: SCAN,
      status: 'failed',
      errorCode: 'IMPORT_STORAGE_UNAVAILABLE',
      findingsCount: 0,
      toolName: '',
    });
  });

  it('fails the scan with IMPORT_INTERNAL_ERROR on an unexpected error', async () => {
    withFile([fixture('minimal.sarif')]);
    processSastIacBatch.mockRejectedValue(new Error('ER_LOCK_DEADLOCK'));
    await expect(processor.process(jobOf())).resolves.toBeUndefined();

    expect(finalizeScan).not.toHaveBeenCalled();
    expect(onScannerFinalized).not.toHaveBeenCalled();
    expect(completion()).toEqual({
      scanId: SCAN,
      status: 'failed',
      errorCode: 'IMPORT_INTERNAL_ERROR',
      findingsCount: 0,
      toolName: '',
    });
    expect(completion().errorCode).not.toBe('');
  });

  it('releases the finalize lock when a finalization fails, and fails the scan', async () => {
    withFile([fixture('minimal.sarif')]);
    finalizeScan.mockRejectedValue(new Error('redis down'));
    await processor.process(jobOf());

    expect(releaseFinalizeLock).toHaveBeenCalledWith(
      'sast-iac',
      SCAN,
      'semgrep',
    );
    expect(clearBatchTracking).not.toHaveBeenCalled();
    expect(onScannerFinalized).not.toHaveBeenCalled();
    expect(completion()).toMatchObject({
      status: 'failed',
      errorCode: 'IMPORT_INTERNAL_ERROR',
    });
  });

  it('retries a batch answered UNAVAILABLE and gives up after 3', async () => {
    withFile([fixture('minimal.sarif')]);
    const unavailable = () =>
      new RpcException({ code: status.UNAVAILABLE, message: 'scan record' });

    // two failures, then success: the import goes on
    processSastIacBatch
      .mockRejectedValueOnce(unavailable())
      .mockRejectedValueOnce(unavailable());
    await processor.process(jobOf());
    expect(processSastIacBatch).toHaveBeenCalledTimes(3);
    expect(delay.mock.calls.map(([ms]) => ms)).toEqual([2_000, 5_000]);
    expect(completion().status).toBe('completed');

    // always UNAVAILABLE: 1 call + 3 retries, then the scan fails
    processSastIacBatch.mockReset();
    processSastIacBatch.mockRejectedValue(unavailable());
    completeImportScan.mockClear();
    delay.mockClear();
    await processor.process(jobOf());
    expect(processSastIacBatch).toHaveBeenCalledTimes(4);
    expect(delay.mock.calls.map(([ms]) => ms)).toEqual([2_000, 5_000, 10_000]);
    expect(completion()).toMatchObject({
      status: 'failed',
      errorCode: 'IMPORT_INTERNAL_ERROR',
    });
  });

  it('does not retry a batch refused for another reason', async () => {
    withFile([fixture('minimal.sarif')]);
    processSastIacBatch.mockRejectedValue(
      new RpcException({ code: status.INVALID_ARGUMENT, message: 'no' }),
    );
    await processor.process(jobOf());
    expect(processSastIacBatch).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('retries completeImportScan 3 times, then logs RESULTS_IMPORT_COMPLETE_FAILED', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    withFile([fixture('minimal.sarif')]);
    completeImportScan.mockReturnValue(
      throwError(() =>
        Object.assign(new Error('14 UNAVAILABLE'), { code: 14 }),
      ),
    );
    await expect(processor.process(jobOf())).resolves.toBeUndefined();

    expect(completeImportScan).toHaveBeenCalledTimes(4);
    expect(delay.mock.calls.map(([ms]) => ms)).toEqual([1_000, 5_000, 30_000]);
    const lines = error.mock.calls.map(([line]) => String(line));
    expect(
      lines.filter((line) => line.startsWith('RESULTS_IMPORT_COMPLETE_FAILED')),
    ).toEqual([`RESULTS_IMPORT_COMPLETE_FAILED scan=${SCAN} code=completed`]);
  });

  it('retries completeImportScan until it succeeds', async () => {
    withFile([fixture('minimal.sarif')]);
    completeImportScan
      .mockReturnValueOnce(throwError(() => new Error('14 UNAVAILABLE')))
      .mockReturnValueOnce(of({ success: true, message: '' }));
    await processor.process(jobOf());
    expect(completeImportScan).toHaveBeenCalledTimes(2);
    expect(delay.mock.calls.map(([ms]) => ms)).toEqual([1_000]);
  });

  it('logs one RESULTS_IMPORT_DONE line with the skip counts', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    withFile([fixture('suppressed.sarif')]);
    await processor.process(jobOf());
    const done = log.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.startsWith('RESULTS_IMPORT_DONE'));
    expect(done).toHaveLength(1);
    expect(done[0]).toMatch(
      new RegExp(`^RESULTS_IMPORT_DONE scan=${SCAN} tools=\\S+ mapped=\\d+`),
    );
    expect(done[0]).toMatch(/skipped_suppressed=\d+/);
  });

  describe('sca and container', () => {
    const IMAGE = 'ghcr.io/example/api:2.0.1';
    const IMAGE_ID =
      'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const scaCalls = (): { meta: ScaScanMeta; items: ScaMatchedItem[] }[] =>
      ingestMatched.mock.calls.map(([meta, items]) => ({
        meta: meta as ScaScanMeta,
        items: items as ScaMatchedItem[],
      }));
    const containerCalls = (): {
      req: ScanAddContainerResultRequest;
      options: { imageId?: string };
    }[] =>
      processContainerBatch.mock.calls.map(([req, options]) => ({
        req: req as ScanAddContainerResultRequest,
        options: options as { imageId?: string },
      }));

    interface GenVuln {
      pkg: string;
      version?: string;
      id?: string;
      uri?: string;
      fixed?: string;
      noLink?: boolean;
    }

    /** A Trivy-shaped file, one rule per advisory id. */
    const trivyOf = (
      vulns: GenVuln[],
      extra: Record<string, unknown> = {},
    ): Buffer[] => {
      const ids = [...new Set(vulns.map((v, i) => v.id ?? `CVE-2099-${i}`))];
      const rules = ids.map((id) =>
        JSON.stringify({
          id,
          shortDescription: { text: `${id} summary` },
          properties: { 'security-severity': '7.5', tags: ['vulnerability'] },
        }),
      );
      const parts: string[] = [
        `{"version":"2.1.0","runs":[{"tool":{"driver":{"name":"Trivy","rules":[${rules.join(',')}]}},` +
          Object.entries(extra)
            .map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)},`)
            .join('') +
          '"results":[',
      ];
      vulns.forEach((v, i) => {
        const id = v.id ?? `CVE-2099-${i}`;
        const text =
          `Package: ${v.pkg}\nInstalled Version: ${v.version ?? '1.0.0'}\nVulnerability ${id}\nSeverity: HIGH\nFixed Version: ${v.fixed ?? ''}` +
          (v.noLink
            ? ''
            : `\nLink: [${id}](https://avd.aquasec.com/nvd/${id.toLowerCase()})`);
        parts.push(
          (i > 0 ? ',' : '') +
            JSON.stringify({
              ruleId: id,
              level: 'error',
              message: { text },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: {
                      uri: v.uri ?? 'package-lock.json',
                      uriBaseId: 'ROOTPATH',
                    },
                    region: { startLine: 1, endLine: 1 },
                  },
                },
              ],
            }),
        );
      });
      parts.push(']}]}');
      return toChunks(parts);
    };

    it('imports trivy-fs-sca.sarif as sca through ingestMatched, with the advisories ensured first', async () => {
      withFile([fixture('trivy-fs-sca.sarif')]);
      await processor.process(jobOf({ category: 'sca' }));

      expect(ensureAdvisories).toHaveBeenCalledTimes(1);
      expect(ingestMatched).toHaveBeenCalledTimes(1);
      expect(ensureAdvisories.mock.invocationCallOrder[0]).toBeLessThan(
        ingestMatched.mock.invocationCallOrder[0],
      );
      const inputs = ensureAdvisories.mock.calls[0][0] as AdvisoryInput[];
      expect(inputs).toHaveLength(5);
      expect(inputs.every((input) => input.toolName === 'trivy')).toBe(true);
      const qs = inputs.find((input) => input.id === 'CVE-2022-24999');
      expect(qs?.fixes).toHaveLength(7);
      expect(qs?.fixes[0]).toEqual({
        ecosystem: 'npm',
        packageName: 'qs',
        fixed: '6.10.3',
      });
      expect(
        inputs.find((input) => input.id === 'CVE-2023-28155')?.fixes,
      ).toEqual([]);

      const [{ meta, items }] = scaCalls();
      expect(meta).toEqual({
        projectId: PROJECT,
        scanId: SCAN,
        vulnerabilityType: 'critical,high,medium,low',
      });
      expect(items).toHaveLength(5);
      expect(items[0].library).toEqual({
        name: 'lodash',
        version: '4.17.20',
        file: 'package-lock.json',
        ecosystem: 'npm',
        isTransitive: false,
        isDev: false,
        path: [],
        dependencyInfoAvailable: false,
        importLocations: [],
        licenses: [],
      });
      expect(items[0].affected).toHaveLength(1);
      expect(items[0].affected[0]).toMatchObject({
        ecosystem: 'npm',
        packageName: 'lodash',
        severity: null,
        vulnerability: { id: 'CVE-2021-23337' },
      });
      expect(items[4].library).toMatchObject({
        name: 'requests',
        file: 'requirements.txt',
        ecosystem: 'PyPI',
      });

      // no SAST path, no container path
      expect(processSastIacBatch).not.toHaveBeenCalled();
      expect(ensureRules).not.toHaveBeenCalled();
      expect(processContainerBatch).not.toHaveBeenCalled();
      expect(completion()).toEqual({
        scanId: SCAN,
        status: 'completed',
        errorCode: '',
        findingsCount: 5,
        toolName: 'trivy',
      });
    });

    it('groups the items of one package into one library with every advisory', async () => {
      withFile(
        trivyOf([
          { pkg: 'Lodash', version: '4.17.20', id: 'CVE-2099-1' },
          { pkg: 'lodash ', version: '4.17.20', id: 'CVE-2099-2' },
          { pkg: 'lodash', version: '4.17.21', id: 'CVE-2099-3' },
        ]),
      );
      await processor.process(jobOf({ category: 'sca' }));
      const [{ items }] = scaCalls();
      expect(items).toHaveLength(2);
      expect(items[0].affected.map((a) => a.vulnerability.id)).toEqual([
        'CVE-2099-1',
        'CVE-2099-2',
      ]);
      expect(items[1].affected.map((a) => a.vulnerability.id)).toEqual([
        'CVE-2099-3',
      ]);
      expect(completion().findingsCount).toBe(3);
    });

    for (const category of ['sca', 'container'] as const) {
      it(`fails sca-unparsable.sarif with IMPORT_UNSUPPORTED_RESULT and writes nothing (${category})`, async () => {
        withFile([fixture('sca-unparsable.sarif')]);
        await processor.process(
          jobOf({
            category,
            ...(category === 'container' ? { image: IMAGE } : {}),
          }),
        );

        expect(ensureAdvisories).not.toHaveBeenCalled();
        expect(ingestMatched).not.toHaveBeenCalled();
        expect(processContainerBatch).not.toHaveBeenCalled();
        expect(scaFinalizeScan).not.toHaveBeenCalled();
        expect(containerFinalizeScan).not.toHaveBeenCalled();
        expect(finalizeScan).not.toHaveBeenCalled();
        expect(tryAcquireFinalizeLock).not.toHaveBeenCalled();
        expect(onScannerFinalized).not.toHaveBeenCalled();
        expect(completion()).toEqual({
          scanId: SCAN,
          status: 'failed',
          errorCode: 'IMPORT_UNSUPPORTED_RESULT',
          findingsCount: 0,
          toolName: '',
        });
      });
    }

    it('skips the other kinds of trivy-mixed-kinds.sarif and logs one IMPORT_SKIPPED line per run and kind', async () => {
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
        (level) => jest.spyOn(Logger.prototype, level).mockImplementation(),
      );
      withFile([fixture('trivy-mixed-kinds.sarif')]);
      await processor.process(jobOf({ category: 'sca' }));

      const [{ items }] = scaCalls();
      expect(items).toHaveLength(1);
      expect(items[0].library.name).toBe('lodash');

      const lines = spies
        .flatMap((spy) => spy.mock.calls)
        .map(([line]) => String(line));
      expect(
        lines.filter((line) => line.startsWith('IMPORT_SKIPPED')).sort(),
      ).toEqual(
        [
          `IMPORT_SKIPPED scan=${SCAN} tool=trivy kind=license count=1`,
          `IMPORT_SKIPPED scan=${SCAN} tool=trivy kind=misconfiguration count=1`,
          `IMPORT_SKIPPED scan=${SCAN} tool=trivy kind=secret count=1`,
        ].sort(),
      );
      const done = lines.filter((line) =>
        line.startsWith('RESULTS_IMPORT_DONE'),
      );
      expect(done).toHaveLength(1);
      expect(done[0]).toContain('skipped_kind_misconfiguration=1');
      expect(done[0]).toContain('skipped_kind_secret=1');
      expect(done[0]).toContain('skipped_kind_license=1');
      // no result text in any log
      const logged = spies
        .flatMap((spy) => spy.mock.calls)
        .flat()
        .map((arg) => String(arg))
        .join('\n');
      for (const text of [
        'lodash',
        'AVD-DS-0002',
        'aws-access-key-id',
        'GPL-3.0-only',
        'config/settings.py',
        'package-lock.json',
        'CVE-2021-23337',
      ]) {
        expect(logged).not.toContain(text);
      }
      expect(completion()).toMatchObject({
        status: 'completed',
        findingsCount: 1,
      });
    });

    it('finalizes sca per tool with queue type sca, then dispatches the scan end once', async () => {
      withFile([fixture('sca-package-bag.sarif')]);
      await processor.process(jobOf({ category: 'sca' }));

      expect(registerScanQueueType).toHaveBeenCalledWith(SCAN, 'sca');
      expect(scaCalls().map(({ items }) => items.length)).toEqual([2, 1]);
      expect(tryAcquireFinalizeLock.mock.calls).toEqual([
        ['sca', SCAN, 'acme-sca'],
        ['sca', SCAN, 'trivy'],
      ]);
      expect(scaFinalizeScan).toHaveBeenCalledTimes(2);
      expect(scaFinalizeScan).toHaveBeenCalledWith(PROJECT, SCAN);
      expect(finalizeScan).not.toHaveBeenCalled();
      expect(publishNow.mock.calls.map(([channel]) => channel)).toEqual([
        `vuln:${PROJECT}:${SCAN}:sca`,
        `vuln:${PROJECT}:${SCAN}:sca`,
      ]);
      expect(publishNow.mock.calls[0][1]).toMatchObject({
        type: 'VULNERABILITY_BATCH_APPENDED',
        scope: { projectId: PROJECT },
        payload: {
          vulnerabilityBatchAppended: { scanId: SCAN, scannerType: 'sca' },
        },
      });
      expect(clearBatchTracking.mock.calls).toEqual([
        ['sca', SCAN, 'acme-sca'],
        ['sca', SCAN, 'trivy'],
      ]);
      expect(onScannerFinalized).toHaveBeenCalledTimes(1);
      expect(onScannerFinalized).toHaveBeenCalledWith(
        SCAN,
        PROJECT,
        'sca',
        'trivy',
      );
      expect(onScannerFinalized.mock.invocationCallOrder[0]).toBeGreaterThan(
        clearBatchTracking.mock.invocationCallOrder[1],
      );
      // every write precedes the first finalization
      expect(Math.max(...ingestMatched.mock.invocationCallOrder)).toBeLessThan(
        scaFinalizeScan.mock.invocationCallOrder[0],
      );
      expect(completion()).toMatchObject({
        status: 'completed',
        findingsCount: 3,
        toolName: 'acme-sca,trivy',
      });
    });

    it('imports trivy-image.sarif as container with the image of the request and the imageID of the run', async () => {
      withFile([fixture('trivy-image.sarif')]);
      await processor.process(jobOf({ category: 'container', image: IMAGE }));

      expect(registerScanQueueType).toHaveBeenCalledWith(SCAN, 'container');
      expect(ensureAdvisories).toHaveBeenCalledTimes(1);
      expect(
        (ensureAdvisories.mock.calls[0][0] as AdvisoryInput[]).map((i) => i.id),
      ).toEqual([
        'CVE-2023-2650',
        'CVE-2023-2650',
        'CVE-2023-42363',
        'CVE-2021-23337',
      ]);
      expect(containerCalls()).toHaveLength(1);
      const [{ req, options }] = containerCalls();
      expect(ensureAdvisories.mock.invocationCallOrder[0]).toBeLessThan(
        processContainerBatch.mock.invocationCallOrder[0],
      );
      expect(options).toEqual({ imageId: IMAGE_ID });
      expect(req).toMatchObject({
        projectId: PROJECT,
        scanId: SCAN,
        scannerName: 'trivy',
        startedAt: '',
        finishedAt: '',
        chunk: { index: 1, isLast: false },
        os: { family: '', name: '', eosl: false },
        imageName: IMAGE,
      });
      expect(req.results.map((r) => [r.target, r.class, r.type])).toEqual([
        ['ghcr.io/example/api', 'os-pkgs', 'unknown'],
        ['app/package-lock.json', 'lang-pkgs', 'npm'],
      ]);
      expect(req.results[0].packages.map((p) => p.name)).toEqual([
        'libcrypto3',
        'libssl3',
        'busybox',
      ]);
      expect(req.results[0].packages[0]).toEqual({
        id: '',
        name: 'libcrypto3',
        version: '3.1.0-r4',
        arch: '',
        srcName: '',
        srcVersion: '',
        digest: '',
        licenses: [],
        dependsOn: [],
        fullVersion: '',
        srcFullVersion: '',
      });
      const vulns = req.results.flatMap((r) => r.vulnerabilities);
      expect(vulns).toHaveLength(4);
      expect(vulns[0]).toMatchObject({
        vulnerabilityId: 'CVE-2023-2650',
        pkgName: 'libcrypto3',
        installedVersion: '3.1.0-r4',
        fixedVersion: '3.1.1-r0',
        severity: 'MEDIUM',
        title: 'CVE-2023-2650: OpenSSL signature verification bypass',
        primaryUrl: 'https://avd.aquasec.com/nvd/cve-2023-2650',
        target: 'ghcr.io/example/api',
        class: 'os-pkgs',
        type: 'unknown',
        references: ['https://avd.aquasec.com/nvd/cve-2023-2650'],
        internalId: '',
        cvss: {
          sarif: { v2Vector: '', v3Vector: '', v2Score: 0, v3Score: 6.5 },
        },
      });
      expect(vulns[3]).toMatchObject({
        vulnerabilityId: 'CVE-2021-23337',
        pkgName: 'lodash',
        severity: 'HIGH',
        class: 'lang-pkgs',
        type: 'npm',
      });

      expect(tryAcquireFinalizeLock).toHaveBeenCalledWith(
        'container',
        SCAN,
        'trivy',
      );
      expect(containerFinalizeScan).toHaveBeenCalledWith(PROJECT, SCAN);
      expect(publishNow.mock.calls[0][0]).toBe(
        `vuln:${PROJECT}:${SCAN}:container`,
      );
      expect(publishNow.mock.calls[0][1]).toMatchObject({
        payload: {
          vulnerabilityBatchAppended: { scannerType: 'container' },
        },
      });
      expect(clearBatchTracking).toHaveBeenCalledWith(
        'container',
        SCAN,
        'trivy',
      );
      expect(onScannerFinalized).toHaveBeenCalledWith(
        SCAN,
        PROJECT,
        'container',
        'trivy',
      );
      expect(ingestMatched).not.toHaveBeenCalled();
      expect(processSastIacBatch).not.toHaveBeenCalled();
      expect(completion()).toMatchObject({
        status: 'completed',
        findingsCount: 4,
        toolName: 'trivy',
      });
    });

    it('uses the image reference as imageId when no run carries one', async () => {
      withFile([fixture('grype-image.sarif')]);
      const image = 'ghcr.io/example/web:1.4.2';
      await processor.process(jobOf({ category: 'container', image }));

      const [{ req, options }] = containerCalls();
      expect(options).toEqual({ imageId: image });
      expect(req.imageName).toBe(image);
      expect(req.scannerName).toBe('grype');
      expect(req.results.flatMap((r) => r.vulnerabilities)).toHaveLength(4);
    });

    it('reads the shapes of a Trivy image scan: no ROOTPATH base, installed manifests, repository and archive paths', async () => {
      withFile(
        trivyOf(
          [
            { pkg: 'busybox', version: '1.36.0-r9', uri: 'library/alpine' },
            {
              pkg: 'lodash',
              version: '4.17.20',
              uri: 'app/node_modules/lodash/package.json',
              fixed: '4.17.21',
            },
            {
              pkg: 'musl',
              version: '1.2.4-r0',
              uri: 'out/image.tar',
              noLink: true,
            },
            { pkg: 'zlib', version: '1.2.13-r1', uri: '/out/image.tar' },
          ],
          // the image the file names is never the one stored
          { properties: { imageName: 'docker.io/other/name:9' } },
        ),
      );
      await processor.process(jobOf({ category: 'container', image: IMAGE }));

      const [{ req, options }] = containerCalls();
      expect(req.imageName).toBe(IMAGE);
      expect(options).toEqual({ imageId: IMAGE });
      expect(req.results.map((r) => [r.target, r.class, r.type])).toEqual([
        ['library/alpine', 'os-pkgs', 'unknown'],
        ['app/node_modules/lodash/package.json', 'lang-pkgs', 'npm'],
        ['out/image.tar', 'os-pkgs', 'unknown'],
      ]);
      expect(req.results[2].packages.map((p) => p.name)).toEqual([
        'musl',
        'zlib',
      ]);
      const vulns = req.results.flatMap((r) => r.vulnerabilities);
      expect(vulns.map((v) => [v.pkgName, v.installedVersion])).toEqual([
        ['busybox', '1.36.0-r9'],
        ['lodash', '4.17.20'],
        ['musl', '1.2.4-r0'],
        ['zlib', '1.2.13-r1'],
      ]);
      expect(vulns[1].fixedVersion).toBe('4.17.21');
      expect(completion()).toMatchObject({
        status: 'completed',
        findingsCount: 4,
      });
    });

    it('ignores an imageID over 255 characters and keeps the image reference', async () => {
      withFile(
        trivyOf([{ pkg: 'busybox', uri: 'library/alpine' }], {
          properties: { imageID: `sha256:${'a'.repeat(256)}` },
        }),
      );
      await processor.process(jobOf({ category: 'container', image: IMAGE }));
      expect(containerCalls()[0].options).toEqual({ imageId: IMAGE });
    });

    it('sends one empty container batch for a file with no vulnerability result', async () => {
      withFile(trivyOf([]));
      await processor.process(jobOf({ category: 'container', image: IMAGE }));

      expect(ensureAdvisories).not.toHaveBeenCalled();
      expect(containerCalls()).toHaveLength(1);
      const [{ req, options }] = containerCalls();
      expect(req.results).toEqual([]);
      expect(req.imageName).toBe(IMAGE);
      expect(options).toEqual({ imageId: IMAGE });
      expect(processContainerBatch.mock.invocationCallOrder[0]).toBeLessThan(
        containerFinalizeScan.mock.invocationCallOrder[0],
      );
      expect(containerFinalizeScan).toHaveBeenCalledTimes(1);
      expect(onScannerFinalized).toHaveBeenCalledTimes(1);
      expect(completion()).toMatchObject({
        status: 'completed',
        findingsCount: 0,
        toolName: 'trivy',
      });
    });

    it('completes an sca file with no vulnerability result and still finalizes it', async () => {
      withFile(trivyOf([]));
      await processor.process(jobOf({ category: 'sca' }));

      expect(ensureAdvisories).not.toHaveBeenCalled();
      expect(ingestMatched).not.toHaveBeenCalled();
      expect(scaFinalizeScan).toHaveBeenCalledTimes(1);
      expect(scaFinalizeScan).toHaveBeenCalledWith(PROJECT, SCAN);
      expect(onScannerFinalized).toHaveBeenCalledWith(
        SCAN,
        PROJECT,
        'sca',
        'trivy',
      );
      expect(completion()).toEqual({
        scanId: SCAN,
        status: 'completed',
        errorCode: '',
        findingsCount: 0,
        toolName: 'trivy',
      });
    });

    it('registers the import type as the scan queue type', async () => {
      for (const [category, image] of [
        ['sca', undefined],
        ['container', IMAGE],
      ] as const) {
        registerScanQueueType.mockClear();
        withFile([fixture('trivy-fs-sca.sarif')]);
        await processor.process(jobOf({ category, image }));
        expect(registerScanQueueType.mock.calls).toEqual([[SCAN, category]]);
        const firstWrite = Math.min(
          ...ensureAdvisories.mock.invocationCallOrder,
        );
        expect(registerScanQueueType.mock.invocationCallOrder[0]).toBeLessThan(
          firstWrite,
        );
        ensureAdvisories.mockClear();
      }
    });

    it('splits 1,201 sca items into batches of 500, 500, 201', async () => {
      withFile(
        trivyOf(
          Array.from({ length: 1201 }, (_, i) => ({
            pkg: `pkg-${i}`,
            id: `CVE-2099-${i}`,
          })),
        ),
      );
      await processor.process(jobOf({ category: 'sca' }));

      expect(scaCalls().map(({ items }) => items.length)).toEqual([
        500, 500, 201,
      ]);
      expect(
        ensureAdvisories.mock.calls.map(([items]) => items.length),
      ).toEqual([500, 500, 201]);
      ensureAdvisories.mock.invocationCallOrder.forEach((order, i) => {
        expect(order).toBeLessThan(ingestMatched.mock.invocationCallOrder[i]);
      });
      expect(scaFinalizeScan).toHaveBeenCalledTimes(1);
      expect(completion().findingsCount).toBe(1201);
    });

    it('numbers container batches from 1 and retries one answered UNAVAILABLE', async () => {
      withFile(
        trivyOf(
          Array.from({ length: 501 }, (_, i) => ({
            pkg: `pkg-${i}`,
            uri: 'library/alpine',
          })),
        ),
      );
      processContainerBatch.mockRejectedValueOnce(
        new RpcException({ code: status.UNAVAILABLE, message: 'scan' }),
      );
      await processor.process(jobOf({ category: 'container', image: IMAGE }));

      // 1 failed + 2 batches
      expect(processContainerBatch).toHaveBeenCalledTimes(3);
      expect(delay.mock.calls.map(([ms]) => ms)).toEqual([2_000]);
      expect(containerCalls().map(({ req }) => req.chunk?.index)).toEqual([
        1, 1, 2,
      ]);
      expect(completion().status).toBe('completed');
    });

    it('never runs the SAST path for sca or container, nor the package path for code types', async () => {
      withFile([fixture('minimal.sarif')]);
      await processor.process(jobOf());
      expect(ensureAdvisories).not.toHaveBeenCalled();
      expect(ingestMatched).not.toHaveBeenCalled();
      expect(processContainerBatch).not.toHaveBeenCalled();
    });

    describe('with a CycloneDX SBOM (one picture of the branch)', () => {
      const SBOM_KEY = `import/${PROJECT}/${SCAN}.sbom`;
      const SBOM_FIXTURES = join(
        __dirname,
        '../../../../../libs/test-fixtures/sbom',
      );
      const sbomFixture = (name: string): Buffer =>
        readFileSync(join(SBOM_FIXTURES, name));
      const pep = (name: string): string =>
        name.toLowerCase().replace(/[-_.]+/g, '-');

      /** The SARIF at KEY, the SBOM at SBOM_KEY. */
      const withFiles = (sarif: Buffer[], sbom: Buffer[]): void => {
        open.mockImplementation((_project: string, key: string) =>
          sourceOf(key === SBOM_KEY ? sbom : sarif),
        );
      };

      const libraries = (): Map<string, ScaMatchedItem> =>
        new Map(
          scaCalls().flatMap(({ items }) =>
            items.map((item) => [item.library.name, item] as const),
          ),
        );

      it('ingests the vulnerable packages with what the SBOM knows of them, then the others, then finalizes once', async () => {
        withFiles(
          [fixture('trivy-fs-sca.sarif')],
          [sbomFixture('trivy-fs.cdx.json')],
        );
        await processor.process(
          jobOf({ category: 'sca', sbomFileKey: SBOM_KEY }),
        );

        const calls = scaCalls();
        expect(calls.map(({ items }) => items.length)).toEqual([5, 3]);
        const byName = libraries();

        // a vulnerable package: its advisories and the SBOM's facts
        expect(byName.get('lodash')?.library).toEqual({
          name: 'lodash',
          version: '4.17.20',
          file: 'package-lock.json',
          ecosystem: 'npm',
          isTransitive: false,
          isDev: false,
          path: ['lodash@4.17.20', 'package-lock.json'],
          dependencyInfoAvailable: true,
          importLocations: [],
          licenses: ['MIT'],
        });
        expect(byName.get('lodash')?.affected).toHaveLength(1);
        expect(byName.get('qs')?.library).toMatchObject({
          isTransitive: true,
          licenses: ['BSD-3-Clause'],
        });
        expect(byName.get('requests')?.library).toMatchObject({
          file: 'requirements.txt',
          ecosystem: 'PyPI',
          dependencyInfoAvailable: true,
        });

        // the packages only the SBOM names: no advisory, no detection
        const [, inventory] = calls;
        expect(inventory.items.map((item) => item.library.name)).toEqual([
          'express',
          '@babel/code-frame',
          'typing_extensions',
        ]);
        expect(
          inventory.items.every((item) => item.affected.length === 0),
        ).toBe(true);
        expect(inventory.meta).toEqual(calls[0].meta);
        // the advisories of the SARIF only
        expect(ensureAdvisories).toHaveBeenCalledTimes(1);

        expect(scaFinalizeScan).toHaveBeenCalledTimes(1);
        const lastIngest = Math.max(...ingestMatched.mock.invocationCallOrder);
        expect(lastIngest).toBeLessThan(
          scaFinalizeScan.mock.invocationCallOrder[0],
        );
        expect(onScannerFinalized).toHaveBeenCalledTimes(1);
        expect(completion()).toEqual({
          scanId: SCAN,
          status: 'completed',
          errorCode: '',
          findingsCount: 5,
          toolName: 'trivy',
        });
      });

      it('takes the SBOM of a SARIF with no result: the inventory alone, finalized', async () => {
        withFiles(trivyOf([]), [sbomFixture('syft-flat.cdx.json')]);
        await processor.process(
          jobOf({ category: 'sca', sbomFileKey: SBOM_KEY }),
        );
        expect(scaCalls().map(({ items }) => items.length)).toEqual([5]);
        expect(ensureAdvisories).not.toHaveBeenCalled();
        expect(scaFinalizeScan).toHaveBeenCalledTimes(1);
        expect(completion()).toMatchObject({
          status: 'completed',
          findingsCount: 0,
        });
      });

      it('matches a Python package spelled with _ in one file and - in the other', async () => {
        withFiles(
          trivyOf([
            {
              pkg: 'typing-extensions',
              version: '4.7.1',
              uri: 'requirements.txt',
            },
          ]),
          [sbomFixture('trivy-fs.cdx.json')],
        );
        await processor.process(
          jobOf({ category: 'sca', sbomFileKey: SBOM_KEY }),
        );
        const names = scaCalls().flatMap(({ items }) =>
          items.map((item) => item.library.name),
        );
        expect(names.filter((n) => pep(n) === 'typing-extensions')).toEqual([
          'typing-extensions',
        ]);
        expect(libraries().get('typing-extensions')?.library).toMatchObject({
          licenseExpression: 'PSF-2.0',
          dependencyInfoAvailable: true,
        });
      });

      it('sends the packages only the SBOM names in batches of 500', async () => {
        const components = Array.from({ length: 1201 }, (_, i) => ({
          type: 'library',
          name: `p${i}`,
          version: '1.0.0',
          purl: `pkg:npm/p${i}@1.0.0`,
        }));
        withFiles(trivyOf([]), [
          Buffer.from(
            JSON.stringify({
              bomFormat: 'CycloneDX',
              specVersion: '1.6',
              components,
            }),
          ),
        ]);
        await processor.process(
          jobOf({ category: 'sca', sbomFileKey: SBOM_KEY }),
        );
        expect(scaCalls().map(({ items }) => items.length)).toEqual([
          500, 500, 201,
        ]);
        expect(scaFinalizeScan).toHaveBeenCalledTimes(1);
      });

      it('reads no SBOM without one: the SARIF alone, as before', async () => {
        withFile([fixture('trivy-fs-sca.sarif')]);
        await processor.process(jobOf({ category: 'sca' }));
        expect(open.mock.calls.every(([, key]) => key === KEY)).toBe(true);
        expect(scaCalls().map(({ items }) => items.length)).toEqual([5]);
      });

      for (const [name, code] of [
        ['spdx.json', 'IMPORT_INVALID_SBOM'],
        ['bad-coordinates.cdx.json', 'IMPORT_INVALID_SBOM'],
        ['malformed.cdx.json', 'IMPORT_INVALID_SBOM'],
      ] as const) {
        it(`fails with ${code} on ${name} before anything is written`, async () => {
          withFiles([fixture('trivy-fs-sca.sarif')], [sbomFixture(name)]);
          await processor.process(
            jobOf({ category: 'sca', sbomFileKey: SBOM_KEY }),
          );
          expect(ensureAdvisories).not.toHaveBeenCalled();
          expect(ingestMatched).not.toHaveBeenCalled();
          expect(scaFinalizeScan).not.toHaveBeenCalled();
          expect(onScannerFinalized).not.toHaveBeenCalled();
          expect(completion()).toEqual({
            scanId: SCAN,
            status: 'failed',
            errorCode: code,
            findingsCount: 0,
            toolName: '',
          });
        });
      }

      it('refuses an SBOM with any other import type', async () => {
        withFiles(
          [fixture('trivy-fs-sca.sarif')],
          [sbomFixture('trivy-fs.cdx.json')],
        );
        await processor.process(
          jobOf({ category: 'container', image: IMAGE, sbomFileKey: SBOM_KEY }),
        );
        expect(processContainerBatch).not.toHaveBeenCalled();
        expect(containerFinalizeScan).not.toHaveBeenCalled();
        expect(completion()).toMatchObject({
          status: 'failed',
          errorCode: 'IMPORT_INVALID_SBOM',
        });
      });

      describe('of the sca container of a Community cluster scan (trivy fs)', () => {
        const CONTAINER = '3f2b8c1e-5d4a-4b6c-9e7f-1a2b3c4d5e6f';
        const CONTAINER_KEY = `import/${PROJECT}/${SCAN}/${CONTAINER}.sarif`;
        const CONTAINER_SBOM_KEY = `import/${PROJECT}/${SCAN}/${CONTAINER}.sbom`;
        const containerSbomJob = () =>
          jobOf({
            category: 'sca',
            containerId: CONTAINER,
            fileKey: CONTAINER_KEY,
            sbomFileKey: CONTAINER_SBOM_KEY,
          });
        const withContainerFiles = (sarif: Buffer[], sbom: Buffer[]): void => {
          open.mockImplementation((_project: string, key: string) =>
            sourceOf(key === CONTAINER_SBOM_KEY ? sbom : sarif),
          );
        };

        it('reads the SARIF and SBOM of the container, ingests one picture, finalizes once, closes the container', async () => {
          withContainerFiles(
            [fixture('trivy-fs-sca.sarif')],
            [sbomFixture('trivy-fs.cdx.json')],
          );
          await processor.process(containerSbomJob());

          const keys = new Set(open.mock.calls.map(([, key]) => key));
          expect(keys).toEqual(new Set([CONTAINER_KEY, CONTAINER_SBOM_KEY]));
          expect(scaCalls().map(({ items }) => items.length)).toEqual([5, 3]);
          expect(libraries().get('lodash')?.library).toMatchObject({
            licenses: ['MIT'],
            dependencyInfoAvailable: true,
          });
          expect(scaFinalizeScan).toHaveBeenCalledTimes(1);
          const lastIngest = Math.max(
            ...ingestMatched.mock.invocationCallOrder,
          );
          expect(lastIngest).toBeLessThan(
            scaFinalizeScan.mock.invocationCallOrder[0],
          );
          expect(onScannerFinalized).toHaveBeenCalledTimes(1);
          expect(completion()).toEqual({
            scanId: SCAN,
            status: 'completed',
            errorCode: '',
            findingsCount: 5,
            toolName: 'trivy',
            containerId: CONTAINER,
          });
        });

        it('fails the container with IMPORT_INVALID_SBOM on a bad SBOM, nothing written', async () => {
          withContainerFiles(
            [fixture('trivy-fs-sca.sarif')],
            [sbomFixture('malformed.cdx.json')],
          );
          await processor.process(containerSbomJob());
          expect(ensureAdvisories).not.toHaveBeenCalled();
          expect(ingestMatched).not.toHaveBeenCalled();
          expect(scaFinalizeScan).not.toHaveBeenCalled();
          expect(onScannerFinalized).not.toHaveBeenCalled();
          expect(completion()).toEqual({
            scanId: SCAN,
            status: 'failed',
            errorCode: 'IMPORT_INVALID_SBOM',
            findingsCount: 0,
            toolName: '',
            containerId: CONTAINER,
          });
        });
      });

      it('logs the SBOM counts, never a package or a path', async () => {
        const log = jest.spyOn(Logger.prototype, 'log');
        withFiles(
          [fixture('trivy-fs-sca.sarif')],
          [sbomFixture('trivy-fs.cdx.json')],
        );
        await processor.process(
          jobOf({ category: 'sca', sbomFileKey: SBOM_KEY }),
        );
        const lines = log.mock.calls.map(([line]) => String(line)).join('\n');
        expect(lines).toContain('sbom_packages=8');
        expect(lines).toContain('sbom_skipped_not_a_package=2');
        expect(lines).not.toMatch(/express|code-frame|package-lock/);
      });
    });
  });

  describe('per scanner container (Community cluster scans)', () => {
    const CONTAINER = '3f2b8c1e-5d4a-4b6c-9e7f-1a2b3c4d5e6f';
    const CONTAINER_KEY = `import/${PROJECT}/${SCAN}/${CONTAINER}.sarif`;
    const containerJob = (data: Partial<ResultsImportJobData> = {}) =>
      jobOf({ containerId: CONTAINER, fileKey: CONTAINER_KEY, ...data });

    /** A Trivy file of one rule tagged with `kind`, as trivy config / fs write it. */
    const trivyKindOf = (kind: string): Buffer[] =>
      toChunks([
        JSON.stringify({
          version: '2.1.0',
          runs: [
            {
              tool: {
                driver: {
                  name: 'Trivy',
                  rules: [
                    {
                      id: 'TRV-1',
                      shortDescription: { text: 'rule' },
                      properties: { tags: [kind] },
                    },
                  ],
                },
              },
              results: [],
            },
          ],
        }),
      ]);

    it('reads the per-container key and completes with the container', async () => {
      withFile(sarifOf([{ tool: 'Opengrep OSS', results: results(2) }]));
      await processor.process(containerJob());

      expect(open).toHaveBeenCalledWith(PROJECT, CONTAINER_KEY);
      expect(completion()).toEqual({
        scanId: SCAN,
        status: 'completed',
        errorCode: '',
        findingsCount: 2,
        toolName: 'opengrep-oss',
        containerId: CONTAINER,
      });
    });

    it('fails with the container when the import fails', async () => {
      withFile([fixture('malformed.sarif')]);
      await processor.process(containerJob());

      expect(completion()).toEqual({
        scanId: SCAN,
        status: 'failed',
        errorCode: 'IMPORT_INVALID_SARIF',
        findingsCount: 0,
        toolName: '',
        containerId: CONTAINER,
      });
    });

    it('sends no container_id for an import without a container', async () => {
      withFile(sarifOf([{ tool: 'Semgrep', results: results(1) }]));
      await processor.process(jobOf());
      expect(completion()).not.toHaveProperty('containerId');
    });

    it("sends the job's severities as the batches' vulnerabilityType", async () => {
      withFile(sarifOf([{ tool: 'Opengrep OSS', results: results(3) }]));
      await processor.process(containerJob({ severities: 'high' }));

      expect(batches().length).toBeGreaterThan(0);
      for (const batch of batches()) {
        expect(batch.vulnerabilityType).toBe('high');
      }
    });

    it('sends every severity when the job has none, as today', async () => {
      withFile(sarifOf([{ tool: 'Opengrep OSS', results: results(3) }]));
      await processor.process(containerJob());

      expect(batches().length).toBeGreaterThan(0);
      for (const batch of batches()) {
        expect(batch.vulnerabilityType).toBe('critical,high,medium,low');
      }
    });

    it("sends the job's severities to the SCA ingestion", async () => {
      withFile([fixture('trivy-fs-sca.sarif')]);
      await processor.process(
        containerJob({ category: 'sca', severities: 'critical,high' }),
      );

      expect(ingestMatched).toHaveBeenCalledTimes(1);
      expect(ingestMatched.mock.calls[0][0]).toEqual({
        projectId: PROJECT,
        scanId: SCAN,
        vulnerabilityType: 'critical,high',
      });
    });

    it('finalizes a category-sca import of tool trivy (trivy-fs) as sca', async () => {
      withFile(trivyKindOf('vulnerability'));
      await processor.process(containerJob({ category: 'sca' }));

      expect(registerScanQueueType).toHaveBeenCalledWith(SCAN, 'sca');
      expect(tryAcquireFinalizeLock).toHaveBeenCalledWith('sca', SCAN, 'trivy');
      expect(scaFinalizeScan).toHaveBeenCalledWith(PROJECT, SCAN);
      expect(finalizeScan).not.toHaveBeenCalled();
      expect(clearBatchTracking).toHaveBeenCalledWith('sca', SCAN, 'trivy');
      expect(onScannerFinalized).toHaveBeenCalledWith(
        SCAN,
        PROJECT,
        'sca',
        'trivy',
      );
      expect(completion()).toMatchObject({
        status: 'completed',
        toolName: 'trivy',
        containerId: CONTAINER,
      });
    });

    it('finalizes a category-iac import of tool trivy (trivy-config) as iac', async () => {
      withFile(trivyKindOf('misconfiguration'));
      await processor.process(containerJob({ category: 'iac' }));

      expect(registerScanQueueType).toHaveBeenCalledWith(SCAN, 'sast-iac');
      expect(tryAcquireFinalizeLock).toHaveBeenCalledWith(
        'sast-iac',
        SCAN,
        'trivy',
      );
      expect(finalizeScan).toHaveBeenCalledWith(PROJECT, SCAN, 'trivy', 'iac');
      expect(scaFinalizeScan).not.toHaveBeenCalled();
      expect(onScannerFinalized).toHaveBeenCalledWith(
        SCAN,
        PROJECT,
        'sast-iac',
        'trivy',
      );
      expect(completion()).toMatchObject({
        status: 'completed',
        toolName: 'trivy',
        containerId: CONTAINER,
      });
    });
  });

  it('never logs a path or a rule text', async () => {
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
      (level) => jest.spyOn(Logger.prototype, level).mockImplementation(),
    );
    const SECRET_PATH = 'src/very-private-module/handler.py';
    const RULE_TEXT = 'Rule text that must never be logged';
    withFile(
      sarifOf([
        {
          tool: 'Semgrep',
          rules: [{ id: 'priv.rule', text: RULE_TEXT }],
          results: [{ ruleId: 'priv.rule', level: 'error', uri: SECRET_PATH }],
        },
      ]),
    );
    await processor.process(jobOf());
    // also the failure path, whose error text names the file's content
    processSastIacBatch.mockRejectedValue(
      new Error(`failed on ${SECRET_PATH}: ${RULE_TEXT}`),
    );
    await processor.process(jobOf());

    const logged = spies
      .flatMap((spy) => spy.mock.calls)
      .flat()
      .map((arg) => String(arg))
      .join('\n');
    expect(logged).not.toContain(SECRET_PATH);
    expect(logged).not.toContain(RULE_TEXT);
    expect(logged).not.toContain('priv.rule');
    expect(logged).not.toContain(KEY);
  });
});
