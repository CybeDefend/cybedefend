/** The part of an ioredis client that closing it needs. */
export interface RedisToClose {
  readonly status: string;
  quit(): Promise<unknown>;
  disconnect(): void;
}

/** How long a QUIT may wait for Redis before the socket is dropped. */
export const REDIS_CLOSE_TIMEOUT_MS = 2_000;

/**
 * Close one Redis client at application shutdown: QUIT, and drop the socket
 * when QUIT fails or does not answer within `timeoutMs`. Never throws.
 *
 * Nest runs no lifecycle hook on a client a factory provider returns, so the
 * module that provides it closes it (onApplicationShutdown). A client left
 * open keeps its socket in the event loop after app.close(): the gateway
 * then never exits on SIGTERM, and waits for its whole grace period before
 * it is killed.
 */
export async function closeRedisClient(
  client: RedisToClose,
  timeoutMs: number = REDIS_CLOSE_TIMEOUT_MS,
): Promise<void> {
  if (!client || client.status === 'end') return;
  const drop = (): void => {
    try {
      client.disconnect?.();
    } catch {
      // Shutdown goes on: the socket is the process's to lose now.
    }
  };
  if (typeof client.quit !== 'function') {
    drop();
    return;
  }
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
    timer.unref?.();
  });
  try {
    const outcome = await Promise.race([
      client.quit().then(() => 'quit' as const),
      timedOut,
    ]);
    if (outcome === 'timeout') drop();
  } catch {
    drop();
  } finally {
    if (timer) clearTimeout(timer);
  }
}
