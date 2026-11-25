import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, Inject, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { ulid } from 'ulid';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import type { ClientGrpc } from '@nestjs/microservices';
import { POLICY_QUEUE_NAMES } from '../queue-names';
import { PolicyEvaluationJobData } from '../evaluation-queue.service';
import {
  PolicyEvaluation,
  EvaluationStatus,
  ComplianceResultDetails,
  EvaluationWarning,
} from '@entities/policy-evaluation.entity';
import {
  PolicyViolation,
  ViolationDetails,
  AffectedVulnerability,
} from '@entities/policy-violation.entity';
import {
  SecurityPolicy,
  PolicyRule,
  PolicyExclusion,
  ViolationAction,
  RuleType,
  RuleOperator,
} from '@entities/security-policy.entity';
import { PolicyService } from '@modules/policy/policy.service';
import { normalizeSeverity, severityRank } from '@modules/policy/severity';
import { countViolatedRules } from '@modules/evaluation/violation-counts';
import { matchGlob } from '@modules/evaluation/safe-glob';

/**
 * Vulnerability data from the analysis-reporting service
 */
interface VulnerabilityData {
  id: string;
  name: string;
  severity: string;
  cvssScore?: number;
  cwe?: string[];
  owaspTop10?: string[];
  owaspCategory?: string;
  scannerType: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  isNew?: boolean;
  status?: string;
  createdAt?: number; // Unix timestamp
  branch?: string; // Branch where this vulnerability was detected
  // SCA-specific fields
  packageName?: string;
  packageVersion?: string;
  // Container-specific fields
  artifactName?: string;
}

/**
 * Scan context for rule evaluation (contains scan-level data like branch)
 */
interface ScanContext {
  scanId: string;
  branch?: string;
  /** Told when a branch pattern of a rule had to be skipped. */
  onSkip?: (rule: PolicyRule, pattern: string, reason: string) => void;
}

/**
 * First key of the advisory lock that serializes the violation writes of one
 * project; the second key is a hash of the project id.
 */
const VIOLATION_WRITE_LOCK_NAMESPACE = 0x706f6c76;

/** Most skipped-pattern warnings kept in one evaluation result. */
const MAX_EVALUATION_WARNINGS = 50;

/**
 * Collects, once each, the glob patterns an evaluation had to skip, with the
 * policy that holds them, for the stored evaluation result.
 */
class SkippedPatterns {
  private readonly entries = new Map<string, EvaluationWarning>();

  constructor(private readonly policies: SecurityPolicy[]) {}

  exclusion(pattern: string, reason: string): void {
    const policy = this.policies.find((p) =>
      [...(p.exclusions || []), ...(p.rules?.exclusions || [])].some(
        (e) => e?.pattern === pattern,
      ),
    );
    this.add({
      policyId: policy?.id || '',
      policyName: policy?.name,
      pattern,
      reason,
    });
  }

  branch(
    policy: SecurityPolicy | undefined,
    rule: PolicyRule,
    pattern: string,
    reason: string,
  ): void {
    this.add({
      policyId: policy?.id || '',
      policyName: policy?.name,
      ruleId: rule.id,
      pattern,
      reason,
    });
  }

  list(): EvaluationWarning[] {
    return [...this.entries.values()];
  }

  private add(warning: EvaluationWarning): void {
    const key = JSON.stringify([
      warning.policyId,
      warning.ruleId ?? '',
      warning.pattern,
      warning.reason,
    ]);
    if (this.entries.has(key)) return;
    if (this.entries.size >= MAX_EVALUATION_WARNINGS) return;
    this.entries.set(key, warning);
  }
}

/**
 * License summary data from the analysis-reporting service
 */
interface LicenseSummaryData {
  projectId: string;
  totalPackages: number;
  packagesWithLicenses: number;
  packagesWithoutLicenses: number;
  permissiveCount: number;
  weakCopyleftCount: number;
  strongCopyleftCount: number;
  unknownCount: number;
  licenses: {
    spdxId: string;
    name: string;
    category: string;
    risk: string;
    riskDescription: string;
    count: number;
  }[];
}

/**
 * Interface for analysis reporting gRPC client
 */
interface AnalysisReportingClient {
  getProjectSastVulnerabilities(request: {
    projectId: string;
    scanId: string;
  }): { toPromise(): Promise<{ vulnerabilities: VulnerabilityData[] }> };
  getProjectIacVulnerabilities(request: {
    projectId: string;
    scanId: string;
  }): { toPromise(): Promise<{ vulnerabilities: VulnerabilityData[] }> };
  getProjectScaVulnerabilities(request: {
    projectId: string;
    scanId: string;
    branch?: string;
    malwareOnly?: boolean;
  }): { toPromise(): Promise<{ vulnerabilities: VulnerabilityData[] }> };
  getProjectContainerVulnerabilities(request: {
    projectId: string;
    scanId: string;
  }): { toPromise(): Promise<{ vulnerabilities: VulnerabilityData[] }> };
  getProjectSecretVulnerabilities(request: {
    projectId: string;
    scanId: string;
  }): { toPromise(): Promise<{ vulnerabilities: VulnerabilityData[] }> };
  getProjectCicdVulnerabilities(request: {
    projectId: string;
    scanId: string;
  }): { toPromise(): Promise<{ vulnerabilities: VulnerabilityData[] }> };
  getScanQueueStatus(request: { scanId: string }): {
    toPromise(): Promise<{
      scanId: string;
      isProcessingComplete: boolean;
      pendingJobs: number;
      activeJobs: number;
      completedJobs: number;
      failedJobs: number;
      scaPending: number;
      sastIacPending: number;
      containerPending: number;
    }>;
  };
  getProjectLicenseSummary(request: {
    projectId: string;
    branch?: string;
    organizationId?: string;
  }): {
    toPromise(): Promise<LicenseSummaryData>;
  };
}

/**
 * BullMQ Processor for policy evaluation jobs.
 *
 * Key features:
 * - Fetches vulnerabilities from analysis-reporting service
 * - Evaluates each vulnerability against applicable policies
 * - Creates violation records for policy breaches
 * - Updates evaluation status with compliance results
 */

/**
 * Build a rule snapshot for storing in violation details.
 * Includes criteria for composite rules (AND/OR).
 */
function buildRuleSnapshot(rule: PolicyRule): Partial<PolicyRule> {
  const isComposite =
    rule.type === RuleType.COMPOSITE_AND || rule.type === RuleType.COMPOSITE_OR;

  const base: Partial<PolicyRule> = {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    type: rule.type,
    action: rule.action,
  };

  if (isComposite && rule.criteria) {
    // For composite rules, include the child criteria (simplified)
    base.criteria = rule.criteria.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      isEnabled: c.isEnabled,
      type: c.type,
      operator: c.operator,
      value: c.value,
      action: c.action,
    }));
  } else {
    // For simple rules, include operator and value
    base.operator = rule.operator;
    base.value = rule.value;
  }

  return base;
}

/** The findings that broke one rule of one policy in this evaluation. */
interface PendingViolation {
  policyId: string;
  /** The rule as first matched: its name and action name the row. */
  rule: PolicyRule;
  /** The rule as last matched: the stored snapshot. */
  snapshotRule: PolicyRule;
  vulnerabilities: VulnerabilityData[];
}

const violationKey = (policyId: string, ruleId: string): string =>
  JSON.stringify([policyId, ruleId]);

/** A finding as a violation row lists it, with the branch it was found on. */
function toAffectedVulnerability(
  vulnerability: VulnerabilityData,
): AffectedVulnerability {
  return {
    id: vulnerability.id,
    name: vulnerability.name,
    severity: vulnerability.severity,
    cvssScore: vulnerability.cvssScore,
    cwe: vulnerability.cwe,
    owaspTop10: vulnerability.owaspTop10,
    filePath: vulnerability.filePath,
    startLine: vulnerability.startLine,
    endLine: vulnerability.endLine,
    vulnerabilityType: vulnerability.scannerType?.toLowerCase() || '',
    branch: vulnerability.branch,
    // SCA-specific fields
    packageName: vulnerability.packageName,
    packageVersion: vulnerability.packageVersion,
    // Container-specific fields
    artifactName: vulnerability.artifactName,
  };
}

