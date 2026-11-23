import { Logger } from 'nestjs-pino';
import { Repository } from 'typeorm';

import {
  ScanProgressUtils,
  SCANNER_WEIGHTS,
  EXPECTED_DURATIONS,
} from 'src/modules/scan/core/scanProgressUtils';
import { Scan } from 'src/entities/scan.entity';
import { Container } from 'src/entities/container.entity';
import { Scanner } from 'src/entities/scanner.entity';

class LoggerStub {
  log() {}
  error() {}
  warn() {}
  debug() {}
}

function makeUtils(): ScanProgressUtils {
  const repo = {} as unknown as Repository<any>;
  return new ScanProgressUtils(
    repo as Repository<Scan>,
    repo as Repository<Container>,
    repo as Repository<Scanner>,
    new LoggerStub() as unknown as Logger,
  );
}

describe('ScanProgressUtils — AI-BOM scanner detection', () => {
  it('classifies an aibom scanner by container name as "aibom"', () => {
    const utils = makeUtils();
    const container = {
      scanner: { name: 'CiscoAiBom' },
      image: 'cybedefend-scanners/aibom-cisco',
      podName: 'scan-pod-aibom-123',
    } as unknown as Container;

    expect((utils as any).getScannerType(container)).toBe('aibom');
  });

  it('classifies an aibom scanner by image name as "aibom"', () => {
    const utils = makeUtils();
    expect(
      (utils as any).getScannerTypeFromImage(
        'cybedefend-scanners/aibom-trusera',
      ),
    ).toBe('aibom');
  });
});

/**
 * Lock the AI-BOM scanner weight and expected duration. Without these
 * assertions a refactor that, say, replaces the literal SCANNER_WEIGHTS
 * record with a generated table could silently drop the 'aibom' key, leaving
 * SCANNER_WEIGHTS[scannerType] undefined → fallback to SCANNER_WEIGHTS.default
 * (1.5) → the progress bar jumps to 100% before the LLM classification
 * has finished. Same risk on EXPECTED_DURATIONS.
 */
describe('ScanProgressUtils — AI-BOM weights & expected durations', () => {
  it('SCANNER_WEIGHTS.aibom is the calibrated 2.5 (matches the agent baseline)', () => {
    expect(SCANNER_WEIGHTS.aibom).toBe(2.5);
  });

  it('EXPECTED_DURATIONS.aibom is a positive ms value', () => {
    expect(typeof EXPECTED_DURATIONS.aibom).toBe('number');
    expect(EXPECTED_DURATIONS.aibom).toBeGreaterThan(0);
  });
});

/**
 * The ScannerType union used to be duplicated between scanner.entity.ts (the
 * single source of truth for the TypeORM enum column) and scanProgressUtils.ts
 * (where the inline 'sast' | 'iac' | … cast appeared inside `fetchExpectedScannerWeights`).
 * Now both reference `ScannerTypeValues` exported by scanner.entity. The
 * tuple drives the TypeORM enum, the inferred `ScannerType` union drives
 * the cast in scanProgressUtils. Adding a scanner type only requires
 * editing the tuple — TS will surface a compile error wherever the union
 * is still narrow.
 */
describe('ScannerType union', () => {
  it('exports ScannerTypeValues as a const tuple containing the aibom value', async () => {
    const { ScannerTypeValues } = await import('src/entities/scanner.entity');
    expect(Array.isArray(ScannerTypeValues)).toBe(true);
    expect(ScannerTypeValues).toContain('sast');
    expect(ScannerTypeValues).toContain('iac');
    expect(ScannerTypeValues).toContain('sca');
    expect(ScannerTypeValues).toContain('container');
    expect(ScannerTypeValues).toContain('secret');
    expect(ScannerTypeValues).toContain('aibom');
  });

  it('every entity ScannerType maps to a SCANNER_WEIGHTS entry OR via getScannerTypeFromImage', () => {
    const utils = makeUtils();
    const canonicalImageBy: Record<string, string> = {
      sast: 'cybedefend-scanners/sast',
      iac: 'cybedefend-scanners/iac',
      sca: 'cybedefend-scanners/sca',
      container: 'cybedefend-scanners/container',
      secret: 'cybedefend-scanners/secret',
      aibom: 'cybedefend-scanners/aibom-cisco',
    };
    for (const t of Object.keys(canonicalImageBy)) {
      const resolved = (utils as any).getScannerTypeFromImage(
        canonicalImageBy[t],
      );
      expect(typeof SCANNER_WEIGHTS[resolved]).toBe('number');
    }
  });
});

