/**
 * hybrid (Option C) branch presentation for the daily critical
 * report email.
 *
 * A project whose criticals all live on a single git branch keeps a flat list
 * and shows that branch inline in its header. A project spanning two or more
 * distinct branches is split into per-branch sections. A null / empty branch
 * never counts as a "second branch" on its own (so single-branch projects stay
 * un-nested); when grouping is triggered, branch-less vulns land in a synthetic
 * `default` section.
 *
 * Pure and dependency-free so it can be unit-tested without the MailService.
 */

// Max vulnerabilities rendered per list (flat project list, or per branch
// section). Mirrors the pre-existing daily-critical cap.
export const DAILY_CRITICAL_DISPLAY_CAP = 10;

// Display label used for the section of vulnerabilities that carry no branch.
export const DEFAULT_BRANCH_LABEL = 'default';

// Internal Map key for the branch-less bucket. A Symbol can never collide with
// a real git branch name — including one literally called "default" (a valid
// git/Mercurial branch) — unlike a plain string key. `DEFAULT_BRANCH_LABEL`
// stays purely the *display* label, applied only for this sentinel bucket.
const NO_BRANCH_KEY: unique symbol = Symbol('no-branch');

export interface DailyCriticalVulnInput {
  title?: string;
  severity: string;
  type?: string;
  packageName?: string;
  version?: string;
  cvss?: string;
  createdAt?: string;
  branch?: string;
}

export interface DailyCriticalProjectInput {
  projectId: string;
  projectName: string;
  criticals: DailyCriticalVulnInput[];
}

export interface DailyCriticalVulnView {
  severity: string;
  title: string;
  type?: string;
  packageName?: string;
  version?: string;
  cvss?: string;
  createdAt?: string;
}

export interface DailyCriticalBranchGroup {
  branch: string;
  branchUrl: string;
  criticalCount: number;
  vulnerabilities: DailyCriticalVulnView[];
  hasMore: boolean;
  remainingCount: number;
}

export interface DailyCriticalProjectView {
  projectName: string;
  projectUrl: string;
  criticalCount: number;
  multiBranch: boolean;
  /** Inline header branch (single-branch projects only). */
  branch?: string;
  /** Per-branch sections (multi-branch projects only). */
  branches?: DailyCriticalBranchGroup[];
  /** Flat list (single-branch projects only). */
  vulnerabilities?: DailyCriticalVulnView[];
  hasMore: boolean;
  remainingCount: number;
}

function hasBranch(branch: string | undefined): branch is string {
  return typeof branch === 'string' && branch.trim() !== '';
}

function mapVuln(v: DailyCriticalVulnInput): DailyCriticalVulnView {
  return {
    severity: v.severity,
    title: v.title?.substring(0, 200) || 'Unknown vulnerability',
    type: v.type,
    packageName: v.packageName || undefined,
    version: v.version || undefined,
    cvss: v.cvss || undefined,
    createdAt: v.createdAt,
  };
}

function criticalUrl(baseUrl: string, branch?: string): string {
  const branchQuery = hasBranch(branch)
    ? `&branch=${encodeURIComponent(branch)}`
    : '';
  return `${baseUrl}?filter=critical${branchQuery}`;
}

export function buildDailyCriticalProjectView(
  project: DailyCriticalProjectInput,
  frontendUrl: string,
): DailyCriticalProjectView {
  const criticals = project.criticals ?? [];
  const baseUrl = `${frontendUrl}/project/${project.projectId}`;
  const totalCount = criticals.length;

  // Distinct *real* branches only — a null/empty branch is not a branch of its
  // own, so it can't turn a single-branch project into a multi-branch one.
  const distinctBranches: string[] = [];
  for (const v of criticals) {
    if (hasBranch(v.branch) && !distinctBranches.includes(v.branch)) {
      distinctBranches.push(v.branch);
    }
  }

  // Multi-branch → per-branch sections (branch-less vulns → sentinel bucket).
  if (distinctBranches.length >= 2) {
    type BucketKey = string | typeof NO_BRANCH_KEY;
    const order: BucketKey[] = [];
    const groups = new Map<BucketKey, DailyCriticalVulnInput[]>();
    for (const v of criticals) {
      const key: BucketKey = hasBranch(v.branch) ? v.branch : NO_BRANCH_KEY;
      let bucket = groups.get(key);
      if (!bucket) {
        bucket = [];
        groups.set(key, bucket);
        order.push(key);
      }
      bucket.push(v);
    }

    const branches: DailyCriticalBranchGroup[] = order.map((key) => {
      const bucket = groups.get(key)!;
      const isNoBranch = key === NO_BRANCH_KEY;
      return {
        branch: isNoBranch ? DEFAULT_BRANCH_LABEL : (key as string),
        branchUrl: criticalUrl(
          baseUrl,
          isNoBranch ? undefined : (key as string),
        ),
        criticalCount: bucket.length,
        vulnerabilities: bucket
          .slice(0, DAILY_CRITICAL_DISPLAY_CAP)
          .map(mapVuln),
        hasMore: bucket.length > DAILY_CRITICAL_DISPLAY_CAP,
        remainingCount: Math.max(0, bucket.length - DAILY_CRITICAL_DISPLAY_CAP),
      };
    });

    return {
      projectName: project.projectName,
      projectUrl: criticalUrl(baseUrl),
      criticalCount: totalCount,
      multiBranch: true,
      branches,
      hasMore: false,
      remainingCount: 0,
    };
  }

  // Single-branch (0 or 1 distinct real branch) → flat list, inline header.
  const branch =
    distinctBranches.length === 1 ? distinctBranches[0] : undefined;
  return {
    projectName: project.projectName,
    projectUrl: criticalUrl(baseUrl, branch),
    criticalCount: totalCount,
    multiBranch: false,
    branch,
    vulnerabilities: criticals
      .slice(0, DAILY_CRITICAL_DISPLAY_CAP)
      .map(mapVuln),
    hasMore: criticals.length > DAILY_CRITICAL_DISPLAY_CAP,
    remainingCount: Math.max(0, criticals.length - DAILY_CRITICAL_DISPLAY_CAP),
  };
}