/** A container finding page: the list's largest (clampListPageSize). */
const CONTAINER_PAGE_SIZE = 500;
/** At most 100,000 container findings per evaluation. */
const CONTAINER_MAX_PAGES = 200;

@Processor(POLICY_QUEUE_NAMES.EVALUATION, {
  concurrency: 2, // Process 2 evaluations at a time
  lockDuration: 300000, // 5 minutes for complex evaluations
  lockRenewTime: 60000,
})
export class PolicyEvaluationProcessor extends WorkerHost {
  private readonly logger = new Logger(PolicyEvaluationProcessor.name);
  private analysisClient: AnalysisReportingClient;

  constructor(
    @InjectRepository(PolicyEvaluation)
    private readonly evaluationRepository: Repository<PolicyEvaluation>,
    @InjectRepository(PolicyViolation)
    private readonly violationRepository: Repository<PolicyViolation>,
    @InjectRepository(SecurityPolicy)
    private readonly policyRepository: Repository<SecurityPolicy>,
    private readonly policyService: PolicyService,
    @Inject('ANALYSIS_REPORTING_SERVICE')
    private readonly analysisReportingGrpc: ClientGrpc,
    @Optional()
    private readonly realtime?: RealtimeEventPublisher,
  ) {
    super();
  }

  onModuleInit() {
    this.analysisClient =
      this.analysisReportingGrpc.getService<AnalysisReportingClient>(
        'ResultService',
      );
  }

  /**
   * Process a policy evaluation job
   */
  async process(job: Job<PolicyEvaluationJobData>): Promise<void> {
    const {
      evaluationId,
      scanId,
      projectId,
      organizationId,
      branch,
      hierarchy,
    } = job.data;

    this.logger.log(
      `[Evaluation] Starting job ${job.id} for scan=${scanId}, project=${projectId}`,
    );

    const startTime = Date.now();

    try {
      // Update evaluation status to IN_PROGRESS
      await this.updateEvaluationStatus(
        evaluationId,
        EvaluationStatus.IN_PROGRESS,
        {
          startedAt: new Date(),
          progressPercentage: 10,
        },
      );
      await job.updateProgress(10);

      // 1. Get effective policy for this project. triggerEvaluation resolved
      // the project's hierarchy in global-management and the job carries it;
      // a job queued before that field, or an OSV
      // re-evaluation, resolves it here.
      const { effectiveConfig, appliedPolicies } = hierarchy?.organizationId
        ? await this.policyService.getEffectivePolicyForHierarchy(
            projectId,
            hierarchy,
          )
        : await this.policyService.getEffectivePolicy(projectId);

      if (appliedPolicies.length === 0) {
        // No policies apply - mark as compliant
        await this.completeEvaluation(evaluationId, {
          compliant: true,
          action: null,
          violations: [],
        });
        this.logger.log(
          `[Evaluation] No policies apply for project=${projectId}`,
        );
        void this.realtime?.publish({
          eventId: ulid(),
          type: 'POLICY_EVALUATION_COMPLETED',
          scope: { organizationId, projectId, scanId },
          payload: {
            policyEvaluationCompleted: {
              scanId,
              projectId,
              violationsCount: 0,
            },
          },
        });
        return;
      }

      await job.updateProgress(20);

      // 2. Wait for vulnerability processing to complete in analysis-reporting
      const queueReady = await this.waitForQueueCompletion(scanId);
      if (!queueReady) {
        this.logger.warn(
          `[Evaluation] Queue not fully processed for scan=${scanId}, proceeding with available data`,
        );
      }

      await job.updateProgress(30);

      // 3. Fetch all vulnerabilities for this scan
      const { vulnerabilities, failedTypes } =
        await this.fetchVulnerabilitiesReport(projectId, scanId, branch);
      await job.updateProgress(50);

      this.logger.log(
        `[Evaluation] Found ${vulnerabilities.length} vulnerabilities for scan=${scanId}`,
      );

      // 4. Evaluate each vulnerability against all rules
      const violations: ComplianceResultDetails['violations'] = [];
      const pendingViolations = new Map<string, PendingViolation>();
      let highestAction: ViolationAction | null = null;

      const rules = effectiveConfig.rules || [];
      const exclusions = effectiveConfig.exclusions || [];
      const skipped = new SkippedPatterns(appliedPolicies);
      const onBranchSkip = (
        rule: PolicyRule,
        pattern: string,
        reason: string,
      ): void =>
        skipped.branch(
          this.findPolicyForRule(rule, appliedPolicies),
          rule,
          pattern,
          reason,
        );

      this.logger.log(
        `[Evaluation] Evaluating ${vulnerabilities.length} vulnerabilities against ${rules.length} rules from ${appliedPolicies.length} policies`,
      );

      await job.updateProgress(60);

      for (const vulnerability of vulnerabilities) {
        // Ignore vulnerabilities with certain statuses
        // Note: "proposed_not_exploitable" is NOT ignored as it requires validation
        const ignoredStatuses = ['not_exploitable', 'resolved', 'ignored'];
        if (
          vulnerability.status &&
          ignoredStatuses.includes(vulnerability.status.toLowerCase())
        ) {
          continue;
        }

        // Check if vulnerability is excluded
        if (
          this.isExcluded(vulnerability, exclusions, (pattern, reason) =>
            skipped.exclusion(pattern, reason),
          )
        ) {
          continue;
        }

        for (const rule of rules) {
          if (!rule.isEnabled) {
            continue;
          }

          const matchResult = this.evaluateRule(rule, vulnerability, {
            scanId,
            branch,
            onSkip: onBranchSkip,
          });

          if (matchResult.matches) {
            // Find the policy that contains this rule
            const policy = this.findPolicyForRule(rule, appliedPolicies);

            violations.push({
              policyId: policy?.id || '',
              ruleId: rule.id,
              ruleName: rule.name,
              action: rule.action,
              details: {
                ruleName: rule.name,
                condition: matchResult.condition,
                matchedValues: matchResult.matchedValues,
              },
              affectedVulnerabilityIds: [vulnerability.id],
            });

            // Track highest action (BLOCK > WARN)
            if (rule.action === ViolationAction.BLOCK) {
              highestAction = ViolationAction.BLOCK;
            } else if (highestAction !== ViolationAction.BLOCK) {
              highestAction = ViolationAction.WARN;
            }

            this.queueViolation(pendingViolations, policy, rule, vulnerability);
          }
        }
      }

      // Evaluate license_check rules separately (licenses are per-package, not per-vulnerability)
      const licenseRules = rules.filter(
        (r) => r.isEnabled !== false && this.ruleTouchesLicense(r),
      );
      this.logger.log(
        `[Evaluation] License rules found: ${licenseRules.length} (total rules: ${rules.length}, rules with isEnabled: ${rules.map((r) => `${r.type}:${r.isEnabled}`).join(', ')})`,
      );
      if (licenseRules.length > 0) {
        try {
          this.logger.log(
            `[Evaluation] Fetching license summary for project=${projectId}, branch=${branch}, org=${organizationId}`,
          );
          const licenseSummary = await this.analysisClient
            .getProjectLicenseSummary({
              projectId,
              branch,
              organizationId,
            })
            .toPromise();

          this.logger.log(
            `[Evaluation] License summary response: ${JSON.stringify(licenseSummary)}`,
          );

          if (licenseSummary) {
            const categoryCountMap: Record<string, number> = {
              PERMISSIVE: licenseSummary.permissiveCount || 0,
              WEAK_COPYLEFT: licenseSummary.weakCopyleftCount || 0,
              STRONG_COPYLEFT: licenseSummary.strongCopyleftCount || 0,
              UNKNOWN: licenseSummary.unknownCount || 0,
            };

            // Build SPDX name → count map from the licenses array
            const licenseNameCountMap: Record<string, number> = {};
            if (Array.isArray(licenseSummary.licenses)) {
              for (const item of licenseSummary.licenses) {
                if (item.spdxId && item.count > 0) {
                  licenseNameCountMap[item.spdxId] = item.count;
                }
              }
            }

            this.logger.log(
              `[Evaluation] License category counts: ${JSON.stringify(categoryCountMap)}`,
            );
            this.logger.log(
              `[Evaluation] License name counts: ${JSON.stringify(licenseNameCountMap)}`,
            );

            for (const rule of licenseRules) {
              const matchingCategories = this.evaluateLicenseRule(
                rule,
                categoryCountMap,
                licenseNameCountMap,
              );

              this.logger.log(
                `[Evaluation] License rule "${rule.name}" (op=${rule.operator}, val=${JSON.stringify(rule.value)}): matchingCategories=${JSON.stringify(matchingCategories)}`,
              );

              for (const cat of matchingCategories) {
                const isNameRule = rule.type === RuleType.LICENSE_NAME_CHECK;
                const count = isNameRule
                  ? licenseNameCountMap[cat] || 0
                  : categoryCountMap[cat] || 0;
                if (count === 0) continue;

                const policy = this.findPolicyForRule(rule, appliedPolicies);
                const fieldLabel = isNameRule
                  ? 'license_name'
                  : 'license_category';

                // Create a synthetic entry representing the license violation
                const syntheticId = `license-${cat.toLowerCase()}-${rule.id}`;
                violations.push({
                  policyId: policy?.id || '',
                  ruleId: rule.id,
                  ruleName: rule.name,
                  action: rule.action,
                  details: {
                    ruleName: rule.name,
                    condition: `${fieldLabel} ${rule.operator} ${JSON.stringify(rule.value)}`,
                    matchedValues: [
                      {
                        field: fieldLabel,
                        expected: rule.value,
                        actual: cat,
                        packageCount: count,
                      },
                    ],
                  },
                  affectedVulnerabilityIds: [syntheticId],
                });

                // Track highest action
                if (rule.action === ViolationAction.BLOCK) {
                  highestAction = ViolationAction.BLOCK;
                } else if (highestAction !== ViolationAction.BLOCK) {
                  highestAction = ViolationAction.WARN;
                }

                // Create violation record for license
                const syntheticVuln: VulnerabilityData = {
                  id: syntheticId,
                  name: `${cat} license detected (${count} package${count > 1 ? 's' : ''})`,
                  severity:
                    cat === 'STRONG_COPYLEFT'
                      ? 'HIGH'
                      : cat === 'UNKNOWN'
                        ? 'MEDIUM'
                        : 'LOW',
                  scannerType: 'SCA',
                  branch,
                };

                this.queueViolation(
                  pendingViolations,
                  policy,
                  rule,
                  syntheticVuln,
                );
              }
            }
          }
        } catch (error) {
          this.logger.warn(
            `[Evaluation] Failed to fetch license summary for project=${projectId}: ${(error as Error).message}`,
          );
        }
      }

      await job.updateProgress(80);

      // Collect all vulnerability IDs that matched in this evaluation (grouped by ruleId)
      const matchedVulnIdsByRule = new Map<string, Set<string>>();
      for (const violation of violations) {
        const ruleId = violation.ruleId;
        if (!matchedVulnIdsByRule.has(ruleId)) {
          matchedVulnIdsByRule.set(ruleId, new Set());
        }
        for (const vulnId of violation.affectedVulnerabilityIds) {
          matchedVulnIdsByRule.get(ruleId)!.add(vulnId);
        }
      }

      // 5. Write the violations, then clean up stale ones (fixed
      // vulnerabilities, same branch as the scan only). A type that could not
      // be fetched looks like a type with no finding: a cleanup then would
      // remove every violation it holds as fixed. The stored violations are
      // kept until an evaluation reads every type.
      const cleanup = failedTypes.length === 0;
      if (!cleanup) {
        this.logger.warn(
          `[Evaluation] Keeping the existing violations of project=${projectId}: could not fetch the ${failedTypes.join(', ')} findings`,
        );
      }
      if (pendingViolations.size > 0 || cleanup) {
        await this.underProjectWriteLock(projectId, async (repository) => {
          await this.writeViolations(
            repository,
            pendingViolations,
            scanId,
            projectId,
            organizationId,
          );
          if (cleanup) {
            await this.cleanupStaleViolations(
              repository,
              projectId,
              scanId,
              matchedVulnIdsByRule,
              branch,
            );
          }
        });
      }

      await job.updateProgress(90);

      // 6. Complete the evaluation
      const warnings = skipped.list();
      if (warnings.length > 0) {
        this.logger.warn(
          `[Evaluation] ${warnings.length} glob pattern(s) skipped for project=${projectId}: ${JSON.stringify(warnings)}`,
        );
      }
      await this.completeEvaluation(evaluationId, {
        compliant: violations.length === 0,
        action: highestAction,
        violations,
        warnings,
      });

      // 7. Publish realtime event
      void this.realtime?.publish({
        eventId: ulid(),
        type: 'POLICY_EVALUATION_COMPLETED',
        scope: { organizationId, projectId, scanId },
        payload: {
          policyEvaluationCompleted: {
            scanId,
            projectId,
            violationsCount: countViolatedRules(violations).total,
          },
        },
      });

      await job.updateProgress(100);

      const duration = Date.now() - startTime;
      this.logger.log(
        `[Evaluation] Job ${job.id} completed in ${duration}ms. Violations: ${violations.length}`,
      );
    } catch (error) {
      this.logger.error(
        `[Evaluation] Error processing job ${job.id}: ${(error as Error).message}`,
        (error as Error).stack,
      );

      // Mark evaluation as failed
      await this.updateEvaluationStatus(evaluationId, EvaluationStatus.FAILED, {
        errorMessage: (error as Error).message,
        completedAt: new Date(),
      });

      throw error;
    }
  }

