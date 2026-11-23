import { GitHistoryCursorService } from './git-history-cursor.service';

const build = (mode: string, row: unknown = null, scan: unknown = null) => {
  const cursors = { findOne: jest.fn().mockResolvedValue(row) };
  const scans = {
    findOne: jest.fn().mockResolvedValue(scan),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const service = new GitHistoryCursorService(
    cursors as never,
    scans as never,
    { mode: () => mode } as never,
  );
  return { service, cursors, scans };
};

describe('GitHistoryCursorService', () => {
  it('community mode answers in_archive without reading the table', async () => {
    const { service, cursors } = build('in_archive');
    await expect(service.getCursor('p', 'main', 'github:o/r')).resolves.toEqual(
      { mode: 'in_archive' },
    );
    expect(cursors.findOne).not.toHaveBeenCalled();
  });

  it('ignores a cursor recorded for another repository', async () => {
    const { service } = build('incremental_artifact', {
      repositoryKey: 'github:old/name',
      tipSha: 'abc',
      complete: true,
      gaps: [],
    });
    await expect(service.getCursor('p', 'main', 'github:o/r')).resolves.toEqual(
      { mode: 'incremental_artifact' },
    );
  });

  it('answers the tip and coverage of a matching row', async () => {
    const { service } = build('incremental_artifact', {
      repositoryKey: 'github:o/r',
      tipSha: 'abc',
      complete: false,
      coveredSince: new Date('2023-01-01T00:00:00Z'),
      gaps: [{ fromSha: 'a', toSha: 'b' }],
      lastPassOutcome: 'ok',
    });
    await expect(service.getCursor('p', 'main', 'github:o/r')).resolves.toEqual(
      {
        mode: 'incremental_artifact',
        tipSha: 'abc',
        coverage: {
          complete: false,
          coveredSince: '2023-01-01T00:00:00.000Z',
          gaps: [{ fromSha: 'a', toSha: 'b' }],
          lastPassOutcome: 'ok',
        },
      },
    );
  });

  it('coverageFor carries the last pass outcome, none included', async () => {
    const { service } = build('incremental_artifact', {
      repositoryKey: 'github:o/r',
      tipSha: null,
      complete: false,
      coveredSince: null,
      gaps: null,
      lastPassOutcome: 'none',
    });
    await expect(service.coverageFor('p', 'main')).resolves.toEqual({
      complete: false,
      coveredSince: undefined,
      gaps: [],
      lastPassOutcome: 'none',
    });
  });

  it('recordPass writes only the historyPass key of the metadata', async () => {
    const pass = { mode: 'full', bytes: '1', firstPass: true } as never;
    const { service, scans } = build('incremental_artifact', null, {
      id: 's1',
      metadata: { keep: 1 },
    });
    await service.recordPass('s1', pass);
    expect(scans.update).toHaveBeenCalledWith(
      { id: 's1' },
      { metadata: { keep: 1, historyPass: pass } },
    );
  });

  describe('advance', () => {
    const pass = (over: object = {}) =>
      ({
        mode: 'full',
        tipSha: 'tipB',
        excludeShas: [],
        bytes: '1',
        firstPass: true,
        repositoryKey: 'github:o/r',
        oldestCommitAt: '2020-01-01T00:00:00Z',
        ...over,
      }) as never;

    const harness = (reads: unknown[]) => {
      const update = jest.fn().mockResolvedValue({});
      const execute = jest.fn().mockResolvedValue({});
      const qb: Record<string, jest.Mock> = {};
      qb.insert = jest.fn(() => qb);
      qb.values = jest.fn(() => qb);
      qb.orIgnore = jest.fn(() => qb);
      qb.execute = execute;
      const findOne = jest.fn();
      reads.forEach((r) =>
        findOne.mockImplementationOnce(async () =>
          typeof r === 'function' ? r() : r,
        ),
      );
      const repo = { findOne, update, createQueryBuilder: () => qb };
      const manager = { getRepository: () => repo };
      const transaction = jest.fn<Promise<unknown>, [(m: unknown) => unknown]>(
        async (cb) => cb(manager),
      );
      const service = new GitHistoryCursorService(
        { manager: { transaction } } as never,
        {} as never,
        { mode: () => 'incremental_artifact' } as never,
      );
      return { service, update, qb, transaction };
    };

    it("a losing first pass is re-judged against the winner's row", async () => {
      const winner = {
        id: 'w',
        repositoryKey: 'github:o/r',
        tipSha: 'tipA',
        coveredSince: null,
        complete: true,
        gaps: [],
        consecutiveFailures: 0,
        lastPassOutcome: 'ok',
      };
      const { service, update, qb } = harness([null, winner]);
      await expect(service.advance('p', 'main', pass(), 'ok')).resolves.toBe(
        false,
      );
      expect(qb.orIgnore).toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('a first pass that inserts the row is not rewritten', async () => {
      let insertedId = '';
      const { service, update, qb } = harness([
        null,
        () => ({ id: insertedId, repositoryKey: 'github:o/r', tipSha: 'tipB' }),
      ]);
      qb.values.mockImplementation((v: { id: string }) => {
        insertedId = v.id;
        return qb;
      });
      await expect(service.advance('p', 'main', pass(), 'ok')).resolves.toBe(
        true,
      );
      expect(update).not.toHaveBeenCalled();
    });

    it('retries the whole transaction once on a deadlock', async () => {
      const { service, transaction } = harness([]);
      transaction.mockRejectedValueOnce({ code: 'ER_LOCK_DEADLOCK' });
      transaction.mockImplementationOnce(async () => false);
      await expect(service.advance('p', 'main', pass(), 'ok')).resolves.toBe(
        false,
      );
      expect(transaction).toHaveBeenCalledTimes(2);
    });
  });
});

describe('GitHistoryCursorService.applyFinalizedScan', () => {
  const pass = {
    mode: 'incremental',
    tipSha: 'tip',
    baseTipSha: 'base',
    excludeShas: [],
    bytes: '10',
    firstPass: false,
    repositoryKey: 'github:o/r',
  };
  const gitleaks = (status: string, historyOutcome: string | null) => ({
    status,
    historyOutcome,
    scanner: { scannerType: 'secret' },
  });
  const make = (scan: unknown) => {
    const { service, scans } = build('incremental_artifact', null, scan);
    const advance = jest.spyOn(service, 'advance').mockResolvedValue(true);
    return { service, scans, advance };
  };
  const scanWith = (containers: unknown[], historyPass: unknown = pass) => ({
    id: 's1',
    projectId: 'p1',
    branch: 'main',
    metadata: historyPass ? { historyPass } : {},
    containers,
  });

  it('results-final moves the cursor when the Gitleaks history pass succeeded', async () => {
    const { service, advance } = make(
      scanWith([
        gitleaks('completed', 'ok'),
        { scanner: { scannerType: 'sast' } },
      ]),
    );
    await service.applyFinalizedScan('s1');
    expect(advance).toHaveBeenCalledWith('p1', 'main', pass, 'ok');
  });

  it('a failed Gitleaks history pass counts a failure and leaves the tip', async () => {
    const { service, advance } = make(
      scanWith([gitleaks('completed', 'failed')]),
    );
    await service.applyFinalizedScan('s1');
    expect(advance).toHaveBeenCalledWith('p1', 'main', pass, 'failed');
  });

  it('a Gitleaks container that did not complete is a failure even with an ok outcome', async () => {
    const { service, advance } = make(scanWith([gitleaks('failed', 'ok')]));
    await service.applyFinalizedScan('s1');
    expect(advance).toHaveBeenCalledWith('p1', 'main', pass, 'failed');
  });

  it('a scan without a history pass never touches the cursor', async () => {
    const { service, advance } = make(
      scanWith([gitleaks('completed', 'ok')], null),
    );
    await service.applyFinalizedScan('s1');
    expect(advance).not.toHaveBeenCalled();
  });

  it('a scan that recorded a none pass records it on the branch even without a Gitleaks container', async () => {
    const nonePass = { ...pass, mode: 'none', baseTipSha: undefined };
    for (const containers of [
      [{ scanner: { scannerType: 'sast' } }],
      [gitleaks('failed', null)],
      [],
    ]) {
      const { service, advance } = make(scanWith(containers, nonePass));
      await service.applyFinalizedScan('s1');
      expect(advance).toHaveBeenCalledWith('p1', 'main', nonePass, 'ok');
    }
  });

  it('a none pass is never counted as a failure', async () => {
    const nonePass = { ...pass, mode: 'none' };
    const { service, advance } = make(
      scanWith([gitleaks('failed', 'failed')], nonePass),
    );
    await service.applyFinalizedScan('s1');
    expect(advance).toHaveBeenCalledTimes(1);
    expect(advance.mock.calls[0][3]).toBe('ok');
  });

  it('a none pass without a branch, no Gitleaks container for another mode or an unknown scan do nothing', async () => {
    for (const scan of [
      { ...scanWith([], { ...pass, mode: 'none' }), branch: null },
      scanWith([{ scanner: { scannerType: 'sast' } }]),
      null,
    ]) {
      const { service, advance } = make(scan);
      await service.applyFinalizedScan('s1');
      expect(advance).not.toHaveBeenCalled();
    }
  });
});

describe('GitHistoryCursorService without a branch', () => {
  const pass = {
    mode: 'incremental',
    excludeShas: [],
    bytes: '1',
    firstPass: false,
    repositoryKey: 'github:o/r',
  };

  it.each([undefined, null, ''])(
    'coverageFor never queries without a branch (%p)',
    async (branch) => {
      const { service, cursors } = build('incremental_artifact', {
        complete: true,
      });
      await expect(
        service.coverageFor('p', branch as never),
      ).resolves.toBeNull();
      expect(cursors.findOne).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, null, ''])(
    'advance never touches a cursor without a branch (%p)',
    async (branch) => {
      const { service, cursors } = build('incremental_artifact');
      const transaction = jest.fn();
      (cursors as any).manager = { transaction };
      await expect(
        service.advance('p', branch as never, pass as never, 'ok'),
      ).resolves.toBe(false);
      expect(transaction).not.toHaveBeenCalled();
      expect(cursors.findOne).not.toHaveBeenCalled();
    },
  );
});

describe('GitHistoryCursorService in the in_archive mode', () => {
  const pass = {
    mode: 'incremental',
    tipSha: 'tip',
    excludeShas: [],
    bytes: '1',
    firstPass: false,
    repositoryKey: 'github:o/r',
  };

  it('coverageFor answers null without reading the table', async () => {
    const { service, cursors } = build('in_archive', { complete: false });
    await expect(service.coverageFor('p', 'main')).resolves.toBeNull();
    expect(cursors.findOne).not.toHaveBeenCalled();
  });

  it('recordPass writes nothing', async () => {
    const { service, scans } = build('in_archive', null, {
      id: 's1',
      metadata: {},
    });
    await service.recordPass('s1', pass as never);
    expect(scans.findOne).not.toHaveBeenCalled();
    expect(scans.update).not.toHaveBeenCalled();
  });

  it('applyFinalizedScan never touches the cursor', async () => {
    const { service, scans } = build('in_archive', null, {
      id: 's1',
      projectId: 'p1',
      branch: 'main',
      state: 'failed',
      metadata: { historyPass: pass },
      containers: [{ status: 'failed', scanner: { scannerType: 'secret' } }],
    });
    const advance = jest.spyOn(service, 'advance').mockResolvedValue(true);
    await service.applyFinalizedScan('s1');
    await service.applyFinalizedScan('s1', { scanFailed: true });
    expect(scans.findOne).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });
});

describe('GitHistoryCursorService history ingestion failures', () => {
  const pass = {
    mode: 'incremental',
    tipSha: 'tip',
    baseTipSha: 'base',
    excludeShas: [],
    bytes: '10',
    firstPass: false,
    repositoryKey: 'github:o/r',
  };
  const gitleaks = (status: string, historyOutcome: string | null) => ({
    status,
    historyOutcome,
    scanner: { scannerType: 'secret' },
  });
  const make = (scan: unknown) => {
    const { service, scans } = build('incremental_artifact', null, scan);
    const advance = jest.spyOn(service, 'advance').mockResolvedValue(true);
    return { service, scans, advance };
  };

  it('applyFinalizedScan counts historyIngestionFailed as a failure', async () => {
    const { service, advance } = make({
      id: 's1',
      projectId: 'p1',
      branch: 'main',
      metadata: { historyPass: pass, historyIngestionFailed: true },
      containers: [gitleaks('completed', 'ok')],
    });
    await service.applyFinalizedScan('s1');
    expect(advance).toHaveBeenCalledWith('p1', 'main', pass, 'failed');
  });

  it('a none pass stays ok even when an ingestion failure was recorded', async () => {
    const nonePass = { ...pass, mode: 'none' };
    const { service, advance } = make({
      id: 's1',
      projectId: 'p1',
      branch: 'main',
      metadata: { historyPass: nonePass, historyIngestionFailed: true },
      containers: [gitleaks('completed', null)],
    });
    await service.applyFinalizedScan('s1');
    expect(advance).toHaveBeenCalledWith('p1', 'main', nonePass, 'ok');
  });

  it('markHistoryIngestionFailed writes only the historyIngestionFailed key, again and again', async () => {
    const { service, scans } = build('incremental_artifact', null, {
      id: 's1',
      metadata: { historyPass: pass },
    });
    await expect(service.markHistoryIngestionFailed('s1')).resolves.toBe(true);
    await expect(service.markHistoryIngestionFailed('s1')).resolves.toBe(true);
    expect(scans.update).toHaveBeenCalledTimes(2);
    expect(scans.update).toHaveBeenLastCalledWith(
      { id: 's1' },
      { metadata: { historyPass: pass, historyIngestionFailed: true } },
    );
  });

  it('markHistoryIngestionFailed answers false for an unknown scan', async () => {
    const { service, scans } = build('incremental_artifact', null, null);
    await expect(service.markHistoryIngestionFailed('nope')).resolves.toBe(
      false,
    );
    expect(scans.update).not.toHaveBeenCalled();
  });
});

describe('GitHistoryCursorService.applyFinalizedScan on a failed scan', () => {
  const pass = {
    mode: 'incremental',
    tipSha: 'tip',
    baseTipSha: 'base',
    excludeShas: [],
    bytes: '10',
    firstPass: false,
    repositoryKey: 'github:o/r',
  };
  const secret = (status: string, historyOutcome: string | null) => ({
    status,
    historyOutcome,
    scanner: { scannerType: 'secret' },
  });
  const failedScan = (over: object = {}) => ({
    id: 's1',
    projectId: 'p1',
    branch: 'main',
    state: 'failed',
    metadata: { historyPass: pass },
    containers: [secret('failed', null), { scanner: { scannerType: 'sast' } }],
    ...over,
  });
  const make = (scan: unknown) => {
    const { service } = build('incremental_artifact', null, scan);
    const advance = jest.spyOn(service, 'advance').mockResolvedValue(true);
    return { service, advance };
  };

  it('counts a failure for a failed scan that recorded a history pass', async () => {
    const { service, advance } = make(failedScan());
    await service.applyFinalizedScan('s1', { scanFailed: true });
    expect(advance).toHaveBeenCalledWith('p1', 'main', pass, 'failed');
  });

  it('counts a failure even when its secret container reported an ok pass', async () => {
    const { service, advance } = make(
      failedScan({ containers: [secret('completed', 'ok')] }),
    );
    await service.applyFinalizedScan('s1', { scanFailed: true });
    expect(advance).toHaveBeenCalledWith('p1', 'main', pass, 'failed');
  });

  it('does nothing for a none pass, a scan without a secret container, a cancelled or an unknown scan', async () => {
    for (const scan of [
      failedScan({ metadata: { historyPass: { ...pass, mode: 'none' } } }),
      failedScan({ containers: [{ scanner: { scannerType: 'sast' } }] }),
      failedScan({ state: 'cancelled' }),
      failedScan({ metadata: {} }),
      null,
    ]) {
      const { service, advance } = make(scan);
      await service.applyFinalizedScan('s1', { scanFailed: true });
      expect(advance).not.toHaveBeenCalled();
    }
  });
});
