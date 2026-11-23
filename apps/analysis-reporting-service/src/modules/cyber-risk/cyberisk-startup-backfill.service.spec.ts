import { DataSource } from 'typeorm';
import { CyberiskStartupBackfillService } from './cyberisk-startup-backfill.service';
import { CyberiskRecomputeEnqueuer } from './cyberisk-recompute.enqueuer';

describe('CyberiskStartupBackfillService.onApplicationBootstrap', () => {
  let dataSource: jest.Mocked<DataSource>;
  let enqueuer: jest.Mocked<CyberiskRecomputeEnqueuer>;
  let service: CyberiskStartupBackfillService;

  beforeEach(() => {
    dataSource = { query: jest.fn() } as unknown as jest.Mocked<DataSource>;
    enqueuer = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CyberiskRecomputeEnqueuer>;
    service = new CyberiskStartupBackfillService(dataSource, enqueuer);
  });

  it('enqueues a backfill recompute for every missing project', async () => {
    dataSource.query.mockResolvedValueOnce([
      { projectId: 'p1' },
      { projectId: 'p2' },
    ]);

    await service.onApplicationBootstrap();

    expect(enqueuer.enqueue).toHaveBeenCalledWith('p1', 'backfill');
    expect(enqueuer.enqueue).toHaveBeenCalledWith('p2', 'backfill');
    expect(enqueuer.enqueue).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when no projects are missing a score', async () => {
    dataSource.query.mockResolvedValueOnce([]);

    await service.onApplicationBootstrap();

    expect(enqueuer.enqueue).not.toHaveBeenCalled();
  });

  it('resolves without throwing when the query fails and never enqueues', async () => {
    dataSource.query.mockRejectedValueOnce(new Error('db down'));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(enqueuer.enqueue).not.toHaveBeenCalled();
  });

  it('quotes every camelCase identifier, so PostgreSQL does not fold it', async () => {
    dataSource.query.mockResolvedValueOnce([]);

    await service.onApplicationBootstrap();

    const [sql, params] = dataSource.query.mock.calls[0] as unknown as [
      string,
      unknown[],
    ];
    expect(sql).toContain('SELECT `d`.`projectId` AS `projectId` FROM (');
    expect(sql).toContain(
      'SELECT `projectId` FROM vulnerability_detections_secret',
    );
    expect(sql).toContain('ON r.project_id = `d`.`projectId`');
    expect(sql).toContain(
      "`d`.`projectId` IS NOT NULL AND `d`.`projectId` <> ''",
    );
    expect(sql).not.toMatch(/[^`]projectId[^`]/);
    expect(params).toEqual([]);
  });
});