  /**
   * Wait for the vulnerability processing queue to complete for a scan.
   * Uses exponential backoff strategy:
   * - 2 seconds, 3 times
   * - 5 seconds, 3 times
   * - 15 seconds, 3 times
   * - 30 seconds, 2 times
   * If still not complete after all retries, proceed anyway.
   *
   * @param scanId The scan ID to check
   * @returns True if queue is complete, false if timed out
   */
  private async waitForQueueCompletion(scanId: string): Promise<boolean> {
    const backoffSchedule = [
      { delay: 2000, attempts: 3 }, // 2s x 3 = 6s
      { delay: 5000, attempts: 3 }, // 5s x 3 = 15s
      { delay: 15000, attempts: 3 }, // 15s x 3 = 45s
      { delay: 30000, attempts: 4 }, // 30s x 4 = 120s
    ];
    // Total max wait: 186 seconds

    this.logger.log(
      `[Evaluation] Waiting for vulnerability queue to complete for scan=${scanId}`,
    );

    for (const { delay, attempts } of backoffSchedule) {
      for (let i = 0; i < attempts; i++) {
        try {
          const status = await this.analysisClient
            .getScanQueueStatus({ scanId })
            .toPromise();

          if (status.isProcessingComplete) {
            this.logger.log(
              `[Evaluation] Queue processing complete for scan=${scanId}. ` +
                `Completed: ${status.completedJobs}, Failed: ${status.failedJobs}`,
            );
            return true;
          }

          this.logger.debug(
            `[Evaluation] Queue not ready for scan=${scanId}. ` +
              `Pending: ${status.pendingJobs}, Active: ${status.activeJobs}. ` +
              `Waiting ${delay}ms... (attempt ${i + 1}/${attempts} at ${delay}ms interval)`,
          );
        } catch (error) {
          this.logger.warn(
            `[Evaluation] Failed to check queue status for scan=${scanId}: ${(error as Error).message}. ` +
              `Will retry...`,
          );
        }

        // Wait before next check
        await this.sleep(delay);
      }
    }

    // Timeout - proceed with whatever data is available
    this.logger.warn(
      `[Evaluation] Queue check timed out for scan=${scanId}. Proceeding with available data.`,
    );
    return false;
  }

