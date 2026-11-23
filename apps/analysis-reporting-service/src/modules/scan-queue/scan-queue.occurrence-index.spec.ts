import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ScanQueueService } from './scan-queue.service';
import { QUEUE_NAMES } from './queue-names';
import { assignOccurrenceIndexes } from '../findings-export/fingerprint.util';

/**
 * In-memory Redis hash mock — only the commands the occurrence allocator uses.
 * Mirrors the mock style already used by the finalization-gate specs so the
 * allocator is exercised through the real getRedisClient() path.
 */
function createHashRedisMock() {
  const hashes = new Map<string, Map<string, string>>();
  const of = (key: string) => {
    if (!hashes.has(key)) hashes.set(key, new Map());
    return hashes.get(key)!;
  };
  return {
    hmget: jest.fn(async (key: string, ...fields: string[]) =>
      fields.map((f) => of(key).get(f) ?? null),
    ),
    hincrby: jest.fn(async (key: string, field: string, by: number) => {
      const next = parseInt(of(key).get(field) ?? '0', 10) + by;
      of(key).set(field, String(next));
      return next;
    }),
    hset: jest.fn(async (key: string, ...pairs: string[]) => {
      for (let i = 0; i < pairs.length; i += 2) {
        of(key).set(pairs[i], pairs[i + 1]);
      }
      return pairs.length / 2;
    }),
    expire: jest.fn(async () => 1),
    del: jest.fn(async (...keys: string[]) => {
      let n = 0;
      for (const k of keys) if (hashes.delete(k)) n++;
      return n;
    }),
    _hashes: hashes,
  };
}

