import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Not, Repository } from 'typeorm';
import {
  CvssCalculatorService,
  SecurityContextForScoring,
} from './cvss-calculator.service';
import { computeStaticExploitability } from './static-exploitability';
import { computeScaStaticExploitability } from '../sca/sca-static-exploitability';
import { computeSecretPriority } from './secret-priority';

type DetectionKind = 'sca' | 'standard';
import { deriveEffectiveSeverity } from './severity-from-cvss';
import {
  PriorityCalculatorService,
  PriorityInput,
} from '../result/priority-calculator.service';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from 'src/entities/container_vulnerability_detections.entity';
import { SecretVulnerabilityDetections } from 'src/entities/secret-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from 'src/entities/cicd-vulnerability-detections.entity';
import { VulnerabilityOsv } from 'src/entities/osv';

const BATCH_SIZE = 500;
// OSV ids are batched into the IN(...) clause so a tick that changed many
// vulnerabilities doesn't build one giant query.
const OSV_ID_CHUNK = 200;

@Injectable()
export class CvssRecalculationProcessor {
  private readonly logger = new Logger(CvssRecalculationProcessor.name);

  constructor(
    private readonly calculator: CvssCalculatorService,
    private readonly priorityCalculator: PriorityCalculatorService,
    @InjectRepository(SastVulnerabilityDetections)
    private readonly sastRepo: Repository<SastVulnerabilityDetections>,
    @InjectRepository(ScaVulnerabilityDetections)
    private readonly scaRepo: Repository<ScaVulnerabilityDetections>,
    @InjectRepository(IacVulnerabilityDetections)
    private readonly iacRepo: Repository<IacVulnerabilityDetections>,
    @InjectRepository(VulnerabilityDetectionsContainer)
    private readonly containerRepo: Repository<VulnerabilityDetectionsContainer>,
    @InjectRepository(SecretVulnerabilityDetections)
    private readonly secretRepo: Repository<SecretVulnerabilityDetections>,
    @InjectRepository(CicdVulnerabilityDetections)
    private readonly cicdRepo: Repository<CicdVulnerabilityDetections>,
  ) {}

  /**
   * Recompute priority only (no CVSS recalculation) for all active detections in a project.
   * Used for bulk recompute after deploying the new algorithm.
   */
  async recomputePrioritiesForProject(
    projectId: string,
    businessCriticality: number,
    dataClassification: number,
  ): Promise<number> {
    let totalUpdated = 0;
    const repos: Array<{
      repo: Repository<any>;
      loadPackageRelation: boolean;
      isSecret: boolean;
    }> = [
      { repo: this.sastRepo, loadPackageRelation: false, isSecret: false },
      { repo: this.scaRepo, loadPackageRelation: true, isSecret: false },
      { repo: this.iacRepo, loadPackageRelation: false, isSecret: false },
      { repo: this.containerRepo, loadPackageRelation: false, isSecret: false },
      { repo: this.secretRepo, loadPackageRelation: false, isSecret: true },
      { repo: this.cicdRepo, loadPackageRelation: false, isSecret: false },
    ];

    for (const { repo, loadPackageRelation, isSecret } of repos) {
      // Keyset (seek) pagination: WHERE id > lastId ORDER BY id LIMIT N.
      // Avoids the O(n²) cost of OFFSET on 100k+ row tables — each page is
      // O(log n) via the PK index instead of O(offset) full scan.
      let lastId: string | undefined = undefined;
      while (true) {
        const findOptions: any = {
          where: {
            projectId,
            ...(lastId !== undefined ? { id: MoreThan(lastId) } : {}),
          },
          order: { id: 'ASC' },
          take: BATCH_SIZE,
        };
        if (loadPackageRelation) {
          findOptions.relations = ['scaDetectedPackage'];
        }
        const detections = await repo.find(findOptions);
        if (detections.length === 0) break;

        const toSave: any[] = [];
        for (const det of detections) {
          if (det.priorityManualOverride) continue;

          if (isSecret) {
            // Secrets bypass the multi-signal composite — priority is a
            // deterministic rule: always critical_urgent (a leaked credential
            // IS the exploit, and the file context does not demote it). This
            // loop is also the migration path that re-aligns historic secrets
            // that were previously demoted.
            const secretPriority = computeSecretPriority();
            if (
              secretPriority.priority !== det.currentPriority ||
              secretPriority.priorityScore !== det.priorityScore
            ) {
              det.currentPriority = secretPriority.priority;
              det.priorityScore = secretPriority.priorityScore;
              toSave.push(det);
            }
            continue;
          }

          const reachability = loadPackageRelation
            ? ((det as any).scaDetectedPackage?.reachability ?? null)
            : null;
          const input: PriorityInput = {
            cvss4EnvironmentalScore: det.cvss4EnvironmentalScore ?? null,
            cvss4BaseScore: det.cvss4BaseScore ?? null,
            currentSeverity: det.effectiveSeverity ?? det.currentSeverity,
            epssScore: det.epssScore ?? null,
            epssPercentile: det.epssPercentile ?? null,
            exploitabilityScore: det.exploitabilityScore ?? null,
            businessCriticality,
            dataClassification,
            reachability,
            priorityManualOverride: false,
          };
          const result = this.priorityCalculator.calculate(input);
          if (result) {
            const priorityChanged = result.priority !== det.currentPriority;
            const scoreChanged = result.priorityScore !== det.priorityScore;
            if (priorityChanged || scoreChanged) {
              det.currentPriority = result.priority;
              det.priorityScore = result.priorityScore;
              toSave.push(det);
            }
          }
        }

        if (toSave.length > 0) {
          await repo.save(toSave);
          totalUpdated += toSave.length;
        }

        lastId = detections[detections.length - 1].id;
        if (detections.length < BATCH_SIZE) break;
      }
    }

    this.logger.log(
      `Recomputed priorities for ${totalUpdated} detections in project ${projectId}`,
    );
    return totalUpdated;
  }

