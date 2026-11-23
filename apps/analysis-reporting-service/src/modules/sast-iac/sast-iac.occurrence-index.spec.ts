import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SastIacService } from './sast-iac.service';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { AutoFixRecord } from '../../entities/autofix-record.entity';
import { ResultService } from '../result/result.service';
import { SastIacUtilsService } from './sast-iac.utils';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import { SecurityContextCacheService } from '../security-context/security-context-cache.service';
import { ScanQueueService } from '../scan-queue/scan-queue.service';
import { occurrenceTieBreak } from '../findings-export/fingerprint.util';
import { Logger } from 'nestjs-pino';
import {
  createLoggerMock,
  createMockRepository,
} from '../../test-utils/typeorm-mock.util';

/**
 * Stand-in for `ScanQueueService.allocateOccurrenceIndexes`: one contiguous
 * counter per group, memoised on (group, line) so replaying the same entry
 * re-reads its index instead of consuming a fresh one.
 *
 * The bucketing assertions below need a WORKING allocator, not a stub: since
 * the allocator is the only source of the index, a mock that answers nothing
 * makes every batch unrankable and the group key stops being observable.
 */
const memoAllocator = () => {
  const allocated = new Map<string, number>();
  return async (_q: string, _s: string, _n: string, entries: any[]) =>
    entries.map((e) => {
      // Memoised on the WHOLE entry, tie-break included: the real allocator
      // gives two entries sharing (group, line) but differing in tieBreak two
      // distinct indexes, so a stand-in that keys on (group, line) alone would
      // silently merge exactly the pair the tie-break exists to keep apart.
      const memo = `${e.groupKey}#${e.line}#${e.tieBreak ?? ''}`;
      if (!allocated.has(memo)) {
        const taken = [...allocated.entries()].filter(([k]) =>
          k.startsWith(`${e.groupKey}#`),
        ).length;
        allocated.set(memo, taken);
      }
      return allocated.get(memo)!;
    });
};

/**
 * The occurrence index exists for exactly one reason: two findings that hash
 * identically (same catalogue vuln, same normalised path, same normalised
 * vulnerable snippet) must not receive the same fingerprint. It therefore has
 * to be bucketed on the SAME components the digest consumes, and it has to be
 * unique across the whole (scan, scanner) — not merely within one BullMQ batch.
 */