  /**
   * Sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Map raw vulnerability response to normalized VulnerabilityData
   * Handles different response structures from different scanner types
   */
  private mapVulnerabilityToData(
    raw: Record<string, unknown>,
    scannerType: string,
  ): VulnerabilityData {
    // For SAST/IAC/Secret/CICD, the structure is: { base: { id, current_severity, vulnerability: { name, cwe, cvss3 } } }
    // For SCA, the structure is: { base: { id, current_severity }, library: { package_name, package_version, path }, metadata: { summary, cwes }, cvss_score }
    // For Container, the structure is flat: { vulnerability_id, severity, title, cwe_ids }

    const base = raw.base as Record<string, unknown> | undefined;
    const vulnMeta = base?.vulnerability as Record<string, unknown> | undefined;
    const cvss3 = vulnMeta?.cvss3 as Record<string, unknown> | undefined;

    // SCA-specific structures
    const scaMetadata = raw.metadata as Record<string, unknown> | undefined;
    const scaLibrary = raw.library as Record<string, unknown> | undefined;

    // Container: { id, currentSeverity, currentState, package: { name,
    // version }, vuln: { title, cweIds }, cvssScore, createdAt }
    const containerVuln = raw.vuln as Record<string, unknown> | undefined;
    const containerPackage = raw.package as Record<string, unknown> | undefined;

    // Extract ID
    const id = (base?.id || raw.vulnerability_id || raw.id || '') as string;

    // Extract name (SCA uses metadata.summary, others use vulnerability.name)
    const name = (scaMetadata?.summary ||
      vulnMeta?.name ||
      containerVuln?.title ||
      raw.vulnerabilityIdentifier ||
      raw.title ||
      raw.name ||
      'Unknown') as string;

    // Extract severity (normalize to uppercase)
    const rawSeverity = (base?.currentSeverity ||
      base?.current_severity ||
      raw.currentSeverity ||
      raw.current_severity ||
      raw.severity ||
      vulnMeta?.severity ||
      'UNKNOWN') as string;
    const severity = rawSeverity.toUpperCase();

    // Extract CVSS score
    let cvssScore: number | undefined;
    // SCA has direct cvss_score field (might be cvssScore in camelCase)
    if (typeof raw.cvss_score === 'number') {
      cvssScore = raw.cvss_score;
    } else if (typeof raw.cvss_score === 'string') {
      cvssScore = parseFloat(raw.cvss_score);
    } else if (typeof raw.cvssScore === 'number') {
      cvssScore = raw.cvssScore;
    } else if (typeof raw.cvssScore === 'string') {
      cvssScore = parseFloat(raw.cvssScore);
    }
    // SAST/IAC/Secret/CICD have it in base.vulnerability.cvss3.baseScore (camelCase from ts-proto)
    if (cvssScore === undefined && cvss3?.baseScore) {
      cvssScore =
        typeof cvss3.baseScore === 'number'
          ? cvss3.baseScore
          : parseFloat(cvss3.baseScore as string);
    }
    // Fallback to snake_case base_score in case the gRPC client preserves it
    if (cvssScore === undefined && cvss3?.base_score) {
      cvssScore =
        typeof cvss3.base_score === 'number'
          ? cvss3.base_score
          : parseFloat(cvss3.base_score as string);
    }
    // Container might have it in cvss map
    if (cvssScore === undefined && raw.cvss) {
      const cvssMap = raw.cvss as Record<
        string,
        { v3_score?: number; v3Score?: number }
      >;
      const firstEntry = Object.values(cvssMap)[0];
      if (firstEntry?.v3_score) {
        cvssScore = firstEntry.v3_score;
      } else if (firstEntry?.v3Score) {
        cvssScore = firstEntry.v3Score;
      }
    }

    // Extract CWE
    let cwe: string[] = [];
    if (Array.isArray(vulnMeta?.cwe)) {
      cwe = vulnMeta.cwe as string[];
    } else if (Array.isArray(vulnMeta?.cwe_array)) {
      cwe = vulnMeta.cwe_array as string[];
    } else if (Array.isArray(raw.cwe_ids)) {
      cwe = raw.cwe_ids as string[];
    } else if (Array.isArray(containerVuln?.cweIds)) {
      cwe = containerVuln.cweIds as string[];
    } else if (Array.isArray(containerVuln?.cwe_ids)) {
      cwe = containerVuln.cwe_ids as string[];
    }
    // SCA has cwes in metadata as array of objects { cwe_id: "CWE-xxx" }
    if (cwe.length === 0 && Array.isArray(scaMetadata?.cwes)) {
      const scaCwes = scaMetadata.cwes as Array<{
        cwe_id?: string;
        cweId?: string;
      }>;
      cwe = scaCwes
        .map((c) => c.cwe_id || c.cweId || '')
        .filter((c) => c.length > 0);
    }

    // Extract OWASP Top 10 categories
    let owaspTop10: string[] = [];
    const owaspArray = vulnMeta?.owasp_top10 as string[] | undefined;
    if (Array.isArray(owaspArray)) {
      owaspTop10 = owaspArray;
    } else if (Array.isArray(vulnMeta?.owaspTop10)) {
      owaspTop10 = vulnMeta.owaspTop10 as string[];
    } else if (Array.isArray(raw.owasp_top10)) {
      owaspTop10 = raw.owasp_top10 as string[];
    }
    const owaspCategory = owaspTop10[0];

    // Extract file path (SCA uses library.path which is an array of dependency chain)
    let filePath = '';
    if (base?.path) {
      filePath = base.path as string;
    } else if (raw.path) {
      filePath = raw.path as string;
    } else if (scaLibrary?.path) {
      const libPath = scaLibrary.path;
      if (Array.isArray(libPath)) {
        // SCA dependency chain: reverse and join with arrow separator
        // Input: ["glob@11.0.3", "@nestjs/cli@11.0.10", "@dashwright/backend@1.2.20"]
        // Output: "@dashwright/backend@1.2.20→@nestjs/cli@11.0.10→glob@11.0.3"
        filePath = [...libPath].reverse().join('→');
      } else {
        filePath = libPath as string;
      }
    }

    // Extract line numbers (start and end)
    const startLine = (base?.vulnerable_start_line ||
      base?.vulnerableStartLine ||
      raw.start_line ||
      raw.startLine ||
      raw.line ||
      0) as number;
    const endLine = (base?.vulnerable_end_line ||
      base?.vulnerableEndLine ||
      raw.end_line ||
      raw.endLine ||
      startLine) as number;

    // Extract SCA-specific fields (from library object)
    let packageName = '';
    let packageVersion = '';
    if (scaLibrary) {
      packageName = (scaLibrary.package_name ||
        scaLibrary.packageName ||
        '') as string;
      packageVersion = (scaLibrary.package_version ||
        scaLibrary.packageVersion ||
        '') as string;
    }
    if (containerPackage) {
      packageName = (containerPackage.name || '') as string;
      packageVersion = (containerPackage.version || '') as string;
    }
    // Fallback to raw fields
    if (!packageName) {
      packageName = (raw.package_name ||
        raw.packageName ||
        base?.package_name ||
        base?.packageName ||
        '') as string;
    }
    if (!packageVersion) {
      packageVersion = (raw.package_version ||
        raw.packageVersion ||
        base?.package_version ||
        base?.packageVersion ||
        '') as string;
    }

    // Extract Container-specific fields
    const artifactName = (raw.artifact_name ||
      raw.artifactName ||
      raw.image_name ||
      raw.imageName ||
      '') as string;

    // Extract created date for age calculation
    let createdAt: number | undefined;
    const createdAtStr = (base?.created_at ||
      base?.createdAt ||
      (containerVuln || containerPackage ? raw.createdAt : undefined)) as
      | string
      | undefined;
    if (createdAtStr) {
      const date = new Date(createdAtStr);
      if (!isNaN(date.getTime())) {
        createdAt = date.getTime();
      }
    }

    // Extract branch from vulnerability data
    const branch = (base?.branch || raw.branch || '') as string;

    return {
      id,
      name,
      severity,
      cvssScore: cvssScore && !isNaN(cvssScore) ? cvssScore : undefined,
      cwe: cwe.length > 0 ? cwe : undefined,
      owaspTop10: owaspTop10.length > 0 ? owaspTop10 : undefined,
      owaspCategory,
      scannerType,
      filePath: filePath || undefined,
      startLine: startLine > 0 ? startLine : undefined,
      endLine: endLine > 0 ? endLine : undefined,
      isNew: undefined, // Not available in current response
      createdAt,
      // SCA-specific fields
      packageName: packageName || undefined,
      packageVersion: packageVersion || undefined,
      // Container-specific fields
      artifactName: artifactName || undefined,
      // Branch where this vulnerability was detected
      branch: branch || undefined,
      // Status can be in different places depending on the vulnerability type
      // - base.currentState for SAST/IAC/SECRET/CICD (camelCase from gRPC loader)
      // - base.current_state (snake_case fallback)
      // - raw.status or raw.currentState for other types
      status: (base?.currentState ||
        base?.current_state ||
        raw.status ||
        raw.currentState ||
        raw.current_state) as string,
    };
  }

