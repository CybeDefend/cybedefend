/**
 * Runs async tasks with at most `limit` of them in flight, in
 * the order they were submitted. One limiter per request bounds what that
 * request takes from the database pool (20 connections, `app.module.ts`):
 * `Promise.all` over the tasks alone would hold as many connections as there
 * are queries.
 *
 * Each `run(task)` settles like `task()` would. A task is only started when a
 * slot is free.
 */
export function createConcurrencyLimiter(
  limit: number,
): <T>(task: () => Promise<T>) => Promise<T> {
  if (!(limit >= 1)) {
    throw new Error('A concurrency limit is at least 1');
  }
  let active = 0;
  const waiting: Array<() => void> = [];

  const startNext = (): void => {
    if (active >= limit) return;
    const start = waiting.shift();
    if (!start) return;
    active += 1;
    start();
  };

  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        let running: Promise<T>;
        try {
          running = task();
        } catch (error) {
          running = Promise.reject(error);
        }
        running.then(resolve, reject).finally(() => {
          active -= 1;
          startNext();
        });
      });
      startNext();
    });
}
