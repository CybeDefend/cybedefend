import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { IsNull } from 'typeorm';
import { Logger } from 'nestjs-pino';

import { ScanStateStore } from './scanStateStore';
import { Scan } from '../../../entities/scan.entity';
import { Container } from '../../../entities/container.entity';

// The conditional UPDATE a scan state is written with:
// `createQueryBuilder().update(Scan).set(...).where(...).andWhere(...)
// .execute()`. It matches the row by default (1 row affected).
const conditionalUpdateMock = () => {
  const qb: any = { execute: jest.fn().mockResolvedValue({ affected: 1 }) };
  for (const step of ['update', 'set', 'where', 'andWhere']) {
    qb[step] = jest.fn(() => qb);
  }
  return qb;
};

const repoMock = () => {
  const m: any = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn(async (entity: any) => entity),
    create: jest.fn((x: any) => x),
  };
  m.stateUpdate = conditionalUpdateMock();
  m.createQueryBuilder = jest.fn(() => m.stateUpdate);
  return m;
};

const loggerMock = () => ({
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
});

describe('ScanStateStore', () => {
  let module: TestingModule;
  let store: ScanStateStore;
  let scanRepo: ReturnType<typeof repoMock>;
  let containerRepo: ReturnType<typeof repoMock>;

  beforeEach(async () => {
    scanRepo = repoMock();
    containerRepo = repoMock();
    module = await Test.createTestingModule({
      providers: [
        ScanStateStore,
        { provide: getRepositoryToken(Scan), useValue: scanRepo },
        { provide: getRepositoryToken(Container), useValue: containerRepo },
        { provide: Logger, useValue: loggerMock() },
      ],
    }).compile();
    store = module.get(ScanStateStore);
  });

  afterEach(async () => {
    await module.close();
  });

  it('moves a scan held in memory only from one of the given states and mirrors the move on the entity', async () => {
    const startTime = new Date();
    const scan = {
      id: 's1',
      projectId: 'p1',
      state: 'queued',
      metadata: {},
    } as unknown as Scan;

    const moved = await store.moveScanState(scan, ['queued'], 'running', {
      startTime,
    });

    expect(moved).toBe(true);
    expect(scan.state).toBe('running');
    expect(scan.startTime).toBe(startTime);
    // The precondition lives in the WHERE of the one conditional UPDATE.
    const whereCalls = [
      ...scanRepo.stateUpdate.where.mock.calls,
      ...scanRepo.stateUpdate.andWhere.mock.calls,
    ];
    expect(whereCalls.map(([clause]) => clause)).toContain(
      'state IN (:...fromStates)',
    );
    expect(scanRepo.stateUpdate.execute).toHaveBeenCalledTimes(1);
  });

  it('removes the registry credentials when the move leaves the queue', async () => {
    const scan = {
      id: 's1',
      projectId: 'p1',
      state: 'queued',
      metadata: { registryAuth: { __encrypted: true }, imageToScan: 'img' },
    } as unknown as Scan;

    const moved = await store.moveScanState(scan, ['queued'], 'cancelled');

    expect(moved).toBe(true);
    expect(scan.state).toBe('cancelled');
    expect(scan.metadata.registryAuth).toBeUndefined();
    expect(scan.metadata.imageToScan).toBe('img');
  });

  it('answers false when the row left the states meanwhile', async () => {
    scanRepo.stateUpdate.execute.mockResolvedValueOnce({ affected: 0 });
    const scan = {
      id: 's1',
      projectId: 'p1',
      state: 'queued',
      metadata: {},
    } as unknown as Scan;

    const moved = await store.moveScanState(scan, ['queued'], 'running');

    expect(moved).toBe(false);
    expect(scan.state).toBe('queued');
  });

  it('refuses a code scan on a branch that already has one active', async () => {
    scanRepo.findOne.mockResolvedValueOnce({ id: 's-other' });

    let err: unknown;
    try {
      await store.checkExistingScan('p1', 'main');
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(RpcException);
    expect((err as RpcException).getError()).toMatchObject({
      code: 6,
      message: 'A scan is already in progress',
    });
    expect(status.ALREADY_EXISTS).toBe(6);
  });

  it('lets a code scan start when no active scan holds the branch', async () => {
    scanRepo.findOne.mockResolvedValueOnce(null);

    const answer = await store.checkExistingScan('p1', 'main');

    expect(answer).toEqual({
      message: 'No existing scan in progress',
      exists: true,
    });
  });

  // An import scan (`importFormat` set) blocks nothing and is
  // blocked by nothing — the import watchdog owns its lifecycle, not this
  // check.
  it('never lets an import scan block a code scan on its branch', async () => {
    scanRepo.findOne.mockResolvedValueOnce(null);

    await store.checkExistingScan('p1', 'main');

    const where = scanRepo.findOne.mock.calls[0][0].where as Array<
      Record<string, unknown>
    >;
    expect(where).toHaveLength(2);
    for (const alternative of where) {
      expect(alternative.importFormat).toEqual(IsNull());
    }
  });
});