/**
 * getScan loads the scan with its containers (and their scanner) in one
 * query; the progress must not read them again on every GetScan of a running
 * scan.
 */
describe('ScanProgressUtils.calculateScanProgress — containers already loaded', () => {
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
  const containersOf = (scanId: string) =>
    [
      {
        id: `${scanId}-sast`,
        scanId,
        status: 'completed',
        step: 'scan completed',
        image: 'cybedefend-scanners/sast',
        podName: 'scan-pod-sast-1',
        scanner: { name: 'Opengrep', scannerType: 'sast' },
        createdAt: minutesAgo(10),
        startedAt: minutesAgo(9),
        finishedAt: minutesAgo(5),
      },
      {
        id: `${scanId}-sca`,
        scanId,
        status: 'running',
        step: 'analyzing',
        image: 'cybedefend-scanners/sca',
        podName: 'scan-pod-sca-1',
        scanner: { name: 'SCA', scannerType: 'sca' },
        createdAt: minutesAgo(10),
        startedAt: minutesAgo(9),
        finishedAt: null,
      },
    ] as unknown as Container[];
  const runningScan = (id: string, containers?: Container[]) =>
    ({
      id,
      projectId: 'p1',
      state: 'running',
      scanType: 'sast,sca',
      startTime: minutesAgo(10),
      createAt: minutesAgo(11),
      containers,
    }) as unknown as Scan;

  function makeUtilsWith(containerFind: jest.Mock) {
    const scanRepo = {
      // The historical durations are best-effort: a failing query is
      // caught and the expected durations are used.
      createQueryBuilder: jest.fn(() => {
        throw new Error('no historical data in this test');
      }),
    };
    const containerRepo = {
      find: containerFind,
      createQueryBuilder: jest.fn(() => {
        throw new Error('no historical data in this test');
      }),
    };
    const scannerRepo = {
      find: jest.fn().mockResolvedValue([
        {
          name: 'Opengrep',
          imageName: 'cybedefend-scanners/sast',
          scannerType: 'sast',
        },
        {
          name: 'SCA',
          imageName: 'cybedefend-scanners/sca',
          scannerType: 'sca',
        },
      ]),
    };
    return new ScanProgressUtils(
      scanRepo as unknown as Repository<Scan>,
      containerRepo as unknown as Repository<Container>,
      scannerRepo as unknown as Repository<Scanner>,
      new LoggerStub() as unknown as Logger,
    );
  }

  it('does not read the containers again when the scan carries them', async () => {
    const find = jest.fn().mockResolvedValue(containersOf('pl-1'));
    const utils = makeUtilsWith(find);

    const scan = runningScan('pl-1', containersOf('pl-1'));
    await utils.calculateScanProgress(scan); // cold progress cache
    await utils.calculateScanProgress(scan); // warm progress cache

    expect(find).not.toHaveBeenCalled();
  });

  it('gives the progress it gives from the containers it reads itself', async () => {
    const fromRepository = await makeUtilsWith(
      jest.fn().mockResolvedValue(containersOf('pl-2')),
    ).calculateScanProgress(runningScan('pl-2'));
    const preloaded = await makeUtilsWith(jest.fn()).calculateScanProgress(
      runningScan('pl-3', containersOf('pl-3')),
    );

    expect(preloaded).toBe(fromRepository);
    expect(preloaded).toBeGreaterThan(1);
  });

  it('still reads the containers when the scan was loaded without them', async () => {
    const find = jest.fn().mockResolvedValue(containersOf('pl-4'));
    const utils = makeUtilsWith(find);

    await utils.calculateScanProgress(runningScan('pl-4'));

    expect(find).toHaveBeenCalledWith({
      where: { scanId: 'pl-4' },
      relations: ['scanner'],
    });
  });
});