describe('SastIacService — occurrence index', () => {
  let service: SastIacService;
  let scanQueue: { allocateOccurrenceIndexes: jest.Mock };
  let catalogResolver: jest.Mock;
  let processVulnerability: jest.Mock;
  let logger: ReturnType<typeof createLoggerMock>;

  const dto = (over: Record<string, unknown>) => ({
    ruleId: 'rule-a',
    path: 'main.tf',
    codeSnippet: {
      vulnerableStartLine: 10,
      vulnerableEndLine: 14,
      code: [
        { line: 10, content: 'resource "aws_s3_bucket" "b" {' },
        { line: 14, content: '}' },
      ],
    },
    ...over,
  });

  /** Same snippet text, shifted to another line range. */
  const at = (start: number, over: Record<string, unknown> = {}) =>
    dto({
      codeSnippet: {
        vulnerableStartLine: start,
        vulnerableEndLine: start + 4,
        code: [
          { line: start, content: 'resource "aws_s3_bucket" "b" {' },
          { line: start + 4, content: '}' },
        ],
      },
      ...over,
    });

  beforeEach(async () => {
    scanQueue = { allocateOccurrenceIndexes: jest.fn(memoAllocator()) };
    // Default: every rule resolves to ONE catalogue vulnerability. This is the
    // real shape of correspondance_table — it is many-to-one onto the catalogue
    // id (one kics vuln maps to dozens of ruleIds).
    catalogResolver = jest.fn().mockResolvedValue(new Map([['rule-a', 'V']]));
    processVulnerability = jest.fn().mockResolvedValue(undefined);
    logger = createLoggerMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SastIacService,
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: jest.fn().mockReturnValue({}) },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: jest.fn().mockReturnValue({}) },
        },
        {
          provide: 'AGENT_SERVICE',
          useValue: { getService: jest.fn().mockReturnValue({}) },
        },
        { provide: ResultService, useValue: {} },
        {
          provide: SastIacUtilsService,
          useValue: {
            resolveCatalogVulnIds: catalogResolver,
            processVulnerability,
          },
        },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: jest.fn() },
        },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(ScaVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(AutoFixRecord),
          useValue: createMockRepository(),
        },
        { provide: Logger, useValue: logger },
        {
          provide: SecurityContextCacheService,
          useValue: { get: jest.fn(), getUpdatedAt: jest.fn() },
        },
        { provide: ScanQueueService, useValue: scanQueue },
      ],
    }).compile();

    service = module.get(SastIacService);
  });

  const compute = (
    vulns: any[],
    scanner = 'kics',
    catalogVulnIds?: Map<string, string>,
  ) =>
    (service as any).computeOccurrenceIndexes(
      vulns,
      'scan-1',
      scanner,
      catalogVulnIds,
    );

  it('buckets on the catalogue vuln id, not the raw scanner ruleId', async () => {
    // correspondance_table is many-to-one: kics rules R1 and R2 both resolve to
    // catalogue vuln V. Two identical resource blocks at lines 10 and 40 are
    // DISTINCT rows (the legacy tuple includes the lines) but hash to the same
    // digest, so they must be ranked 0 and 1. Keying on ruleId puts them in two
    // buckets and hands both index 0.
    catalogResolver.mockResolvedValue(
      new Map([
        ['R1', 'V'],
        ['R2', 'V'],
      ]),
    );

    const indexes = await compute([
      at(10, { ruleId: 'R1' }),
      at(40, { ruleId: 'R2' }),
    ]);

    expect([...indexes].sort()).toEqual([0, 1]);
  });

  // The batch's catalogue rules are resolved once, before the
  // cybedefend-ignore decision; the ranking reuses that resolution.
  it('buckets on a catalogue resolution handed in, without querying again', async () => {
    const indexes = await compute(
      [at(10, { ruleId: 'R1' }), at(40, { ruleId: 'R2' })],
      'kics',
      new Map([
        ['R1', 'V'],
        ['R2', 'V'],
      ]),
    );

    expect(catalogResolver).not.toHaveBeenCalled();
    expect([...indexes].sort()).toEqual([0, 1]);
  });

  it('buckets on the normalised path, not the raw one', async () => {
    const indexes = await compute([
      at(10, { path: './main.tf' }),
      at(40, { path: 'main.tf' }),
    ]);

    expect([...indexes].sort()).toEqual([0, 1]);
  });

  it('ranks by ascending line regardless of arrival order', async () => {
    const indexes = await compute([at(40), at(10), at(70)]);
    expect(indexes).toEqual([1, 0, 2]);
  });

  it('keeps two genuinely different findings at 0', async () => {
    const other = at(40);
    other.codeSnippet.code[0].content = 'resource "aws_sqs_queue" "q" {';
    const indexes = await compute([at(10), other]);
    expect(indexes).toEqual([0, 0]);
  });

  it('is scoped to the (scan, scanner), not to the BullMQ batch', async () => {
    // SAST/IaC results arrive as N independent jobs per scanner, processed with
    // concurrency >= 3 and across KEDA-scaled pods. A batch-local ranking gives
    // index 0 to a finding in batch 0 AND to its twin in batch 1 — one
    // identical fingerprint for two distinct rows.
    scanQueue.allocateOccurrenceIndexes.mockImplementation(memoAllocator());

    const batch0 = await compute([at(10), at(40)]);
    const batch1 = await compute([at(70)]);

    expect(batch0).toEqual([0, 1]);
    expect(batch1).toEqual([2]);
  });

  it('is idempotent when a failed BullMQ job is retried', async () => {
    scanQueue.allocateOccurrenceIndexes.mockImplementation(memoAllocator());

    const first = await compute([at(10), at(40)]);
    const retry = await compute([at(10), at(40)]);
    expect(retry).toEqual(first);
  });

  /**
   * Defect 3 in the path that actually runs.
   *
   * Two rows are distinct today when they differ only in `vulnerableEndLine` or
   * in `language` — both sit in `dupWhereBase` and in the `existingVulnsMap`
   * predicate, and NEITHER is hashed by `computeCodeFingerprint` nor present in
   * `codeOccurrenceKey`. Such a pair sharing a start line was ranked purely by
   * its position in the scanner's output, so the two findings SWAPPED
   * fingerprints between two scans of unchanged code and every per-fingerprint
   * state (dismissal, status, first-seen) followed the wrong finding.
   *
   * The end line and the language are available at this call site, so they are
   * handed to the allocator as a stable discriminator.
   */
  describe('same-line tie-break', () => {
    const shortSpan = dto({
      language: 'java',
      codeSnippet: {
        vulnerableStartLine: 10,
        vulnerableEndLine: 12,
        code: [{ line: 10, content: 'exec(cmd);' }],
      },
    });
    const longSpan = dto({
      language: 'java',
      codeSnippet: {
        vulnerableStartLine: 10,
        vulnerableEndLine: 40,
        code: [{ line: 10, content: 'exec(cmd);' }],
      },
    });

    it('gives each finding the same index whatever order the scanner emitted', async () => {
      scanQueue.allocateOccurrenceIndexes.mockImplementation(memoAllocator());
      const forwards = await compute([shortSpan, longSpan]);

      scanQueue.allocateOccurrenceIndexes.mockImplementation(memoAllocator());
      const backwards = await compute([longSpan, shortSpan]);

      // shortSpan keeps index 0 and longSpan keeps index 1 across both scans.
      expect(forwards).toEqual([0, 1]);
      expect(backwards).toEqual([1, 0]);
    });

    it('separates two same-line findings that differ only by language', async () => {
      scanQueue.allocateOccurrenceIndexes.mockImplementation(memoAllocator());
      const a = { ...shortSpan, language: 'java' };
      const b = { ...shortSpan, language: 'kotlin' };

      const forwards = await compute([a, b]);
      scanQueue.allocateOccurrenceIndexes.mockImplementation(memoAllocator());
      const backwards = await compute([b, a]);

      expect(forwards).toEqual([0, 1]);
      expect(backwards).toEqual([1, 0]);
    });

    /**
     * The call site must BUILD the tie-break with `occurrenceTieBreak`, not with
     * a template literal.
     *
     * The first cut asserted only that (endLine 12, 'java') and (endLine 1,
     * '2java') produce two different strings. That is vacuous: it holds for
     * `${endLine}${language}`-with-any-non-empty-separator too, so it passes for
     * `${endLine} ${language}` — the very spelling it was written to forbid.
     * Injectivity of the ENCODING is pinned where the encoding lives
     * (fingerprint.util.spec.ts, with a case a raw join genuinely loses); what
     * has to be pinned HERE is that this call site uses that encoding, since a
     * raw join is what a future edit would reach for.
     */
    it('builds the tie-break with the length-prefixed framing, not a raw join', async () => {
      scanQueue.allocateOccurrenceIndexes.mockImplementation(memoAllocator());

      await compute([
        dto({
          language: 'java',
          codeSnippet: {
            vulnerableStartLine: 10,
            vulnerableEndLine: 12,
            code: [{ line: 10, content: 'exec(cmd);' }],
          },
        }),
      ]);

      const entries = scanQueue.allocateOccurrenceIndexes.mock.calls.at(-1)![3];
      expect(entries).toHaveLength(1);
      expect(entries[0].tieBreak).toBe(occurrenceTieBreak([12, 'java']));
      // And it is not any raw join of the same two components.
      expect(entries[0].tieBreak).not.toBe('12java');
      expect(entries[0].tieBreak).not.toBe('12 java');
    });

    it('separates two same-line findings that differ only by end line', async () => {
      scanQueue.allocateOccurrenceIndexes.mockImplementation(memoAllocator());
      const forwards = await compute([shortSpan, longSpan]);
      const entries = scanQueue.allocateOccurrenceIndexes.mock.calls.at(-1)![3];

      expect(entries[0].tieBreak).not.toBe(entries[1].tieBreak);
      expect([...forwards].sort()).toEqual([0, 1]);
    });

    // `Number(v?.codeSnippet?.vulnerableStartLine ?? 0)` is NaN for any
    // non-numeric non-null value, and `a.line - b.line` on a NaN is NaN — an
    // intransitive comparator whose permutation is whatever V8's sort produces
    // for that array length. The value handed to the allocator must be the same
    // coercion the allocator and the batch-local fallback apply, or the three
    // disagree on which finding ranks first.
    it('coerces a non-finite start line the same way the allocator does', async () => {
      scanQueue.allocateOccurrenceIndexes.mockImplementation(memoAllocator());

      await compute([
        dto({
          codeSnippet: {
            vulnerableStartLine: 'not-a-line',
            vulnerableEndLine: 12,
            code: [{ line: 10, content: 'exec(cmd);' }],
          },
        }),
      ]);

      const entries = scanQueue.allocateOccurrenceIndexes.mock.calls.at(-1)![3];
      expect(entries[0].line).toBe(Number.POSITIVE_INFINITY);
      expect(Number.isNaN(entries[0].line)).toBe(false);
    });
  });

  /**
   * A failed catalogue resolution used to degrade the bucket key to
   * ('', path, snippet), on the argument that a COARSER bucket can only merge
   * and therefore can never collide. That argument holds for a batch-LOCAL
   * ranking and is false for the allocator actually in use: uniqueness comes
   * from a Redis counter keyed on the bucket's own hash
   * (`hincrby key n:<groupId>`), so changing the bucket key RE-NAMESPACES the
   * counter and restarts it at 0.
   *
   * Concrete failure it produced — scan S, scanner kics, two identical
   * Terraform blocks (same catalogue vuln V, same path, same normalised
   * snippet) at lines 10 and 400, split across batches A and B by the chunker:
   * A resolves normally (group GA, index 0); B hits a transient MySQL error,
   * degrades to group GB, gets a fresh counter, index 0. Both rows are still
   * created — `processVulnerability` does its OWN per-finding lookup, which
   * succeeded — so both digests hash V, the same normalised path, the same
   * snippet and occurrenceIndex 0. One fingerprint, two rows: a permanent
   * ER_DUP_ENTRY under the planned UNIQUE index, and two findings merged into
   * one identity after the matching switch-over.
   *
   * The only safe degradation is therefore to allocate NOTHING: the batch's new
   * detections are written with a NULL fingerprint (which is what the entire
   * pre-existing corpus carries, and which MySQL treats as distinct in a unique
   * index) and the next healthy scan backfills them.
   */
  describe('when the catalogue resolution fails', () => {
    beforeEach(() => {
      catalogResolver.mockRejectedValue(new Error('DB blip'));
    });

    it('refuses to rank the batch instead of re-namespacing the counter', async () => {
      const indexes = await compute([at(10), at(40)]);
      expect(indexes).toEqual([null, null]);
    });

    it('never consumes a cross-batch counter for a batch it cannot bucket', async () => {
      await compute([at(10)]);
      expect(scanQueue.allocateOccurrenceIndexes).not.toHaveBeenCalled();
    });

    it('cannot hand a healthy batch of the same scan a colliding index', async () => {
      // The realistic shape: concurrency 3 across KEDA-scaled pods against one
      // MySQL means a single batch's query can fail while its siblings succeed.
      scanQueue.allocateOccurrenceIndexes.mockImplementation(memoAllocator());

      catalogResolver.mockResolvedValue(new Map([['rule-a', 'V']]));
      const healthy = await compute([at(10)]);
      catalogResolver.mockRejectedValue(new Error('DB blip'));
      const degraded = await compute([at(400)]);

      expect(healthy).toEqual([0]);
      // NOT [0] — that is the duplicate fingerprint the design exists to
      // prevent. `null` means "unrankable", i.e. write no fingerprint.
      expect(degraded).toEqual([null]);
    });

    it('reports the degradation instead of failing the batch', async () => {
      await compute([at(10)]);
      const reported = [
        ...logger.error.mock.calls,
        ...logger.warn.mock.calls,
      ].map((c: any[]) => String(c[0]));
      expect(reported.some((m) => m.includes('catalogue'))).toBe(true);
    });
  });

  it('threads the unrankable marker to processVulnerability without coercing it to 0', async () => {
    // `occurrenceIndexes?.[i] ?? 0` would turn the marker back into index 0 —
    // exactly the collision the marker exists to avoid.
    await (service as any).processVulnsWithConcurrency(
      [at(10)],
      new Map(),
      [],
      [],
      'scan-1',
      'p1',
      'kics',
      'iac',
      'main',
      1,
      1,
      [null],
    );

    expect(processVulnerability).toHaveBeenCalledTimes(1);
    expect(processVulnerability.mock.calls[0][9]).toBeNull();
  });

  it('returns an empty array for an empty batch without touching Redis', async () => {
    await expect(compute([])).resolves.toEqual([]);
    expect(scanQueue.allocateOccurrenceIndexes).not.toHaveBeenCalled();
  });

  /**
   * The allocator's own failure modes must degrade EXACTLY like the catalogue
   * failure above, and for the same reason: a batch cannot rank a group it only
   * partly contains, so a batch-local ranking hands index 0 to a finding in
   * batch A AND to its twin in batch B — one fingerprint on two rows.
   *
   * Never guess an index. A NULL fingerprint is a hole the next healthy scan
   * fills; a duplicate identity never self-heals.
   */
  describe('when the cross-batch allocator fails', () => {
    it('refuses to rank the batch when the allocator is ABSENT', async () => {
      delete (scanQueue as any).allocateOccurrenceIndexes;
      await expect(compute([at(10), at(400)])).resolves.toEqual([null, null]);
    });

    it('refuses to rank the batch when the allocator THROWS', async () => {
      scanQueue.allocateOccurrenceIndexes.mockRejectedValue(
        new Error('Redis client not available'),
      );
      // Resolving at all is the point: ingestion must never fail because the
      // allocator is down — it just writes no fingerprint for this batch.
      await expect(compute([at(10), at(400)])).resolves.toEqual([null, null]);
    });

    it('never returns a batch-local ranking as a fallback', async () => {
      // The batch-local ranking for this input is [0, 1]. Neither failure path
      // may produce it: batch A ranking 0 and batch B ranking 0 is the
      // collision the cross-batch counter exists to prevent.
      delete (scanQueue as any).allocateOccurrenceIndexes;
      const absent = await compute([at(10), at(400)]);

      (scanQueue as any).allocateOccurrenceIndexes = jest
        .fn()
        .mockRejectedValue(new Error('redis down'));
      const threw = await compute([at(10), at(400)]);

      expect(absent).not.toEqual([0, 1]);
      expect(threw).not.toEqual([0, 1]);
    });

    it('reports the degradation at error level, not as a warning', async () => {
      // This suppresses findings from the export until the next scan — it is
      // not a routine condition.
      scanQueue.allocateOccurrenceIndexes.mockRejectedValue(
        new Error('Redis client not available'),
      );
      await compute([at(10), at(400)]);
      expect(
        logger.error.mock.calls.some((c: any[]) =>
          String(c[0]).includes('occurrence'),
        ),
      ).toBe(true);
    });

    it('does not let a partial allocator response fall back per-entry', async () => {
      // A short or sparse array from the allocator must not silently reuse the
      // local rank for the missing entries — same collision by another route.
      scanQueue.allocateOccurrenceIndexes.mockResolvedValue([0]);
      const out = await compute([at(10), at(400)]);
      expect(out[1]).toBeNull();
    });

    it('propagates an EXPLICIT null from the allocator', async () => {
      // The allocator returns null per entry when its counter hash was lost
      // mid-scan and the index it computed is already claimed. Coercing that to
      // 0 here would undo the guard inside allocateOccurrenceIndexes.
      scanQueue.allocateOccurrenceIndexes.mockResolvedValue([0, null]);
      await expect(compute([at(10), at(400)])).resolves.toEqual([0, null]);
    });

    it('still uses the allocator result on the happy path', async () => {
      scanQueue.allocateOccurrenceIndexes.mockResolvedValue([0, 1]);
      await expect(compute([at(10), at(400)])).resolves.toEqual([0, 1]);
    });
  });
});