  /**
   * Backfill cvss4Vector for detections that have NULL vectors.
   * For SAST/IAC/CICD/Secret: derives from vulnerability.cvss3 relation.
   * For SCA/Container: derives from OSV severity data or falls back to severity default.
   */
  async backfillMissingCvss4Vectors(projectId: string): Promise<number> {
    let total = 0;

    // SAST/IAC/CICD/Secret — load vulnerability relation for cvss3 data
    for (const repo of [
      this.sastRepo,
      this.iacRepo,
      this.cicdRepo,
      this.secretRepo,
    ]) {
      total += await this.backfillFromVulnerabilityCvss3(repo, projectId);
    }

    // SCA/Container — use severity default (avoids expensive OSV severity JOIN)
    for (const repo of [this.scaRepo, this.containerRepo]) {
      total += await this.backfillFromOsvSeverity(repo, projectId);
    }

    if (total > 0) {
      this.logger.log(
        `Backfilled CVSS4 vectors for ${total} detections in project ${projectId}`,
      );
    }
    return total;
  }

  async recalculateForProject(
    projectId: string,
    context: SecurityContextForScoring,
  ): Promise<number> {
    // Step 1: Backfill CVSS4 vectors for detections that don't have them yet
    await this.backfillMissingCvss4Vectors(projectId);

    // Step 2: Backfill static exploitability for detections that don't have it yet
    await this.backfillMissingExploitability(projectId);

    // Step 2b: Re-evaluate existing static SCA verdicts against the current
    // package state (reachability/isDev/isTransitive). Required because the
    // backfill above only fills NULL verdicts — when the SCA static rule
    // evolves (e.g. unused → not_exploitable), already-persisted verdicts
    // must be updated without waiting for a fresh scan to touch them.
    await this.reevaluateScaStaticExploitability(projectId);

    // Step 3: Backfill effectiveSeverity for detections that don't have it yet
    await this.backfillMissingEffectiveSeverity(projectId);

    let totalUpdated = 0;

    // SCA: load scaDetectedPackage so reachability is available to the
    // priority calculator (unused dependencies must collapse to very_low).
    totalUpdated += await this.recalculateRepo(
      this.scaRepo,
      projectId,
      context,
      true,
    );

    const otherRepos: Array<{ repo: Repository<any>; isSecret: boolean }> = [
      { repo: this.sastRepo, isSecret: false },
      { repo: this.iacRepo, isSecret: false },
      { repo: this.containerRepo, isSecret: false },
      { repo: this.secretRepo, isSecret: true },
      { repo: this.cicdRepo, isSecret: false },
    ];
    for (const { repo, isSecret } of otherRepos) {
      totalUpdated += await this.recalculateRepo(
        repo,
        projectId,
        context,
        false,
        isSecret,
      );
    }

    // Safety re-queue: rows whose cvss4Vector could not be produced during
    // step 1 (missing vulnerability.cvss3 relation at that moment, migration
    // stragglers) are skipped by recalculateRepo (WHERE cvss4Vector IS NOT
    // NULL). Re-run the backfill after recalc so any row that has since
    // become backfillable gets a vector and is no longer stale. Idempotent:
    // no-op when nothing left to backfill.
    await this.backfillMissingCvss4Vectors(projectId);

    this.logger.log(
      `Recalculated ${totalUpdated} detections for project ${projectId}`,
    );
    return totalUpdated;
  }

