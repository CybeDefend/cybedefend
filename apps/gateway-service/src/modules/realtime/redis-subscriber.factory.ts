import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REALTIME_REDIS_SUB = 'REALTIME_REDIS_SUB';

export const realtimeRedisSubscriberProvider = {
  provide: REALTIME_REDIS_SUB,
  inject: [ConfigService],
  useFactory: (cfg: ConfigService): Redis => {
    const url =
      cfg.get<string>('REALTIME_REDIS_URL') ?? cfg.get<string>('REDIS_URL');
    if (!url) throw new Error('Missing REALTIME_REDIS_URL or REDIS_URL');
    return new Redis(url);
  },
};
