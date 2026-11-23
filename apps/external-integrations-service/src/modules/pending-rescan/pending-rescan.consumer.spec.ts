// The consumer imports GithubService/GitlabService for their DI tokens only;
// their real modules pull ESM-only octokit packages Jest cannot transform.
jest.mock('../github/github.service', () => ({ GithubService: class {} }));
jest.mock('../gitlab/gitlab.service', () => ({ GitlabService: class {} }));

import {
  PENDING_RESCAN_TICK_MS,
  PendingRescanConsumer,
} from './pending-rescan.consumer';
import { ClaimedRescan, PendingRescan } from './pending-rescan.store';

const githubEntry: PendingRescan = {
  provider: 'github',
  projectId: 'p1',
  branch: 'main',
  commitSha: 'a'.repeat(40),
  githubRepositoryId: 42,
  recordedAt: 1,
};
const gitlabEntry: PendingRescan = {
  provider: 'gitlab',
  projectId: 'p2',
  branch: 'main',
  commitSha: 'b'.repeat(40),
  gitlabRepositoryId: 'repo-2',
  recordedAt: 2,
};
const claimOf = (entry: PendingRescan | null, member = 'm'): ClaimedRescan => ({
  member,
  raw: entry ? JSON.stringify(entry) : null,
  entry,
});

function build() {
  const store = {
    claimDue: jest.fn<Promise<ClaimedRescan[]>, [number]>(),
    settle: jest.fn().mockResolvedValue(true),
    rearm: jest.fn().mockResolvedValue(true),
  };
  const github = { runPendingRescan: jest.fn() };
  const gitlab = { runPendingRescan: jest.fn() };
  const consumer = new PendingRescanConsumer(
    store as never,
    github as never,
    gitlab as never,
  );
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  (consumer as unknown as { logger: typeof logger }).logger = logger;
  return { consumer, store, github, gitlab, logger };
}