  /**
   * Re-derive CVSS for existing detections after an OSV record's severities
   * changed (a CVSS bump). Triggered by the delta sync with the set of OSV ids
   * whose CONTENT actually changed — re-stamps are already filtered out by the
   * `content_hash` skip, so we only run on real changes.
   *
   * Re-derives the base CVSS4 vector from the CURRENT OSV severities, re-applies
   * environmental metrics + effective severity + priority, and saves only the
   * detections that actually moved. Covers BOTH detection kinds that key off
   * OSV severities:
   *  - SCA: FK relation to VulnerabilityOsv (`vulnerability`)
   *  - Container: loose `vulnerabilityIdentifier` string, resolved via the
   *    EntityManager (no FK).
   *
   * Safety: only acts when the OSV exposes a concrete CVSS_V4/CVSS_V3 vector.
   * If only a text label is present it leaves the detection untouched, so a
   * package-specific (SCA) or alias-resolved (container) vector set at scan
   * time is never downgraded to a label default — those nuances are re-applied
   * by the next scan.
   */
  async refreshCvssFromOsv(
    projectId: string,
    osvIds: string[],
    context: SecurityContextForScoring,
  ): Promise<number> {
    if (!osvIds || osvIds.length === 0) return 0;

    let updated = 0;
    for (let i = 0; i < osvIds.length; i += OSV_ID_CHUNK) {
      const chunk = osvIds.slice(i, i + OSV_ID_CHUNK);
      updated += await this.refreshScaFromOsv(projectId, chunk, context);
      updated += await this.refreshContainerFromOsv(projectId, chunk, context);
    }

    if (updated > 0) {
      this.logger.log(
        `Refreshed CVSS from OSV for ${updated} detection(s) in project ${projectId} (${osvIds.length} changed OSV id(s))`,
      );
    }
    return updated;
  }

  private async refreshScaFromOsv(
    projectId: string,
    osvIds: string[],
    context: SecurityContextForScoring,
  ): Promise<number> {
    const detections = await this.scaRepo.find({
      where: { projectId, vulnerability: { id: In(osvIds) } },
      relations: {
        vulnerability: { severities: true },
        scaDetectedPackage: true,
      },
    });

    const toSave: any[] = [];
    for (const det of detections) {
      const base = this.deriveCvss4BaseFromOsvSeverities(
        (det as any).vulnerability?.severities,
      );
      if (!base) continue;
      const reachability =
        (det as any).scaDetectedPackage?.reachability ?? null;
      if (
        this.applyRefreshedCvss(det, base.vector, context, reachability, false)
      ) {
        toSave.push(det);
      }
    }

    if (toSave.length > 0) await this.scaRepo.save(toSave);
    return toSave.length;
  }

