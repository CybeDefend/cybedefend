import { buildDailyCriticalProjectView } from './report-branch-grouping';

/**
 * Option C (hybrid) grouping for the daily critical email:
 *  - a project whose criticals all sit on a single branch shows that branch
 *    inline in the header and keeps a flat vulnerability list;
 *  - a project spanning ≥2 branches is split into per-branch sections;
 *  - a null/empty branch never counts as a second branch on its own, and when
 *    grouping is triggered it lands in a "default" section.
 */
const FRONT = 'https://app.example.com';

const vuln = (
  branch: string | undefined,
  over: Record<string, unknown> = {},
) => ({
  severity: 'critical',
  title: 'Some critical vuln',
  type: 'SCA',
  ...over,
  branch,
});

const project = (criticals: any[]) => ({
  projectId: 'p1',
  projectName: 'plateforme-backend',
  criticals,
});

describe('buildDailyCriticalProjectView', () => {
  it('single branch → inline header branch, flat list, branch deep-link', () => {
    const view = buildDailyCriticalProjectView(
      project([vuln('main'), vuln('main')]),
      FRONT,
    );

    expect(view.multiBranch).toBe(false);
    expect(view.branch).toBe('main');
    expect(view.branches).toBeUndefined();
    expect(view.vulnerabilities).toHaveLength(2);
    expect(view.criticalCount).toBe(2);
    expect(view.projectUrl).toContain('branch=main');
    expect(view.projectUrl).toContain('filter=critical');
  });

  it('no branch anywhere → no inline branch, no branch query param', () => {
    const view = buildDailyCriticalProjectView(
      project([vuln(undefined), vuln('')]),
      FRONT,
    );

    expect(view.multiBranch).toBe(false);
    expect(view.branch).toBeUndefined();
    expect(view.vulnerabilities).toHaveLength(2);
    expect(view.projectUrl).not.toContain('branch=');
    expect(view.projectUrl).toContain('filter=critical');
  });

  it('two distinct branches → per-branch sections with correct counts and deep-links', () => {
    const view = buildDailyCriticalProjectView(
      project([
        vuln('main', { title: 'a' }),
        vuln('dev', { title: 'b' }),
        vuln('main', { title: 'c' }),
      ]),
      FRONT,
    );

    expect(view.multiBranch).toBe(true);
    expect(view.branch).toBeUndefined();
    expect(view.criticalCount).toBe(3);
    expect(view.branches).toBeDefined();
    // first-seen order: main then dev
    expect(view.branches!.map((b) => b.branch)).toEqual(['main', 'dev']);
    const main = view.branches!.find((b) => b.branch === 'main')!;
    const dev = view.branches!.find((b) => b.branch === 'dev')!;
    expect(main.criticalCount).toBe(2);
    expect(dev.criticalCount).toBe(1);
    expect(main.vulnerabilities).toHaveLength(2);
    expect(main.branchUrl).toContain('branch=main');
    expect(dev.branchUrl).toContain('branch=dev');
  });

  it('null branch alongside real branches lands in a "default" section without a branch query', () => {
    const view = buildDailyCriticalProjectView(
      project([vuln('main'), vuln('dev'), vuln(undefined), vuln('')]),
      FRONT,
    );

    expect(view.multiBranch).toBe(true);
    const def = view.branches!.find((b) => b.branch === 'default')!;
    expect(def).toBeDefined();
    expect(def.criticalCount).toBe(2);
    expect(def.branchUrl).not.toContain('branch=');
  });

  it('one real branch + some null rows stays single-branch (null is not a 2nd branch)', () => {
    const view = buildDailyCriticalProjectView(
      project([vuln('main'), vuln(undefined), vuln('main')]),
      FRONT,
    );

    expect(view.multiBranch).toBe(false);
    expect(view.branch).toBe('main');
    expect(view.vulnerabilities).toHaveLength(3);
  });

  it('caps a branch section at 10 rows and flags hasMore', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      vuln('main', { title: `m${i}` }),
    );
    const view = buildDailyCriticalProjectView(
      project([...many, vuln('dev')]),
      FRONT,
    );

    const main = view.branches!.find((b) => b.branch === 'main')!;
    expect(main.criticalCount).toBe(12);
    expect(main.vulnerabilities).toHaveLength(10);
    expect(main.hasMore).toBe(true);
    expect(main.remainingCount).toBe(2);
  });

  it('url-encodes branch names with slashes', () => {
    const view = buildDailyCriticalProjectView(
      project([vuln('feature/login')]),
      FRONT,
    );
    expect(view.projectUrl).toContain('branch=feature%2Flogin');
  });

  // A real git branch literally named "default"
  // (valid — Mercurial convention / deliberate choice) must NOT be merged with
  // the synthetic branch-less bucket, and must keep its own `?branch=default`
  // deep-link.
  it('does not merge a real branch named "default" with branch-less vulns', () => {
    const view = buildDailyCriticalProjectView(
      project([
        vuln('default', { title: 'real-default' }),
        vuln('dev', { title: 'on-dev' }),
        vuln(undefined, { title: 'no-branch' }),
      ]),
      FRONT,
    );

    expect(view.multiBranch).toBe(true);
    const defaults = view.branches!.filter((b) => b.branch === 'default');
    // Two distinct sections display "default": the real branch and the
    // branch-less bucket — they must never be merged.
    const realBranch = defaults.find((b) =>
      b.branchUrl.includes('branch=default'),
    );
    const branchless = defaults.find((b) => !b.branchUrl.includes('branch='));

    expect(realBranch).toBeDefined();
    expect(realBranch!.criticalCount).toBe(1);
    expect(realBranch!.vulnerabilities[0].title).toBe('real-default');

    expect(branchless).toBeDefined();
    expect(branchless!.criticalCount).toBe(1);
    expect(branchless!.vulnerabilities[0].title).toBe('no-branch');
  });
});
