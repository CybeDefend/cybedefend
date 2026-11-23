import { Test } from '@nestjs/testing';
import { REDIS_CLIENT } from '../../core/redis/redis.module';
import { PendingRescanModule } from './pending-rescan.module';
import { PendingRescanStore } from './pending-rescan.store';

/**
 * The store resolves from its own module (REDIS_CLIENT through
 * RedisModule, the key prefix optional), on the shared Redis client and with
 * the default key layout.
 */
describe('PendingRescanModule', () => {
  it('provides the store on the shared Redis client, under the default prefix', async () => {
    const redis = { eval: jest.fn().mockResolvedValue(1), mget: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      imports: [PendingRescanModule],
    })
      .overrideProvider(REDIS_CLIENT)
      .useValue(redis)
      .compile();

    const store = moduleRef.get(PendingRescanStore);
    await store.record(
      {
        provider: 'github',
        projectId: 'p1',
        branch: 'main',
        commitSha: 'a'.repeat(40),
        githubRepositoryId: 1,
      },
      1_000,
    );

    expect(store.entryKey('p1', 'main')).toBe(
      'ei:pending-rescan:entry:p1:main',
    );
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      3,
      'ei:pending-rescan:entry:p1:main',
      'ei:pending-rescan:due',
      'ei:pending-rescan:started:p1:main',
      expect.any(String),
      6 * 60 * 60,
      61_000,
      'a'.repeat(40),
    );
  });
});