  private async refreshContainerFromOsv(
    projectId: string,
    osvIds: string[],
    context: SecurityContextForScoring,
  ): Promise<number> {
    const detections = await this.containerRepo.find({
      where: { projectId, vulnerabilityIdentifier: In(osvIds) },
    });
    if (detections.length === 0) return 0;

    // Container detections carry only a `vulnerabilityIdentifier` string (no FK),
    // so resolve the OSV records (with severities) via the shared EntityManager.
    const ids = Array.from(
      new Set(detections.map((d: any) => d.vulnerabilityIdentifier)),
    );
    const osvRecords: VulnerabilityOsv[] =
      await this.containerRepo.manager.find(VulnerabilityOsv, {
        where: { id: In(ids) },
        relations: { severities: true },
      });
    const osvById = new Map(osvRecords.map((o) => [o.id, o]));

    const toSave: any[] = [];
    for (const det of detections) {
      const osv = osvById.get((det as any).vulnerabilityIdentifier);
      const base = this.deriveCvss4BaseFromOsvSeverities(osv?.severities);
      if (!base) continue;
      if (this.applyRefreshedCvss(det, base.vector, context, null, false)) {
        toSave.push(det);
      }
    }

    if (toSave.length > 0) await this.containerRepo.save(toSave);
    return toSave.length;
  }

  /**
   * Build a CVSS4 base vector from OSV severities (CVSS_V4 preferred, else
   * CVSS_V3 converted). Returns null when neither is present so the caller
   * leaves the detection untouched rather than downgrading it to a label
   * default. Mirrors ScaService.computeCvss4FromAffected's global-fallback path.
   */
  private deriveCvss4BaseFromOsvSeverities(
    severities: Array<{ type: string; score: string }> | undefined,
  ): { vector: string; baseScore: number } | null {
    const cvss4 = severities?.find((s) => s.type === 'CVSS_V4')?.score ?? null;
    const cvss3 = severities?.find((s) => s.type === 'CVSS_V3')?.score ?? null;
    if (!cvss4 && !cvss3) return null;
    return this.calculator.computeCvss4Base({
      cvss4Vector: cvss4,
      cvss3Vector: cvss3,
      severity: '',
    });
  }

  /**
   * Apply environmental metrics + effective severity + priority to a detection
   * from a freshly-derived base vector. Returns true iff any persisted field
   * actually moved (so the caller saves only changed rows). Mirrors the inner
   * loop of recalculateRepo.
   */
  private applyRefreshedCvss(
    det: any,
    baseVector: string,
    context: SecurityContextForScoring,
    reachability: string | null,
    isSecret: boolean,
  ): boolean {
    const result = this.calculator.applyEnvironmentalMetrics(
      baseVector,
      context,
    );
    if (!result) return false;

    const newEffectiveSeverity = deriveEffectiveSeverity(
      result.environmentalScore,
      result.baseScore,
    );

    let changed =
      det.cvss4Vector !== baseVector ||
      det.cvss4BaseScore !== result.baseScore ||
      det.cvss4EnvironmentalScore !== result.environmentalScore ||
      det.cvss4EnvironmentalVector !== result.fullVector ||
      det.effectiveSeverity !== newEffectiveSeverity;

    det.cvss4Vector = baseVector;
    det.cvss4BaseScore = result.baseScore;
    det.cvss4EnvironmentalScore = result.environmentalScore;
    det.cvss4EnvironmentalVector = result.fullVector;
    det.effectiveSeverity = newEffectiveSeverity;

    if (!det.priorityManualOverride) {
      if (isSecret) {
        const secretPriority = computeSecretPriority();
        if (
          secretPriority.priority !== det.currentPriority ||
          secretPriority.priorityScore !== det.priorityScore
        ) {
          det.currentPriority = secretPriority.priority;
          det.priorityScore = secretPriority.priorityScore;
          changed = true;
        }
      } else {
        const input: PriorityInput = {
          cvss4EnvironmentalScore: result.environmentalScore,
          cvss4BaseScore: result.baseScore,
          currentSeverity: det.effectiveSeverity ?? det.currentSeverity,
          epssScore: det.epssScore ?? null,
          epssPercentile: det.epssPercentile ?? null,
          exploitabilityScore: det.exploitabilityScore ?? null,
          businessCriticality: this.mapBusinessCriticality(
            context.businessCriticality,
          ),
          dataClassification: this.mapDataClassification(
            context.dataClassification,
          ),
          reachability,
          priorityManualOverride: false,
        };
        const priorityResult = this.priorityCalculator.calculate(input);
        if (
          priorityResult &&
          (priorityResult.priority !== det.currentPriority ||
            priorityResult.priorityScore !== det.priorityScore)
        ) {
          det.currentPriority = priorityResult.priority;
          det.priorityScore = priorityResult.priorityScore;
          changed = true;
        }
      }
    }

    return changed;
  }