  /**
   * Fetch all vulnerability types for a scan
   */
  private async fetchAllVulnerabilities(
    projectId: string,
    scanId: string,
  ): Promise<VulnerabilityData[]> {
    return (await this.fetchVulnerabilitiesReport(projectId, scanId))
      .vulnerabilities;
  }

  /**
   * Every finding of the project, and the scanner types that could not be
   * fetched. A failure is a warning: the evaluation goes on with the types
   * it has, but must not treat a missing type as one with no finding.
   */
  private async fetchVulnerabilitiesReport(
    projectId: string,
    scanId: string,
    branch?: string,
  ): Promise<{ vulnerabilities: VulnerabilityData[]; failedTypes: string[] }> {
    const allVulns: VulnerabilityData[] = [];
    const failedTypes: string[] = [];

    // Every list is read for the scan's own branch, so a branch scanned in CI
    // is judged on the findings it actually holds, not on another branch's.
    // With no branch named, the code, IaC, secret and CI/CD lists answer every
    // branch and the dependency list the default one, as before. The
    // dependency list gives malware apart from the other findings.
    const branchScope: { branch?: string } = branch ? { branch } : {};
    const fetchMethods: {
      method: string;
      scanner: string;
      extra?: { branch?: string; malwareOnly?: boolean };
    }[] = [
      {
        method: 'getProjectSastVulnerabilities',
        scanner: 'SAST',
        extra: branchScope,
      },
      {
        method: 'getProjectIacVulnerabilities',
        scanner: 'IAC',
        extra: branchScope,
      },
      {
        method: 'getProjectScaVulnerabilities',
        scanner: 'SCA',
        extra: branchScope,
      },
      {
        method: 'getProjectScaVulnerabilities',
        scanner: 'SCA',
        extra: { ...branchScope, malwareOnly: true },
      },
      {
        method: 'getProjectSecretVulnerabilities',
        scanner: 'SECRET',
        extra: branchScope,
      },
      {
        method: 'getProjectCicdVulnerabilities',
        scanner: 'CICD',
        extra: branchScope,
      },
    ];

    for (const { method, scanner, extra } of fetchMethods) {
      try {
        const response = await (
          this.analysisClient as unknown as Record<
            string,
            (req: {
              projectId: string;
              scanId: string;
              branch?: string;
              malwareOnly?: boolean;
            }) => {
              toPromise(): Promise<{
                vulnerabilities?: Record<string, unknown>[];
              }>;
            }
          >
        )
          [method]({
            projectId,
            scanId,
            ...extra,
          })
          .toPromise();

        if (
          response?.vulnerabilities &&
          Array.isArray(response.vulnerabilities)
        ) {
          const mapped = response.vulnerabilities.map((raw) =>
            this.mapVulnerabilityToData(raw, scanner),
          );
          allVulns.push(...mapped);
        }
      } catch (error) {
        if (!failedTypes.includes(scanner)) failedTypes.push(scanner);
        this.logger.warn(
          `Failed to fetch ${scanner} vulnerabilities: ${(error as Error).message}`,
        );
      }
    }

    const containers = await this.fetchContainerVulnerabilities(projectId);
    allVulns.push(...containers.vulnerabilities);
    if (containers.failed) failedTypes.push('CONTAINER');

    return { vulnerabilities: allVulns, failedTypes };
  }

  /**
   * The project's container findings (image scans, Trivy image imports),
   * every page: the list answers 10 rows by default and 500 at most.
   * A failure is a warning, as for the other types.
   */
  private async fetchContainerVulnerabilities(
    projectId: string,
  ): Promise<{ vulnerabilities: VulnerabilityData[]; failed: boolean }> {
    const vulns: VulnerabilityData[] = [];
    let failed = false;
    try {
      for (let page = 1; page <= CONTAINER_MAX_PAGES; page += 1) {
        const response = await (
          this.analysisClient as unknown as Record<
            string,
            (req: { projectId: string; page: number; limit: number }) => {
              toPromise(): Promise<{
                totalPages?: number;
                vulnerabilities?: Record<string, unknown>[];
              }>;
            }
          >
        )
          .getProjectContainerVulnerabilities({
            projectId,
            page,
            limit: CONTAINER_PAGE_SIZE,
          })
          .toPromise();
        const rows = Array.isArray(response?.vulnerabilities)
          ? response.vulnerabilities
          : [];
        vulns.push(
          ...rows.map((raw) => this.mapVulnerabilityToData(raw, 'CONTAINER')),
        );
        if (rows.length === 0 || page >= (response?.totalPages ?? 0)) break;
      }
    } catch (error) {
      failed = true;
      this.logger.warn(
        `Failed to fetch CONTAINER vulnerabilities: ${(error as Error).message}`,
      );
    }
    return { vulnerabilities: vulns, failed };
  }

