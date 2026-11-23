import { READ_ONLY_TOOL, uuidProperty } from '../mcp/tools/schema-parts';
import { McpToolDefinition } from '../mcp/tools/types';
import { GatewayClientService } from '../gateway-client/gateway-client.service';

type SeverityBucket = 'critical' | 'high' | 'medium' | 'low';
type SeverityCounts = Record<SeverityBucket, number>;

/** Number of projects returned in `topProjects`. */
const TOP_PROJECTS_LIMIT = 5;

interface RankedProject {
  projectId: string;
  projectName?: string;
  criticalHigh: number;
  total: number;
  riskLevel?: string;
}

interface PostureResult {
  totalProjectsAccessible: number;
  projectsScanned: number;
  totalsBySeverity: SeverityCounts;
  totalsByScanner: Record<string, number>;
  topProjects: RankedProject[];
  errors: number;
  generatedAt: string;
}

function safeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.trunc(value);
}

function readSeverityTotals(overview: unknown): SeverityCounts {
  const out: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  if (!overview || typeof overview !== 'object') return out;
  const o = overview as Record<string, unknown>;
  out.critical = safeCount(o.criticalIssues);
  out.high = safeCount(o.highIssues);
  out.medium = safeCount(o.mediumIssues);
  out.low = safeCount(o.lowIssues);
  return out;
}

function readScannerTotals(overview: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!overview || typeof overview !== 'object') return out;
  const arr = (overview as Record<string, unknown>).totalByAnalysisType;
  if (!Array.isArray(arr)) return out;
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const typeRaw = (entry as Record<string, unknown>).analysisType;
    const count = safeCount((entry as Record<string, unknown>).count);
    if (typeof typeRaw !== 'string' || count === 0) continue;
    const type = typeRaw.toLowerCase();
    out[type] = (out[type] ?? 0) + count;
  }
  return out;
}

function readTopProjects(overview: unknown): RankedProject[] {
  if (!overview || typeof overview !== 'object') return [];
  const arr = (overview as Record<string, unknown>).topVulnerableProjects;
  if (!Array.isArray(arr)) return [];
  const out: RankedProject[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const projectId = typeof e.projectId === 'string' ? e.projectId : undefined;
    if (!projectId) continue;
    const criticalHigh = safeCount(e.criticalCount) + safeCount(e.highCount);
    const total = safeCount(e.vulnerabilityCount);
    const ranked: RankedProject = {
      projectId,
      criticalHigh,
      total,
    };
    if (typeof e.projectName === 'string' && e.projectName.length > 0) {
      ranked.projectName = e.projectName;
    }
    if (typeof e.riskLevel === 'string' && e.riskLevel.length > 0) {
      ranked.riskLevel = e.riskLevel;
    }
    out.push(ranked);
  }
  return out
    .sort((a, b) => b.criticalHigh - a.criticalHigh)
    .slice(0, TOP_PROJECTS_LIMIT);
}

function readTotalProjects(overview: unknown): number {
  if (!overview || typeof overview !== 'object') return 0;
  const v = (overview as Record<string, unknown>).totalProjects;
  return safeCount(v);
}

function readProjectsScanned(overview: unknown): number {
  if (!overview || typeof overview !== 'object') return 0;
  const arr = (overview as Record<string, unknown>).projectsSummary;
  if (!Array.isArray(arr)) return 0;
  // Treat a project as "scanned" when it has at least one vulnerability
  // counted; this is consistent with the legacy fan-out semantics where a
  // never-scanned project produced no overview at all.
  let count = 0;
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const total = safeCount(
      (entry as Record<string, unknown>).totalVulnerabilities,
    );
    if (total > 0) count += 1;
  }
  // Fall back to the project count itself when the gateway returned
  // summaries but no vulnerabilities at all (a brand-new org with empty
  // projects must still report something meaningful).
  return count > 0 ? count : arr.length;
}

/**
 * `get_user_posture` — cross-project security posture rollup.
 *
 * Thin wrapper around the gateway's
 * `GET /organization/{id}/results/overview` endpoint. mcp-service is no
 * longer responsible for fan-out or per-project authorisation: Gateway
 * already aggregates the user's accessible scope via Permify and returns
 * the consolidated payload in a single call. We only normalise the shape
 * here to keep the historical MCP wire contract stable
 * (`{ totalProjectsAccessible, projectsScanned, totalsBySeverity,
 * totalsByScanner, topProjects, errors, generatedAt }`).
 */
export function buildGetUserPostureTool(
  gateway: GatewayClientService,
): McpToolDefinition {
  return {
    name: 'get_user_posture',
    annotations: READ_ONLY_TOOL,
    description:
      "Aggregate the caller's cross-project security posture for an " +
      'organization in a single call. Returns severity totals, ' +
      'per-scanner totals and the top ' +
      `${TOP_PROJECTS_LIMIT} projects by critical+high.`,
    inputSchema: {
      type: 'object',
      properties: {
        organizationId: uuidProperty(
          'Organization UUID to aggregate over. Gateway applies the ' +
            "caller's access scope before returning the rollup.",
        ),
        branches: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional. Restrict the rollup to these branches.',
        },
      },
      required: ['organizationId'],
    },
    async run(args, context) {
      if (!context?.accessToken) {
        throw new Error('Missing access token in tool context');
      }
      const organizationId =
        typeof args.organizationId === 'string'
          ? args.organizationId.trim()
          : '';
      if (!organizationId) {
        throw new Error('organizationId is required');
      }
      const branches = Array.isArray(args.branches)
        ? args.branches.filter(
            (b): b is string => typeof b === 'string' && b.length > 0,
          )
        : undefined;
      const generatedAt = new Date().toISOString();

      const overview = await gateway.getOrganizationOverview(
        organizationId,
        branches && branches.length > 0 ? branches : undefined,
        context.accessToken,
      );

      const result: PostureResult = {
        totalProjectsAccessible: readTotalProjects(overview),
        projectsScanned: readProjectsScanned(overview),
        totalsBySeverity: readSeverityTotals(overview),
        totalsByScanner: readScannerTotals(overview),
        topProjects: readTopProjects(overview),
        errors: 0,
        generatedAt,
      };
      return result;
    },
  };
}