  async backfillMissingExploitability(projectId: string): Promise<number> {
    let total = 0;
    // SCA: load package relation to get reachability
    total += await this.backfillExploitabilityForRepo(
      this.scaRepo,
      projectId,
      'sca',
    );
    // Secrets are intentionally excluded: exploitability is not applicable to a
    // hardcoded credential (the secret IS the exploit). Secret priority comes
    // from a deterministic file-context rule, not the exploitability signal, so
    // their exploitability columns stay null.
    // Standard: file-path heuristic only (genuine test file → not_exploitable)
    for (const repo of [
      this.sastRepo,
      this.iacRepo,
      this.containerRepo,
      this.cicdRepo,
    ]) {
      total += await this.backfillExploitabilityForRepo(
        repo,
        projectId,
        'standard',
      );
    }
    if (total > 0) {
      this.logger.log(
        `Backfilled exploitability for ${total} detections in project ${projectId}`,
      );
    }
    return total;
  }

  async backfillMissingEffectiveSeverity(projectId: string): Promise<number> {
    let total = 0;
    for (const repo of [
      this.sastRepo,
      this.scaRepo,
      this.iacRepo,
      this.containerRepo,
      this.secretRepo,
      this.cicdRepo,
    ]) {
      total += await this.backfillEffectiveSeverityForRepo(repo, projectId);
    }
    if (total > 0) {
      this.logger.log(
        `Backfilled effectiveSeverity for ${total} detections in project ${projectId}`,
      );
    }
    return total;
  }

  private async backfillEffectiveSeverityForRepo(
    repo: Repository<any>,
    projectId: string,
  ): Promise<number> {
    let updated = 0;
    // Keyset pagination — see recomputePrioritiesForProject for rationale.
    let lastId: string | undefined = undefined;
    while (true) {
      const detections = await repo.find({
        where: {
          projectId,
          effectiveSeverity: IsNull(),
          ...(lastId !== undefined ? { id: MoreThan(lastId) } : {}),
        },
        order: { id: 'ASC' },
        take: BATCH_SIZE,
      });
      if (detections.length === 0) break;

      const toSave: any[] = [];
      for (const det of detections) {
        const sev = deriveEffectiveSeverity(
          det.cvss4EnvironmentalScore ?? null,
          det.cvss4BaseScore ?? null,
        );
        if (sev == null) continue;
        det.effectiveSeverity = sev;
        toSave.push(det);
      }

      if (toSave.length > 0) {
        await repo.save(toSave);
        updated += toSave.length;
      }

      lastId = detections[detections.length - 1].id;
      if (detections.length < BATCH_SIZE) break;
    }
    return updated;
  }

  /**
   * One-time global backfill: iterate all distinct project IDs and call
   * backfillMissingExploitability for each.
   */
  async backfillAllProjectsExploitability(): Promise<{
    projects: number;
    detections: number;
  }> {
    const rows: Array<{ projectId: string }> = await this.sastRepo
      .createQueryBuilder('d')
      .select('DISTINCT d.projectId', 'projectId')
      .getRawMany();

    let totalDetections = 0;
    for (const { projectId } of rows) {
      totalDetections += await this.backfillMissingExploitability(projectId);
      totalDetections +=
        await this.reevaluateScaStaticExploitability(projectId);
    }

    this.logger.log(
      `backfillAllProjectsExploitability: ${rows.length} projects, ${totalDetections} detections updated`,
    );
    return { projects: rows.length, detections: totalDetections };
  }

