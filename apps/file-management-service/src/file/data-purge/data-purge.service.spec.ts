import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { dialectApi } from '@cybedefend/db-dialect';
import { DataPurgeService, PURGE_BATCH_SIZE } from './data-purge.service';
import { StoragePurge } from './storage-purge';

const mysql = dialectApi('mysql');

const PID = '0b6f3c1e-7d2a-4c8e-9f10-2a3b4c5d6e7f';
const OID = '1c7a4d2f-8e3b-4d9f-a021-3b4c5d6e7f80';
const TID = '2d8b5e30-9f4c-4ea0-b132-4c5d6e7f8091';
const TID2 = '3e9c6f41-a05d-4fb1-8243-5d6e7f8091a2';
const FUTURE = () => Date.now() + 60_000;

function setup(
  purgeAnswer: (prefix: string) => {
    deleted: number;
    complete: boolean;
  } = () => ({
    deleted: 0,
    complete: true,
  }),
  affectedRows = 0,
) {
  const purgePrefix = jest.fn(async (prefix: string) => purgeAnswer(prefix));
  const storage = { purgePrefix } as unknown as StoragePurge;
  const query = jest.fn().mockResolvedValue({ affectedRows });
  const dataSource = { query } as never;
  const logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() } as never;
  const service = new DataPurgeService(dataSource, storage, logger);
  return { service, purgePrefix, query };
}

function expectCode(err: unknown, code: number) {
  expect(err).toBeInstanceOf(RpcException);
  expect((err as RpcException).getError()).toEqual(
    expect.objectContaining({ code }),
  );
}

