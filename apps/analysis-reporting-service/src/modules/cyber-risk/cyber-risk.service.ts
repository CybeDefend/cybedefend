import { Injectable, Logger } from '@nestjs/common';
import { pointsFromVuln } from './helpers/points-from-vuln';
import { levelFromScore, CyberRiskLevel } from './helpers/level-from-score';
import { ProjectCyberRiskRepository } from './repositories/project-cyber-risk.repository';
import { ActiveVulnFetcher } from './active-vuln-fetcher.service';
import { ReferenceBranchResolver } from './reference-branch.resolver';

export type ProjectScoreResult = {
  projectId: string;
  score: number;
  level: CyberRiskLevel;
  vulnCount: number;
  computedAt: Date;
};

@Injectable()
export class CyberRiskService {
  private readonly logger = new Logger(CyberRiskService.name);

  constructor(
    private readonly repo: ProjectCyberRiskRepository,
    private readonly activeVulnFetcher: ActiveVulnFetcher,
    private readonly referenceBranchResolver: ReferenceBranchResolver,
  ) {}

  /**
   * Computes the CybeRisk Score for a project and persists it.
   *
   * Pure formula: score = round( Σ pointsFromVuln(v) ) over all
   * vulnerabilities of the project currently in active states
   * (to_verify, confirmed).
   *
   * No multipliers, no reachability factor — contextualisation lives
   * inside vuln.cvssEnvironmental (recalculated upstream by
   * CvssCalculatorService when the security context changes).
   */
  async computeAndPersistProjectScore(
    projectId: string,
  ): Promise<ProjectScoreResult> {
    const branches =
      await this.referenceBranchResolver.getScoringBranches(projectId);
    const vulns = await this.activeVulnFetcher.fetchActiveVulns(
      projectId,
      undefined,
      branches,
    );

    let total = 0;
    for (const v of vulns) {
      total += pointsFromVuln(v);
    }
    const score = Math.round(total);
    const level = levelFromScore(score);
    const computedAt = new Date();

    // Persist the 7-day (sliding-window) level alongside the all-time level so
    // the project-list hot path reads it instead of recomputing it live on
    // every request. Refreshed on every recompute, same as the all-time level.
    const sevenDaysAgo = new Date(
      computedAt.getTime() - 7 * 24 * 60 * 60 * 1000,
    );
    const level7Days = await this.computeProjectScoreLevelSince(
      projectId,
      sevenDaysAgo,
    );

    await this.repo.upsert({
      projectId,
      score,
      level,
      level7Days,
      vulnCount: vulns.length,
      computedAt,
    });

    this.logger.debug(
      `cyberisk recomputed projectId=${projectId} score=${score} level=${level} level7d=${level7Days} vulns=${vulns.length}`,
    );

    return { projectId, score, level, vulnCount: vulns.length, computedAt };
  }

  // Live, non-persisted level from vulns discovered since a cutoff (7-day
  // metric). Branch-scoped to the project reference branch (main/master
  // fallback) so it stays consistent with the persisted all-time score.
  async computeProjectScoreLevelSince(
    projectId: string,
    since: Date,
  ): Promise<CyberRiskLevel> {
    const branches =
      await this.referenceBranchResolver.getScoringBranches(projectId);
    const vulns = await this.activeVulnFetcher.fetchActiveVulns(
      projectId,
      since,
      branches,
    );
    let total = 0;
    for (const v of vulns) total += pointsFromVuln(v);
    return levelFromScore(Math.round(total));
  }

  // Batched live levels (since-filtered) for listing/KPI endpoints. Branch-scoped
  // per project (one reference-branch lookup per id, resolved in parallel) so the
  // 7-day KPI matches the branch-scoped persisted score.
  async computeBatchLevelsSince(
    projectIds: string[],
    since: Date,
  ): Promise<Map<string, CyberRiskLevel>> {
    const out = new Map<string, CyberRiskLevel>();
    if (projectIds.length === 0) return out;
    const branchesByProject =
      await this.referenceBranchResolver.getScoringBranchesBatch(projectIds);
    const byProject = await this.activeVulnFetcher.fetchActiveVulnsBatch(
      projectIds,
      since,
      branchesByProject,
    );
    for (const projectId of projectIds) {
      const vulns = byProject.get(projectId) ?? [];
      let total = 0;
      for (const v of vulns) total += pointsFromVuln(v);
      out.set(projectId, levelFromScore(Math.round(total)));
    }
    return out;
  }
}