  private async backfillExploitabilityForRepo(
    repo: Repository<any>,
    projectId: string,
    kind: DetectionKind,
  ): Promise<number> {
    let updated = 0;
    // Keyset pagination — see recomputePrioritiesForProject for rationale.
    let lastId: string | undefined = undefined;

    while (true) {
      const findOptions: any = {
        where: {
          projectId,
          exploitabilityVerdict: IsNull(),
          ...(lastId !== undefined ? { id: MoreThan(lastId) } : {}),
        },
        order: { id: 'ASC' },
        take: BATCH_SIZE,
      };
      if (kind === 'sca') {
        findOptions.relations = ['scaDetectedPackage'];
      }

      const detections = await repo.find(findOptions);
      if (detections.length === 0) break;

      const toSave: any[] = [];
      for (const det of detections) {
        // Guard: only fill truly null verdicts (query filter may race)
        if (det.exploitabilityVerdict != null) continue;

        // Use the entity's `path` (when available) so the file-context
        // heuristic kicks in for SAST/IAC/CICD/Secret. Container detections
        // don't carry a path; the standard path falls back to 'theoretical'.
        const filePath: string | null = (det as any).path ?? null;
        let result;
        if (kind === 'sca') {
          result = computeScaStaticExploitability({
            isDev: det.scaDetectedPackage?.isDev ?? false,
            isTransitive: det.scaDetectedPackage?.isTransitive ?? false,
            reachability: det.scaDetectedPackage?.reachability ?? null,
            dependencyInfoAvailable:
              det.scaDetectedPackage?.dependencyInfoAvailable ?? true,
          });
        } else {
          result = computeStaticExploitability({ filePath });
        }

        det.exploitabilityVerdict = result.verdict;
        det.exploitabilityScore = result.score;
        det.exploitabilityReason = result.reason;
        det.exploitabilitySource = 'static';
        det.exploitabilityUpdatedAt = new Date();

        // Seed environmental score from base when not yet computed
        if (det.cvss4EnvironmentalScore == null && det.cvss4BaseScore != null) {
          det.cvss4EnvironmentalScore = det.cvss4BaseScore;
        }

        toSave.push(det);
      }

      if (toSave.length > 0) {
        await repo.save(toSave);
        updated += toSave.length;
      }

      lastId = detections[detections.length - 1].id;
      if (detections.length < BATCH_SIZE) break;
    }

    return updated;
  }

  /**
   * Re-evaluate already-persisted static SCA exploitability verdicts against
   * the current package state. Mirrors `applyScaStaticExploitabilityIfAllowed`
   * from sca.service.ts but operates outside the scan flow so rule updates
   * (e.g. reachability=unused → not_exploitable) propagate to historic data.
   *
   * Scope: SCA only, source='static' only. Agent-source verdicts and other
   * detection kinds are left untouched.
   */
  async reevaluateScaStaticExploitability(projectId: string): Promise<number> {
    let updated = 0;
    // Keyset pagination — see recomputePrioritiesForProject for rationale.
    let lastId: string | undefined = undefined;

    while (true) {
      const findOptions: any = {
        where: {
          projectId,
          exploitabilitySource: 'static',
          ...(lastId !== undefined ? { id: MoreThan(lastId) } : {}),
        },
        relations: ['scaDetectedPackage'],
        order: { id: 'ASC' },
        take: BATCH_SIZE,
      };

      const detections = await this.scaRepo.find(findOptions);
      if (detections.length === 0) break;

      const toSave: any[] = [];
      for (const det of detections) {
        const pkg = (det as any).scaDetectedPackage;
        if (!pkg) continue;

        const result = computeScaStaticExploitability({
          isDev: pkg.isDev ?? false,
          isTransitive: pkg.isTransitive ?? false,
          reachability: pkg.reachability ?? null,
          dependencyInfoAvailable: pkg.dependencyInfoAvailable ?? true,
        });

        const changed =
          det.exploitabilityVerdict !== result.verdict ||
          det.exploitabilityScore !== result.score ||
          det.exploitabilityReason !== result.reason;
        if (!changed) continue;

        det.exploitabilityVerdict = result.verdict;
        det.exploitabilityScore = result.score;
        det.exploitabilityReason = result.reason;
        det.exploitabilityUpdatedAt = new Date();
        toSave.push(det);
      }

      if (toSave.length > 0) {
        await this.scaRepo.save(toSave);
        updated += toSave.length;
      }

      lastId = detections[detections.length - 1].id;
      if (detections.length < BATCH_SIZE) break;
    }

    if (updated > 0) {
      this.logger.log(
        `Re-evaluated SCA static exploitability for ${updated} detections in project ${projectId}`,
      );
    }
    return updated;
  }