  /**
   * Check if a vulnerability is excluded by any exclusion pattern
   */
  private isExcluded(
    vulnerability: VulnerabilityData,
    exclusions: PolicyExclusion[],
    onSkip?: (pattern: string, reason: string) => void,
  ): boolean {
    for (const exclusion of exclusions) {
      // Check expiration
      if (exclusion.expirationDate) {
        const expDate = new Date(exclusion.expirationDate);
        if (expDate < new Date()) continue;
      }

      // Check file path pattern
      if (exclusion.pattern && vulnerability.filePath) {
        // A pattern that cannot be matched, or a path too long to match,
        // hides nothing: the finding counts, and the skip is reported.
        const result = matchGlob(vulnerability.filePath, exclusion.pattern);
        if ('skipped' in result) onSkip?.(exclusion.pattern, result.skipped);
        else if (result.matched) return true;
      }

      // Check CWE exclusions
      if (exclusion.cweIds && vulnerability.cwe) {
        const hasExcludedCwe = vulnerability.cwe.some(
          (cwe) =>
            exclusion.cweIds!.includes(cwe) ||
            exclusion.cweIds!.includes(cwe.replace('CWE-', '')),
        );
        if (hasExcludedCwe) return true;
      }

      // Check OWASP category exclusions
      if (exclusion.owaspCategories && vulnerability.owaspCategory) {
        if (exclusion.owaspCategories.includes(vulnerability.owaspCategory)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Maximum recursion depth for `evaluateRule`. Set higher than the
   * parse-time `MAX_CRITERIA_DEPTH` (8) so legitimate edge cases never
   * trip on it; this guard exists purely as defense-in-depth for legacy
   * policies persisted before parse-time validation was added. At depth > MAX_EVAL_DEPTH we return `matches: false`
   * (safe default — never block / warn from a policy we cannot fully
   * evaluate) and emit a warn log.
   */
  private static readonly MAX_EVAL_DEPTH = 16;

  /**
   * Evaluate a rule against a vulnerability
   */
  private evaluateRule(
    rule: PolicyRule,
    vulnerability: VulnerabilityData,
    scanContext: ScanContext,
    depth = 0,
  ): {
    matches: boolean;
    condition: string;
    matchedValues: Record<string, unknown>[];
  } {
    if (depth > PolicyEvaluationProcessor.MAX_EVAL_DEPTH) {
      this.logger.warn(
        `Policy rule depth exceeded MAX_EVAL_DEPTH (${PolicyEvaluationProcessor.MAX_EVAL_DEPTH}) ` +
          `for rule ${rule.id ?? rule.name ?? '(anonymous)'} ` +
          `(scanId=${scanContext.scanId}, vuln=${vulnerability.id}); ` +
          `treating as no-match to protect the worker.`,
      );
      return {
        matches: false,
        condition: `depth-guard:${PolicyEvaluationProcessor.MAX_EVAL_DEPTH}`,
        matchedValues: [],
      };
    }

    // Handle composite rules
    if (rule.type === RuleType.COMPOSITE_AND) {
      const results = (rule.criteria || []).map((c) =>
        this.evaluateRule(c, vulnerability, scanContext, depth + 1),
      );
      const allMatch = results.every((r) => r.matches);
      return {
        matches: allMatch,
        condition: `All of: ${results.map((r) => r.condition).join(', ')}`,
        matchedValues: results.flatMap((r) => r.matchedValues),
      };
    }

    if (rule.type === RuleType.COMPOSITE_OR) {
      const results = (rule.criteria || []).map((c) =>
        this.evaluateRule(c, vulnerability, scanContext, depth + 1),
      );
      const anyMatch = results.some((r) => r.matches);
      return {
        matches: anyMatch,
        condition: `Any of: ${results.map((r) => r.condition).join(', ')}`,
        matchedValues: results
          .filter((r) => r.matches)
          .flatMap((r) => r.matchedValues),
      };
    }

    // Simple rule evaluation
    return this.evaluateSimpleRule(rule, vulnerability, scanContext);
  }

  /**
   * Evaluate a simple (non-composite) rule
   */
  private evaluateSimpleRule(
    rule: PolicyRule,
    vulnerability: VulnerabilityData,
    scanContext: ScanContext,
  ): {
    matches: boolean;
    condition: string;
    matchedValues: Record<string, unknown>[];
  } {
    const operator = rule.operator || RuleOperator.EQUALS;
    let matches = false;
    let actualValue: unknown = null;
    let condition = '';

    switch (rule.type) {
      case RuleType.SEVERITY:
        actualValue = vulnerability.severity?.toUpperCase();
        matches = this.compareSeverity(actualValue, rule.value, operator);
        condition = `severity ${operator} ${rule.value}`;
        break;

      case RuleType.CVSS_SCORE:
        actualValue = vulnerability.cvssScore || 0;
        matches = this.compareValues(actualValue, rule.value, operator);
        condition = `cvssScore ${operator} ${rule.value}`;
        break;

      case RuleType.CWE_CHECK:
        actualValue = vulnerability.cwe || [];
        if (operator === RuleOperator.IN || operator === RuleOperator.NOT_IN) {
          const ruleValues = Array.isArray(rule.value)
            ? rule.value
            : [rule.value];
          const hasMatch = (actualValue as string[]).some(
            (cwe) =>
              ruleValues.includes(cwe) ||
              ruleValues.includes(cwe.replace('CWE-', '')),
          );
          matches = operator === RuleOperator.IN ? hasMatch : !hasMatch;
        }
        condition = `cwe ${operator} ${JSON.stringify(rule.value)}`;
        break;

      case RuleType.OWASP_CATEGORY:
        actualValue = vulnerability.owaspCategory;
        matches = this.compareValues(actualValue, rule.value, operator);
        condition = `owaspCategory ${operator} ${rule.value}`;
        break;

      case RuleType.SCANNER_TYPE:
        actualValue = vulnerability.scannerType?.toUpperCase();
        matches = this.compareValues(actualValue, rule.value, operator);
        condition = `scannerType ${operator} ${rule.value}`;
        break;

      case RuleType.IS_NEW_VULNERABILITY:
        actualValue = vulnerability.isNew ?? false;
        matches = actualValue === rule.value;
        condition = `isNew ${operator} ${rule.value}`;
        break;

      case RuleType.VULNERABILITY_AGE_DAYS:
        if (vulnerability.createdAt) {
          const ageMs = Date.now() - vulnerability.createdAt;
          actualValue = Math.floor(ageMs / (24 * 60 * 60 * 1000));
          matches = this.compareValues(actualValue, rule.value, operator);
        }
        condition = `ageDays ${operator} ${rule.value}`;
        break;

      case RuleType.BRANCH:
        // Branch-based rules use the scan context, not vulnerability data
        actualValue = scanContext.branch || '';
        if (operator === RuleOperator.IN || operator === RuleOperator.NOT_IN) {
          // For IN/NOT_IN, check if branch matches any of the patterns using glob
          const patterns = Array.isArray(rule.value)
            ? rule.value
            : [rule.value];
          const branchMatches = actualValue
            ? patterns.some((pattern) =>
                this.branchMatches(
                  actualValue as string,
                  pattern as string,
                  rule,
                  scanContext,
                ),
              )
            : false;
          matches =
            operator === RuleOperator.IN ? branchMatches : !branchMatches;
        } else if (
          operator === RuleOperator.EQUALS ||
          operator === RuleOperator.NOT_EQUALS
        ) {
          // For EQUALS/NOT_EQUALS, use glob pattern matching
          const pattern = rule.value as string;
          const branchMatches = actualValue
            ? this.branchMatches(
                actualValue as string,
                pattern,
                rule,
                scanContext,
              )
            : false;
          matches =
            operator === RuleOperator.EQUALS ? branchMatches : !branchMatches;
        }
        condition = `branch ${operator} ${JSON.stringify(rule.value)}`;
        break;

      case RuleType.LICENSE_CHECK:
        // License rules are evaluated separately via fetchLicenseSummary.
        // If we reach here (e.g., inside a composite rule), we cannot evaluate
        // against a single vulnerability — always returns false.
        matches = false;
        condition = `license_category ${operator} ${JSON.stringify(rule.value)}`;
        break;

      case RuleType.LICENSE_NAME_CHECK:
        // License name rules are evaluated separately via fetchLicenseSummary.
        // Cannot evaluate against a single vulnerability — always returns false.
        matches = false;
        condition = `license_name ${operator} ${JSON.stringify(rule.value)}`;
        break;
    }

    return {
      matches,
      condition,
      matchedValues: matches
        ? [{ field: rule.type, expected: rule.value, actual: actualValue }]
        : [],
    };
  }

  /**
   * A branch against one pattern of a rule. A pattern that cannot be matched
   * matches no branch, as an unknown name would, and the skip is reported.
   */
  private branchMatches(
    branch: string,
    pattern: string,
    rule: PolicyRule,
    scanContext: ScanContext,
  ): boolean {
    const result = matchGlob(branch, pattern);
    if ('skipped' in result) {
      scanContext.onSkip?.(rule, pattern, result.skipped);
      return false;
    }
    return result.matched;
  }

  /**
   * Compare a finding's severity with a rule's value. Names are compared
   * case-insensitively, and ordered operators use the severity rank
   * (INFO < LOW < MEDIUM < HIGH < CRITICAL), never the alphabetical order.
   * An unknown severity on either side never satisfies an ordered operator.
   */
  private compareSeverity(
    actual: unknown,
    expected: unknown,
    operator: RuleOperator,
  ): boolean {
    const actualName = normalizeSeverity(actual);
    const expectedName = Array.isArray(expected)
      ? expected.map(normalizeSeverity)
      : normalizeSeverity(expected);

    switch (operator) {
      case RuleOperator.GT:
      case RuleOperator.GTE:
      case RuleOperator.LT:
      case RuleOperator.LTE: {
        const actualRank = severityRank(actualName);
        const expectedRank = severityRank(expectedName);
        if (actualRank === undefined || expectedRank === undefined) {
          return false;
        }
        return this.compareValues(actualRank, expectedRank, operator);
      }
      default:
        return this.compareValues(actualName, expectedName, operator);
    }
  }

  /**
   * Compare values using the specified operator
   */
  private compareValues(
    actual: unknown,
    expected: unknown,
    operator: RuleOperator,
  ): boolean {
    switch (operator) {
      case RuleOperator.EQUALS:
        return actual === expected;

      case RuleOperator.NOT_EQUALS:
        return actual !== expected;

      case RuleOperator.GT:
        return (actual as number) > (expected as number);

      case RuleOperator.GTE:
        return (actual as number) >= (expected as number);

      case RuleOperator.LT:
        return (actual as number) < (expected as number);

      case RuleOperator.LTE:
        return (actual as number) <= (expected as number);

      case RuleOperator.IN:
        if (Array.isArray(expected)) {
          return expected.includes(actual);
        }
        return false;

      case RuleOperator.NOT_IN:
        if (Array.isArray(expected)) {
          return !expected.includes(actual);
        }
        return true;

      default:
        return false;
    }
  }

  /**
   * Check if a rule (or any sub-criteria in a composite rule) uses license_check or license_name_check
   */
  private ruleTouchesLicense(rule: PolicyRule): boolean {
    if (rule.type === RuleType.LICENSE_CHECK) return true;
    if (rule.type === RuleType.LICENSE_NAME_CHECK) return true;
    if (
      (rule.type === RuleType.COMPOSITE_AND ||
        rule.type === RuleType.COMPOSITE_OR) &&
      rule.criteria
    ) {
      return rule.criteria.some(
        (c) =>
          c.type === RuleType.LICENSE_CHECK ||
          c.type === RuleType.LICENSE_NAME_CHECK,
      );
    }
    return false;
  }

  /**
   * Evaluate a license_check / license_name_check rule and return matching license identifiers.
   * For composite rules, only the license sub-criteria are evaluated.
   */
  private evaluateLicenseRule(
    rule: PolicyRule,
    categoryCountMap: Record<string, number>,
    licenseNameCountMap: Record<string, number>,
  ): string[] {
    // Simple license_check (by category)
    if (rule.type === RuleType.LICENSE_CHECK) {
      return this.matchLicenseCategories(
        rule.operator || RuleOperator.EQUALS,
        rule.value,
        categoryCountMap,
      );
    }

    // Simple license_name_check (by SPDX identifier)
    if (rule.type === RuleType.LICENSE_NAME_CHECK) {
      return this.matchLicenseNames(
        rule.operator || RuleOperator.EQUALS,
        rule.value,
        licenseNameCountMap,
      );
    }

    // Composite rules — extract license sub-criteria
    if (
      (rule.type === RuleType.COMPOSITE_AND ||
        rule.type === RuleType.COMPOSITE_OR) &&
      rule.criteria
    ) {
      const results = rule.criteria.flatMap((c) => {
        if (c.type === RuleType.LICENSE_CHECK) {
          return this.matchLicenseCategories(
            c.operator || RuleOperator.EQUALS,
            c.value,
            categoryCountMap,
          );
        }
        if (c.type === RuleType.LICENSE_NAME_CHECK) {
          return this.matchLicenseNames(
            c.operator || RuleOperator.EQUALS,
            c.value,
            licenseNameCountMap,
          );
        }
        return [];
      });
      return [...new Set(results)];
    }

    return [];
  }

  /**
   * Given a rule operator+value, return which license categories match and have count > 0.
   */
  private matchLicenseCategories(
    operator: RuleOperator,
    value: unknown,
    categoryCountMap: Record<string, number>,
  ): string[] {
    const allCategories = Object.keys(categoryCountMap);
    const matched: string[] = [];

    for (const cat of allCategories) {
      if ((categoryCountMap[cat] || 0) === 0) continue;

      let isMatch = false;
      switch (operator) {
        case RuleOperator.EQUALS:
          isMatch = cat === value;
          break;
        case RuleOperator.NOT_EQUALS:
          isMatch = cat !== value;
          break;
        case RuleOperator.IN:
          isMatch = Array.isArray(value) && value.includes(cat);
          break;
        case RuleOperator.NOT_IN:
          isMatch = Array.isArray(value) && !value.includes(cat);
          break;
        default:
          break;
      }
      if (isMatch) matched.push(cat);
    }

    return matched;
  }

  /**
   * Given a rule operator+value, return which SPDX license names match and have count > 0.
   */
  private matchLicenseNames(
    operator: RuleOperator,
    value: unknown,
    licenseNameCountMap: Record<string, number>,
  ): string[] {
    const allNames = Object.keys(licenseNameCountMap);
    const matched: string[] = [];

    for (const name of allNames) {
      if ((licenseNameCountMap[name] || 0) === 0) continue;

      let isMatch = false;
      switch (operator) {
        case RuleOperator.EQUALS:
          isMatch = name === value;
          break;
        case RuleOperator.NOT_EQUALS:
          isMatch = name !== value;
          break;
        case RuleOperator.IN:
          isMatch = Array.isArray(value) && value.includes(name);
          break;
        case RuleOperator.NOT_IN:
          isMatch = Array.isArray(value) && !value.includes(name);
          break;
        default:
          break;
      }
      if (isMatch) matched.push(name);
    }

    return matched;
  }

  /**
   * Find the policy that contains a specific rule
   */
  private findPolicyForRule(
    rule: PolicyRule,
    policies: SecurityPolicy[],
  ): SecurityPolicy | undefined {
    for (const policy of policies) {
      const rules = policy.rules?.rules || [];
      if (rules.some((r) => r.id === rule.id || r.name === rule.name)) {
        return policy;
      }
    }
    return policies[0]; // Default to first policy if not found
  }

  /**
   * Runs the read-then-write of a project's violation rows while holding a
   * lock on that project, in one transaction. Two evaluations of one project
   * (two scans finishing together, jobs on several workers) then write one
   * after the other: neither overwrites what the other appended, and no
   * second row is created for the same rule. The lock is released when the
   * transaction ends, on success or failure.
   */
  private async underProjectWriteLock(
    projectId: string,
    work: (repository: Repository<PolicyViolation>) => Promise<void>,
  ): Promise<void> {
    await this.violationRepository.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
        VIOLATION_WRITE_LOCK_NAMESPACE,
        projectId,
      ]);
      await work(manager.getRepository(PolicyViolation));
    });
  }

