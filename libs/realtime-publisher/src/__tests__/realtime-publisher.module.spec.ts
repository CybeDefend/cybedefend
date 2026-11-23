import { Test } from '@nestjs/testing';
import { RealtimePublisherModule, RealtimeEventPublisher } from '../';

describe('RealtimePublisherModule', () => {
  it('exposes RealtimeEventPublisher when registered with redis url', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RealtimePublisherModule.forRoot({ realtimeRedisUrl: 'redis://localhost:6379' })],
    }).compile();
    try {
      expect(moduleRef.get(RealtimeEventPublisher)).toBeDefined();
    } finally {
      // The module opens a Redis client; closing it releases the socket so
      // Jest exits even where no Redis server listens (the public CI).
      await moduleRef.close();
    }
  });
});
