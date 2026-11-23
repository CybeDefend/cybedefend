import type { DataSource } from 'typeorm';

const createLiveDatabase = jest.fn();
jest.mock('../core/db/live-database', () => ({
  createLiveDatabase: (...args: unknown[]) => createLiveDatabase(...args),
}));

import { openResultsLiveDb } from './results-live-db';
import { SastVulnerabilityDetections } from '../entities/sast-vulnerability-detections.entity';
import { ScaAutoFixRecord } from '../entities/sca-autofix-record.entity';
import { ScaDetectedPackages } from '../entities/sca-detected-packages.entity';

describe('openResultsLiveDb', () => {
  it('opens through createLiveDatabase with migrations, never synchronize', async () => {
    const synchronize = jest.fn();
    const drop = jest.fn().mockResolvedValue(undefined);
    const dataSource = { synchronize } as unknown as DataSource;
    createLiveDatabase.mockResolvedValue({
      dataSource,
      dialect: 'mysql',
      statements: [],
      drop,
    });

    const db = await openResultsLiveDb({
      prefix: 'r',
      envPrefix: 'RESULT_OVERVIEW',
    });

    expect(createLiveDatabase).toHaveBeenCalledTimes(1);
    const [opts] = createLiveDatabase.mock.calls[0] as [
      {
        prefix: string;
        envPrefix: string;
        migrations: string;
        entities: unknown[];
        extra: Record<string, unknown>;
        logger: unknown;
      },
    ];
    expect(opts.prefix).toBe('r');
    expect(opts.envPrefix).toBe('RESULT_OVERVIEW');
    expect(opts.migrations).toBe('track');
    expect(opts.extra).toEqual({ connectionLimit: 20 });
    // The closure of the detection tables: the roots and what they reach.
    expect(opts.entities).toEqual(
      expect.arrayContaining([
        SastVulnerabilityDetections,
        ScaAutoFixRecord,
        ScaDetectedPackages,
      ]),
    );
    expect(opts.entities.every((e) => typeof e === 'function')).toBe(true);
    expect(synchronize).not.toHaveBeenCalled();

    expect(db.dataSource).toBe(dataSource);
    expect(db.queries).toEqual([]);
    await db.close();
    expect(drop).toHaveBeenCalledTimes(1);
  });

  it('builds its entity closure from the core entities only, so it opens on PostgreSQL', async () => {
    // The closure used to be read from ../**/*.entity.ts, src/ee
    // included, and on PostgreSQL the metadata stopped at the ee entity
    // OsvEcosystemSyncState ("datetime" is not a PostgreSQL type).
    const previous = process.env.DB_TYPE;
    process.env.DB_TYPE = 'postgres';
    try {
      createLiveDatabase.mockReset();
      createLiveDatabase.mockResolvedValue({
        dataSource: {} as DataSource,
        dialect: 'postgres',
        statements: [],
        drop: jest.fn().mockResolvedValue(undefined),
      });
      // A fresh module registry for the whole call, so the entity files the
      // closure loads are decorated for PostgreSQL, as in a postgres live run.
      await jest.isolateModulesAsync(async () => {
        const isolated = await import('./results-live-db');
        await isolated.openResultsLiveDb({
          prefix: 'r',
          envPrefix: 'RESULT_OVERVIEW',
        });
      });

      const [opts] = createLiveDatabase.mock.calls[0] as [
        { entities: Array<{ name: string }> },
      ];
      const names = opts.entities.map((e) => e.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'SastVulnerabilityDetections',
          'ScaDetectedPackages',
        ]),
      );
      expect(names).not.toContain('OsvEcosystemSyncState');
    } finally {
      if (previous === undefined) delete process.env.DB_TYPE;
      else process.env.DB_TYPE = previous;
    }
  });
});