  /**
   * Note a (rule, finding) match. The violation rows are written once, at
   * the end of the evaluation, by writeViolations.
   */
  private queueViolation(
    pending: Map<string, PendingViolation>,
    policy: SecurityPolicy | undefined,
    rule: PolicyRule,
    vulnerability: VulnerabilityData,
  ): void {
    const policyId = policy?.id || '';
    const key = violationKey(policyId, rule.id);
    const entry = pending.get(key);
    if (entry) {
      entry.snapshotRule = rule;
      entry.vulnerabilities.push(vulnerability);
    } else {
      pending.set(key, {
        policyId,
        rule,
        snapshotRule: rule,
        vulnerabilities: [vulnerability],
      });
    }
  }

  /**
   * Write the violations of one evaluation: one read of the project's rows,
   * then one write per violated rule, whatever the number of findings. The
   * stored row is the one a write per finding would leave: a finding already
   * listed is refreshed in place, a new one is appended and counted, and the
   * rule snapshot is the latest.
   */
  private async writeViolations(
    repository: Repository<PolicyViolation>,
    pending: Map<string, PendingViolation>,
    scanId: string,
    projectId: string,
    organizationId: string,
  ): Promise<void> {
    if (pending.size === 0) return;

    const stored = await repository.find({
      where: { projectId },
    });
    const storedByKey = new Map<string, PolicyViolation>();
    for (const row of stored) {
      const key = violationKey(row.policyId, row.ruleId);
      if (!storedByKey.has(key)) storedByKey.set(key, row);
    }

    for (const [key, entry] of pending) {
      const existing = storedByKey.get(key);
      const list: AffectedVulnerability[] = existing
        ? [...(existing.violationDetails?.affectedVulnerabilities || [])]
        : [];
      const indexById = new Map<string, number>();
      list.forEach((v, index) => indexById.set(v.id, index));
      // A new row counts 1 with its first finding; every finding added
      // afterwards counts one more, as the stored count always did.
      let count = existing ? existing.affectedVulnerabilitiesCount : 0;
      let added = false;

      for (const vulnerability of entry.vulnerabilities) {
        const affected = toAffectedVulnerability(vulnerability);
        const index = indexById.get(affected.id);
        if (index !== undefined) {
          list[index] = affected;
          continue;
        }
        indexById.set(affected.id, list.length);
        list.push(affected);
        count = !existing && !added ? 1 : (count || 1) + 1;
        added = true;
      }

      const violationDetails: ViolationDetails = {
        rule: buildRuleSnapshot(entry.snapshotRule),
        affectedVulnerabilities: list,
      };

      if (existing) {
        await repository.update(
          { id: existing.id },
          {
            scanId,
            ...(added ? { affectedVulnerabilitiesCount: count } : {}),
            violationDetails,
            updatedAt: new Date(),
          },
        );
      } else {
        await repository.save(
          repository.create({
            policyId: entry.policyId,
            projectId,
            scanId,
            organizationId,
            ruleId: entry.rule.id,
            ruleName: entry.rule.name,
            actionTaken: entry.rule.action,
            violationDetails,
            affectedVulnerabilitiesCount: count,
          }),
        );
      }
    }
  }

