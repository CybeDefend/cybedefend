import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { Like } from 'typeorm';

import { ScanValidation } from './scanValidation';
import { Scan } from '../../../entities/scan.entity';
import { Container } from '../../../entities/container.entity';

/**
 * The agent reports its analysis progress through UpdateScan, and the receiver
 * used to locate the container strictly by podName — the fallback had been
 * removed on the stated assumption that "podName is always transmitted
 * correctly".
 *
 * It is not. The agent gives up resolving its own pod name when the scan
 * lookup fails, and podName is `optional` in UpdateScanRequest. The two
 * assumptions closed on each other: the agent sent nothing, and had it sent
 * something the receiver would have dropped it. Unrelated failures then all
 * show up as "the scan finished, no finding was analysed, nothing was
 * logged".
 */
describe('ScanValidation.findContainerForUpdate', () => {
  let validation: ScanValidation;
  let containerRepository: { findOne: jest.Mock };

  const agentContainer = { id: 'c-agent', image: 'agent-service' } as Container;
  const podContainer = { id: 'c-pod', podName: 'agent-pod-1' } as Container;

  beforeEach(async () => {
    containerRepository = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanValidation,
        { provide: getRepositoryToken(Scan), useValue: { findOne: jest.fn() } },
        {
          provide: getRepositoryToken(Container),
          useValue: containerRepository,
        },
        {
          provide: Logger,
          useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
        },
      ],
    }).compile();

    validation = module.get<ScanValidation>(ScanValidation);
  });

  it('uses the pod-matched container when podName resolves', async () => {
    containerRepository.findOne.mockResolvedValueOnce(podContainer);

    const found = await validation.findContainerForUpdate(
      'agent-pod-1',
      'scan-1',
    );

    expect(found).toBe(podContainer);
    expect(containerRepository.findOne).toHaveBeenCalledTimes(1);
  });

  it('falls back to the agent container when podName is empty', async () => {
    // The agent now reports without a podName rather than dropping the update.
    containerRepository.findOne.mockResolvedValueOnce(agentContainer);

    const found = await validation.findContainerForUpdate('', 'scan-1');

    expect(found).toBe(agentContainer);
    // It must not waste a lookup on an empty pod name.
    expect(containerRepository.findOne).toHaveBeenCalledTimes(1);
    expect(containerRepository.findOne).toHaveBeenCalledWith({
      where: { scanId: 'scan-1', image: Like('%agent%') },
    });
  });

  it('falls back to the agent container when podName matches nothing', async () => {
    // A pod that was recreated, or a name resolved from a stale scan snapshot.
    containerRepository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(agentContainer);

    const found = await validation.findContainerForUpdate(
      'stale-pod',
      'scan-1',
    );

    expect(found).toBe(agentContainer);
    expect(containerRepository.findOne).toHaveBeenCalledTimes(2);
  });

  it('returns null when the scan has no agent container at all', async () => {
    containerRepository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const found = await validation.findContainerForUpdate(
      'stale-pod',
      'scan-1',
    );

    expect(found).toBeNull();
  });
});

/**
 * A closed container is final for
 * UpdateScan. A late or replayed report — the agent reporting progress on
 * the project's last scan during an on-demand reanalysis, a
 * scanner pod reporting after its end — reopened the container and, through
 * the scan-state recompute, the scan and its organisation slot.
 *
 * Fields absent from the request used to be overwritten too: every progress
 * update without `startedAt` wrote `startedAt = null`, and a counter of 0 was
 * never written.
 */