  private async recalculateRepo(
    repo: Repository<any>,
    projectId: string,
    context: SecurityContextForScoring,
    loadPackageRelation = false,
    isSecret = false,
  ): Promise<number> {
    let updated = 0;
    // Keyset pagination — see recomputePrioritiesForProject for rationale.
    let lastId: string | undefined = undefined;

    while (true) {
      const findOptions: any = {
        where: {
          projectId,
          cvss4Vector: Not(IsNull()),
          ...(lastId !== undefined ? { id: MoreThan(lastId) } : {}),
        },
        order: { id: 'ASC' },
        take: BATCH_SIZE,
      };
      if (loadPackageRelation) {
        findOptions.relations = ['scaDetectedPackage'];
      }
      const detections = await repo.find(findOptions);

      if (detections.length === 0) break;

      const toSave: any[] = [];
      for (const det of detections) {
        if (!det.cvss4Vector) continue;

        const result = this.scoreWithContext(det, context);
        if (!result) continue;

        det.cvss4BaseScore = result.baseScore;
        det.cvss4EnvironmentalScore = result.environmentalScore;
        det.cvss4EnvironmentalVector = result.fullVector;
        det.effectiveSeverity = deriveEffectiveSeverity(
          result.environmentalScore,
          result.baseScore,
        );

        if (!det.priorityManualOverride) {
          if (isSecret) {
            // Secrets: priority is a deterministic rule (always critical_urgent),
            // not the CVSS/EPSS/exploitability composite. The
            // CVSS env above is still refreshed because the CybeRisk score
            // consumes it.
            const secretPriority = computeSecretPriority();
            det.currentPriority = secretPriority.priority;
            det.priorityScore = secretPriority.priorityScore;
          } else {
            const reachability = loadPackageRelation
              ? ((det as any).scaDetectedPackage?.reachability ?? null)
              : null;
            const input: PriorityInput = {
              cvss4EnvironmentalScore: result.environmentalScore,
              cvss4BaseScore: result.baseScore,
              currentSeverity: det.effectiveSeverity ?? det.currentSeverity,
              epssScore: det.epssScore ?? null,
              epssPercentile: det.epssPercentile ?? null,
              exploitabilityScore: det.exploitabilityScore ?? null,
              businessCriticality: this.mapBusinessCriticality(
                context.businessCriticality,
              ),
              dataClassification: this.mapDataClassification(
                context.dataClassification,
              ),
              reachability,
              priorityManualOverride: false,
            };
            const priorityResult = this.priorityCalculator.calculate(input);
            if (priorityResult) {
              det.currentPriority = priorityResult.priority;
              det.priorityScore = priorityResult.priorityScore;
            }
          }
        }

        toSave.push(det);
      }

      if (toSave.length > 0) {
        await repo.save(toSave);
        updated += toSave.length;
      }

      lastId = detections[detections.length - 1].id;
      if (detections.length < BATCH_SIZE) break;
    }

    return updated;
  }

  /**
   * The base and environmental scores of a detection under `context`.
   *
   * A detection with no CVSS of its own carries the default vector of its
   * label, current or former. It gets the current default vector and no
   * environmental adjustment: the vector's metrics are invented, and adjusting
   * them would move the severity its scanner gave.
   */
  private scoreWithContext(
    det: {
      cvss4Vector: string;
      currentSeverity?: string | null;
    },
    context: SecurityContextForScoring,
  ): {
    fullVector: string | null;
    baseScore: number;
    environmentalScore: number;
  } | null {
    if (
      this.calculator.isSeverityDefaultVector(
        det.cvss4Vector,
        det.currentSeverity,
      )
    ) {
      const base =
        this.calculator.computeCvss4Base({
          severity: det.currentSeverity ?? '',
        }) ??
        this.calculator.computeCvss4Base({
          cvss4Vector: det.cvss4Vector,
          severity: '',
        });
      if (!base) return null;
      det.cvss4Vector = base.vector;
      return {
        fullVector: null,
        baseScore: base.baseScore,
        environmentalScore: base.baseScore,
      };
    }
    return this.calculator.applyEnvironmentalMetrics(det.cvss4Vector, context);
  }