describe('ScanQueueService.allocateOccurrenceIndexes', () => {
  let service: ScanQueueService;
  let redisMock: ReturnType<typeof createHashRedisMock>;

  const queueStub = () => ({
    client: Promise.resolve({ duplicate: () => redisMock }),
  });

  beforeEach(async () => {
    redisMock = createHashRedisMock();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ScanQueueService,
        ...[
          QUEUE_NAMES.SCA,
          QUEUE_NAMES.SAST_IAC,
          QUEUE_NAMES.CONTAINER,
          // SCA_AUTOFIX left QUEUE_NAMES (closed queues).
          QUEUE_NAMES.CVSS_RECALCULATION,
          // AGENT_REANALYSIS left QUEUE_NAMES (closed queues).
          QUEUE_NAMES.CYBERISK_RECOMPUTE,
          QUEUE_NAMES.ORG_STATISTICS_RECOMPUTE,
          QUEUE_NAMES.REPORTS,
          QUEUE_NAMES.AGGREGATED_REPORTS,
          QUEUE_NAMES.VULN_BATCH_UPDATE,
          // The results-import queue.
          QUEUE_NAMES.RESULTS_IMPORT,
        ].map((name) => ({
          provide: getQueueToken(name),
          useValue: queueStub(),
        })),
      ],
    }).compile();

    service = moduleRef.get(ScanQueueService);
    await service.onModuleInit();
  });

  const alloc = (
    entries: { groupKey: string; line: number; tieBreak?: string }[],
  ) => service.allocateOccurrenceIndexes('sast-iac', 's1', 'opengrep', entries);

  it('ranks a group by ascending line inside one batch', async () => {
    await expect(
      alloc([
        { groupKey: 'G', line: 10 },
        { groupKey: 'G', line: 40 },
      ]),
    ).resolves.toEqual([0, 1]);
  });

  it('continues the sequence in the NEXT batch of the same scan+scanner', async () => {
    // This is the whole point: a per-batch ranking would hand index 0 to the
    // third twin as well, producing an identical fingerprint for two rows.
    await alloc([
      { groupKey: 'G', line: 10 },
      { groupKey: 'G', line: 40 },
    ]);
    await expect(alloc([{ groupKey: 'G', line: 70 }])).resolves.toEqual([2]);
  });

  it('keeps separate counters per group', async () => {
    await expect(
      alloc([
        { groupKey: 'G1', line: 10 },
        { groupKey: 'G2', line: 20 },
        { groupKey: 'G1', line: 30 },
      ]),
    ).resolves.toEqual([0, 0, 1]);
  });

  it('is idempotent when a failed BullMQ job is retried', async () => {
    const entries = [
      { groupKey: 'G', line: 10 },
      { groupKey: 'G', line: 40 },
    ];
    const first = await alloc(entries);
    const retry = await alloc(entries);

    expect(retry).toEqual(first);
    // The retry re-reads, it does not consume a fresh range.
    expect(redisMock.hincrby).toHaveBeenCalledTimes(1);
  });

  it('scopes the counter to the scan and the scanner', async () => {
    await alloc([{ groupKey: 'G', line: 10 }]);
    await expect(
      service.allocateOccurrenceIndexes('sast-iac', 's2', 'opengrep', [
        { groupKey: 'G', line: 10 },
      ]),
    ).resolves.toEqual([0]);
    await expect(
      service.allocateOccurrenceIndexes('sast-iac', 's1', 'kics', [
        { groupKey: 'G', line: 10 },
      ]),
    ).resolves.toEqual([0]);
  });

  it('gives DISTINCT indexes to two findings that share (group, line)', async () => {
    // The occurrence index exists to keep two rows that hash identically apart.
    // Two detection rows are distinct today when they differ only in
    // vulnerableEndLine or language (both are in dupWhereBase and in the
    // existingVulnsMap predicate) — neither is hashed by computeCodeFingerprint
    // and neither is in codeOccurrenceKey. Any such pair sharing a start line,
    // and any pair whose vulnerable region normalises to '' (secret/cicd), lands
    // here. Handing them ONE index gives TWO rows ONE fingerprint, which is
    // exactly what makes ADD UNIQUE INDEX fail with ER_DUP_ENTRY.
    await expect(
      alloc([
        { groupKey: 'G', line: 10 },
        { groupKey: 'G', line: 10 },
      ]),
    ).resolves.toEqual([0, 1]);
  });

  it('agrees with the batch-local fallback for the same input', async () => {
    // A finding's persisted identity must not depend on whether Redis answered.
    const entries = [
      { groupKey: 'G', line: 10 },
      { groupKey: 'G', line: 10 },
      { groupKey: 'G', line: 20 },
      { groupKey: 'H', line: 10 },
    ];
    const local = assignOccurrenceIndexes(
      entries,
      (e) => e.groupKey,
      (e) => e.line,
    );
    await expect(alloc(entries)).resolves.toEqual(local);
  });

  // Defect 3, in the path that actually runs. Two findings sharing (group,
  // line) were ranked by their position in the scanner's output, so they SWAPPED
  // fingerprints between two scans of unchanged code and every per-fingerprint
  // state (dismissal, status, first-seen) followed the wrong finding. The
  // caller supplies a stable discriminator; the allocator must order on it
  // BEFORE falling back to arrival order.
  it('ranks a (group, line) tie on the caller tie-break, not on arrival order', async () => {
    await expect(
      alloc([
        { groupKey: 'G', line: 10, tieBreak: 'B' },
        { groupKey: 'G', line: 10, tieBreak: 'A' },
      ]),
    ).resolves.toEqual([1, 0]);
  });

  it('gives one finding the same index whatever order the scanner emitted it in', async () => {
    const A = { groupKey: 'G', line: 10, tieBreak: 'A' };
    const B = { groupKey: 'G', line: 10, tieBreak: 'B' };

    const forwards = await alloc([A, B]);

    // A fresh scan of the same unchanged code, emitted the other way round.
    redisMock._hashes.clear();
    const backwards = await alloc([B, A]);

    // A keeps its index and B keeps its index across the two scans.
    expect(forwards).toEqual([0, 1]);
    expect(backwards).toEqual([1, 0]);
  });

  it('agrees with the batch-local fallback when a tie-break is supplied', async () => {
    const entries = [
      { groupKey: 'G', line: 10, tieBreak: 'B' },
      { groupKey: 'G', line: 10, tieBreak: 'A' },
      { groupKey: 'G', line: 10, tieBreak: 'A' },
      { groupKey: 'G', line: 5, tieBreak: 'Z' },
      { groupKey: 'H', line: 10, tieBreak: 'A' },
    ];
    const local = assignOccurrenceIndexes(
      entries,
      (e) => e.groupKey,
      (e) => e.line,
      (e) => e.tieBreak,
    );
    await expect(alloc(entries)).resolves.toEqual(local);
  });

  // The allocator coerced a non-finite line with `Number(e.line) || 0`, mapping
  // NaN to 0 so it sorted FIRST, while assignOccurrenceIndexes maps it to
  // +Infinity so it sorts LAST. The doc-comment on this method promises the two
  // agree "so a finding's identity does not depend on whether Redis answered";
  // neither side rejects a non-finite line (`lineOf` in sast-iac.service.ts is
  // `Number(v?.codeSnippet?.vulnerableStartLine ?? 0)`, NaN for any non-numeric
  // non-null value), so the coercion has to be identical on both sides.
  it('agrees with the batch-local fallback on a non-finite line', async () => {
    const entries = [
      { groupKey: 'G', line: NaN },
      { groupKey: 'G', line: 10 },
    ];
    const local = assignOccurrenceIndexes(
      entries,
      (e) => e.groupKey,
      (e) => e.line,
    );
    expect(local).toEqual([1, 0]);
    await expect(alloc(entries)).resolves.toEqual(local);
  });

  /**
   * THE RESIDUE, PINNED — the ordering rules above are BATCH-LOCAL.
   *
   * `misses.sort(...)` orders only the misses of the current call and
   * `hincrby(key, n:<groupId>, misses.length)` then hands that call one
   * contiguous block. A group whose members are split across two batches is
   * therefore ordered by which batch reached Redis first, and nothing orders
   * batches: they are N independent BullMQ jobs consumed with concurrency >= 3
   * across KEDA-scaled pods. A group straddling a chunk boundary is the exact
   * case this allocator exists for, so this is not an exotic input.
   *
   * Consequence, since the index is hashed: two findings of one group that land
   * in different batches SWAP fingerprints between two scans of unchanged code
   * whenever the batches race differently — the very defect the tie-break closes
   * inside a batch. It is not closable by a streaming allocator: a dense rank by
   * (line, tie-break) cannot be committed for the first arrival without knowing
   * whether a smaller key is still coming. Closing it means deferring index
   * allocation (and the fingerprint stamp) to the finalize gate, which is a
   * different design, not a tweak.
   *
   * These tests assert the CURRENT, WRONG-BY-DESIGN behaviour on purpose. If one
   * of them starts failing, the residue has been closed — update the JSDoc on
   * `allocateOccurrenceIndexes` and `SastIacService.computeOccurrenceIndexes`
   * with it, do not "fix" the expectation.
   */
  describe('the cross-batch residue (known, unclosed)', () => {
    it('ranks a group split across two batches by batch arrival, NOT by tie-break', async () => {
      const A = { groupKey: 'G', line: 10, tieBreak: 'A' };
      const B = { groupKey: 'G', line: 10, tieBreak: 'B' };

      const aFirst = [...(await alloc([A])), ...(await alloc([B]))];

      // Same two findings, same unchanged code, the other batch consumed first.
      redisMock._hashes.clear();
      const bFirst = [...(await alloc([B])), ...(await alloc([A]))];

      expect(aFirst).toEqual([0, 1]);
      // A correct global ordering would give [1, 0] here (A keeps 0). It gives
      // [0, 1]: whoever arrived first took index 0, so A and B swapped digests.
      expect(bFirst).toEqual([0, 1]);
    });

    it('is not even line-ordered across batches', async () => {
      // Inside one batch line 10 always ranks before line 400. Split across two,
      // the later-arriving line 10 gets the higher index.
      const early = await alloc([{ groupKey: 'G', line: 400 }]);
      const late = await alloc([{ groupKey: 'G', line: 10 }]);

      expect(early).toEqual([0]);
      expect(late).toEqual([1]);
    });
  });

  it('never reuses an index across two DIFFERENT batches sharing a (group, line)', async () => {
    // Chunks of one scanner's output are disjoint, so the same (group, line)
    // appearing in two batches means two distinct findings, not a retry.
    const a = await alloc([
      { groupKey: 'G', line: 10 },
      { groupKey: 'G', line: 20 },
    ]);
    const b = await alloc([
      { groupKey: 'G', line: 10 },
      { groupKey: 'G', line: 30 },
    ]);

    expect(new Set([...a, ...b]).size).toBe(4);
  });

  it('chunks HMGET/HSET so one big batch is not a single unbounded command', async () => {
    // One field per ENTRY (the per-entry ordinal removed the old dedupe), so a
    // large batch would otherwise spread thousands of arguments into a single
    // Redis command.
    const entries = Array.from({ length: 2500 }, (_, i) => ({
      groupKey: `G${i % 7}`,
      line: i,
    }));

    const indexes = await alloc(entries);

    expect(indexes).toHaveLength(2500);
    expect(
      new Set(indexes.map((v, i) => `${entries[i].groupKey}#${v}`)).size,
    ).toBe(2500);

    const maxHmget = Math.max(
      ...redisMock.hmget.mock.calls.map((c: any[]) => c.length - 1),
    );
    const maxHset = Math.max(
      ...redisMock.hset.mock.calls.map((c: any[]) => c.length - 1),
    );
    expect(maxHmget).toBeLessThanOrEqual(1000);
    expect(maxHset).toBeLessThanOrEqual(1000);
  });

  /**
   * The allocator is the SOLE source of index uniqueness (the batch-local
   * fallback was deleted), and its uniqueness rests entirely on one Redis
   * hash field: `hincrby <occurrence-key> n:<groupId>`. HINCRBY RECREATES a
   * missing field at 0, so if that key disappears between two batches of one
   * scan the counter silently restarts and the second batch is handed an index
   * the first already used — two rows, one fingerprint, inside a single scan,
   * with no NULL and no log.
   *
   * The key is not safe: it carries a 24h sliding TTL but lives on the Redis
   * shared with BullMQ, the cross-process caches and rate limiting, so under
   * `maxmemory-policy allkeys-lru` it is evictable at any moment.
   *
   * The guard is a SEPARATE claims key recording which (group, index) pairs
   * this scan has already handed out, and to whom. Two independent keys are
   * evicted independently: losing the counter while the claims survive is
   * detectable, and the entries that would collide come back `null`
   * (unrankable) instead of duplicating an index.
   */
  describe('when the occurrence counter is lost mid-scan', () => {
    const counterKey = () =>
      [...redisMock._hashes.keys()].find((k) => k.endsWith(':occurrence'))!;

    it('refuses to hand out an index the counter already gave away', async () => {
      await expect(alloc([{ groupKey: 'G', line: 10 }])).resolves.toEqual([0]);

      redisMock._hashes.delete(counterKey());

      // WITHOUT the guard this is [0] — the same index as the line-10 twin.
      await expect(alloc([{ groupKey: 'G', line: 400 }])).resolves.toEqual([
        null,
      ]);
    });

    it('does not silently duplicate an index across the whole scan', async () => {
      const a = await alloc([
        { groupKey: 'G', line: 10 },
        { groupKey: 'G', line: 20 },
      ]);
      redisMock._hashes.delete(counterKey());
      const b = await alloc([
        { groupKey: 'G', line: 300 },
        { groupKey: 'G', line: 400 },
      ]);

      const handed = [...a, ...b].filter((v) => v !== null);
      expect(new Set(handed).size).toBe(handed.length);
    });

    it('still lets a RETRY of the same batch re-derive its own index', async () => {
      // The claim is owned by this batch's own field name, so re-claiming it is
      // a retry, not a collision — the retry must not be made unrankable.
      const entries = [
        { groupKey: 'G', line: 10 },
        { groupKey: 'G', line: 40 },
      ];
      const first = await alloc(entries);
      redisMock._hashes.delete(counterKey());

      await expect(alloc(entries)).resolves.toEqual(first);
    });

    it('leaves a group the counter never served alone', async () => {
      await alloc([{ groupKey: 'G', line: 10 }]);
      redisMock._hashes.delete(counterKey());

      // H was never allocated, so index 0 for H is genuinely free.
      await expect(alloc([{ groupKey: 'H', line: 10 }])).resolves.toEqual([0]);
    });

    it('reports the loss at error level rather than failing the batch', async () => {
      const errorSpy = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);

      await alloc([{ groupKey: 'G', line: 10 }]);
      redisMock._hashes.delete(counterKey());
      await alloc([{ groupKey: 'G', line: 400 }]);

      expect(
        errorSpy.mock.calls.some((c: any[]) =>
          String(c[0]).includes('occurrence'),
        ),
      ).toBe(true);
    });

    it('chunks the claim read/write like the counter hash', async () => {
      const entries = Array.from({ length: 2500 }, (_, i) => ({
        groupKey: `G${i % 7}`,
        line: i,
      }));

      await alloc(entries);

      const maxHmget = Math.max(
        ...redisMock.hmget.mock.calls.map((c: any[]) => c.length - 1),
      );
      const maxHset = Math.max(
        ...redisMock.hset.mock.calls.map((c: any[]) => c.length - 1),
      );
      expect(maxHmget).toBeLessThanOrEqual(1000);
      expect(maxHset).toBeLessThanOrEqual(1000);
    });
  });

  it('clearBatchTracking deletes the occurrence hash and its claims', async () => {
    // It holds ~2 fields per finding — orders of magnitude more than every
    // other tracking key combined — on the Redis shared with BullMQ, the
    // cross-process caches and rate limiting. Leaving it to the 24h TTL after
    // the scanner has demonstrably finished is the one asymmetry in
    // clearBatchTracking's del list.
    await alloc([{ groupKey: 'G', line: 10 }]);

    await service.clearBatchTracking('sast-iac', 's1', 'opengrep');

    const deleted: string[] = redisMock.del.mock.calls.flat();
    expect(deleted.some((k) => k.endsWith(':occurrence'))).toBe(true);
    // The claims key is the same order of magnitude — one field per allocated
    // index — so leaving it behind would undo the whole point of the del.
    expect(deleted.some((k) => k.endsWith(':occurrence:claims'))).toBe(true);
    expect(redisMock._hashes.size).toBe(0);
  });

  it('applies the 24h tracking TTL and does nothing on an empty batch', async () => {
    await alloc([{ groupKey: 'G', line: 1 }]);
    expect(redisMock.expire).toHaveBeenCalledWith(
      expect.stringContaining(':occurrence'),
      86400,
    );

    redisMock.hmget.mockClear();
    await expect(alloc([])).resolves.toEqual([]);
    expect(redisMock.hmget).not.toHaveBeenCalled();
  });
});
