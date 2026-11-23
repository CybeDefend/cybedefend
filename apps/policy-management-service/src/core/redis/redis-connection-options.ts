import { ConfigService } from '@nestjs/config';

export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
}

/**
 * The ioredis options of every Redis client this service configures by host
 * and port (BullMQ connections, dedicated clients): REDIS_HOST, REDIS_PORT,
 * and REDIS_PASSWORD when the Redis requires one (an empty value sends none).
 */
export function redisConnectionOptions(
  config: ConfigService,
): RedisConnectionOptions {
  const password = config.get<string>('REDIS_PASSWORD');
  return {
    host: config.get<string>('REDIS_HOST', 'localhost'),
    port: Number(config.get<number | string>('REDIS_PORT', 6379)),
    ...(password ? { password } : {}),
  };
}
