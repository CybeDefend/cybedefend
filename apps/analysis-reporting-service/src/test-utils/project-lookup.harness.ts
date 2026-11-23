import { ClientGrpc } from '@nestjs/microservices';
import { of, throwError } from 'rxjs';

import { ReferenceBranchResolver } from '../modules/cyber-risk/reference-branch.resolver';
import { ResultService } from '../modules/result/result.service';

/** Every call a chainable query builder received, in order: [method, args]. */
export type QueryBuilderCalls = Array<[string, unknown[]]>;

const QUERY_RESULTS: Record<string, unknown> = {
  getMany: [],
  getRawMany: [],
  getOne: null,
  getRawOne: undefined,
  getCount: 0,
  getManyAndCount: [[], 0],
};

/** Synchronous builder methods: what a caller composes into another query. */
const SYNC_RESULTS: Record<string, () => unknown> = {
  getQueryAndParameters: () => ['SELECT 1', []],
  getQuery: () => 'SELECT 1',
};

/**
 * A TypeORM query builder that accepts any chain and finds nothing: every
 * builder method returns the builder, every terminal method resolves to an
 * empty result. Each call is recorded in `calls`.
 */
export function makeChainableQueryBuilder(calls: QueryBuilderCalls = []) {
  const qb: object = new Proxy(
    {},
    {
      get(_target, prop) {
        // Not a thenable: `await qb` must not mistake it for a promise.
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return (...args: unknown[]) => {
          calls.push([prop, args]);
          if (prop in SYNC_RESULTS) return SYNC_RESULTS[prop]();
          return prop in QUERY_RESULTS
            ? Promise.resolve(QUERY_RESULTS[prop])
            : qb;
        };
      },
    },
  );
  return qb;
}

/**
 * A repository whose every query builder is {@link makeChainableQueryBuilder},
 * and whose raw `query` (a UNION ALL of such builders) finds nothing.
 */
export function makeEmptyRepository(calls: QueryBuilderCalls = []) {
  return {
    createQueryBuilder: () => makeChainableQueryBuilder(calls),
    query: (...args: unknown[]) => {
      calls.push(['query', args]);
      return Promise.resolve([]);
    },
  };
}

export interface ProjectLookupHarness {
  /** The ONE `ProjectService/Get` mock every lookup goes through. */
  get: jest.Mock;
  /** Hand to the list as its `projectServiceClient`. */
  projectServiceClient: { get: jest.Mock };
  /** A real resolver over `get`. */
  referenceBranchResolver: ReferenceBranchResolver;
  /** Real counters over empty repositories and `referenceBranchResolver`. */
  resultService: ResultService;
  getScoringBranches: jest.SpyInstance;
  countByType: jest.SpyInstance;
  autofixCountByType: jest.SpyInstance;
}

/**
 * Counts the `ProjectService/Get` calls ONE results-list request
 * costs global-management.
 *
 * Every Get goes through the single `get` mock: the list's own lookup, and the
 * one `ReferenceBranchResolver` makes whenever a counter (or the list itself)
 * resolves the SCA branch partition on its own. The two counters are the real
 * `ResultService` methods, so a list that lets them re-resolve the partition
 * shows up as extra Gets, and the branches they receive are the ones the
 * SQL would be scoped to.
 *
 * @param project - what `get` answers, or the error it fails with.
 */
export function makeProjectLookupHarness(
  project: Record<string, unknown> | Error,
): ProjectLookupHarness {
  const get = jest.fn(() =>
    project instanceof Error ? throwError(() => project) : of(project),
  );
  const referenceBranchResolver = new ReferenceBranchResolver({
    getService: () => ({ get }),
  } as unknown as ClientGrpc);
  referenceBranchResolver.onModuleInit();

  const resultService = Object.assign(
    Object.create(ResultService.prototype) as ResultService,
    {
      sastVulnDetectRepository: makeEmptyRepository(),
      iacVulnDetectRepository: makeEmptyRepository(),
      cicdVulnDetectRepository: makeEmptyRepository(),
      secretVulnDetectRepository: makeEmptyRepository(),
      scaVulnDetectRepository: makeEmptyRepository(),
      containerVulnDetectRepository: makeEmptyRepository(),
      aibom: { countMergedComponents: jest.fn().mockResolvedValue(0) },
      referenceBranchResolver,
    },
  );

  return {
    get,
    projectServiceClient: { get },
    referenceBranchResolver,
    resultService,
    getScoringBranches: jest.spyOn(
      referenceBranchResolver,
      'getScoringBranches',
    ),
    countByType: jest.spyOn(
      resultService,
      'getCountVulnerabilitiesCountByType',
    ),
    autofixCountByType: jest.spyOn(resultService, 'getAutofixCountByType'),
  };
}