describe('ScanValidation.updateContainerStatus', () => {
  // The same chainable stand-in as scan.service.spec.ts for the conditional
  // UPDATE: `createQueryBuilder().update().set().where().andWhere().execute()`.
  // It wins by default (1 row affected).
  const conditionalUpdateMock = () => {
    const qb: Record<string, jest.Mock> = {
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    for (const step of ['update', 'set', 'where', 'andWhere']) {
      qb[step] = jest.fn(() => qb);
    }
    return qb;
  };
  /** The WHERE of the conditional UPDATE: its fragments and merged parameters. */
  const conditionalUpdateWhere = (qb: Record<string, jest.Mock>) => {
    const calls = [...qb.where.mock.calls, ...qb.andWhere.mock.calls];
    return {
      clauses: calls.map(([clause]) => String(clause)),
      params: Object.assign({}, ...calls.map(([, params]) => params ?? {})),
    };
  };

  let validation: ScanValidation;
  let containerRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let qb: Record<string, jest.Mock>;
  let logger: { log: jest.Mock; error: jest.Mock; warn: jest.Mock };

  beforeEach(async () => {
    qb = conditionalUpdateMock();
    containerRepository = {
      findOne: jest.fn(),
      save: jest.fn(async (c: Container) => c),
      createQueryBuilder: jest.fn(() => qb),
    };
    logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanValidation,
        { provide: getRepositoryToken(Scan), useValue: { findOne: jest.fn() } },
        {
          provide: getRepositoryToken(Container),
          useValue: containerRepository,
        },
        { provide: Logger, useValue: logger },
      ],
    }).compile();

    validation = module.get<ScanValidation>(ScanValidation);
  });

  it.each(['completed', 'failed', 'completed_degraded'])(
    'ignores any update on a %s container',
    async (closed) => {
      const c = {
        id: 'c1',
        status: closed,
        step: 'agent: done',
        processedVulnerabilities: 12,
      } as Container;

      // Shaped like a reanalysis progress report.
      const res = await validation.updateContainerStatus(c, {
        scanId: 's1',
        state: 'running',
        step: 'agent: analyzed 1/1',
        processedVulnerabilities: 1,
      });

      expect(res).toEqual({ applied: false, reason: 'container_closed' });
      // Nothing is written at all.
      expect(qb.execute).not.toHaveBeenCalled();
      expect(containerRepository.save).not.toHaveBeenCalled();
      expect(c).toMatchObject({
        status: closed,
        step: 'agent: done',
        processedVulnerabilities: 12,
      });
    },
  );

  it('ignores a terminal report on an already closed container', async () => {
    const finishedAt = new Date('2026-09-25T10:00:00Z');
    const c = {
      id: 'c1',
      status: 'failed',
      outcomeReason: 'analysis_timeout',
      finishedAt,
    } as Container;

    const res = await validation.updateContainerStatus(c, {
      scanId: 's1',
      state: 'completed',
      outcomeReason: 'analysis_failed',
    });

    expect(res).toEqual({ applied: false, reason: 'container_closed' });
    expect(c).toMatchObject({
      status: 'failed',
      outcomeReason: 'analysis_timeout',
      finishedAt,
    });
    expect(qb.execute).not.toHaveBeenCalled();
    expect(containerRepository.save).not.toHaveBeenCalled();
  });

  it('ignores a late parsing_completed once the analysis started', async () => {
    const c = {
      id: 'c1',
      status: 'running',
      analysisStartedAt: new Date(),
    } as Container;

    const res = await validation.updateContainerStatus(c, {
      scanId: 's1',
      state: 'parsing_completed',
    });

    expect(res).toEqual({ applied: false, reason: 'analysis_started' });
    expect(c.status).toBe('running');
    expect(qb.execute).not.toHaveBeenCalled();
    expect(containerRepository.save).not.toHaveBeenCalled();
  });

  it("UpdateScan stores the container's history outcome", async () => {
    const c = { id: 'c1', status: 'running' } as Container;
    await validation.updateContainerStatus(c, {
      scanId: 's1',
      state: 'completed',
      historyOutcome: 'ok',
    });
    expect(qb.set).toHaveBeenCalledWith(
      expect.objectContaining({ historyOutcome: 'ok' }),
    );
    expect(c.historyOutcome).toBe('ok');
  });

  it('ignores an unknown history outcome with a warning', async () => {
    const c = { id: 'c1', status: 'running' } as Container;
    await validation.updateContainerStatus(c, {
      scanId: 's1',
      state: 'completed',
      historyOutcome: 'banana',
    });
    const set = qb.set.mock.calls[0][0];
    expect(set).not.toHaveProperty('historyOutcome');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('applies parsing_completed before the analysis started', async () => {
    const c = { id: 'c1', status: 'running' } as Container;

    const res = await validation.updateContainerStatus(c, {
      scanId: 's1',
      state: 'parsing_completed',
      step: 'agent: parsing completed',
    });

    expect(res).toEqual({ applied: true });
    expect(c.status).toBe('parsing_completed');
    expect(qb.set).toHaveBeenCalledWith({
      status: 'parsing_completed',
      step: 'agent: parsing completed',
    });
    expect(qb.execute).toHaveBeenCalledTimes(1);
  });

  // The write is ONE conditional UPDATE of the fields present in the request
  // (review of PR-5). TypeORM's `save` re-reads the row and writes back every
  // column that differs from the loaded entity: an agent progress report read
  // just before a watchdog's conditional close and saved just after it wrote
  // `status = running` back, reopening the container and the scan; a late
  // `parsing_completed` saved just after the AI claim wrote the status AND a
  // null `analysisStartedAt` back, so the analysis could start twice.
  describe('the write is atomic', () => {
    it('updates only the fields present, and only while the container is open', async () => {
      const c = {
        id: 'c1',
        status: 'running',
        startedAt: new Date('2026-09-25T10:00:00Z'),
        analysisStartedAt: null,
        step: 'agent: analyzed 1/5',
      } as Container;

      const res = await validation.updateContainerStatus(c, {
        scanId: 's1',
        state: 'running',
        step: 'agent: analyzed 2/5',
        processedVulnerabilities: 2,
      });

      expect(res).toEqual({ applied: true });
      expect(containerRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(qb.update).toHaveBeenCalledWith(Container);
      // Nothing the request did not carry: no startedAt, version, finishedAt,
      // outcomeReason, total — and above all no analysisStartedAt.
      expect(qb.set).toHaveBeenCalledWith({
        status: 'running',
        step: 'agent: analyzed 2/5',
        processedVulnerabilities: 2,
      });
      const { clauses, params } = conditionalUpdateWhere(qb);
      expect(clauses).toEqual(['id = :id', 'status NOT IN (:...closed)']);
      expect(params.id).toBe('c1');
      expect([...params.closed].sort()).toEqual([
        'completed',
        'completed_degraded',
        'failed',
      ]);
      expect(containerRepository.save).not.toHaveBeenCalled();
    });

    it('also requires analysisStartedAt IS NULL for a parsing_completed', async () => {
      const c = { id: 'c1', status: 'running' } as Container;

      await validation.updateContainerStatus(c, {
        scanId: 's1',
        state: 'parsing_completed',
      });

      const { clauses } = conditionalUpdateWhere(qb);
      expect(clauses).toEqual([
        'id = :id',
        'status NOT IN (:...closed)',
        // The bare camelCase column is quoted per engine, so on MySQL
        // (the default DB_TYPE of a unit run) it comes back with backticks.
        '`analysisStartedAt` IS NULL',
      ]);
    });

    it('writes a closing report with its finishedAt and outcome in the same update', async () => {
      const c = { id: 'c1', status: 'running' } as Container;

      await validation.updateContainerStatus(c, {
        scanId: 's1',
        state: 'completed',
        outcomeReason: 'parse_timeout',
        step: 'agent: analysis skipped (code parsing timed out)',
      });

      expect(qb.set).toHaveBeenCalledWith({
        status: 'completed',
        finishedAt: expect.any(Date),
        outcomeReason: 'parse_timeout',
        step: 'agent: analysis skipped (code parsing timed out)',
      });
    });

    it('is not applied when the row closed meanwhile, and leaves the entity untouched', async () => {
      // The watchdog closed the container between the read and this write.
      qb.execute.mockResolvedValueOnce({ affected: 0 });
      const c = {
        id: 'c1',
        status: 'running',
        step: 'agent: analyzed 3/5',
        processedVulnerabilities: 3,
      } as Container;

      const res = await validation.updateContainerStatus(c, {
        scanId: 's1',
        state: 'running',
        step: 'agent: analyzed 4/5',
        processedVulnerabilities: 4,
      });

      expect(res).toEqual({ applied: false, reason: 'container_closed' });
      // updateScan reads container.step afterwards: nothing was written, so
      // nothing is mirrored.
      expect(c).toMatchObject({
        status: 'running',
        step: 'agent: analyzed 3/5',
        processedVulnerabilities: 3,
      });
    });

    // When the write matches no row, the reason must say why (review of
    // PR-5): the row is re-read — one small SELECT, on this rare path only.
    describe('says why the write matched no row', () => {
      const reRead = (row: Partial<Container> | null) =>
        containerRepository.findOne.mockResolvedValueOnce(row);

      it('reports analysis_started when a parsing_completed loses to the AI claim', async () => {
        // The claim set analysisStartedAt between the check on the loaded
        // entity and the UPDATE.
        qb.execute.mockResolvedValueOnce({ affected: 0 });
        reRead({
          id: 'c1',
          status: 'running',
          analysisStartedAt: new Date(),
        });
        const c = { id: 'c1', status: 'parsing_completed' } as Container;

        const res = await validation.updateContainerStatus(c, {
          scanId: 's1',
          state: 'parsing_completed',
        });

        expect(res).toEqual({ applied: false, reason: 'analysis_started' });
        expect(containerRepository.findOne).toHaveBeenCalledWith({
          where: { id: 'c1' },
          select: { id: true, status: true, analysisStartedAt: true },
        });
        expect(c.status).toBe('parsing_completed');
      });

      it('reports container_closed when the re-read row is closed', async () => {
        qb.execute.mockResolvedValueOnce({ affected: 0 });
        reRead({
          id: 'c1',
          status: 'completed',
          analysisStartedAt: new Date(),
        });
        const c = { id: 'c1', status: 'parsing_completed' } as Container;

        const res = await validation.updateContainerStatus(c, {
          scanId: 's1',
          state: 'parsing_completed',
        });

        expect(res).toEqual({ applied: false, reason: 'container_closed' });
      });

      it('reports container_closed when the row is gone', async () => {
        qb.execute.mockResolvedValueOnce({ affected: 0 });
        reRead(null);
        const c = { id: 'c1', status: 'running' } as Container;

        const res = await validation.updateContainerStatus(c, {
          scanId: 's1',
          state: 'parsing_completed',
        });

        expect(res).toEqual({ applied: false, reason: 'container_closed' });
      });

      it('never blames a started analysis for a refused progress report', async () => {
        // Only a parsing_completed is refused because the analysis started;
        // a progress report can only be refused by a close.
        qb.execute.mockResolvedValueOnce({ affected: 0 });
        reRead({
          id: 'c1',
          status: 'failed',
          analysisStartedAt: new Date(),
        });
        const c = { id: 'c1', status: 'running' } as Container;

        const res = await validation.updateContainerStatus(c, {
          scanId: 's1',
          state: 'running',
          step: 'agent: analyzed 5/9',
        });

        expect(res).toEqual({ applied: false, reason: 'container_closed' });
      });

      it('does not re-read when the write applied', async () => {
        const c = { id: 'c1', status: 'running' } as Container;

        await validation.updateContainerStatus(c, {
          scanId: 's1',
          state: 'running',
          step: 'agent: analyzed 1/9',
        });

        expect(containerRepository.findOne).not.toHaveBeenCalled();
      });
    });

    it('writes nothing, and refuses nothing, for a request that carries no field', async () => {
      const c = { id: 'c1', status: 'running' } as Container;

      const res = await validation.updateContainerStatus(c, { scanId: 's1' });

      expect(res).toEqual({ applied: true });
      expect(qb.execute).not.toHaveBeenCalled();
      expect(containerRepository.save).not.toHaveBeenCalled();
    });
  });

  it('keeps startedAt and version when the request omits them', async () => {
    const started = new Date('2026-09-25T10:00:00Z');
    const c = {
      id: 'c1',
      status: 'running',
      startedAt: started,
      version: '1.2.3',
    } as Container;

    const res = await validation.updateContainerStatus(c, {
      scanId: 's1',
      state: 'running',
      step: 'agent: analyzed 2/5',
    });

    expect(res).toEqual({ applied: true });
    expect(c.startedAt).toBe(started);
    expect(c.version).toBe('1.2.3');
    expect(c.step).toBe('agent: analyzed 2/5');
  });

  it('keeps the status when the request carries no state', async () => {
    const c = { id: 'c1', status: 'running' } as Container;

    await validation.updateContainerStatus(c, {
      scanId: 's1',
      step: 'agent: analyzed 3/5',
    });

    expect(c.status).toBe('running');
  });

  it('writes startedAt and version when the request carries them', async () => {
    const c = { id: 'c1', status: 'starting' } as Container;

    await validation.updateContainerStatus(c, {
      scanId: 's1',
      state: 'running',
      startedAt: '2026-09-25T11:00:00.000Z',
      version: '2.0.0',
    });

    expect(c.startedAt).toEqual(new Date('2026-09-25T11:00:00.000Z'));
    expect(c.version).toBe('2.0.0');
  });

  it('writes counters of 0', async () => {
    const c = {
      id: 'c1',
      status: 'running',
      processedVulnerabilities: 3,
      totalVulnerabilities: 9,
    } as Container;

    await validation.updateContainerStatus(c, {
      scanId: 's1',
      state: 'running',
      processedVulnerabilities: 0,
      totalVulnerabilities: 7,
    });

    expect(c.processedVulnerabilities).toBe(0);
    expect(c.totalVulnerabilities).toBe(7);
  });

  it('keeps the counters when the request omits them', async () => {
    const c = {
      id: 'c1',
      status: 'running',
      processedVulnerabilities: 3,
      totalVulnerabilities: 9,
    } as Container;

    await validation.updateContainerStatus(c, {
      scanId: 's1',
      state: 'running',
    });

    expect(c.processedVulnerabilities).toBe(3);
    expect(c.totalVulnerabilities).toBe(9);
  });

  it('stores a valid outcome reason with a closed state', async () => {
    const c = { id: 'c1', status: 'running' } as Container;

    const res = await validation.updateContainerStatus(c, {
      scanId: 's1',
      state: 'completed',
      outcomeReason: 'parse_timeout',
    });

    expect(res).toEqual({ applied: true });
    expect(c.status).toBe('completed');
    expect(c.outcomeReason).toBe('parse_timeout');
    expect(c.finishedAt).toBeInstanceOf(Date);
  });

  it('drops a malformed outcome reason, with a warning, and one sent with an open state', async () => {
    const closed = { id: 'c1', status: 'running' } as Container;
    await validation.updateContainerStatus(closed, {
      scanId: 's1',
      state: 'completed',
      outcomeReason: 'Parse-Timeout; x',
    });
    expect(closed.outcomeReason ?? null).toBeNull();
    expect(closed.status).toBe('completed');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    // The raw value is not logged: only the container is named.
    expect(String(logger.warn.mock.calls[0][0])).not.toContain('Parse-Timeout');

    const open = { id: 'c2', status: 'running' } as Container;
    await validation.updateContainerStatus(open, {
      scanId: 's1',
      state: 'running',
      outcomeReason: 'parse_timeout',
    });
    expect(open.outcomeReason ?? null).toBeNull();
    expect(open.finishedAt ?? null).toBeNull();
  });
});
