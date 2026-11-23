import { of, throwError } from 'rxjs';
import { Logger } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';

import {
  ReferenceBranchResolver,
  scoringBranchesFromLookup,
  scoringBranchesFromProject,
} from './reference-branch.resolver';

function makeResolver(get: jest.Mock): ReferenceBranchResolver {
  const gm = {
    getService: jest.fn().mockReturnValue({ get }),
  } as unknown as ClientGrpc;
  const resolver = new ReferenceBranchResolver(gm);
  resolver.onModuleInit();
  return resolver;
}

describe('ReferenceBranchResolver.getReferenceBranch', () => {
  it('returns the trimmed referenceBranch from the project response', async () => {
    const get = jest.fn().mockReturnValue(of({ referenceBranch: '  main  ' }));
    const resolver = makeResolver(get);

    await expect(resolver.getReferenceBranch('p1')).resolves.toBe('main');
    // referenceBranch is a project column and defaultBranch comes
    // from the integration status: the read skips the vulnerability stats
    // (analysis-reporting, which called back into this service) and the
    // security context, and keeps the integration status.
    expect(get).toHaveBeenCalledWith({
      projectId: 'p1',
      skipVulnerabilityStats: true,
      skipSecurityContext: true,
    });
  });

  it('returns null when referenceBranch is an empty string', async () => {
    const resolver = makeResolver(
      jest.fn().mockReturnValue(of({ referenceBranch: '' })),
    );

    await expect(resolver.getReferenceBranch('p2')).resolves.toBeNull();
  });

  it('returns null when the response carries no referenceBranch field', async () => {
    const resolver = makeResolver(jest.fn().mockReturnValue(of({})));

    await expect(resolver.getReferenceBranch('p3')).resolves.toBeNull();
  });

  it('returns null when the gRPC get() call errors (resilient fallback)', async () => {
    const resolver = makeResolver(
      jest.fn().mockReturnValue(throwError(() => new Error('grpc down'))),
    );

    await expect(resolver.getReferenceBranch('p4')).resolves.toBeNull();
  });
});

describe('ReferenceBranchResolver.getScoringBranches', () => {
  it('returns the single reference branch when one resolves', async () => {
    const get = jest.fn().mockReturnValue(of({ referenceBranch: 'main' }));
    const resolver = makeResolver(get);

    await expect(resolver.getScoringBranches('p1')).resolves.toEqual(['main']);
  });

  it('falls back to main/master when no reference branch resolves', async () => {
    const resolver = makeResolver(
      jest.fn().mockReturnValue(of({ referenceBranch: '' })),
    );

    await expect(resolver.getScoringBranches('p2')).resolves.toEqual([
      'main',
      'master',
    ]);
  });

  it.each(['all', 'ALL', 'all_branches', 'all branches', '*'])(
    'falls back to main/master when referenceBranch is the "all branches" sentinel %p',
    async (sentinel) => {
      const resolver = makeResolver(
        jest.fn().mockReturnValue(of({ referenceBranch: sentinel })),
      );

      await expect(resolver.getScoringBranches('p3')).resolves.toEqual([
        'main',
        'master',
      ]);
    },
  );

  // When no referenceBranch is configured, scope to the project's REAL
  // git default branch (resolved by global-management) before the hardcoded
  // main/master fallback, so a project whose main branch isn't named main/master
  // is scored on the branch its vulns actually live on.
  it('falls back to the repo default branch when no referenceBranch is set', async () => {
    const resolver = makeResolver(
      jest
        .fn()
        .mockReturnValue(of({ referenceBranch: '', defaultBranch: 'develop' })),
    );

    await expect(resolver.getScoringBranches('p4')).resolves.toEqual([
      'develop',
    ]);
  });

  it('prefers referenceBranch over the repo default branch when both are set', async () => {
    const resolver = makeResolver(
      jest
        .fn()
        .mockReturnValue(
          of({ referenceBranch: 'release', defaultBranch: 'develop' }),
        ),
    );

    await expect(resolver.getScoringBranches('p5')).resolves.toEqual([
      'release',
    ]);
  });

  it('falls back to main/master when both referenceBranch and defaultBranch are unset', async () => {
    const resolver = makeResolver(
      jest.fn().mockReturnValue(of({ referenceBranch: '', defaultBranch: '' })),
    );

    await expect(resolver.getScoringBranches('p6')).resolves.toEqual([
      'main',
      'master',
    ]);
  });

  it('ignores an "all branches" sentinel defaultBranch and falls back to main/master', async () => {
    const resolver = makeResolver(
      jest
        .fn()
        .mockReturnValue(of({ referenceBranch: '', defaultBranch: 'all' })),
    );

    await expect(resolver.getScoringBranches('p7')).resolves.toEqual([
      'main',
      'master',
    ]);
  });
});