describe('DataPurgeService', () => {
  it('purges the four prefixes and the file_scan rows of the project', async () => {
    const { service, purgePrefix, query } = setup(
      (p) => ({ deleted: p.startsWith('scan/') ? 4 : 2, complete: true }),
      3,
    );

    const res = await service.purgeProject(PID, OID, FUTURE());

    expect(purgePrefix.mock.calls.map((c) => c[0])).toEqual([
      `scan/${PID}/`,
      `filtered/${PID}/`,
      `reports/${PID}/`,
      `import/${PID}/`,
    ]);
    const deleteScan = mysql.deleteBatch(
      'file_scan',
      mysql.sql`${mysql.ident('projectId')} = ${PID}`,
      PURGE_BATCH_SIZE,
    );
    expect(query).toHaveBeenCalledWith(
      deleteScan.text,
      deleteScan.params,
      true,
    );
    expect(res).toEqual({
      complete: true,
      deleted: {
        'objects:scan': 4,
        'objects:filtered': 2,
        'objects:reports': 2,
        'objects:import': 2,
        file_scan: 3,
      },
    });
  });

  it('deletes file_scan rows in batches until a batch is short', async () => {
    const { service, query } = setup();
    query
      .mockResolvedValueOnce({ affectedRows: PURGE_BATCH_SIZE })
      .mockResolvedValueOnce({ affectedRows: 7 });

    const res = await service.purgeProject(PID, OID, FUTURE());

    expect(query).toHaveBeenCalledTimes(2);
    expect(res.deleted.file_scan).toBe(PURGE_BATCH_SIZE + 7);
    expect(res.complete).toBe(true);
  });

  it('deletes the rows only once every prefix is complete', async () => {
    const { service, purgePrefix, query } = setup((p) => ({
      deleted: 1000,
      complete: !p.startsWith('filtered/'),
    }));

    const res = await service.purgeProject(PID, OID, FUTURE());

    expect(purgePrefix).toHaveBeenCalledTimes(2);
    expect(query).not.toHaveBeenCalled();
    expect(res.complete).toBe(false);
  });

  it('purges the team and organization report folders', async () => {
    const team = setup(() => ({ deleted: 5, complete: true }));
    const teamRes = await team.service.purgeTeam(TID, OID, FUTURE());
    expect(team.purgePrefix.mock.calls.map((c) => c[0])).toEqual([
      `reports/${TID}/`,
    ]);
    expect(team.query).not.toHaveBeenCalled();
    expect(teamRes).toEqual({
      complete: true,
      deleted: { 'objects:reports': 5 },
    });

    const org = setup(() => ({ deleted: 2, complete: true }));
    const orgRes = await org.service.purgeOrganization(
      OID,
      [TID, TID2, TID],
      FUTURE(),
    );
    expect(org.purgePrefix.mock.calls.map((c) => c[0])).toEqual([
      `reports/${OID}/`,
      `reports/${TID}/`,
      `reports/${TID2}/`,
    ]);
    expect(org.query).not.toHaveBeenCalled();
    expect(orgRes).toEqual({
      complete: true,
      deleted: { 'objects:reports': 6 },
    });
  });

  it.each(['', 'x', '%', '*', 'reports', '../', '----', `${PID}/`, ` ${PID}`])(
    'refuses a malformed id and deletes nothing: %j',
    async (bad) => {
      const { service, purgePrefix, query } = setup();
      const calls: Promise<unknown>[] = [
        service.purgeProject(bad, OID, FUTURE()),
        service.purgeProject(PID, bad, FUTURE()),
        service.purgeTeam(bad, OID, FUTURE()),
        service.purgeTeam(TID, bad, FUTURE()),
        service.purgeOrganization(bad, [], FUTURE()),
        service.purgeOrganization(OID, [TID, bad], FUTURE()),
      ];
      for (const call of calls) {
        const err = await call.catch((e: unknown) => e);
        expectCode(err, status.INVALID_ARGUMENT);
      }
      expect(purgePrefix).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('refuses a missing id and deletes nothing', async () => {
    const { service, purgePrefix, query } = setup();
    const err = await service
      .purgeProject(undefined as unknown as string, OID, FUTURE())
      .catch((e: unknown) => e);
    expectCode(err, status.INVALID_ARGUMENT);
    // No team list is an organization without teams, not a malformed id.
    const res = await service.purgeOrganization(
      OID,
      undefined as unknown as string[],
      FUTURE(),
    );
    expect(res.complete).toBe(true);
    expect(query).not.toHaveBeenCalled();
    expect(purgePrefix).toHaveBeenCalledTimes(1);
  });

  it('accepts an id in upper case and purges its lower-case folders', async () => {
    const { service, purgePrefix } = setup();
    await service.purgeProject(PID.toUpperCase(), OID, FUTURE());
    expect(purgePrefix.mock.calls[0][0]).toBe(`scan/${PID}/`);
  });

  it('stops at the deadline and resumes', async () => {
    const { service, purgePrefix, query } = setup(() => ({
      deleted: 1000,
      complete: true,
    }));

    const res = await service.purgeProject(PID, OID, Date.now() - 1);

    expect(purgePrefix).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
    expect(res.complete).toBe(false);
    expect(res.deleted['objects:scan']).toBe(1000);
  });

  it('with the deadline passed deletes at most one batch of rows', async () => {
    const { service, query } = setup();
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      query.mockImplementation(async () => {
        now += 100_000;
        return { affectedRows: PURGE_BATCH_SIZE };
      });

      const res = await service.purgeProject(PID, OID, now + 50_000);

      expect(query).toHaveBeenCalledTimes(1);
      expect(res.complete).toBe(false);
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('is idempotent', async () => {
    const { service } = setup();

    const project = await service.purgeProject(PID, OID, FUTURE());
    const again = await service.purgeProject(PID, OID, FUTURE());
    const team = await service.purgeTeam(TID, OID, FUTURE());
    const org = await service.purgeOrganization(OID, [TID], FUTURE());

    for (const res of [project, again]) {
      expect(res).toEqual({
        complete: true,
        deleted: {
          'objects:scan': 0,
          'objects:filtered': 0,
          'objects:reports': 0,
          'objects:import': 0,
          file_scan: 0,
        },
      });
    }
    expect(team).toEqual({ complete: true, deleted: { 'objects:reports': 0 } });
    expect(org).toEqual({ complete: true, deleted: { 'objects:reports': 0 } });
  });

  it('a storage failure answers UNAVAILABLE with nothing but the code', async () => {
    const { service, query } = setup();
    (
      service as unknown as { storage: { purgePrefix: jest.Mock } }
    ).storage.purgePrefix.mockRejectedValue(
      new Error(`denied on scan/${PID}/secret-path.zip`),
    );

    const err = await service
      .purgeProject(PID, OID, FUTURE())
      .catch((e: unknown) => e);

    expectCode(err, status.UNAVAILABLE);
    expect(JSON.stringify((err as RpcException).getError())).not.toContain(
      'secret-path',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('a database failure answers UNAVAILABLE', async () => {
    const { service, query } = setup();
    query.mockRejectedValue(new Error('ER_LOCK_WAIT_TIMEOUT'));

    const err = await service
      .purgeProject(PID, OID, FUTURE())
      .catch((e: unknown) => e);

    expectCode(err, status.UNAVAILABLE);
  });
});