describe('PendingRescanConsumer', () => {
  it('hands each claimed entry to its provider', async () => {
    const { consumer, store, github, gitlab } = build();
    store.claimDue.mockResolvedValue([
      claimOf(githubEntry, 'm1'),
      claimOf(gitlabEntry, 'm2'),
    ]);
    github.runPendingRescan.mockResolvedValue('started');
    gitlab.runPendingRescan.mockResolvedValue('started');

    await expect(consumer.tick()).resolves.toBe(2);

    expect(github.runPendingRescan).toHaveBeenCalledWith(githubEntry);
    expect(gitlab.runPendingRescan).toHaveBeenCalledWith(gitlabEntry);
  });

  it('settles a started rescan: the entry it read is forgotten', async () => {
    const { consumer, store, github } = build();
    const claim = claimOf(githubEntry);
    store.claimDue.mockResolvedValue([claim]);
    github.runPendingRescan.mockResolvedValue('started');

    await consumer.tick();

    expect(store.settle).toHaveBeenCalledWith(claim);
    expect(store.rearm).not.toHaveBeenCalled();
  });

  it('settles a dropped rescan too', async () => {
    const { consumer, store, github } = build();
    const claim = claimOf(githubEntry);
    store.claimDue.mockResolvedValue([claim]);
    github.runPendingRescan.mockResolvedValue('dropped');

    await consumer.tick();

    expect(store.settle).toHaveBeenCalledWith(claim);
    expect(store.rearm).not.toHaveBeenCalled();
  });

  it('re-arms a rescan whose branch is still being scanned', async () => {
    const { consumer, store, github } = build();
    store.claimDue.mockResolvedValue([claimOf(githubEntry, 'm1')]);
    github.runPendingRescan.mockResolvedValue('busy');

    await consumer.tick();

    expect(store.rearm).toHaveBeenCalledWith('m1');
    expect(store.settle).not.toHaveBeenCalled();
  });

  it('settles an entry that expired or cannot be read, without running anything, and says so', async () => {
    const { consumer, store, github, gitlab, logger } = build();
    const gone = claimOf(null, 'm1');
    const unreadable: ClaimedRescan = { member: 'm2', raw: '{', entry: null };
    store.claimDue.mockResolvedValue([gone, unreadable]);

    await consumer.tick();

    expect(store.settle).toHaveBeenCalledWith(gone);
    expect(store.settle).toHaveBeenCalledWith(unreadable);
    expect(github.runPendingRescan).not.toHaveBeenCalled();
    expect(gitlab.runPendingRescan).not.toHaveBeenCalled();
    const logs = logger.log.mock.calls.map((c) => String(c[0]));
    expect(logs).toEqual([
      expect.stringMatching(/PENDING_RESCAN_DROPPED reason=expired .*m1/),
      expect.stringMatching(/PENDING_RESCAN_DROPPED reason=expired .*m2/),
    ]);
  });

  it('says so when an entry expired while its branch was still busy', async () => {
    const { consumer, store, github, logger } = build();
    store.claimDue.mockResolvedValue([claimOf(githubEntry, 'm1')]);
    github.runPendingRescan.mockResolvedValue('busy');
    store.rearm.mockResolvedValue(false);

    await consumer.tick();

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringMatching(
        /PENDING_RESCAN_DROPPED reason=expired .*project=p1/,
      ),
    );
  });

  // The TTL bounds the retries, so an unexpected failure
  // (MySQL, BullMQ, a bug) is checked again later rather than dropped.
  it('re-arms a rescan whose run threw, and goes on with the others', async () => {
    const { consumer, store, github, gitlab } = build();
    store.claimDue.mockResolvedValue([
      claimOf(githubEntry, 'm1'),
      claimOf(gitlabEntry, 'm2'),
    ]);
    github.runPendingRescan.mockRejectedValue(new Error('boom'));
    gitlab.runPendingRescan.mockResolvedValue('started');

    await consumer.tick();

    expect(store.rearm).toHaveBeenCalledWith('m1');
    expect(store.settle).toHaveBeenCalledWith(
      expect.objectContaining({ member: 'm2' }),
    );
    expect(store.settle).not.toHaveBeenCalledWith(
      expect.objectContaining({ member: 'm1' }),
    );
  });

  it('leaves an entry leased when Redis fails while settling it, and goes on', async () => {
    const { consumer, store, github } = build();
    store.claimDue.mockResolvedValue([
      claimOf(githubEntry, 'm1'),
      claimOf(githubEntry, 'm2'),
    ]);
    github.runPendingRescan.mockResolvedValue('started');
    store.settle.mockRejectedValueOnce(new Error('redis down'));

    await expect(consumer.tick()).resolves.toBe(2);

    expect(github.runPendingRescan).toHaveBeenCalledTimes(2);
  });

  it('a failing claim is only a missed tick', async () => {
    const { consumer, store } = build();
    store.claimDue.mockRejectedValue(new Error('redis down'));

    await expect(consumer.tick()).resolves.toBe(0);
  });

  it('never runs two ticks of one process at once', async () => {
    const { consumer, store, github } = build();
    let release!: () => void;
    store.claimDue.mockResolvedValueOnce([claimOf(githubEntry)]);
    github.runPendingRescan.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve('started');
        }),
    );

    const first = consumer.tick();
    await Promise.resolve();
    await expect(consumer.tick()).resolves.toBe(0);
    release();
    await first;

    expect(store.claimDue).toHaveBeenCalledTimes(1);
  });

  describe('schedule', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('ticks every PENDING_RESCAN_TICK_MS from module init until destroy', async () => {
      const { consumer, store } = build();
      store.claimDue.mockResolvedValue([]);

      consumer.onModuleInit();
      await jest.advanceTimersByTimeAsync(PENDING_RESCAN_TICK_MS * 3);
      expect(store.claimDue).toHaveBeenCalledTimes(3);

      consumer.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(PENDING_RESCAN_TICK_MS * 3);
      expect(store.claimDue).toHaveBeenCalledTimes(3);
    });
  });
});
