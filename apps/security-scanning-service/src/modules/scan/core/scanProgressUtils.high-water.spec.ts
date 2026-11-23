import { Logger } from 'nestjs-pino';
import { Repository } from 'typeorm';

import { ScanProgressUtils } from 'src/modules/scan/core/scanProgressUtils';
import { Scan } from 'src/entities/scan.entity';
import { Container } from 'src/entities/container.entity';
import { Scanner } from 'src/entities/scanner.entity';

class LoggerStub {
  log() {}
  error() {}
  warn() {}
  debug() {}
}

/**
 * One fake `scan` table shared by every pod. Its UPDATE honours the
 * `progressHighWater < :p` condition, as the real one does.
 */
function makeSharedDb(scanId: string, initial = 0) {
  const row = { id: scanId, progressHighWater: initial };
  const updates: number[] = [];
  const fail = { next: false };
  const reads: Array<() => number> = [];
  const repo = {
    createQueryBuilder: () => {
      let set: { progressHighWater?: number } = {};
      let params: Record<string, number> = {};
      const qb: any = {
        update: () => qb,
        set: (v: any) => ((set = v), qb),
        where: (_s: string, p?: any) => ((params = { ...params, ...p }), qb),
        andWhere: (_s: string, p?: any) => ((params = { ...params, ...p }), qb),
        execute: async () => {
          if (fail.next) throw new Error('db down');
          updates.push(set.progressHighWater);
          if (row.progressHighWater < params.p) {
            row.progressHighWater = set.progressHighWater;
            return { affected: 1 };
          }
          return { affected: 0 };
        },
      };
      return qb;
    },
    find: async () => [],
    findOne: async () => ({
      id: scanId,
      progressHighWater: reads.length ? reads[0]() : row.progressHighWater,
    }),
  } as unknown as Repository<any>;
  return { row, updates, repo, fail, reads };
}

function makePod(repo: Repository<any>) {
  return new ScanProgressUtils(
    repo as Repository<Scan>,
    repo as Repository<Container>,
    repo as Repository<Scanner>,
    new LoggerStub() as unknown as Logger,
  );
}

const loadScan = (row: { id: string; progressHighWater: number }) =>
  ({ ...row, state: 'running' }) as unknown as Scan;

describe('ScanProgressUtils — progress high-water shared by every pod', () => {
  it('two pods never answer a lower progress than the one already served', async () => {
    const db = makeSharedDb('scan-1');
    const podA = makePod(db.repo);
    const podB = makePod(db.repo);

    expect(
      await (podA as any).ensureMonotonicProgress(loadScan(db.row), 82),
    ).toBe(82);
    expect(
      await (podB as any).ensureMonotonicProgress(loadScan(db.row), 63),
    ).toBe(82);
    expect(db.row.progressHighWater).toBe(82);
  });

  it('writes nothing when the value does not rise', async () => {
    const db = makeSharedDb('scan-2', 70);
    const pod = makePod(db.repo);

    expect(
      await (pod as any).ensureMonotonicProgress(loadScan(db.row), 60),
    ).toBe(70);
    expect(
      await (pod as any).ensureMonotonicProgress(loadScan(db.row), 70),
    ).toBe(70);
    expect(db.updates).toEqual([]);
  });

  it('caps at 99 and treats a missing high-water as 0', async () => {
    const db = makeSharedDb('scan-3');
    const pod = makePod(db.repo);
    const scan = { id: 'scan-3', state: 'running' } as unknown as Scan;

    expect(await (pod as any).ensureMonotonicProgress(scan, 140)).toBe(99);
    expect(db.updates).toEqual([99]);
  });

  it('a failed UPDATE never fails the read: the computed value is returned', async () => {
    const db = makeSharedDb('scan-4');
    db.fail.next = true;
    const pod = makePod(db.repo);

    expect(
      await (pod as any).ensureMonotonicProgress(loadScan(db.row), 40),
    ).toBe(40);
  });

  it('calculateScanProgress answers the stored high-water over a lower computation', async () => {
    const db = makeSharedDb('scan-5', 82);
    const pod = makePod(db.repo);
    const scan = {
      ...loadScan(db.row),
      containers: [],
      startTime: new Date(),
    } as unknown as Scan;

    expect(await pod.calculateScanProgress(scan)).toBe(82);
    expect(db.updates).toEqual([]);
  });

  it('re-reads the stored value when another pod raised it between the load and the UPDATE', async () => {
    const db = makeSharedDb('scan-6');
    const podB = makePod(db.repo);
    const staleLoad = loadScan(db.row); // pod B loaded 0
    db.row.progressHighWater = 82; // pod A raised it since
    db.reads.push(() => db.row.progressHighWater);

    expect(await (podB as any).ensureMonotonicProgress(staleLoad, 70)).toBe(82);
  });
});
