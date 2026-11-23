/**
 * Structural spec for `GitlabModule`'s Redis wiring.
 *
 * Structural on purpose. The failure this guards against does not surface in a
 * behavioural test: `GitlabService` injects `'REDIS_CLIENT'`, and every spec of
 * it supplies a double, so the wiring can be wrong in production while the whole
 * suite stays green. It only breaks at bootstrap, with
 * `UnknownDependenciesException`. Reading the
 * module metadata is the earliest place the invariant can be checked at all.
 */
import { RedisModule } from '../../core/redis/redis.module';
import { GitlabModule } from './gitlab.module';

const importsOf = (module: unknown): unknown[] =>
  (Reflect.getMetadata('imports', module as object) as unknown[]) ?? [];

const providersOf = (module: unknown): unknown[] =>
  (Reflect.getMetadata('providers', module as object) as unknown[]) ?? [];

describe('GitlabModule — REDIS_CLIENT wiring', () => {
  it('imports RedisModule instead of relying on its @Global registration', () => {
    // `worker.module.ts` loads GitlabModule WITHOUT any container-registry
    // module, and those are the only other importers of RedisModule. In that
    // graph nothing publishes the global provider, so an implicit dependency
    // would boot the API fine and kill the worker.
    expect(importsOf(GitlabModule)).toContain(RedisModule);
  });

  it('declares no REDIS_CLIENT provider of its own', () => {
    // A local provider WINS over a @Global one, so re-declaring the same token
    // here does not merely duplicate code: it opens a second ioredis connection
    // to the same instance and quietly puts this module on a different client
    // than everyone else.
    const localRedisProviders = providersOf(GitlabModule).filter(
      (provider) =>
        typeof provider === 'object' &&
        provider !== null &&
        (provider as { provide?: unknown }).provide === 'REDIS_CLIENT',
    );

    expect(localRedisProviders).toEqual([]);
  });
});