  private async backfillFromVulnerabilityCvss3(
    repo: Repository<any>,
    projectId: string,
  ): Promise<number> {
    let updated = 0;
    // Keyset pagination — see recomputePrioritiesForProject for rationale.
    let lastId: string | undefined = undefined;

    while (true) {
      const detections = await repo.find({
        where: {
          projectId,
          cvss4Vector: IsNull(),
          ...(lastId !== undefined ? { id: MoreThan(lastId) } : {}),
        },
        relations: ['vulnerability'],
        order: { id: 'ASC' },
        take: BATCH_SIZE,
      });
      if (detections.length === 0) break;

      const toSave: any[] = [];
      for (const det of detections) {
        const cvss3Vector = det.vulnerability?.cvss3?.vector ?? null;
        const result = this.calculator.computeCvss4Base({
          cvss3Vector,
          severity: det.currentSeverity,
        });
        if (result) {
          det.cvss4Vector = result.vector;
          det.cvss4BaseScore = result.baseScore;
          toSave.push(det);
        }
      }

      if (toSave.length > 0) {
        await repo.save(toSave);
        updated += toSave.length;
      }

      lastId = detections[detections.length - 1].id;
      if (detections.length < BATCH_SIZE) break;
    }
    return updated;
  }

  private async backfillFromOsvSeverity(
    repo: Repository<any>,
    projectId: string,
  ): Promise<number> {
    let updated = 0;
    // Keyset pagination — see recomputePrioritiesForProject for rationale.
    let lastId: string | undefined = undefined;

    while (true) {
      // Avoid loading vulnerability.severities — the JOIN against the large
      // osv_severity table (395K+ rows) causes query hangs. Fall back to
      // severityToDefaultVector via currentSeverity instead. New scans use
      // the accurate CVSS3/4 data from the creation flow.
      const detections = await repo.find({
        where: {
          projectId,
          cvss4Vector: IsNull(),
          ...(lastId !== undefined ? { id: MoreThan(lastId) } : {}),
        },
        order: { id: 'ASC' },
        take: BATCH_SIZE,
      });
      if (detections.length === 0) break;

      const toSave: any[] = [];
      for (const det of detections) {
        const result = this.calculator.computeCvss4Base({
          severity: det.currentSeverity,
        });
        if (result) {
          det.cvss4Vector = result.vector;
          det.cvss4BaseScore = result.baseScore;
          toSave.push(det);
        }
      }

      if (toSave.length > 0) {
        await repo.save(toSave);
        updated += toSave.length;
      }

      lastId = detections[detections.length - 1].id;
      if (detections.length < BATCH_SIZE) break;
    }
    return updated;
  }

  private mapBusinessCriticality(value: string): number {
    const map: Record<string, number> = {
      low: 1,
      medium: 2,
      high: 3,
      mission_critical: 4,
    };
    if (value == null) return 0;
    const mapped = map[value.toLowerCase()];
    if (mapped === undefined) {
      this.logger.warn(
        `Unknown businessCriticality value '${value}', defaulting to UNSPECIFIED (0). ` +
          `Expected one of: ${Object.keys(map).join(', ')}.`,
      );
      return 0;
    }
    return mapped;
  }

  private mapDataClassification(value: string): number {
    const map: Record<string, number> = {
      public: 1,
      internal: 2,
      confidential: 3,
      regulated: 4,
    };
    if (value == null) return 0;
    const mapped = map[value.toLowerCase()];
    if (mapped === undefined) {
      this.logger.warn(
        `Unknown dataClassification value '${value}', defaulting to UNSPECIFIED (0). ` +
          `Expected one of: ${Object.keys(map).join(', ')}.`,
      );
      return 0;
    }
    return mapped;
  }
}