  /**
   * Get the value of a vulnerability field based on rule type
   */
  private getVulnerabilityFieldValue(
    vulnerability: VulnerabilityData,
    ruleType: string,
  ): unknown {
    switch (ruleType) {
      case 'severity':
        return vulnerability.severity;
      case 'cvss_score':
        return vulnerability.cvssScore;
      case 'cwe_check':
        return vulnerability.cwe;
      case 'owasp_category':
        return vulnerability.owaspCategory;
      case 'scanner_type':
        return vulnerability.scannerType;
      default:
        return null;
    }
  }

  /**
   * Clean up stale violations after an evaluation.
   * This removes vulnerabilities from violations that no longer match any rule,
   * and deletes violations that have no remaining vulnerabilities.
   * Only cleans up vulnerabilities from the same branch as the current scan.
   *
   * @param projectId The project ID to clean up violations for
   * @param scanId The current scan ID
   * @param matchedVulnIdsByRule Map of rule ID to set of vulnerability IDs that matched in this evaluation
   * @param scanBranch The branch of the current scan (only vulnerabilities from this branch are cleaned)
   */
  private async cleanupStaleViolations(
    repository: Repository<PolicyViolation>,
    projectId: string,
    scanId: string,
    matchedVulnIdsByRule: Map<string, Set<string>>,
    scanBranch?: string,
  ): Promise<void> {
    // Get all existing violations for this project
    const existingViolations = await repository.find({
      where: { projectId },
    });

    if (existingViolations.length === 0) {
      return;
    }

    this.logger.log(
      `[Evaluation] Cleaning up stale violations for project=${projectId}. Found ${existingViolations.length} existing violations.`,
    );

    const violationsToDelete: string[] = [];
    const violationsToUpdate: {
      id: string;
      ruleId: string;
      ruleName: string;
      actionTaken: string;
      existingDetails: ViolationDetails | undefined;
      affectedVulnerabilities: NonNullable<
        ViolationDetails['affectedVulnerabilities']
      >;
    }[] = [];

    for (const violation of existingViolations) {
      const ruleId = violation.ruleId;
      const currentMatchedVulnIds =
        matchedVulnIdsByRule.get(ruleId) || new Set<string>();
      const existingVulns =
        violation.violationDetails?.affectedVulnerabilities || [];

      if (existingVulns.length === 0) {
        // No vulnerabilities recorded, delete the violation
        violationsToDelete.push(violation.id);
        continue;
      }

      // Filter to keep vulnerabilities that:
      // 1. Still match in this evaluation (same ID in matchedVulnIds), OR
      // 2. Are from a different branch than the current scan (preserve other branches)
      const stillMatchingVulns = existingVulns.filter((v) => {
        // If the vulnerability is from a different branch, keep it
        if (scanBranch && v.branch && v.branch !== scanBranch) {
          return true;
        }
        // Otherwise, only keep if it matched in this evaluation
        return currentMatchedVulnIds.has(v.id);
      });

      if (stillMatchingVulns.length === 0) {
        // All vulnerabilities have been fixed, delete the violation
        violationsToDelete.push(violation.id);
      } else if (stillMatchingVulns.length < existingVulns.length) {
        // Some vulnerabilities have been fixed, update the violation
        violationsToUpdate.push({
          id: violation.id,
          ruleId: violation.ruleId,
          ruleName: violation.ruleName,
          actionTaken: violation.actionTaken,
          existingDetails: violation.violationDetails,
          affectedVulnerabilities: stillMatchingVulns,
        });
      }
      // If stillMatchingVulns.length === existingVulns.length, no change needed
    }

    // Batch delete violations that have no remaining vulnerabilities
    if (violationsToDelete.length > 0) {
      await repository.delete(violationsToDelete);
      this.logger.log(
        `[Evaluation] Deleted ${violationsToDelete.length} stale violations for project=${projectId}`,
      );
    }

    // Batch update violations with reduced vulnerability counts
    // Use simplified ViolationDetails structure with only rule and affectedVulnerabilities
    for (const update of violationsToUpdate) {
      const existingDetails = update.existingDetails;

      // Reconstruct rule data from violation columns if missing
      const reconstructedRule: ViolationDetails['rule'] =
        existingDetails?.rule || {
          id: update.ruleId,
          name: update.ruleName,
          description: existingDetails?.rule?.description || '',
          type: undefined,
          operator: undefined,
          value: undefined,
          action: update.actionTaken as ViolationAction,
        };

      await repository.update(
        { id: update.id },
        {
          scanId,
          affectedVulnerabilitiesCount: update.affectedVulnerabilities.length,
          violationDetails: {
            rule: reconstructedRule,
            affectedVulnerabilities: update.affectedVulnerabilities,
          },
          updatedAt: new Date(),
        },
      );
    }

    if (violationsToUpdate.length > 0) {
      this.logger.log(
        `[Evaluation] Updated ${violationsToUpdate.length} violations with reduced vulnerability counts`,
      );
    }
  }

  /**
   * Update evaluation status
   */
  private async updateEvaluationStatus(
    evaluationId: string,
    status: EvaluationStatus,
    updates: Partial<PolicyEvaluation>,
  ): Promise<void> {
    await this.evaluationRepository.update({ id: evaluationId }, {
      status,
      ...updates,
    } as any);
  }

  /**
   * Complete the evaluation with results
   */
  private async completeEvaluation(
    evaluationId: string,
    result: {
      compliant: boolean;
      action: ViolationAction | null;
      violations: ComplianceResultDetails['violations'];
      warnings?: EvaluationWarning[];
    },
  ): Promise<void> {
    await this.evaluationRepository.update(
      { id: evaluationId },
      {
        status: EvaluationStatus.COMPLETED,
        compliant: result.compliant,
        action: result.action,
        progressPercentage: 100,
        resultDetails: {
          // A violation is one broken rule, not one (rule, finding) match.
          violationCount: countViolatedRules(result.violations).total,
          action: result.action || ViolationAction.WARN,
          violations: result.violations,
          ...(result.warnings?.length ? { warnings: result.warnings } : {}),
        } as any,
        completedAt: new Date(),
      },
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<PolicyEvaluationJobData>) {
    this.logger.debug(`[Evaluation] Job ${job.id} completed successfully`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<PolicyEvaluationJobData>, error: Error) {
    this.logger.error(
      `[Evaluation] Job ${job.id} failed after ${job.attemptsMade} attempts: ${error.message}`,
    );
  }
}
