import { ConfigService } from '@nestjs/config';

/**
 * ioredis-compatible connection options derived from env.
 *
 * external-integrations configures Redis as a single `REDIS_URL`
 * (redis://host:port, or rediss:// with auth). BullMQ's `connection` wants
 * ioredis options, so we parse the URL into host/port (+ optional auth/tls),
 * falling back to discrete REDIS_HOST/REDIS_PORT when no URL is set.
 * REDIS_PASSWORD authenticates when the URL carries no password.
 */
export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: Record<string, never>;
}

export function buildRedisConnection(
  config: ConfigService,
): RedisConnectionOptions {
  const url = config.get<string>('REDIS_URL');
  const fallbackPassword = config.get<string>('REDIS_PASSWORD');

  if (url) {
    const parsed = new URL(url);
    const password = parsed.password
      ? decodeURIComponent(parsed.password)
      : fallbackPassword;
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 6379,
      ...(parsed.username
        ? { username: decodeURIComponent(parsed.username) }
        : {}),
      ...(password ? { password } : {}),
      ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    };
  }

  return {
    host: config.get<string>('REDIS_HOST', 'localhost'),
    port: Number(config.get<string>('REDIS_PORT', '6379')),
    ...(fallbackPassword ? { password: fallbackPassword } : {}),
  };
}