describe('ReferenceBranchResolver.getScoringBranchesBatch', () => {
  it('resolves the scoring branches of every project in parallel', async () => {
    const get = jest
      .fn()
      .mockImplementation(({ projectId }: { projectId: string }) => {
        if (projectId === 'p1') return of({ referenceBranch: 'develop' });
        if (projectId === 'p2') return of({ referenceBranch: '' });
        return of({ referenceBranch: 'all' });
      });
    const resolver = makeResolver(get);

    const map = await resolver.getScoringBranchesBatch(['p1', 'p2', 'p3']);

    expect(map.get('p1')).toEqual(['develop']);
    expect(map.get('p2')).toEqual(['main', 'master']); // unset → fallback
    expect(map.get('p3')).toEqual(['main', 'master']); // sentinel → fallback
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('returns an empty Map without calling gRPC for an empty project list', async () => {
    const get = jest.fn();
    const resolver = makeResolver(get);

    const map = await resolver.getScoringBranchesBatch([]);

    expect(map.size).toBe(0);
    expect(get).not.toHaveBeenCalled();
  });

  it('falls back to main/master for a project whose lookup errors (resilient)', async () => {
    const get = jest
      .fn()
      .mockImplementation(({ projectId }: { projectId: string }) =>
        projectId === 'bad'
          ? throwError(() => new Error('grpc down'))
          : of({ referenceBranch: 'main' }),
      );
    const resolver = makeResolver(get);

    const map = await resolver.getScoringBranchesBatch(['ok', 'bad']);

    expect(map.get('ok')).toEqual(['main']);
    expect(map.get('bad')).toEqual(['main', 'master']);
  });
});

// A results list already holds the project (its own
// ProjectService/Get), so it derives the scoring branches from that response
// instead of asking the resolver, which would Get the same project again. Both
// paths must conclude the same thing, or the tab badge drifts from the list.
describe('scoringBranchesFromProject', () => {
  const projects: Array<[string, Record<string, string>]> = [
    ['a reference branch', { referenceBranch: 'release' }],
    ['a padded reference branch', { referenceBranch: '  release  ' }],
    [
      'the reference branch over the git default',
      { referenceBranch: 'release', defaultBranch: 'develop' },
    ],
    [
      'the git default when no reference branch is set',
      { referenceBranch: '', defaultBranch: 'develop' },
    ],
    [
      'main/master when neither is set',
      { referenceBranch: '', defaultBranch: '' },
    ],
    ['main/master for a response without either field', {}],
    [
      'the git default when the reference branch is the "all" sentinel',
      { referenceBranch: 'all', defaultBranch: 'develop' },
    ],
    [
      'the git default when the reference branch is the "*" sentinel',
      { referenceBranch: '*', defaultBranch: 'develop' },
    ],
    [
      'main/master when both fields are sentinels',
      { referenceBranch: 'ALL', defaultBranch: '*' },
    ],
  ];

  it.each(projects)(
    'concludes what getScoringBranches concludes from the same response: %s',
    async (_case, project) => {
      const resolver = makeResolver(jest.fn().mockReturnValue(of(project)));

      expect(scoringBranchesFromProject(project)).toEqual(
        await resolver.getScoringBranches('p1'),
      );
    },
  );

  it('walks the cascade reference > git default > main/master', () => {
    expect(
      scoringBranchesFromProject({
        referenceBranch: 'release',
        defaultBranch: 'develop',
      }),
    ).toEqual(['release']);
    expect(
      scoringBranchesFromProject({
        referenceBranch: '*',
        defaultBranch: 'develop',
      }),
    ).toEqual(['develop']);
    expect(
      scoringBranchesFromProject({
        referenceBranch: 'all',
        defaultBranch: 'all',
      }),
    ).toEqual(['main', 'master']);
  });

  // Moved from branch-scoping.util.spec.ts (L26a), whose twin of this helper
  // was dropped at integration.
  it('scopes to the trimmed branch, reference or git default', () => {
    expect(scoringBranchesFromProject({ referenceBranch: '  rc  ' })).toEqual([
      'rc',
    ]);
    expect(
      scoringBranchesFromProject({
        referenceBranch: ' * ',
        defaultBranch: ' trunk ',
      }),
    ).toEqual(['trunk']);
  });

  it('hands out a fresh array each time', () => {
    const first = scoringBranchesFromProject(null);
    first.push('mutated');

    expect(scoringBranchesFromProject(null)).toEqual(['main', 'master']);
  });

  it('reads a missing project (its Get failed) as main/master, as the resolver does', async () => {
    const resolver = makeResolver(
      jest.fn().mockReturnValue(throwError(() => new Error('grpc down'))),
    );

    expect(scoringBranchesFromProject(null)).toEqual(['main', 'master']);
    expect(scoringBranchesFromProject(undefined)).toEqual(['main', 'master']);
    await expect(resolver.getScoringBranches('p1')).resolves.toEqual([
      'main',
      'master',
    ]);
  });
});

describe('scoringBranchesFromLookup', () => {
  it('derives the branches from the lookup the caller already started', async () => {
    await expect(
      scoringBranchesFromLookup(
        Promise.resolve({ referenceBranch: '', defaultBranch: 'develop' }),
      ),
    ).resolves.toEqual(['develop']);
  });

  it('falls back to main/master when that lookup fails, and leaves the failure to its own awaiter', async () => {
    const lookup = Promise.reject(new Error('grpc down'));

    await expect(scoringBranchesFromLookup(lookup)).resolves.toEqual([
      'main',
      'master',
    ]);
    await expect(lookup).rejects.toThrow('grpc down');
  });

  // The fallback must not be silent: the resolver logs the
  // same failure, and a caller that forgot to await the lookup would
  // otherwise scope everything to main/master without a trace.
  describe('logging', () => {
    let warn: jest.SpyInstance;
    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });
    afterEach(() => warn.mockRestore());

    it('logs a WARN naming the project and the cause when the lookup fails', async () => {
      await scoringBranchesFromLookup(
        Promise.reject(new Error('14 UNAVAILABLE: gm down')),
        'p-42',
      );

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toEqual(
        expect.stringContaining('projectId=p-42'),
      );
      expect(warn.mock.calls[0][0]).toEqual(
        expect.stringContaining('14 UNAVAILABLE: gm down'),
      );
    });

    it('logs nothing when the lookup succeeds', async () => {
      await scoringBranchesFromLookup(
        Promise.resolve({ referenceBranch: 'develop' }),
        'p-42',
      );

      expect(warn).not.toHaveBeenCalled();
    });
  });
});
