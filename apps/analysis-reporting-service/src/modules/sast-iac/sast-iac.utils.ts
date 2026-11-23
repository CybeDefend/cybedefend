import { createHash } from 'crypto';
import { forwardRef, Inject, Injectable, Optional } from '@nestjs/common';
import {
  deriveEffectiveSeverity,
  resolveEffectiveSeverity,
} from 'src/modules/cvss/severity-from-cvss';
import { DISPLAYABLE_SEVERITIES } from 'src/modules/cvss/effective-severity-sql';
import { InjectRepository } from '@nestjs/typeorm';
import { Span } from 'nestjs-otel';
import { FindOptionsWhere, In, IsNull, Not, Repository } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { isUniqueViolation } from '@cybedefend/db-dialect';
import { withinSavepoint } from 'src/core/db/within-savepoint';
import { SastIacService } from './sast-iac.service';
import { HistoryItem } from 'src/entities/history-item.entity';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from 'src/entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from 'src/entities/secret-vulnerability-detections.entity';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { VulnerabilityDetectionHistory } from 'src/entities/vulnerability-detection-history.entity';
import { CorrespondanceTable } from 'src/entities/vulnerability/correspondance-table.entity';
import { CodeSnippet } from 'src/entities/code-snippet.entity';
import { DataFlowItem } from 'src/entities/data-flow-item.entity';
import {
  VulnerabilityDtoRequest,
  GetProjectVulnerabilityByIdResponse,
  UpdateResultRequest,
} from '@grpc/analysis-reporting/result';
import { ResultService } from '../result/result.service';
import {
  HistoryPassOutcome,
  ScanQueueService,
} from '../scan-queue/scan-queue.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import {
  computeStaticExploitability,
  VERDICT_TO_SCORE,
} from '../cvss/static-exploitability';
import {
  EXPLOITABILITY_SCORER,
  type ExploitabilityScore,
  type ExploitabilityScoreInput,
  type ExploitabilityScorer,
  VERDICT_TABLE_SCORER,
} from '../../edition/ports/exploitability-scorer.port';
import { computeSecretPriority } from '../cvss/secret-priority';
import { isFakeSecret } from '../secret/fake-secret-detector';
import { SecretEncryptionService } from 'src/core/crypto/secret-encryption.service';
import { applyAgentAuditFields } from '../result/agent-audit.helper';
import { clearExploitabilityFields } from '../result/exploitability-reset.util';
import {
  computeCodeFingerprint,
  computeSecretValueFingerprint,
  encodeComponent,
  SnippetLine,
} from '../findings-export/fingerprint.util';
import {
  applySightingToDetection,
  applyTriageToDetection,
  assertDismissalReason,
  clearResolutionOnRevive,
  mergeDetectionTriage,
  shouldAutoResolveOnDisappearance,
} from '../findings-export/lifecycle.util';
import { mergeDetectionBounds } from '../findings-export/detection-bounds.util';
import { isCatalogSeverityRequested } from './catalog-severity.util';

/**
 * Fingerprint for a brand-new code-family detection (sast/iac/cicd/secret).
 * Exported so it can be unit-tested without a repository.
 */
export function fingerprintForNewSastDetection(
  vulnDto: VulnerabilityDtoRequest,
  correspondance: { vulnerability: { id: string } },
  projectId: string,
  scannerNameLowerCase: string,
  branch: string | undefined,
  occurrenceIndex: number,
): string {
  const snippet = vulnDto.codeSnippet;
  return computeCodeFingerprint({
    projectId,
    branch: branch ?? null,
    scannerType: scannerNameLowerCase,
    catalogVulnId: correspondance.vulnerability.id,
    path: vulnDto.path,
    snippetLines: (snippet?.code ?? []) as SnippetLine[],
    vulnerableStartLine: snippet?.vulnerableStartLine ?? 0,
    vulnerableEndLine: snippet?.vulnerableEndLine ?? 0,
    occurrenceIndex,
  });
}

/**
 * Fingerprint for a new secret detection reported with its value
 * (`computeSecretValueFingerprint`): the HEAD and history reports of one value
 * share it, two values never do, and it needs no occurrence index, so an
 * unrankable batch still gets one.
 *
 * The occurrence index is therefore not ranked by value: the allocator keeps
 * grouping a secret by its snippet (`codeOccurrenceKey`), the grouping the
 * drift lookup's snippet digest needs to find a row stored before values were
 * hashed.
 */
export function fingerprintForSecretValue(
  path: string,
  correspondance: { vulnerability: { id: string } },
  projectId: string,
  scannerNameLowerCase: string,
  branch: string | undefined,
  secretValueHash: string,
): string {
  return computeSecretValueFingerprint({
    projectId,
    branch: branch ?? null,
    scannerType: scannerNameLowerCase,
    catalogVulnId: correspondance.vulnerability.id,
    path,
    secretValueHash,
  });
}

/**
 * The rule id a detection stores for its tool: the SARIF `result.ruleId`, as
 * written, when the finding was imported from a SARIF file (only the import
 * sets `ruleMetadata`); null for a built-in scanner's finding, whose rule id
 * is never stored on the detection. Read from `ruleMetadata`, never from
 * `vulnDto.ruleId`: the import ingests a finding under its catalogue key.
 */
export function importedScannerRuleIdOf(
  vulnDto: VulnerabilityDtoRequest,
): string | null {
  const ruleId = vulnDto.ruleMetadata?.ruleId;
  return ruleId ? ruleId.slice(0, 255) : null;
}

/**
 * Redis key of the lock that serializes `createNewVulnerability`'s "duplicate
 * lookup -> create" for one POSITION, across workers, batches and pods.
 *
 * It hashes the components of that lookup (`dupWhereBase` + the catalogue
 * vulnerability of `isDuplicateOf`), so two twins — two scanner rules mapped to
 * one catalogue vulnerability on one line — share it, and two positions never
 * do. It must be AT LEAST as coarse as the lookup: two findings the lookup
 * would merge must never hold different locks. `fileHash` is therefore left
 * out (coarser only serializes a little more; finer could miss a merge), and a
 * missing branch hashes like an empty one because the lookup filters on
 * neither. The finding family (`correspondance.vulnerabilityType`, which picks
 * the table the lookup reads) is not in the key either: findings of two
 * families never merge, so sharing a key can only make one wait for the
 * other, never skip a merge. Components are length-framed (`encodeComponent`)
 * so one cannot bleed into the next, and hashed so no customer path reaches
 * Redis.
 *
 * A secret with a value (`secretValueHash` given) is looked up first on that
 * value in its file, at any line, so its key is (project, branch, scanner,
 * catalogue vulnerability, path, value hash) and never the position: the same
 * secret reported at two lines (the HEAD pass and the history pass, or two
 * batches) must wait for each other. Its position and drift lookups merge
 * into a row stored before values were hashed only once that row is read back
 * as holding this value (`isSameSecretValue`), storing the row's own hash with
 * a conditional update; a row that holds no value is claimed with one. Two
 * values racing for one such row therefore cannot both take it. A leading
 * scope component keeps these keys apart from position keys.
 */
export function detectionCreationLockKey(
  vulnDto: VulnerabilityDtoRequest,
  correspondance: { vulnerability: { id: string } },
  projectId: string,
  scannerNameLowerCase: string,
  branch: string | undefined,
  secretValueHash?: string | null,
): string {
  const components = secretValueHash
    ? [
        'secret-value',
        projectId,
        branch ?? '',
        scannerNameLowerCase,
        correspondance.vulnerability.id,
        vulnDto.path,
        secretValueHash,
      ]
    : [
        projectId,
        branch ?? '',
        scannerNameLowerCase,
        correspondance.vulnerability.id,
        vulnDto.path,
        vulnDto.language,
        vulnDto.codeSnippet?.vulnerableStartLine,
        vulnDto.codeSnippet?.vulnerableEndLine,
      ];
  const digest = createHash('sha256')
    .update(components.map(encodeComponent).join(''))
    .digest('hex');
  return `sast-iac:detection-lock:${digest}`;
}

/** The catalogue rule a scanner rule id resolves to. */
export interface CatalogRule {
  vulnerabilityId: string;
  /** `CD-<TYPE>-<NNNN>`, or null when the catalogue row carries none. */
  code: string | null;
  /**
   * `correspondance_table.vulnerabilityType`, lower-cased: the family
   * `createNewVulnerability` raises the finding in (`sast`, `iac`, `cicd`,
   * `secret`). Null when the row carries none.
   */
  vulnerabilityType: string | null;
  /** Catalogue name of the vulnerability, null when empty. */
  name: string | null;
  /**
   * Catalogue severity: the one a full scan raises the finding with and
   * checks against the scan's severities. Null when empty.
   */
  severity: string | null;
  /** Catalogue CWEs. */
  cwe: string[];
}

/**
 * The rule id `correspondance_table` is keyed on: the last dotted segment of
 * the scanner's rule id (`python.lang.security.audit.eval` → `eval`), as
 * `processVulnerability` extracts it.
 */
export function catalogRuleIdOf(ruleId: string | null | undefined): string {
  return String(ruleId ?? '')
    .split('.')
    .pop();
}

/** Resolved catalogue rules projected onto their vulnerability id. */
export function catalogVulnIdsOf(
  rules: ReadonlyMap<string, CatalogRule>,
): Map<string, string> {
  return new Map(
    Array.from(rules, ([ruleId, rule]) => [ruleId, rule.vulnerabilityId]),
  );
}

/** A SAST, IaC or CICD detection: the families a finalization handles. */
type FinalizedDetection =
  | SastVulnerabilityDetections
  | IacVulnerabilityDetections
  | CicdVulnerabilityDetections;

/**
 * What a scan has sighted so far, read once: the detections
 * with a `vulnerability_detection_history` row of the scan.
 *
 * `finalizeScan` reads it once and hands it to its 2 to 4
 * `finalizeOldScanVulnerabilities` calls, which used to re-read the history of
 * the scan and reload every detection of the project each. Sharing it is safe
 * because each call handles one family and `areVulnsSimilar` never matches
 * two families: what one call merges or deletes, the next one never looks at.
 */
export interface CurrentScanSightings {
  /** Ids of every SAST, IaC and CICD detection the scan sighted. */
  ids: Set<string>;
  /**
   * Those of them in the (project, branch) being finalized, with what the
   * merge reads (`vulnerability`, `codeSnippets`, and `dataFlowItems` for SAST).
   */
  detections: FinalizedDetection[];
  /**
   * Ids of the secret detections the scan reported: created by it, or
   * re-detected and recorded by `recordSecretRedetection`. Finalize resolves
   * the scanner's other secrets; secrets never enter the line-drift merge.
   */
  secretIds: Set<string>;
}

/**
 * What finalize knows of a scan's git history pass when it decides the fate
 * of a secret the scan did not report.
 *
 * - `outcome`: how the pass ended, `secretHistoryRuleOf`'s reading of the
 *   scanner's last batch and the recorded pass. Null when the scan recorded
 *   no pass and the scanner sent no outcome (an upload, an import, an older
 *   scanner).
 * - `mode`: the recorded pass's mode (`full`, `partial`, `incremental`,
 *   `incremental_with_gap`, `none`), null when none was recorded.
 * - `firstPass`: whether it was the branch's first pass.
 * - `ignoredPaths`: the files the scanner dropped because the project's ignore
 *   file excludes them, exactly as it sent their findings' `path`. Empty when
 *   the scanner sent none.
 */
export type SecretHistoryRule = {
  outcome: HistoryPassOutcome | null;
  mode: string | null;
  firstPass: boolean;
  ignoredPaths: ReadonlySet<string>;
};

/**
 * The history rule of a scan: the outcome the scanner's last batch sent, else
 * `none` when the scan recorded a pass (a pass of mode `none` gives the
 * scanner no history URL, so it sends no outcome), else null.
 */
export function secretHistoryRuleOf(
  meta: { historyMode: string | null; historyFirstPass: boolean } | null,
  lastBatchOutcome: HistoryPassOutcome | null,
  ignoredPaths: Iterable<string> = [],
): SecretHistoryRule {
  const mode = meta?.historyMode || null;
  return {
    outcome: lastBatchOutcome ?? (mode ? 'none' : null),
    mode,
    firstPass: meta?.historyFirstPass === true,
    ignoredPaths: new Set(ignoredPaths),
  };
}

/**
 * What finalize does with an open secret the scan did not report.
 *
 * A scan resolves a secret by absence only from its HEAD pass (the secret is
 * no longer in the code), never from its history pass: an incremental pass
 * reads the new commits only, and a scan without a pass (an upload, an
 * import) reads none, so a secret with git evidence may still be in history
 * that no later pass reads again. One rule for every scan:
 * - A secret in a path the project's ignore file excludes is resolved first,
 *   whatever its source or evidence: the customer asked for that path to be
 *   left out, and the scanner no longer reports it.
 * - The branch's first pass over its whole history that ran ok resolves it,
 *   whatever its source: had it been in this branch's history, the pass
 *   would have reported it (a full mirror once stored other branches' and
 *   forks' findings under the branch).
 * - Otherwise a history finding is kept; a code finding with history
 *   evidence (the commit a history pass named) left the code but is still in
 *   git, and becomes a history finding; a code finding without one is
 *   resolved.
 */
export function secretFinalizeAction(
  secret: Pick<SecretVulnerabilityDetections, 'source' | 'commitSha' | 'path'>,
  rule: SecretHistoryRule | undefined,
): 'resolve' | 'keep' | 'move_to_history' {
  if (rule?.ignoredPaths?.has(secret.path)) return 'resolve';
  if (rule?.outcome === 'ok' && rule.firstPass && rule.mode === 'full') {
    return 'resolve';
  }
  if (secret.source === 'history') return 'keep';
  return secret.commitSha ? 'move_to_history' : 'resolve';
}

/**
 * A correspondance as `findEnabledCorrespondancesByVuln` reads it: with
 * `loadRelationIds`, its vulnerability is the foreign key alone, `{ id }`,
 * never the catalogue row.
 */
export type CorrespondanceRuleRef = Pick<
  CorrespondanceTable,
  'id' | 'scanner' | 'ruleId' | 'vulnerabilityType' | 'enabled'
> & { vulnerability: Pick<CorrespondanceTable['vulnerability'], 'id'> };

/** Ids per family of the detections a scan sighted. */
interface ScanSightingIds {
  sast: string[];
  iac: string[];
  cicd: string[];
  /** Empty unless the secret rows were asked for (a finalization). */
  secret: string[];
}

/** IN-list size of the by-id detection reads. */
const SIGHTED_DETECTIONS_CHUNK = 500;

// A detection auto-resolves when its finding disappears from a re-scan unless it
// is `ignored` (a dismissal) or already `resolved`. The freeze guards
// re-evaluation, not disappearance: a `confirmed` finding closes too. The
// predicate lives in lifecycle.util.ts — see shouldAutoResolveOnDisappearance.

@Injectable()
export class SastIacUtilsService {
  constructor(
    @InjectRepository(CodeSnippet)
    private readonly codeSnippetRepository: Repository<CodeSnippet>,
    @InjectRepository(DataFlowItem)
    private readonly dataFlowItemRepository: Repository<DataFlowItem>,
    @InjectRepository(CorrespondanceTable)
    private readonly correspondanceTableRepository: Repository<CorrespondanceTable>,
    @InjectRepository(VulnerabilityDetectionHistory)
    private readonly vulnDetectHistoryRepository: Repository<VulnerabilityDetectionHistory>,
    @InjectRepository(SastVulnerabilityDetections)
    private readonly sastVulnDetectRepository: Repository<SastVulnerabilityDetections>,
    @InjectRepository(IacVulnerabilityDetections)
    private readonly iacVulnDetectRepository: Repository<IacVulnerabilityDetections>,
    @InjectRepository(CicdVulnerabilityDetections)
    private readonly cicdVulnDetectRepository: Repository<CicdVulnerabilityDetections>,
    @InjectRepository(SecretVulnerabilityDetections)
    private readonly secretVulnDetectRepository: Repository<SecretVulnerabilityDetections>,
    @Inject(forwardRef(() => SastIacService))
    private readonly sastIacService: SastIacService,
    @Inject(forwardRef(() => ResultService))
    private readonly resultService: ResultService,
    @Inject(forwardRef(() => IssueIntegrationService))
    private readonly issueIntegrationService: IssueIntegrationService,
    private readonly cvssCalculator: CvssCalculatorService,
    private readonly logger: Logger,
    private readonly secretEncryptionService: SecretEncryptionService,
    private readonly cyberiskEnqueuer: CyberiskRecomputeEnqueuer,
    // Owns the Redis client the per-position detection creation lock lives on
    // (withDetectionCreationLock). Optional, as in SastIacService: the @Global
    // ScanQueueModule is present in every runtime that builds this service —
    // the worker, where every ingestion runs, and the gRPC server; pinned by
    // worker.module.detection-lock-wiring.spec.ts — but the many unit-test
    // modules that build it do not provide it.
    @Optional()
    private readonly scanQueueService?: ScanQueueService,
    // Bound in every edition by EditionModule; the unit-test modules that
    // build this service without it get the verdict table.
    @Optional()
    @Inject(EXPLOITABILITY_SCORER)
    private readonly exploitabilityScorer: ExploitabilityScorer = VERDICT_TABLE_SCORER,
  ) {}

  /**
   * Yield back to the Node.js event loop to let other I/O proceed.
   * Useful when processing large batches to avoid starving gRPC calls.
   */
  private yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  /**
   * Resolve the exploitability score for an update through the edition's
   * scorer (the verdict table unless an extension scores it otherwise).
   */
  private resolveUpdateExploitability(
    dto: UpdateResultRequest,
    domain: ExploitabilityScoreInput['domain'],
  ): ExploitabilityScore {
    return this.exploitabilityScorer.score({
      verdict: dto.exploitabilityVerdict,
      domain,
      source: dto.exploitabilitySource,
      factors: dto.exploitabilityFactors,
    });
  }

  private resolveScoringSourceFromUpdate(
    dto: UpdateResultRequest,
  ): 'static' | 'agent' | undefined {
    if (dto.scoringSource === 'static' || dto.scoringSource === 'agent') {
      return dto.scoringSource;
    }

    const hasExploitabilityUpdate =
      dto.exploitabilityScore > 0 ||
      (!!dto.exploitabilityVerdict &&
        dto.exploitabilityVerdict !== 'not_evaluated');
    if (
      dto.exploitabilitySource === 'agent' ||
      (!dto.exploitabilitySource && hasExploitabilityUpdate)
    ) {
      return 'agent';
    }

    return undefined;
  }

  /**
   * Ids, per family, of the SAST / IaC / CICD detections the scan has sighted:
   * one read of its `vulnerability_detection_history` rows, backed by
   * `IDX_vdh_scanId`. `loadRelationIds` reads the foreign-key columns without
   * joining the detection tables.
   *
   * Only the rows of those three families are read: the SCA
   * ingestion writes one row per detection and per scan, and the secret one
   * too, and every SAST/IaC batch of the scan used to carry them all. The
   * find API cannot select the foreign keys alone (a `select` on a relation
   * without its join is ignored), so a row's own columns come along; they
   * are narrow.
   *
   * A finalization also asks for the secret rows (`secrets`), in the same
   * read: it resolves the scanner's secrets the scan did not report. A batch
   * never needs them.
   */
  @Span()
  async findScanSightingIds(
    scanId: string,
    { secrets = false }: { secrets?: boolean } = {},
  ): Promise<ScanSightingIds> {
    const rows = await this.vulnDetectHistoryRepository.find({
      where: [
        { scanId, sastVulnerabilityDetection: Not(IsNull()) },
        { scanId, iacVulnerabilityDetection: Not(IsNull()) },
        { scanId, cicdVulnerabilityDetection: Not(IsNull()) },
        ...(secrets
          ? [{ scanId, secretVulnerabilityDetection: Not(IsNull()) }]
          : []),
      ],
      loadRelationIds: {
        relations: [
          'sastVulnerabilityDetection',
          'iacVulnerabilityDetection',
          'cicdVulnerabilityDetection',
          ...(secrets ? ['secretVulnerabilityDetection'] : []),
        ],
        disableMixedMap: true,
      },
    });
    const ids: ScanSightingIds = { sast: [], iac: [], cicd: [], secret: [] };
    for (const row of rows ?? []) {
      if (row.sastVulnerabilityDetection?.id) {
        ids.sast.push(row.sastVulnerabilityDetection.id);
      }
      if (row.iacVulnerabilityDetection?.id) {
        ids.iac.push(row.iacVulnerabilityDetection.id);
      }
      if (row.cicdVulnerabilityDetection?.id) {
        ids.cicd.push(row.cicdVulnerabilityDetection.id);
      }
      if (row.secretVulnerabilityDetection?.id) {
        ids.secret.push(row.secretVulnerabilityDetection.id);
      }
    }
    return ids;
  }

  /**
   * What the scan has sighted in (project, branch), read once: the history
   * of the scan, then the sighted detections themselves, by id.
   *
   * The finalization used to reload EVERY detection of the project with three
   * 1-N relations and keep the sighted ones: a cost that grew with the age of
   * the project. Only the sighted ones are read now, and with
   * `relationLoadStrategy: 'query'` (one query per relation) so that
   * codeSnippets x dataFlowItems is no cartesian product.
   */
  @Span()
  async loadCurrentScanSightings(
    projectId: string,
    scanId: string,
    branch?: string,
  ): Promise<CurrentScanSightings> {
    const sighted = await this.findScanSightingIds(scanId, { secrets: true });
    // Same scope as the project-wide reload it replaces.
    const scope: { projectId: string; branch?: string } = { projectId };
    if (branch) {
      scope.branch = branch;
    }

    const loadByIds = async <T extends FinalizedDetection>(
      repository: Repository<T>,
      ids: string[],
      relations: string[],
    ): Promise<T[]> => {
      const unique = Array.from(new Set(ids));
      const out: T[] = [];
      for (let i = 0; i < unique.length; i += SIGHTED_DETECTIONS_CHUNK) {
        const rows = await repository.find({
          where: {
            ...scope,
            id: In(unique.slice(i, i + SIGHTED_DETECTIONS_CHUNK)),
          } as FindOptionsWhere<T>,
          relations,
          relationLoadStrategy: 'query',
        });
        out.push(...(rows ?? []));
      }
      return out;
    };

    const detections: FinalizedDetection[] = [
      ...(await loadByIds(this.sastVulnDetectRepository, sighted.sast, [
        'vulnerability',
        'codeSnippets',
        'dataFlowItems',
      ])),
      ...(await loadByIds(this.iacVulnDetectRepository, sighted.iac, [
        'vulnerability',
        'codeSnippets',
      ])),
      // CICD detections participate in finalization exactly like SAST/IaC.
      ...(await loadByIds(this.cicdVulnDetectRepository, sighted.cicd, [
        'vulnerability',
        'codeSnippets',
      ])),
    ];

    return {
      ids: new Set([...sighted.sast, ...sighted.iac, ...sighted.cicd]),
      detections,
      secretIds: new Set(sighted.secret),
    };
  }

  /**
   * The scanner's existing SAST, IaC, CICD and secret detections in
   * (project, branch): what a batch matches its findings against, and what a
   * finalization resolves when the scan did not sight them.
   *
   * @param projectId - The project ID.
   * @param scannerNameLowerCase - The scanner name in lowercase. Never '*':
   *   TypeORM reads it as `scannerType = '*'`, which matches nothing.
   * @param branch - The branch being scanned (optional, for branch isolation).
   */
  @Span()
  async findExistingDetections(
    projectId: string,
    scannerNameLowerCase: string,
    branch?: string,
  ): Promise<{
    existingSastVulns: SastVulnerabilityDetections[];
    existingIacVulns: IacVulnerabilityDetections[];
    existingCicdVulns: CicdVulnerabilityDetections[];
    existingSecretVulns: SecretVulnerabilityDetections[];
  }> {
    // Build where clause with optional branch filter
    const whereClause: any = { projectId, scannerType: scannerNameLowerCase };
    if (branch) {
      whereClause.branch = branch;
    }

    const existingSastVulns = await this.sastVulnDetectRepository.find({
      where: whereClause,
      relations: ['vulnerability', 'codeSnippets'],
    });

    const existingIacVulns = await this.iacVulnDetectRepository.find({
      where: whereClause,
      relations: ['vulnerability', 'codeSnippets'],
    });

    // CICD detections are resolved via finalizeOldScanVulnerabilities
    // but never enter existingVulnsMap — CICD does not go through the
    // SAST/IAC line-shift matching in processVulnerability.
    const existingCicdVulns = await this.cicdVulnDetectRepository.find({
      where: whereClause,
      relations: ['vulnerability', 'codeSnippets'],
    });

    // Secret detections are resolved the same way, and kept out of
    // existingVulnsMap for the same reason: a secret is only ever matched by
    // createNewVulnerability's duplicate lookup. Scoped like the others to the
    // scanner that reported it (gitleaks, or the SAST/IaC scanner whose rule is
    // raised as a secret) and to the branch.
    const existingSecretVulns = await this.secretVulnDetectRepository.find({
      where: whereClause,
      relations: ['vulnerability', 'codeSnippets'],
    });

    return {
      existingSastVulns,
      existingIacVulns,
      existingCicdVulns,
      existingSecretVulns,
    };
  }

  /**
   * Get the previous scan vulnerabilities detected for a project.
   * Only returns vulnerabilities for the specified branch to ensure proper isolation.
   *
   * @param projectId - The project ID.
   * @param scanId - The scan ID.
   * @param scannerNameLowerCase - The scanner name in lowercase.
   * @param branch - The branch being scanned (optional, for branch isolation).
   * @returns The previous scan vulnerabilities detected.
   */
  @Span()
  async getExistingVulnerabilities(
    projectId: string,
    currentScanId: string,
    scannerNameLowerCase: string,
    branch?: string,
  ): Promise<{
    existingSastVulns: SastVulnerabilityDetections[];
    existingIacVulns: IacVulnerabilityDetections[];
    existingCicdVulns: CicdVulnerabilityDetections[];
    existingSecretVulns: SecretVulnerabilityDetections[];
    existingVulnsMap: Map<
      string,
      (SastVulnerabilityDetections | IacVulnerabilityDetections)[]
    >;
  }> {
    const {
      existingSastVulns,
      existingIacVulns,
      existingCicdVulns,
      existingSecretVulns,
    } = await this.findExistingDetections(
      projectId,
      scannerNameLowerCase,
      branch,
    );

    const allVulns = [...existingSastVulns, ...existingIacVulns];

    const existingVulnsMap = new Map<
      string,
      (SastVulnerabilityDetections | IacVulnerabilityDetections)[]
    >();
    if (allVulns.length === 0) {
      return {
        existingSastVulns,
        existingIacVulns,
        existingCicdVulns,
        existingSecretVulns,
        existingVulnsMap,
      };
    }

    // Two set-based reads instead of two queries per detection.
    // Still computed for every batch: a detection an earlier batch of this
    // scan matched must stay out of the map, so the map cannot be reused.
    //
    // 1. A detection already matched in this scan has a history row of the
    //    scan: one read by scanId (IDX_vdh_scanId) instead of the latest
    //    history row of each detection, which two scans recorded in one
    //    second (`detectedAt` has no fractional seconds) could tie on.
    const sighted = await this.findScanSightingIds(currentScanId);
    const matchedInThisScan = new Set([...sighted.sast, ...sighted.iac]);
    const unmatched = allVulns.filter(
      (vuln) => !matchedInThisScan.has(vuln.id),
    );

    // 2. The enabled rules of their catalogue vulnerabilities, all at once.
    const rulesByCatalogueVuln = await this.findEnabledCorrespondancesByVuln(
      unmatched.map((vuln) => vuln.vulnerability.id),
    );

    // Detection order kept: processVulnerability takes the first match.
    for (const vuln of unmatched) {
      const correspondances =
        rulesByCatalogueVuln.get(vuln.vulnerability.id) ?? [];
      for (const correspondance of correspondances) {
        const key = `${correspondance.scanner}:${correspondance.ruleId}`;
        if (!existingVulnsMap.has(key)) {
          existingVulnsMap.set(key, []);
        }
        existingVulnsMap.get(key).push(vuln);
      }
    }

    return {
      existingSastVulns,
      existingIacVulns,
      existingCicdVulns,
      existingSecretVulns,
      existingVulnsMap,
    };
  }

  /**
   * The enabled correspondances (scanner rules) of the given catalogue
   * vulnerabilities, grouped by catalogue vulnerability id: one IN query per
   * chunk of 500, where the ingestion used to run one query per detection.
   * `loadRelationIds` reads the vulnerability id from the foreign key without
   * loading the catalogue row.
   */
  @Span()
  async findEnabledCorrespondancesByVuln(
    catalogueVulnIds: string[],
  ): Promise<Map<string, CorrespondanceRuleRef[]>> {
    const out = new Map<string, CorrespondanceRuleRef[]>();
    const ids = Array.from(new Set(catalogueVulnIds.filter((id) => !!id)));
    const CHUNK = 500;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const rows = await this.correspondanceTableRepository.find({
        where: {
          vulnerability: { id: In(ids.slice(i, i + CHUNK)) },
          enabled: true,
        },
        loadRelationIds: {
          relations: ['vulnerability'],
          disableMixedMap: true,
        },
      });
      for (const row of rows ?? []) {
        const vulnId = row.vulnerability?.id;
        if (!vulnId) continue;
        if (!out.has(vulnId)) out.set(vulnId, []);
        out.get(vulnId).push(row);
      }
    }
    return out;
  }

  /**
   * Resolve a batch of scanner rule ids to their catalogue rule — vulnerability
   * id and code — in ONE query per chunk.
   *
   * `processVulnerability` derives the same mapping per finding, but two
   * consumers need it for the whole batch BEFORE any finding is processed:
   * - the `cybedefend-ignore` decision, which checks a directive
   *   against the code of the rule the finding would be raised for;
   * - the occurrence-index ranking: the fingerprint hashes
   *   `correspondance.vulnerability.id`, and `correspondance_table` is
   *   many-to-one onto it (a single kics catalogue vuln is mapped by dozens of
   *   distinct ruleIds), so a bucket key built from the raw ruleId splits
   *   findings that hash identically.
   *
   * The IN list is chunked. A single scanner batch can carry thousands of
   * distinct rule ids, and one oversized query would fail DETERMINISTICALLY on
   * exactly the large scans — silently degrading their bucket key on every run,
   * which is a much worse failure mode than the transient blip the callers'
   * catch blocks exist for.
   *
   * (scanner, ruleId) is unique in `correspondance_table` since migration
   * 1835000000001-UniqueCorrespondanceScannerRule
   * (`UQ_correspondance_table_scanner_ruleId`), which deleted the duplicates
   * the catalogue imports had left onto DIFFERENT catalogue vulnerabilities.
   * Both this query and `processVulnerability`'s `findOne` still order by `id`
   * and take the first row: harmless under the index, and it keeps them on
   * the same row in an environment where the migration had to skip the index
   * because duplicates remained. Diverging there would key the bucket on one
   * catalogue vuln while the digest hashes another — splitting exactly the
   * findings that collide and handing them both index 0 — and decide a
   * directive against a sibling row's code and type.
   *
   * @param ruleIds - Raw scanner rule ids (the dotted form is accepted; only
   *   the last segment is matched, exactly like processVulnerability).
   * @param scannerNameLowerCase - The scanner these rules belong to.
   * @returns extracted ruleId (`catalogRuleIdOf`) -> catalogue rule; a rule id
   *   without an enabled correspondance row is absent.
   */
  @Span()
  async resolveCatalogRules(
    ruleIds: string[],
    scannerNameLowerCase: string,
  ): Promise<Map<string, CatalogRule>> {
    const out = new Map<string, CatalogRule>();
    const extracted = Array.from(
      new Set((ruleIds ?? []).map(catalogRuleIdOf).filter((r) => !!r)),
    );
    if (extracted.length === 0) return out;

    const CHUNK = 500;
    for (let i = 0; i < extracted.length; i += CHUNK) {
      const rows = await this.correspondanceTableRepository.find({
        where: {
          ruleId: In(extracted.slice(i, i + CHUNK)),
          scanner: scannerNameLowerCase,
          enabled: true,
        },
        relations: ['vulnerability'],
        // MUST match processVulnerability's findOne exactly — see the JSDoc.
        order: { id: 'ASC' },
      });
      for (const row of rows ?? []) {
        // First row wins, and the query is ordered, so this is the MIN-id row —
        // which is what an ordered `findOne` returns for the same predicate.
        if (row?.ruleId && row?.vulnerability?.id && !out.has(row.ruleId)) {
          out.set(row.ruleId, {
            vulnerabilityId: row.vulnerability.id,
            code: row.vulnerability.code || null,
            vulnerabilityType: row.vulnerabilityType?.toLowerCase() || null,
            name: row.vulnerability.name || null,
            severity: row.vulnerability.severity || null,
            cwe: row.vulnerability.cwe ?? [],
          });
        }
      }
    }
    return out;
  }

  /**
   * `resolveCatalogRules` projected onto the catalogue vulnerability id — the
   * occurrence-index bucket key.
   *
   * @returns extracted ruleId -> catalogue vulnerability id.
   */
  @Span()
  async resolveCatalogVulnIds(
    ruleIds: string[],
    scannerNameLowerCase: string,
  ): Promise<Map<string, string>> {
    return catalogVulnIdsOf(
      await this.resolveCatalogRules(ruleIds, scannerNameLowerCase),
    );
  }

  /**
   * Get processed vulnerabilities for a project.
   *
   * @param vulnerabilitiesRequestDto - The request to get vulnerabilities.
   * @param existingVulnsMap - The existing vulnerabilities map.
   * @param existingSastVulnsProcessed - The existing SAST vulnerabilities processed.
   * @param existingIacVulnsProcessed - The existing IAC vulnerabilities processed.
   * @param scannerNameLowerCase - The scanner name in lowercase.
   * @param allowedVulnType - The allowed vulnerability type.
   * @param branch - The branch being scanned (optional).
   * @param occurrenceIndex - Rank of this finding among the findings that hash
   *   to the same fingerprint, allocated per (scan, scanner). `null` marks an
   *   UNRANKABLE batch and means "write no fingerprint" — never index 0.
   * @returns void
   */
  @Span()
  async processVulnerability(
    vulnDto: VulnerabilityDtoRequest,
    existingVulnsMap: Map<
      string,
      (SastVulnerabilityDetections | IacVulnerabilityDetections)[]
    >,
    existingSastVulnsProcessed: SastVulnerabilityDetections[],
    existingIacVulnsProcessed: IacVulnerabilityDetections[],
    scanId: string,
    projectId: string,
    scannerNameLowerCase: string,
    allowedVulnType: string,
    branch?: string,
    occurrenceIndex: number | null = 0,
  ): Promise<void> {
    const { ruleId, path, language, codeSnippet } = vulnDto;
    const { vulnerableStartLine, vulnerableEndLine } = codeSnippet;

    const ruleIdParts = ruleId.split('.');
    const extractedRuleId = ruleIdParts[ruleIdParts.length - 1];

    const correspondance = await this.correspondanceTableRepository.findOne({
      where: {
        ruleId: extractedRuleId,
        scanner: scannerNameLowerCase,
        enabled: true,
      },
      relations: ['vulnerability'],
      // (scanner, ruleId) is unique since migration
      // 1835000000001-UniqueCorrespondanceScannerRule, which deleted the
      // duplicates pointing at DIFFERENT catalogue vulnerabilities
      // (opengrep/unchecked-subprocess-call had 16 rows, 16 distinct
      // vulnerabilityIds). The order stays: harmless under the index, and
      // where the migration had to skip it because duplicates remained, it
      // keeps this query and resolveCatalogRules' `find` — planned
      // differently — on the same row. Otherwise the occurrence bucket could
      // be keyed on one catalogue vuln while the digest hashes another, which
      // splits findings that hash identically and hands them both index 0.
      order: { id: 'ASC' },
    });

    if (!correspondance) {
      return;
    }

    // The diff scan keeps a finding with this very rule.
    if (
      !isCatalogSeverityRequested(
        correspondance.vulnerability.severity,
        allowedVulnType,
      )
    ) {
      return;
    }

    // Use extractedRuleId for the key to match the key format in getExistingVulnerabilities
    // which uses correspondance.ruleId (the extracted rule ID, not the full scanner path)
    const key = `${scannerNameLowerCase}:${extractedRuleId}`;
    const currentExistingVulns = existingVulnsMap.get(key) || [];

    const existingVuln = currentExistingVulns.find(
      (vuln) =>
        vuln.vulnerability.id === correspondance.vulnerability.id &&
        vuln.path === path &&
        vuln.language === language &&
        vuln.vulnerableStartLine === vulnerableStartLine &&
        vuln.vulnerableEndLine === vulnerableEndLine,
    );

    if (existingVuln) {
      if (existingVuln instanceof SastVulnerabilityDetections) {
        if (existingVuln.fileHash === vulnDto.fileHash) {
          await this.updateExistingVulnerability(
            existingVuln,
            scanId,
            vulnDto,
            correspondance,
            occurrenceIndex,
          );
          existingSastVulnsProcessed.push(existingVuln);
        } else {
          await this.dataFlowItemRepository.delete({
            sastVulnerabilityDetection: { id: existingVuln.id },
          });
          await this.codeSnippetRepository.delete({
            sastVulnerabilityDetection: { id: existingVuln.id },
          });

          await this.addCodeSnippetToDetection(vulnDto, existingVuln);

          if (vulnDto.dataFlow && vulnDto.dataFlow.length > 0) {
            await this.addDataFlowItemsToDetection(vulnDto, existingVuln);
          }
          existingVuln.fileHash = vulnDto.fileHash;
          // The finding's code changed, but a frozen user/agent
          // decision must not be clobbered; only scan-managed (or a reappearing
          // resolved) state resets to to_verify.
          if (
            !existingVuln.stateManuallyModified ||
            existingVuln.currentState === 'resolved'
          ) {
            existingVuln.currentState = 'to_verify';
            // A reappearing resolved detection re-enters the
            // scan-managed lifecycle; drop any stale manual freeze so future
            // scans can manage it (mirrors updateExistingVulnerability / SCA).
            existingVuln.stateManuallyModified = false;
          }
          // The row is open again, so its resolution date no longer holds.
          clearResolutionOnRevive(existingVuln);
          // SHADOW MODE — this branch fires exactly when the vulnerable code
          // changed, which is the one case where the code fingerprint is
          // DESIGNED to move. It saves directly instead of going through
          // updateExistingVulnerability, so without this call the row would
          // keep its creation-time digest forever and emit no evidence at all.
          await this.applyShadowFingerprint(
            existingVuln,
            vulnDto,
            correspondance,
            occurrenceIndex,
            this.sastVulnDetectRepository,
          );
          await this.sastVulnDetectRepository.save(existingVuln);

          await this.addVulnerabilityDetectionHistory(existingVuln, scanId);

          existingSastVulnsProcessed.push(existingVuln);
        }
      } else {
        await this.updateExistingVulnerability(
          existingVuln,
          scanId,
          vulnDto,
          correspondance,
          occurrenceIndex,
        );
        existingIacVulnsProcessed.push(
          existingVuln as IacVulnerabilityDetections,
        );
      }
    } else {
      await this.createNewVulnerability(
        vulnDto,
        correspondance,
        scanId,
        projectId,
        scannerNameLowerCase,
        branch,
        occurrenceIndex,
      );
    }
  }

  /**
   * Get updated existing vulnerabilities for a project.
   * @param existingVuln - The existing vulnerabilities.
   * @param scanId - The scan ID.
   * @param vulnDto - The incoming scanner finding, when available. Optional
   *   because several callers (and the state-preservation tests) only revive a
   *   detection and have no DTO in hand; the fingerprint work is then skipped.
   * @param correspondance - The matched correspondance row, when available.
   * @param occurrenceIndex - Rank among identical findings in the same file, or
   *   `null` when the batch could not be ranked (no fingerprint work at all).
   * @returns void
   */
  @Span()
  async updateExistingVulnerability(
    existingVuln: SastVulnerabilityDetections | IacVulnerabilityDetections,
    scanId: string,
    vulnDto?: VulnerabilityDtoRequest,
    correspondance?: { vulnerability: { id: string } },
    occurrenceIndex: number | null = 0,
  ): Promise<void> {
    await this.addVulnerabilityDetectionHistory(existingVuln, scanId);
    if (existingVuln.currentState === 'resolved') {
      existingVuln.currentState = 'to_verify';
      // A reappearing resolved detection re-enters the scan-managed
      // lifecycle; drop any stale manual freeze so future scans manage it.
      existingVuln.stateManuallyModified = false;
      // ...and it is no longer resolved, so it carries no resolution date.
      clearResolutionOnRevive(existingVuln);
    }

    // The family's own repository, resolved once: the shadow-mode backfill has
    // to look the candidate digest up in the same table it would be written to.
    const repository =
      existingVuln instanceof SastVulnerabilityDetections
        ? this.sastVulnDetectRepository
        : existingVuln instanceof IacVulnerabilityDetections
          ? this.iacVulnDetectRepository
          : null;

    await this.applyShadowFingerprint(
      existingVuln,
      vulnDto,
      correspondance,
      occurrenceIndex,
      repository,
    );

    // A finding imported before the column existed gets its tool's rule id
    // on its next import; a stored id is never replaced.
    if (!existingVuln.scannerRuleId && vulnDto) {
      existingVuln.scannerRuleId = importedScannerRuleIdOf(vulnDto);
    }

    // Use the correct repository based on the vulnerability type
    if (existingVuln instanceof SastVulnerabilityDetections) {
      await this.sastVulnDetectRepository.save(existingVuln);
    } else if (existingVuln instanceof IacVulnerabilityDetections) {
      await this.iacVulnDetectRepository.save(existingVuln);
    } else {
      throw new TypeError(
        `Unknown vulnerability type encountered in updateExistingVulnerability`,
      );
    }
  }

  /**
   * SHADOW MODE, single implementation for every code-family re-detection path.
   *
   * Matching still uses the legacy tuple; this only records what the NEW
   * identity would say, so the switch-over in the next release is made on
   * evidence rather than hope:
   *
   * - a stored fingerprint that differs from the recomputed one is logged as
   *   `FINGERPRINT_MISMATCH` and is NEVER overwritten — overwriting would erase
   *   the very drift being measured;
   * - a NULL fingerprint (a row that predates the column, or one an unrankable
   *   batch left blank) is backfilled — but ONLY with a digest no other row of
   *   the project already holds. See `fingerprintClaimedElsewhere`.
   *
   * It must be called from EVERY path that re-detects an existing row, not just
   * `updateExistingVulnerability`: the `fileHash`-changed branch of
   * `processVulnerability` (the one case where divergence is guaranteed by
   * construction, since the vulnerable code itself changed) and the
   * `alreadyExists` short-circuit of `createNewVulnerability` (the ONLY
   * re-detection path a secret or a cicd finding ever takes — neither family
   * enters `existingVulnsMap`) both reach it here.
   *
   * @param detection - The existing detection row being re-detected.
   * @param vulnDto - The incoming scanner finding. Optional: callers that only
   *   revive a detection have none, and there is nothing to recompute from.
   * @param correspondance - The matched correspondance row, when available.
   * @param occurrenceIndex - Rank among identical findings in the same file, or
   *   `null` when the batch could not be ranked — the expected digest is then
   *   unknowable and this is a no-op.
   * @param repository - The repository of the detection's OWN family, used to
   *   check the digest is unclaimed before backfilling. Required: a backfill
   *   that cannot be checked is refused.
   * @param secretValueHash - For a secret reported with its value, the keyed
   *   hash of that value: its identity is then `fingerprintForSecretValue`,
   *   which needs no occurrence index. A stored fingerprint is kept as is and
   *   never reported as a mismatch (a row stored before values were hashed
   *   carries the snippet digest); a missing one is backfilled.
   * @returns true when the row's fingerprint was backfilled (caller must save).
   */
  private async applyShadowFingerprint(
    detection: {
      id?: string;
      projectId?: string;
      scannerType?: string;
      branch?: string;
      fingerprint?: string | null;
    },
    vulnDto: VulnerabilityDtoRequest | undefined,
    correspondance: { vulnerability: { id: string } } | undefined,
    occurrenceIndex: number | null,
    repository: Repository<any> | null,
    secretValueHash: string | null = null,
  ): Promise<boolean> {
    if (secretValueHash && detection && vulnDto && correspondance) {
      if (detection.fingerprint) return false;
      const expected = fingerprintForSecretValue(
        vulnDto.path,
        correspondance,
        detection.projectId,
        detection.scannerType,
        detection.branch,
        secretValueHash,
      );
      if (
        await this.fingerprintClaimedElsewhere(repository, detection, expected)
      )
        return false;
      detection.fingerprint = expected;
      return true;
    }
    // `occurrenceIndex === null` marks an UNRANKABLE batch (the catalogue
    // pre-resolution failed, or the cross-batch allocator could not answer —
    // see SastIacService.computeOccurrenceIndexes). The expected digest cannot
    // be reconstructed, so recomputing one here would both raise a false
    // FINGERPRINT_MISMATCH against a perfectly good stored value and backfill
    // NULLs with a digest no later scan reproduces.
    if (!detection || !vulnDto || !correspondance || occurrenceIndex === null)
      return false;

    const expected = fingerprintForNewSastDetection(
      vulnDto,
      correspondance,
      detection.projectId,
      detection.scannerType,
      detection.branch,
      occurrenceIndex,
    );

    if (detection.fingerprint && detection.fingerprint !== expected) {
      this.logger.warn(
        `FINGERPRINT_MISMATCH det=${detection.id} stored=${detection.fingerprint} computed=${expected}`,
      );
      return false;
    }
    if (!detection.fingerprint) {
      if (
        await this.fingerprintClaimedElsewhere(repository, detection, expected)
      )
        return false;
      detection.fingerprint = expected;
      return true;
    }
    return false;
  }

  /**
   * Is `expected` already stored on a DIFFERENT detection of this project?
   *
   * This is what keeps the NULL-then-backfill trade honest. A NULL fingerprint
   * is chosen whenever an index cannot be established with certainty, on the
   * argument that a hole self-heals on the next healthy scan while a duplicate
   * identity never does. That argument only holds if the healing itself cannot
   * mint the duplicate — and unguarded it can:
   *
   * Scan S1, group G, twins at lines 10 and 400 split across batches. The
   * healthy batch ranks the line-400 twin first, so R400 = FP(G,0); the other
   * batch is unrankable, so R10 = NULL. Scan S2 is healthy and both twins land
   * in ONE batch, where ascending line gives R10 index 0 and R400 index 1. R10
   * backfills to FP(G,0) — which R400 still holds — and R400 only logs a
   * FINGERPRINT_MISMATCH, because shadow mode deliberately never overwrites.
   * Two rows, one identity, permanently: a hard ER_DUP_ENTRY when
   * `UNIQUE (projectId, branch, fingerprint)` is added to a customer database,
   * and two distinct findings merged after the matching switch-over.
   *
   * Checking the STORED state rather than reacting to the sibling's mismatch is
   * what makes this order-independent: the two twins are handled by concurrent
   * workers (`processVulnsWithConcurrency`, concurrency 3) in either order, and
   * they need not even be in the same batch.
   *
   * The digest already hashes projectId, branch, scannerType, the catalogue
   * vuln, the normalised path and snippet and the index, so `(projectId,
   * fingerprint)` is the whole identity — no branch predicate is needed, and
   * the lookup rides `IDX_<table>_fingerprint` (migration 1809000000000).
   *
   * @param repository - The detection family's repository; `null` means the
   *   check is impossible, and an unverifiable backfill is refused.
   * @param detection - The row being backfilled (excluded from the match).
   * @param expected - The digest about to be written.
   * @returns true when the backfill must be refused.
   */
  private async fingerprintClaimedElsewhere(
    repository: Repository<any> | null | undefined,
    detection: { id?: string; projectId?: string },
    expected: string,
  ): Promise<boolean> {
    if (!repository?.findOne) return true;

    // The digest already hashes projectId, so scoping on it is an index hint,
    // not a correctness requirement — omit it rather than send `undefined`.
    const claimant = await repository.findOne({
      where: {
        fingerprint: expected,
        ...(detection.projectId ? { projectId: detection.projectId } : {}),
      },
      select: ['id'],
    });
    if (!claimant || claimant.id === detection.id) return false;

    this.logger.warn(
      `FINGERPRINT_COLLISION det=${detection.id} digest=${expected} heldBy=${claimant.id} — ` +
        `backfill refused; this group is mis-stamped and must be repaired before ` +
        `UNIQUE (projectId, branch, fingerprint)`,
    );
    return true;
  }

  /**
   * SHADOW MODE for the one re-detection path that has no DTO in hand:
   * `finalizeOldScanVulnerabilities`'s line-drift repair, which merges a
   * freshly-created row into an older one and then deletes the new row.
   *
   * Same contract as `applyShadowFingerprint` — warn on divergence, never
   * overwrite, backfill a NULL — but the expected value is READ from the row
   * being discarded instead of recomputed, because that row was created by
   * `createNewVulnerability` and therefore already carries exactly the digest
   * `fingerprintForNewSastDetection` would produce.
   *
   * @param surviving - The older row that is kept and saved.
   * @param discarded - The row about to be removed. Usually created by this
   *   scan, but it can be an old re-detected row, whose STORED digest is then
   *   what is carried.
   * @returns true when the surviving row's fingerprint was backfilled.
   */
  private carryOverFingerprint(
    surviving: { id?: string; fingerprint?: string | null },
    discarded: { fingerprint?: string | null },
  ): boolean {
    const expected = discarded?.fingerprint;
    if (!surviving || !expected) return false;

    if (surviving.fingerprint && surviving.fingerprint !== expected) {
      this.logger.warn(
        `FINGERPRINT_MISMATCH det=${surviving.id} stored=${surviving.fingerprint} computed=${expected}`,
      );
      return false;
    }
    if (!surviving.fingerprint) {
      surviving.fingerprint = expected;
      return true;
    }
    return false;
  }

  /**
   * Mirror of updateExistingVulnerability for CICD detections.
   * CICD never goes through processVulnerability/existingVulnsMap, so a
   * re-detected CICD finding reaches createNewVulnerability with the duplicate
   * guard set. We record the current scan in its ingestion history so finalize
   * knows it is still present, and revive it if it had been resolved.
   *
   * @param detection - The existing CICD detection matched during ingestion.
   * @param scanId - The current scan ID.
   * @returns void
   */
  @Span()
  async recordCicdRedetection(
    detection: CicdVulnerabilityDetections,
    scanId: string,
  ): Promise<void> {
    // Guard against a duplicate current-scan history row when the same finding
    // is re-detected several times in one scan. This covers the common
    // sequential case; under concurrent ingestion of the exact same finding the
    // two loaded snapshots may both miss the row and both insert — a benign
    // timeline duplicate that never affects resolution (finalize's skip only
    // needs one current-scan history row).
    const alreadyRecorded = detection.vulnerabilityDetectionHistory?.some(
      (history) => history.scanId === scanId,
    );

    // Reopen BEFORE recording the scan. `detection` carries the
    // `vulnerabilityDetectionHistory` the duplicate lookup loaded, a cascaded
    // one-to-many: saved after the current scan's row was inserted, TypeORM
    // nulls that row's foreign key because the loaded array does not hold it,
    // and the finalize of the same scan resolves the finding again (proven on
    // a real MySQL, sast-iac.secret-finalize.live.spec.ts).
    if (detection.currentState === 'resolved') {
      detection.currentState = 'to_verify';
      // A reappearing resolved detection is scan-managed again: drop the stale
      // manual freeze so future scans manage it
      // (mirrors updateExistingVulnerability for SAST/IaC ).
      detection.stateManuallyModified = false;
      clearResolutionOnRevive(detection);
      await this.cicdVulnDetectRepository.save(detection);
    }

    if (!alreadyRecorded) {
      await this.addVulnerabilityDetectionHistory(detection, scanId);
    }
  }

  /**
   * Mirror of recordCicdRedetection for secret detections, which also reach
   * createNewVulnerability's duplicate guard as their only re-detection path.
   * The current scan is recorded in the secret's ingestion history so finalize
   * keeps a secret the scan still reports, and a resolved secret reported
   * again is reopened (`to_verify`, no resolution date). The secret table has
   * no Freeze flag, so there is none to clear.
   *
   * @param detection - The existing secret detection matched during ingestion.
   * @param scanId - The current scan ID.
   * @returns void
   */
  @Span()
  async recordSecretRedetection(
    detection: SecretVulnerabilityDetections,
    scanId: string,
  ): Promise<void> {
    // One current-scan history row is enough for finalize; the same secret
    // reported twice in one scan only refreshes its sighting.
    const alreadyRecorded = detection.vulnerabilityDetectionHistory?.some(
      (history) => history.scanId === scanId,
    );

    // Reopen BEFORE recording the scan, for the cascade reason given in
    // recordCicdRedetection.
    if (detection.currentState === 'resolved') {
      detection.currentState = 'to_verify';
      clearResolutionOnRevive(detection);
      await this.secretVulnDetectRepository.save(detection);
    }

    if (alreadyRecorded) {
      await this.recordDetectionSighting(detection, new Date());
    } else {
      await this.addVulnerabilityDetectionHistory(detection, scanId);
    }
  }

  /**
   * The secret detection that holds this value in this file: the first lookup
   * of a secret reported with its value (`lookupThenCreateDetection`), on
   * (project, branch, scanner, catalogue rule, path, keyed value hash), at any
   * line. A missing branch filters on none, as the position lookup does. The
   * oldest row wins should two ever hold the value.
   */
  private async findSecretByValueHash(
    projectId: string,
    branch: string | undefined,
    scannerNameLowerCase: string,
    vulnerabilityId: string,
    path: string,
    secretValueHash: string,
  ): Promise<SecretVulnerabilityDetections | undefined> {
    const found = await this.secretVulnDetectRepository.findOne({
      where: {
        projectId,
        ...(branch ? { branch } : {}),
        scannerType: scannerNameLowerCase,
        path,
        secretValueHash,
        vulnerability: { id: vulnerabilityId },
      },
      relations: ['vulnerability', 'vulnerabilityDetectionHistory'],
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return found ?? undefined;
  }

  /**
   * Whether the secret row the position or drift lookup found holds the value
   * whose keyed hash is `secretValueHash`; only then is a report merged into it.
   *
   * - A row with a value hash: the two hashes are equal.
   * - A row stored before values were hashed, with its encrypted value: the
   *   value is decrypted and hashed, and that hash, the row's own, is stored
   *   on it with a conditional update whether it matches or not. Every report
   *   stores the same hash on it, so a report of another value can never bind
   *   its hash to this row.
   * - A row without a stored value cannot be read back: it is claimed for this
   *   value with a conditional update, false when another report claimed it
   *   first.
   * - A stored value that cannot be decrypted: false, the row is left alone
   *   (one WARN naming the row).
   *
   * Neither a value nor its hash is ever logged.
   */
  private async isSameSecretValue(
    row: SecretVulnerabilityDetections,
    secretValueHash: string,
  ): Promise<boolean> {
    if (row.secretValueHash != null) {
      return row.secretValueHash === secretValueHash;
    }
    let ownHash: string | null = null;
    if (row.encryptedSecret && row.encryptedSecret.length > 0) {
      try {
        ownHash = this.secretEncryptionService.hashSecretValue(
          this.secretEncryptionService.decrypt(
            Buffer.from(row.encryptedSecret).toString('utf8'),
          ),
        );
      } catch {
        this.logger.warn(
          `SECRET_VALUE_UNREADABLE det=${row.id} — its stored value cannot be ` +
            `decrypted; no report is merged into it by position`,
        );
        return false;
      }
    }
    const result = await this.secretVulnDetectRepository.update(
      { id: row.id, secretValueHash: IsNull() },
      { secretValueHash: ownHash ?? secretValueHash },
    );
    if (ownHash) {
      row.secretValueHash = ownHash;
      return ownHash === secretValueHash;
    }
    if (result?.affected === 0) return false;
    row.secretValueHash = secretValueHash;
    return true;
  }

  /**
   * What one pass's report adds to the secret finding it matched:
   * - a history-pass report names the commit that introduced the secret. A
   *   finding without a commit (the HEAD pass reports none) records it: that
   *   is the evidence that the secret is in the git history. The source is
   *   not changed here; finalize decides that.
   * - a HEAD-pass report is where the secret is now. A finding matched by its
   *   value at another line moves there, on the first report of the scan
   *   only, so a second occurrence in the same file does not move it back.
   *
   * Only a report of the finding's own value (or of no value) counts: a drift
   * match onto a row holding another value says nothing about that value.
   * Written with a narrow `update`: the row carries the cascaded history the
   * lookup loaded, which a `save` would rewrite.
   */
  private async recordSecretPassEvidence(
    detection: SecretVulnerabilityDetections,
    vulnDto: VulnerabilityDtoRequest,
    scanId: string,
    secretValueHash: string | null,
    matchedByValue: boolean,
  ): Promise<void> {
    if (secretValueHash && detection.secretValueHash !== secretValueHash) {
      return;
    }
    const patch: Partial<
      Pick<
        SecretVulnerabilityDetections,
        'commitSha' | 'vulnerableStartLine' | 'vulnerableEndLine' | 'fileHash'
      >
    > = {};
    if (
      vulnDto.secretPass === 'history' &&
      vulnDto.commitSha &&
      !detection.commitSha
    ) {
      patch.commitSha = vulnDto.commitSha;
    }
    const startLine = vulnDto.codeSnippet?.vulnerableStartLine;
    const endLine = vulnDto.codeSnippet?.vulnerableEndLine;
    const seenByThisScan = (detection.vulnerabilityDetectionHistory ?? []).some(
      (history) => history?.scanId === scanId,
    );
    if (
      vulnDto.secretPass === 'head' &&
      matchedByValue &&
      !seenByThisScan &&
      startLine != null &&
      (detection.vulnerableStartLine !== startLine ||
        detection.vulnerableEndLine !== endLine)
    ) {
      patch.vulnerableStartLine = startLine;
      patch.vulnerableEndLine = endLine;
      if (vulnDto.fileHash) {
        patch.fileHash = vulnDto.fileHash;
      }
    }
    if (Object.keys(patch).length === 0) return;
    Object.assign(detection, patch);
    await this.secretVulnDetectRepository.update(detection.id, patch);
  }

  /**
   * Manage old SAST and IAC vulnerabilities to manage simple changements in the code like line changes to avoid duplicates vulnerabilities.
   * 1st case: Their is one vulnerability in a file and the line of this vulnerability has changed => update the line of the vulnerability.
   * 2nd case: Their is one vulnerability in a file and the line of this vulnerability has changed and the code snippet has changed => update the line of the vulnerability and the code snippet.
   * 3rd case: Their is multiple similar vulnerabilities in a file and the line of one of these vulnerabilities has changed => update the line of the vulnerability and remove the other similar vulnerabilities.
   * 4th case: Their is multiple similar vulnerabilities in a file and the scan detected less vulnerabilities than the previous scan => make a match with the closest vulnerability and remove the other similar vulnerabilities.
   *
   * Secret detections skip that repair: a secret the current scan did not
   * report is resolved, one it reported is left alone, and no secret row is
   * ever merged or deleted here. A secret that moved is already merged at
   * ingestion by its fingerprint (createNewVulnerability's drift merge), and a
   * merge here would drop the row carrying a dismissal or the encrypted value.
   *
   * @param oldVulns - Vulnerabilities already detected in previous scans.
   * @param oldVulnsMatched - Vulnerabilities already detected in previous scans and matched with the current scan (void).
   * @param projectId - The project ID.
   * @param currentScanId - The current scan ID.
   * @param branch - The branch being scanned (optional, for branch isolation).
   * @param sightings - What the scan sighted, read once by the caller and
   *   shared by its 2 to 4 calls (`loadCurrentScanSightings`). Read here when
   *   absent.
   * @param historyRule - The scan's git history pass, for the secrets
   *   (`secretFinalizeAction`). Absent: read as a scan without a pass.
   * @returns void
   */
  @Span()
  async finalizeOldScanVulnerabilities(
    oldVulns: (
      | SastVulnerabilityDetections
      | IacVulnerabilityDetections
      | CicdVulnerabilityDetections
      | SecretVulnerabilityDetections
    )[],
    oldVulnsMatched: (
      | SastVulnerabilityDetections
      | IacVulnerabilityDetections
      | CicdVulnerabilityDetections
      | SecretVulnerabilityDetections
    )[],
    projectId: string,
    currentScanId: string,
    branch?: string,
    sightings?: CurrentScanSightings,
    historyRule?: SecretHistoryRule,
  ): Promise<void> {
    this.logger.log(
      `[SastIac] finalizeOldScanVulnerabilities called: projectId=${projectId}, scanId=${currentScanId}, branch='${branch || ''}', oldVulns=${oldVulns.length}, matched=${oldVulnsMatched.length}`,
    );

    // Track resolved vulnerability IDs for closing issues
    const resolvedVulnerabilityIds: {
      id: string;
      type: 'sast' | 'iac' | 'cicd' | 'secret';
    }[] = [];

    // The detections the scan sighted, read once — not every
    // detection of the project reloaded on each call, with the history of
    // the scan re-read on each call and the last history row of each old
    // detection looked up one by one. `newDetectionIds` is what decides "seen
    // in this scan"; `trulyNewVulns` are the merge candidates. The history of a
    // detection the merge deletes goes with it through the ON DELETE CASCADE
    // foreign keys of vulnerability_detection_history (SAST/IaC:
    // 1755378596694, CICD: 1766000000001).
    const {
      ids: newDetectionIds,
      detections: sightedDetections,
      secretIds: secretIdsSeenByThisScan,
    } = sightings ??
    (await this.loadCurrentScanSightings(projectId, currentScanId, branch));

    const allNotMatched = oldVulns.filter(
      (oldVuln) => !oldVulnsMatched.some((p) => p.id === oldVuln.id),
    );
    // Secrets are kept out of the line-drift repair below (see the JSDoc).
    const secretsNotMatched = allNotMatched.filter(
      (v): v is SecretVulnerabilityDetections =>
        v instanceof SecretVulnerabilityDetections,
    );
    const oldVulnsNotMatched = allNotMatched.filter(
      (
        v,
      ): v is
        | SastVulnerabilityDetections
        | IacVulnerabilityDetections
        | CicdVulnerabilityDetections =>
        !(v instanceof SecretVulnerabilityDetections),
    );

    this.logger.log(
      `[SastIac] oldVulnsNotMatched count: ${allNotMatched.length}`,
    );

    // Log the first few unmatched vulns for debugging
    for (let i = 0; i < Math.min(3, allNotMatched.length); i++) {
      const v = allNotMatched[i];
      this.logger.log(
        `[SastIac] Unmatched vuln ${i}: id=${v.id}, path=${v.path}, state=${v.currentState}`,
      );
    }

    // Every sighted detection was loaded by its id in `newDetectionIds`.
    const trulyNewVulns = sightedDetections;

    const lineDistance = (
      v1:
        | SastVulnerabilityDetections
        | IacVulnerabilityDetections
        | CicdVulnerabilityDetections,
      v2:
        | SastVulnerabilityDetections
        | IacVulnerabilityDetections
        | CicdVulnerabilityDetections,
    ) => Math.abs(v1.vulnerableStartLine - v2.vulnerableStartLine);

    const updateAndRemove = async (
      older:
        | SastVulnerabilityDetections
        | IacVulnerabilityDetections
        | CicdVulnerabilityDetections,
      newer:
        | SastVulnerabilityDetections
        | IacVulnerabilityDetections
        | CicdVulnerabilityDetections,
    ) => {
      // Read before the transaction: TypeORM's remove() clears the id.
      const survivorId = older.id;
      const discardedId = newer.id;
      const staleSnippets = older.codeSnippets ?? [];
      const staleDataFlow =
        older instanceof SastVulnerabilityDetections
          ? (older.dataFlowItems ?? [])
          : [];

      older.vulnerableStartLine = newer.vulnerableStartLine;
      older.vulnerableEndLine = newer.vulnerableEndLine;
      older.updateAt = new Date();
      older.codeSnippets = [];
      if (older instanceof SastVulnerabilityDetections) {
        older.dataFlowItems = [];
      }

      if (newer.codeSnippets && newer.codeSnippets.length > 0) {
        for (const snippet of newer.codeSnippets) {
          const newSnippet = new CodeSnippet();
          newSnippet.vulnerableStartLine = snippet.vulnerableStartLine;
          newSnippet.vulnerableEndLine = snippet.vulnerableEndLine;
          newSnippet.startLine = snippet.startLine;
          newSnippet.endLine = snippet.endLine;
          newSnippet.code = snippet.code;
          newSnippet.language = snippet.language;
          newSnippet.fixAnalysis = snippet.fixAnalysis;
          newSnippet.fixAnalysisDescription = snippet.fixAnalysisDescription;
          if (older instanceof SastVulnerabilityDetections) {
            newSnippet.sastVulnerabilityDetection = older;
          } else if (older instanceof CicdVulnerabilityDetections) {
            newSnippet.cicdVulnerabilityDetection = older;
          } else {
            newSnippet.iacVulnerabilityDetection =
              older as IacVulnerabilityDetections;
          }
          older.codeSnippets.push(newSnippet);
        }
      }

      if (
        older instanceof SastVulnerabilityDetections &&
        newer instanceof SastVulnerabilityDetections
      ) {
        if (!older.dataFlowItems) {
          older.dataFlowItems = [];
        }
        if (newer.dataFlowItems && newer.dataFlowItems.length > 0) {
          for (const df of newer.dataFlowItems) {
            const newDf = new DataFlowItem();
            newDf.nameHighlight = df.nameHighlight;
            newDf.line = df.line;
            newDf.language = df.language;
            newDf.code = df.code;
            newDf.type = df.type;
            newDf.order = df.order;
            newDf.sastVulnerabilityDetection = older;
            older.dataFlowItems.push(newDf);
          }
        }
      }

      // SHADOW MODE — this pass merges `newer` into `older` and then DELETES
      // `newer`, which is the row `createNewVulnerability` just stamped with a
      // correct fingerprint. Carrying it over closes the last re-detection path
      // that produced no evidence, and it matters for two distinct reasons:
      //
      // - a row whose fingerprint is NULL and which survives across scans only
      //   through this repair would never be backfilled by ingestion at all;
      // - `areVulnsSimilar` strips comments before comparing while
      //   `normalizeSnippet` does not, so a comment-only edit inside the
      //   vulnerable region matches HERE while genuinely moving the digest.
      //   That divergence is invisible everywhere else by construction.
      //
      // No DTO/correspondance is in hand on this path, so the digest is taken
      // from the row that carries it rather than recomputed — same value, since
      // `newer` was produced by `fingerprintForNewSastDetection`.
      this.carryOverFingerprint(older, newer);

      // `newer` is the row THIS scan just stamped with today's sighting, and it
      // is about to be deleted. Without carrying the window across, the survivor
      // keeps a `last_detected_at` from whenever the lines last held still — a
      // finding that IS still present then exports as though it had not been
      // seen for weeks, which a GRC platform reads as "probably fixed". That is
      // exactly the ambiguity the column was added to remove.
      //
      // Same merge rule as the backfill: earlier `first`, later `last`, never
      // inward.
      const merged = mergeDetectionBounds(
        { first: older.firstDetectedAt, last: older.lastDetectedAt },
        { first: newer.firstDetectedAt, last: newer.lastDetectedAt },
      );
      older.firstDetectedAt = merged.first;
      older.lastDetectedAt = merged.last;

      // The row being DELETED can be the one carrying the decision: `older` is
      // only "older" by `createdAt`, and `areVulnsSimilar` filters on
      // type/rule/path/snippet with no state filter, so an `ignored`, frozen
      // detection is a legal merge candidate. `history_item`'s detection FKs are
      // ON DELETE CASCADE, so the delete below takes the `status_change` row AND
      // the `comment` row `backfill-lifecycle.ts` rebuilds `dismissal_reason`
      // from — the evidence and its only recovery source go together, and
      // nothing can restore them afterwards. The shared rule keeps the decided
      // side (see mergeDetectionTriage).
      if (mergeDetectionTriage(older, newer)) {
        this.logger.log(
          `TRIAGE_CARRIED_OVER survivor=${older.id} from=${newer.id} state=${older.currentState} by=${older.triagedByType ?? 'none'}`,
        );
      }

      // The survivor used to be
      // saved first, while `newer` still held the digest carried over above,
      // so UNIQUE (projectId, branch, fingerprint) rejected it and aborted the
      // whole scanner finalization, retry after retry. `newer` now releases
      // the digest first, and the pair commits or rolls back as one. The
      // detection repositories share one DataSource, so any of their managers
      // opens the same transaction.
      try {
        await this.sastVulnDetectRepository.manager.transaction(
          async (manager) => {
            if (staleSnippets.length > 0) {
              await manager.getRepository(CodeSnippet).remove(staleSnippets);
            }
            if (staleDataFlow.length > 0) {
              await manager.getRepository(DataFlowItem).remove(staleDataFlow);
            }

            if (newer instanceof SastVulnerabilityDetections) {
              await manager
                .getRepository(SastVulnerabilityDetections)
                .remove(newer);
            } else if (newer instanceof CicdVulnerabilityDetections) {
              await manager
                .getRepository(CicdVulnerabilityDetections)
                .remove(newer);
            } else {
              await manager
                .getRepository(IacVulnerabilityDetections)
                .remove(newer);
            }

            if (older instanceof SastVulnerabilityDetections) {
              await manager
                .getRepository(SastVulnerabilityDetections)
                .save(older);
            } else if (older instanceof CicdVulnerabilityDetections) {
              await manager
                .getRepository(CicdVulnerabilityDetections)
                .save(older);
            } else {
              await manager
                .getRepository(IacVulnerabilityDetections)
                .save(older);
            }
          },
        );
      } catch (error) {
        // Another row can still hold the digest (a branch-less finalization
        // merges across branches): leave this pair as it was rather than
        // abandon every group after it.
        if (!isUniqueViolation(error)) throw error;
        this.logger.warn(
          `DRIFT_MERGE_SKIPPED survivor=${survivorId} discarded=${discardedId} scan=${currentScanId} — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    };

    // Resolve one detection uniformly across SAST/IaC/CICD. Only
    // ACTIVE detections auto-resolve — 'ignored' is a user decision and
    // 'resolved' is already closed (same convention as
    // findStaleVulns). A `confirmed` one closes even when the freeze flag froze
    // it: the freeze guards re-evaluation, and the person who confirmed stays on
    // their own status_change row.
    const markResolved = async (
      det:
        | SastVulnerabilityDetections
        | IacVulnerabilityDetections
        | CicdVulnerabilityDetections
        | SecretVulnerabilityDetections,
    ): Promise<void> => {
      if (!shouldAutoResolveOnDisappearance(det)) {
        return;
      }
      det.currentState = 'resolved';
      const resolvedAt = new Date();
      // The machine resolved this, not a person. Stamping the actor type
      // explicitly is what stops the history row below — written with no
      // userId — from reading as "unknown user" for every future export.
      applyTriageToDetection(det, { status: 'resolved' }, resolvedAt, 'system');
      const historyItem = new HistoryItem();
      historyItem.type = 'status_change';
      historyItem.value = 'resolved';
      historyItem.date = resolvedAt;
      if (det instanceof SastVulnerabilityDetections) {
        await this.sastVulnDetectRepository.save(det);
        resolvedVulnerabilityIds.push({ id: det.id, type: 'sast' });
        historyItem.sastVulnerabilityDetection = det;
      } else if (det instanceof CicdVulnerabilityDetections) {
        await this.cicdVulnDetectRepository.save(det);
        resolvedVulnerabilityIds.push({ id: det.id, type: 'cicd' });
        historyItem.cicdVulnerabilityDetection = det;
      } else if (det instanceof SecretVulnerabilityDetections) {
        await this.secretVulnDetectRepository.save(det);
        resolvedVulnerabilityIds.push({ id: det.id, type: 'secret' });
        historyItem.secretVulnerabilityDetection = det;
      } else {
        await this.iacVulnDetectRepository.save(det);
        resolvedVulnerabilityIds.push({ id: det.id, type: 'iac' });
        historyItem.iacVulnerabilityDetection = det;
      }
      applyAgentAuditFields(historyItem, {}, 'system');
      await this.resultService.addHistoryItem(historyItem);
    };

    // A code secret that left the code but is still in the scanned history
    // becomes a history finding and stays open. A narrow update, never a
    // save: the row may carry cascaded relations a save would rewrite (see
    // recordSecretRedetection). Conditional on the source, so two finalizes
    // of one branch write the change once.
    const moveSecretToHistory = async (
      secret: SecretVulnerabilityDetections,
    ): Promise<boolean> => {
      const result = await this.secretVulnDetectRepository.update(
        { id: secret.id, source: 'head' },
        { source: 'history' },
      );
      if (result?.affected === 0) return false;
      secret.source = 'history';
      const historyItem = new HistoryItem();
      historyItem.type = 'source_change';
      historyItem.value = 'history';
      historyItem.date = new Date();
      historyItem.secretVulnerabilityDetection = secret;
      // No userId: a `system` userId marks an agent analysis of the finding
      // (`hasCybeAnalysis`).
      applyAgentAuditFields(historyItem, {}, 'system');
      await this.resultService.addHistoryItem(historyItem);
      return true;
    };

    // Secrets: what this scan did not report is resolved, kept, or moved to
    // the history (secretFinalizeAction). Nothing else: no merge, no delete.
    // The same gate as every family applies first (ignored and resolved are
    // left as they are, their source with them).
    let secretsKept = 0;
    let secretsMovedToHistory = 0;
    for (const secret of secretsNotMatched) {
      if (secretIdsSeenByThisScan.has(secret.id)) {
        continue;
      }
      if (!shouldAutoResolveOnDisappearance(secret)) {
        continue;
      }
      const action = secretFinalizeAction(secret, historyRule);
      if (action === 'resolve') {
        await markResolved(secret);
      } else if (action === 'move_to_history') {
        if (await moveSecretToHistory(secret)) secretsMovedToHistory++;
      } else {
        secretsKept++;
      }
    }
    if (secretsKept > 0 || secretsMovedToHistory > 0) {
      this.logger.log(
        `[SastIac] secrets not reported by scan=${currentScanId}: ${secretsKept} history findings kept, ` +
          `${secretsMovedToHistory} moved to history (outcome=${historyRule?.outcome ?? 'null'}, ` +
          `mode=${historyRule?.mode ?? 'null'}, firstPass=${historyRule?.firstPass === true})`,
      );
    }

    const groupedOldVulns: (
      | SastVulnerabilityDetections
      | IacVulnerabilityDetections
      | CicdVulnerabilityDetections
    )[][] = [];
    const usedIndices = new Set<number>();

    // Yield every N iterations to keep event loop responsive
    let iterationsSinceYield = 0;
    const yieldEvery = 10;

    for (let i = 0; i < oldVulnsNotMatched.length; i++) {
      if (usedIndices.has(i)) continue;
      const group = [oldVulnsNotMatched[i]];
      for (let j = i + 1; j < oldVulnsNotMatched.length; j++) {
        if (usedIndices.has(j)) continue;
        if (
          await this.areVulnsSimilar(
            oldVulnsNotMatched[i],
            oldVulnsNotMatched[j],
          )
        ) {
          group.push(oldVulnsNotMatched[j]);
          usedIndices.add(j);
        }
        // Yield periodically to keep gRPC responsive
        iterationsSinceYield++;
        if (iterationsSinceYield >= yieldEvery) {
          iterationsSinceYield = 0;
          await this.yieldToEventLoop();
        }
      }
      usedIndices.add(i);
      groupedOldVulns.push(group);
    }

    this.logger.log(`[SastIac] Grouped into ${groupedOldVulns.length} groups`);

    for (const group of groupedOldVulns) {
      // Yield at the start of each group processing
      await this.yieldToEventLoop();

      const finalGroup: (
        | SastVulnerabilityDetections
        | IacVulnerabilityDetections
        | CicdVulnerabilityDetections
      )[] = [];
      let skippedDueToCurrentScan = 0;
      for (const oldVuln of group) {
        // Sighted by this scan: still present. The scan has a history row
        // for it, whatever a newer scan of the branch wrote since. Never the
        // finding's newest row: `detectedAt` has no fractional seconds, so two
        // scans of the branch in one second (or two overlapping scans) tie.
        if (newDetectionIds.has(oldVuln.id)) {
          skippedDueToCurrentScan++;
          continue;
        }
        finalGroup.push(oldVuln);
      }

      if (skippedDueToCurrentScan > 0) {
        this.logger.log(
          `[SastIac] Group of ${group.length}: skipped ${skippedDueToCurrentScan} (already in current scan), finalGroup=${finalGroup.length}`,
        );
      }

      if (finalGroup.length === 0) {
        continue;
      }

      if (finalGroup.length >= 2) {
        const oldSet = [...finalGroup];
        // Filter trulyNewVulns to find similar ones (need async check)
        const newSet: (
          | SastVulnerabilityDetections
          | IacVulnerabilityDetections
          | CicdVulnerabilityDetections
        )[] = [];
        let candidateIterations = 0;
        for (const candidate of trulyNewVulns) {
          for (const o of oldSet) {
            if (
              candidate.id !== o.id &&
              (await this.areVulnsSimilar(o, candidate))
            ) {
              newSet.push(candidate);
              break;
            }
          }
          // Yield periodically
          candidateIterations++;
          if (candidateIterations % 10 === 0) {
            await this.yieldToEventLoop();
          }
        }

        for (const oldVuln of oldSet) {
          // Yield at start of each vuln processing
          await this.yieldToEventLoop();

          let bestMatch:
            | SastVulnerabilityDetections
            | IacVulnerabilityDetections
            | CicdVulnerabilityDetections
            | null = null;
          let bestDist = Number.MAX_SAFE_INTEGER;

          for (const candidate of newSet) {
            if (candidate.id === oldVuln.id) continue;
            if (!(await this.areVulnsSimilar(oldVuln, candidate))) continue;
            const dist = lineDistance(oldVuln, candidate);
            if (dist < bestDist) {
              bestDist = dist;
              bestMatch = candidate;
            }
          }

          if (bestMatch) {
            const older =
              oldVuln.createdAt < bestMatch.createdAt ? oldVuln : bestMatch;
            const newer = older === oldVuln ? bestMatch : oldVuln;
            await updateAndRemove(older, newer);
            const idx = newSet.indexOf(bestMatch);
            if (idx !== -1) {
              newSet.splice(idx, 1);
            }
          } else {
            // Auto-resolve only ACTIVE detections; 'ignored'/'resolved' are
            // preserved on disappearance. The gate lives inside markResolved.
            await markResolved(oldVuln);
          }
        }
      } else {
        const oldVuln = finalGroup[0];
        // Filter trulyNewVulns to find similar ones (need async check)
        const possibleNew: (
          | SastVulnerabilityDetections
          | IacVulnerabilityDetections
          | CicdVulnerabilityDetections
        )[] = [];
        let possibleIterations = 0;
        for (const v of trulyNewVulns) {
          if (v.id !== oldVuln.id && (await this.areVulnsSimilar(oldVuln, v))) {
            possibleNew.push(v);
          }
          // Yield periodically
          possibleIterations++;
          if (possibleIterations % 10 === 0) {
            await this.yieldToEventLoop();
          }
        }

        let bestMatch:
          | SastVulnerabilityDetections
          | IacVulnerabilityDetections
          | CicdVulnerabilityDetections
          | null = null;
        let bestDist = Number.MAX_SAFE_INTEGER;

        for (const candidate of possibleNew) {
          const dist = lineDistance(oldVuln, candidate);
          if (dist < bestDist) {
            bestDist = dist;
            bestMatch = candidate;
          }
        }

        if (bestMatch) {
          const older =
            oldVuln.createdAt < bestMatch.createdAt ? oldVuln : bestMatch;
          const newer = older === oldVuln ? bestMatch : oldVuln;
          await updateAndRemove(older, newer);
        } else {
          // Only ACTIVE detections auto-resolve; 'ignored'/'resolved' are
          // preserved across re-scans. The gate lives inside markResolved.
          await markResolved(oldVuln);
        }
      }
    }

    // Close issues for resolved vulnerabilities (files deleted or code fixed)
    this.logger.log(
      `[SastIac] finalizeOldScanVulnerabilities completed: ${resolvedVulnerabilityIds.length} vulnerabilities resolved`,
    );

    if (resolvedVulnerabilityIds.length > 0) {
      try {
        // Group by scanner type
        const sastIds = resolvedVulnerabilityIds
          .filter((r) => r.type === 'sast')
          .map((r) => r.id);
        const iacIds = resolvedVulnerabilityIds
          .filter((r) => r.type === 'iac')
          .map((r) => r.id);
        const cicdIds = resolvedVulnerabilityIds
          .filter((r) => r.type === 'cicd')
          .map((r) => r.id);
        const secretIds = resolvedVulnerabilityIds
          .filter((r) => r.type === 'secret')
          .map((r) => r.id);

        if (sastIds.length > 0) {
          this.logger.log(
            `[SastIac] Closing issues for ${sastIds.length} resolved SAST vulnerabilities...`,
          );
          await this.issueIntegrationService.closeIssuesForResolvedVulnerabilities(
            projectId,
            sastIds,
            'file_deleted_or_fixed',
            'sast',
          );
        }

        if (iacIds.length > 0) {
          this.logger.log(
            `[SastIac] Closing issues for ${iacIds.length} resolved IAC vulnerabilities...`,
          );
          await this.issueIntegrationService.closeIssuesForResolvedVulnerabilities(
            projectId,
            iacIds,
            'file_deleted_or_fixed',
            'iac',
          );
        }

        if (cicdIds.length > 0) {
          this.logger.log(
            `[SastIac] Closing issues for ${cicdIds.length} resolved CICD vulnerabilities...`,
          );
          await this.issueIntegrationService.closeIssuesForResolvedVulnerabilities(
            projectId,
            cicdIds,
            'file_deleted_or_fixed',
            'cicd',
          );
        }

        if (secretIds.length > 0) {
          this.logger.log(
            `[SastIac] Closing issues for ${secretIds.length} resolved secret vulnerabilities...`,
          );
          await this.issueIntegrationService.closeIssuesForResolvedVulnerabilities(
            projectId,
            secretIds,
            'file_deleted_or_fixed',
            'secret',
          );
        }
      } catch (error: any) {
        // Don't fail the scan processing if issue closing fails
        this.logger.warn(
          `[SastIac] Failed to close issues for resolved vulnerabilities: ${error?.message || error}`,
        );
      }
    }
  }

  /**
   * Add a new vulnerability detection to the database for SAST and IAC.
   *
   * The duplicate lookup and the insert run under a per-position Redis lock
   * (`withDetectionCreationLock`), so twin findings ingested concurrently end
   * up as one row.
   *
   * @param vulnDto - The vulnerability DTO.
   * @param correspondance - The correspondance table.
   * @param scanId - The scan ID.
   * @param projectId - The project ID.
   * @param scannerNameLowerCase - The scanner name in lowercase.
   * @param branch - The branch being scanned (optional).
   * @param occurrenceIndex - Rank of this finding among the findings that hash
   *   to the same fingerprint (same catalogue vuln, same normalised path and
   *   snippet). Allocated per (scan, scanner) — NOT per batch — by
   *   `SastIacService.computeOccurrenceIndexes`. Defaults to 0 so the many
   *   existing callers (and a single-occurrence finding) need no change.
   *   `null` marks an UNRANKABLE batch: the detection is created with a NULL
   *   fingerprint rather than one that could collide with a sibling batch's.
   * @returns void
   */
  @Span()
  async createNewVulnerability(
    vulnDto: VulnerabilityDtoRequest,
    correspondance: CorrespondanceTable,
    scanId: string,
    projectId: string,
    scannerNameLowerCase: string,
    branch?: string,
    occurrenceIndex: number | null = 0,
  ): Promise<void> {
    const vulnType = correspondance.vulnerabilityType;
    const isSecret = vulnType === 'secret';

    // Drop fake/placeholder secrets at ingestion. A value that is
    // plainly not a real credential (placeholder, example, sequential filler,
    // env-var name, secret-manager reference) is never persisted. The check is
    // value-only and high-precision, so a real secret is never dropped.
    if (isSecret && isFakeSecret(vulnDto.secretValue)) {
      this.logger.debug(
        `SCAN-7: skipping fake/placeholder secret (rule=${vulnDto.ruleId}, path=${vulnDto.path})`,
      );
      return;
    }

    // The duplicate lookup and the insert that follows it are ONE critical
    // section. Two TWIN findings — two scanner rules mapped to this catalogue
    // vulnerability on this line — must end up as one row, but ingestion is
    // concurrent (3 workers per batch, batches of one scanner consumed
    // concurrently across pods) and `existingVulnsMap` is a batch-start
    // snapshot, so both twins land here. Unserialized, both looked up before
    // either inserted, and both inserted: one finding stored twice, the second
    // row then "resolved" by the next scan although nothing was fixed. Under
    // the per-position lock the twin that
    // waited re-runs the unchanged lookup, finds its twin's row and merges.
    //
    // A secret with a value is one finding wherever its file holds it: its
    // lookup, and so its lock, are keyed on the keyed hash of the value.
    const secretValueHash =
      isSecret && vulnDto.secretValue
        ? this.secretEncryptionService.hashSecretValue(vulnDto.secretValue)
        : null;
    await this.withDetectionCreationLock(
      detectionCreationLockKey(
        vulnDto,
        correspondance,
        projectId,
        scannerNameLowerCase,
        branch,
        secretValueHash,
      ),
      `type=${vulnType} project=${projectId} scan=${scanId} path=${vulnDto.path} ` +
        `line=${vulnDto.codeSnippet?.vulnerableStartLine}`,
      () =>
        this.lookupThenCreateDetection(
          vulnDto,
          correspondance,
          scanId,
          projectId,
          scannerNameLowerCase,
          branch,
          occurrenceIndex,
          secretValueHash,
        ),
    );
  }

  /**
   * Run `section` under the detection creation lock `key`
   * (`detectionCreationLockKey`), held in ScanQueueService's Redis.
   *
   * The lock only serializes, it never decides. When it cannot be had — no
   * provider (legacy unit-test modules), a Redis error, or a holder that
   * outlasts DETECTION_CREATION_LOCK_MAX_WAIT_MS — the section runs anyway
   * after ONE warning naming the reason: the behaviour before the lock existed
   * (a twin may be stored twice), never a failed batch. It is released in
   * `finally`, so a section that throws never strands it until its TTL.
   */
  private async withDetectionCreationLock(
    key: string,
    context: string,
    section: () => Promise<void>,
  ): Promise<void> {
    const lock = this.scanQueueService;
    const skipped = (reason: string, detail?: string) =>
      this.logger.warn(
        `DETECTION_LOCK_SKIPPED reason=${reason} ${context} — created without the ` +
          `per-position lock; a twin ingested concurrently may be stored twice` +
          (detail ? `: ${detail}` : ''),
      );

    let token: string | null = null;
    if (!lock) {
      skipped('no-lock-provider');
    } else {
      try {
        token = await lock.acquireDetectionCreationLock(key);
        if (!token) skipped('wait-timeout');
      } catch (e) {
        skipped('redis-error', (e as Error)?.message ?? String(e));
      }
    }

    try {
      await section();
    } finally {
      if (token) {
        try {
          if (!(await lock.releaseDetectionCreationLock(key, token))) {
            this.logger.warn(
              `DETECTION_LOCK_EXPIRED ${context} — the section outlasted the lock TTL; ` +
                `a twin may have run it concurrently`,
            );
          }
        } catch (e) {
          this.logger.warn(
            `DETECTION_LOCK_RELEASE_FAILED ${context} — the key expires on its own: ` +
              `${(e as Error)?.message ?? String(e)}`,
          );
        }
      }
    }
  }

  /**
   * The critical section of `createNewVulnerability`, run under its
   * per-position lock: the duplicate lookup, then either the merge into the
   * matched row or the insert of a new one (row, history, snippet, data flow).
   * Parameters as in `createNewVulnerability`, plus `secretValueHash`: the
   * keyed hash of a secret's value, null for any other finding or a secret
   * reported without its value.
   */
  private async lookupThenCreateDetection(
    vulnDto: VulnerabilityDtoRequest,
    correspondance: CorrespondanceTable,
    scanId: string,
    projectId: string,
    scannerNameLowerCase: string,
    branch: string | undefined,
    occurrenceIndex: number | null,
    secretValueHash: string | null,
  ): Promise<void> {
    const vulnType = correspondance.vulnerabilityType;
    const isSast = vulnType === 'sast';
    const isIac = vulnType === 'iac';
    const isCicd = vulnType === 'cicd';
    const isSecret = vulnType === 'secret';

    // Defensive deduplication: check if an identical detection has already been recorded
    // for this project + scanner + rule + path + language + vulnerable range + branch during this scan.
    // We consider fileHash as well when provided by the scanner to distinguish same-line changes.
    const startLine = vulnDto.codeSnippet?.vulnerableStartLine;
    const endLine = vulnDto.codeSnippet?.vulnerableEndLine;

    const dupWhereBase = {
      projectId,
      scannerType: scannerNameLowerCase,
      path: vulnDto.path,
      language: vulnDto.language,
      vulnerableStartLine: startLine,
      vulnerableEndLine: endLine,
      ...(branch ? { branch } : {}),
    } as any;

    // The duplicate a re-detection matched, if any. Kept for EVERY family (not
    // just cicd) because this short-circuit is the ONLY re-detection path a
    // secret or a cicd finding ever takes — `getExistingVulnerabilities` builds
    // `existingVulnsMap` from sast + iac alone — so it is where those two
    // families must produce their shadow-mode evidence.
    let matchedDuplicate:
      | SastVulnerabilityDetections
      | IacVulnerabilityDetections
      | CicdVulnerabilityDetections
      | SecretVulnerabilityDetections
      | undefined;
    // Check if an identical detection already exists:
    // 1. Same vulnerability rule
    // 2. Same file hash (if provided)
    // 3. Either already seen this scan OR exists in DB (to prevent duplicates)
    const isDuplicateOf = (c: {
      vulnerability?: { id?: string };
      fileHash?: string;
    }) => {
      const sameRule = c.vulnerability?.id === correspondance.vulnerability.id;
      const sameHash = !vulnDto.fileHash || c.fileHash === vulnDto.fileHash;
      return sameRule && sameHash;
    };
    const dupRepository = isSast
      ? this.sastVulnDetectRepository
      : isCicd
        ? this.cicdVulnDetectRepository
        : isSecret
          ? this.secretVulnDetectRepository
          : isIac
            ? this.iacVulnDetectRepository
            : null;

    // ONE SECRET ACROSS PASSES. The Gitleaks scanner reports a secret twice
    // per scan: the HEAD pass at its current line, the history pass at the
    // line of the commit that introduced it. Neither line, nor the file hash
    // (the history pass has none), says they are one finding; the value does.
    // So a secret with a value is looked up first on (project, branch,
    // scanner, catalogue rule, path, keyed value hash), at any line. The
    // position and drift lookups that follow only find rows stored before
    // values were hashed, and merge into one only once it is known to hold
    // this value (`isSameSecretValue`): another value at the same position is
    // another secret (one rotated in place, say).
    let matchedByValue = false;
    if (secretValueHash) {
      matchedDuplicate = await this.findSecretByValueHash(
        projectId,
        branch,
        scannerNameLowerCase,
        correspondance.vulnerability.id,
        vulnDto.path,
        secretValueHash,
      );
      matchedByValue = !!matchedDuplicate;
    }
    if (!matchedDuplicate && dupRepository) {
      const candidates = (await dupRepository.find({
        where: dupWhereBase,
        relations: ['vulnerability', 'vulnerabilityDetectionHistory'],
      })) as any[];
      if (secretValueHash) {
        for (const candidate of candidates.filter(isDuplicateOf)) {
          if (await this.isSameSecretValue(candidate, secretValueHash)) {
            matchedDuplicate = candidate;
            break;
          }
        }
      } else {
        matchedDuplicate = candidates.find(isDuplicateOf);
      }
    }

    // DRIFT MERGE. The lookup above keys on the POSITION, so it cannot see a
    // finding whose code merely moved — and moving is exactly what the digest is
    // built to survive: it hashes the normalised snippet and excludes the line.
    // So when nothing matches by position, ask the IDENTITY instead. A row
    // already carrying the digest this detection would produce IS this
    // detection, three lines lower.
    //
    // Without this the ingestion creates a second row for one finding, and both
    // legitimately claim one identity, which is what blocks UNIQUE (projectId, branch, fingerprint). For a
    // GRC consumer it opens two work items for one problem and lets the triage
    // history follow whichever row is upserted last.
    //
    // A null `occurrenceIndex` means the batch was declared unrankable, so no
    // digest is derivable and there is nothing to match on — fall through to the
    // shipped behaviour rather than guess. The digest already hashes projectId,
    // branch and path, so no further predicate is needed to keep the match
    // inside the right file; `projectId` is an index hint (IDX_<table>_fingerprint).
    let mergedByDrift = false;
    if (!matchedDuplicate && dupRepository && occurrenceIndex !== null) {
      const expected = fingerprintForNewSastDetection(
        vulnDto,
        correspondance,
        projectId,
        scannerNameLowerCase,
        branch,
        occurrenceIndex,
      );
      // Filter on the digest ALONE. It already hashes projectId, branch, path
      // and scannerType, so adding `projectId` changes no result — but it
      // changes the PLAN: MySQL then prefers IDX_<table>_PROJECT_ID and scans
      // every row of the project. Measured with EXPLAIN: fingerprint alone gives
      // `ref` on IDX_<table>_fingerprint with `Using index`; adding projectId
      // drops to the project index. This lookup runs once per newly-created
      // detection, so the difference is the whole cost of the feature.
      const claimant = await (dupRepository as any).findOne({
        where: { fingerprint: expected },
        relations: ['vulnerability', 'vulnerabilityDetectionHistory'],
      });
      // A digest match alone is NOT enough to conclude "this finding moved".
      // Two DISTINCT occurrences handed the same occurrence index — the defect
      // behind the stored/computed mismatches — also produce one digest, and
      // merging those would DELETE a live vulnerability. Worse than the
      // duplicate this whole change removes.
      //
      // The discriminator is the sighting trail: if the candidate has already
      // been seen BY THIS SCAN it is still present at its own position, so the
      // incoming detection is a second occurrence, not the same one displaced.
      // A genuine move leaves no such sighting — the old position is gone.
      //
      // Caveat, deliberate: this reads the trail as it stands when this
      // detection is processed. A co-occurrence whose own sighting has not been
      // recorded yet still slips through. The complete answer is to stop
      // mis-allocating the index; this keeps that defect from costing a finding.
      const seenByThisScan = (
        (claimant?.vulnerabilityDetectionHistory ?? []) as Array<{
          scanId?: string;
        }>
      ).some((h) => h?.scanId === scanId);
      // A secret with a value takes a claimant only if it holds this value.
      // An incremental history pass hands two values of one file the same
      // empty snippet and occurrence index 0, hence the same snippet digest:
      // merging on the digest alone would fold a new secret into an old one.
      // Refusing costs no report, as the new row's digest is built from its
      // value (`fingerprintForSecretValue`) and cannot collide.
      if (
        claimant &&
        !seenByThisScan &&
        (!secretValueHash ||
          (await this.isSameSecretValue(claimant, secretValueHash)))
      ) {
        matchedDuplicate = claimant;
        mergedByDrift = true;
      }
    }
    const alreadyExists = !!matchedDuplicate;

    if (alreadyExists) {
      // The finding did not change; only where it sits did. Refresh the position
      // so neither a human nor a GRC consumer is sent to a stale line. Nothing
      // that carries a decision is touched — currentState (so a dismissal
      // survives), dismissalReason, first_detected_at and the triage trail all
      // stay on the row they were taken for. Only the drift path refreshes:
      // a position-matched duplicate sits at the same line by definition.
      if (mergedByDrift) {
        (matchedDuplicate as any).vulnerableStartLine = startLine;
        (matchedDuplicate as any).vulnerableEndLine = endLine;
        if (vulnDto.fileHash) {
          (matchedDuplicate as any).fileHash = vulnDto.fileHash;
        }
        // REVIVE. Before drift-merging existed, sast/iac/secret only reached
        // this branch on an intra-batch duplicate, so the sighting stamp below
        // never needed to reopen anything — `recordDetectionSighting` does not.
        // A drifted finding breaks that assumption: it is being DETECTED right
        // now, so leaving it `resolved` would report a live vulnerability as
        // fixed, in the dashboard and in the compliance export alike. Mirrors
        // recordCicdRedetection, which already does this for its own family.
        if ((matchedDuplicate as any).currentState === 'resolved') {
          (matchedDuplicate as any).currentState = 'to_verify';
          // The row is scan-managed again; a stale manual freeze would stop
          // every future scan from ever resolving it.
          (matchedDuplicate as any).stateManuallyModified = false;
          clearResolutionOnRevive(matchedDuplicate as any);
        }
        this.logger.log(
          `DRIFT_MERGE det=${(matchedDuplicate as any).id} path=${vulnDto.path} ` +
            `movedTo=${startLine} — re-detected at a new line, merged instead of duplicated`,
        );
        if (dupRepository) {
          await (dupRepository as any).save(matchedDuplicate);
        }
      }
      // SHADOW MODE: a re-detection of ANY family gets its divergence logged
      // and a NULL fingerprint backfilled here. Without it the secret and cicd
      // families — which never reach updateExistingVulnerability — would
      // generate no evidence at all, and the shadow release would earn the
      // right to flip matching for only a third of the six families.
      const backfilled = await this.applyShadowFingerprint(
        matchedDuplicate,
        vulnDto,
        correspondance,
        occurrenceIndex,
        dupRepository as Repository<any> | null,
        secretValueHash,
      );
      if (backfilled && dupRepository) {
        await (dupRepository as any).save(matchedDuplicate);
      }
      // A re-detected CICD finding records the current scan in its
      // ingestion history (and is revived if it was previously resolved),
      // mirroring updateExistingVulnerability — otherwise finalize would wrongly
      // resolve a finding that is still present. SAST/IAC re-detections are
      // handled earlier via processVulnerability, so here they are just skipped.
      if (isCicd) {
        await this.recordCicdRedetection(
          matchedDuplicate as CicdVulnerabilityDetections,
          scanId,
        );
      } else if (isSecret) {
        // What this pass knows that the finding may lack: the commit of a
        // history-pass report, the current line of a HEAD-pass one.
        await this.recordSecretPassEvidence(
          matchedDuplicate as SecretVulnerabilityDetections,
          vulnDto,
          scanId,
          secretValueHash,
          matchedByValue,
        );
        // A re-detected SECRET reaches nothing else either:
        // `getExistingVulnerabilities` maps SAST + IaC only. Recording the
        // current scan is what keeps finalize from resolving a secret that is
        // still there, and it also moves `last_detected_at` forward.
        await this.recordSecretRedetection(
          matchedDuplicate as SecretVulnerabilityDetections,
          scanId,
        );
      } else {
        // SAST/IaC only land here on an intra-batch duplicate: their scan was
        // recorded by processVulnerability; the sighting stamp is idempotent.
        await this.recordDetectionSighting(matchedDuplicate, new Date());
      }
      return; // Skip duplicate insert
    }

    let newVulnDetection:
      | SastVulnerabilityDetections
      | IacVulnerabilityDetections
      | CicdVulnerabilityDetections
      | SecretVulnerabilityDetections;
    if (isSast) {
      newVulnDetection = new SastVulnerabilityDetections();
    } else if (isCicd) {
      newVulnDetection = new CicdVulnerabilityDetections();
    } else if (isSecret) {
      newVulnDetection = new SecretVulnerabilityDetections();
    } else {
      newVulnDetection = new IacVulnerabilityDetections();
    }

    newVulnDetection.projectId = projectId;
    newVulnDetection.scannerType = scannerNameLowerCase;
    newVulnDetection.currentState = 'to_verify';
    newVulnDetection.currentSeverity = correspondance.vulnerability.severity;
    // Compute CVSS4 base vector and score
    const cvss4Result = this.cvssCalculator.computeCvss4Base({
      cvss3Vector: correspondance.vulnerability.cvss3?.vector ?? null,
      severity: correspondance.vulnerability.severity,
    });
    if (cvss4Result) {
      newVulnDetection.cvss4Vector = cvss4Result.vector;
      newVulnDetection.cvss4BaseScore = cvss4Result.baseScore;
    }
    // Populate static exploitability at detection creation time — but NOT for
    // secrets: exploitability is not applicable to a hardcoded credential (the
    // secret IS the exploit), so its columns stay null and its priority is a
    // deterministic rule (see below). For SAST/IAC/CICD the score is purely
    // code-based: a file-path heuristic (a genuine .test/.spec file →
    // not_exploitable) plus the agent's verdict later. CVSS/EPSS contribute to
    // the priority via their own weights — not via exploitability.
    let exploitabilityScore: number | null = null;
    if (!isSecret) {
      const exploitResult = computeStaticExploitability({
        filePath: vulnDto.path,
      });
      newVulnDetection.exploitabilityVerdict = exploitResult.verdict;
      newVulnDetection.exploitabilityScore = exploitResult.score;
      newVulnDetection.exploitabilityReason = exploitResult.reason;
      newVulnDetection.exploitabilitySource = 'static';
      newVulnDetection.exploitabilityUpdatedAt = new Date();
      exploitabilityScore = exploitResult.score;
    }
    // Apply project security context to compute env score + vector.
    // Falls back to base when no context exists for the project. A vector
    // that only stands for the scanner's label (no CVSS of its own) is left
    // as it is: its metrics are invented, and adjusting them would move the
    // severity the scanner gave.
    let envScore: number | null = cvss4Result?.baseScore ?? null;
    let envVector: string | null = null;
    if (cvss4Result && cvss4Result.source !== 'severity') {
      const envResult = await this.resultService.computeEnvironmentalForProject(
        projectId,
        cvss4Result.vector,
      );
      if (envResult) {
        envScore = envResult.environmentalScore;
        envVector = envResult.fullVector;
      }
    }
    newVulnDetection.cvss4EnvironmentalScore = envScore;
    newVulnDetection.effectiveSeverity = deriveEffectiveSeverity(
      newVulnDetection.cvss4EnvironmentalScore ?? null,
      newVulnDetection.cvss4BaseScore ?? null,
    );
    newVulnDetection.cvss4EnvironmentalVector = envVector;

    // Drop informational findings at ingestion. A scanner rule whose severity
    // is outside the four displayable bands (e.g. 'none'/'info' — a pure
    // hygiene/best-practice note like "Redundant Tool Usage in Dockerfiles")
    // produces no CVSS score, so its effective band resolves to that
    // non-displayable label. Such findings are hidden from every list AND
    // counter, so persisting them only inflates internal state and confuses
    // the tab badges. Secrets are exempt — a secret is a real finding
    // regardless of its catalog severity.
    if (!isSecret) {
      const effectiveBand =
        resolveEffectiveSeverity(newVulnDetection)?.toLowerCase();
      if (
        !effectiveBand ||
        !(DISPLAYABLE_SEVERITIES as readonly string[]).includes(effectiveBand)
      ) {
        this.logger.log(
          `[SastIac] Skipping informational finding (effective severity '${
            effectiveBand ?? 'none'
          }') rule=${correspondance.vulnerability.id} path=${vulnDto.path}`,
        );
        return;
      }
    }

    if (isSecret) {
      // Secrets bypass the multi-signal composite — priority is deterministic:
      // always critical_urgent. The CVSS env above is still
      // computed because the CybeRisk score consumes it.
      const secretPriority = computeSecretPriority();
      newVulnDetection.currentPriority = secretPriority.priority;
      newVulnDetection.priorityScore = secretPriority.priorityScore;
    } else {
      const priorityResult = await this.resultService.recalculatePriority(
        {
          cvss4EnvironmentalScore: envScore,
          cvss4BaseScore: cvss4Result?.baseScore ?? null,
          currentSeverity: correspondance.vulnerability.severity,
          epssScore: null,
          epssPercentile: null,
          exploitabilityScore,
          priorityManualOverride: false,
        },
        projectId,
      );
      newVulnDetection.currentPriority =
        priorityResult?.priority ??
        this.mapSeverityToPriority(correspondance.vulnerability.severity);
      newVulnDetection.priorityScore = priorityResult?.priorityScore ?? null;
    }
    newVulnDetection.path = vulnDto.path;
    newVulnDetection.fileHash = vulnDto.fileHash;
    // SHADOW MODE: the fingerprint is written on every new detection, but no
    // matching decision reads it yet — the legacy line-based tuple above stays
    // authoritative for one release. Switching the match in the same release
    // would reclassify every customer's findings as "new" on any normalisation
    // bug; the divergence log in updateExistingVulnerability is what earns the
    // right to flip it.
    // A NULL occurrenceIndex marks an UNRANKABLE batch: the catalogue
    // pre-resolution failed, so this finding cannot be ranked against its twins
    // in the sibling batches of the same scan. Writing index 0 anyway is how a
    // healthy batch's index 0 and this one collapse onto ONE fingerprint for
    // TWO rows. NULL is the honest value — it is what the whole pre-existing
    // corpus carries, MySQL keeps NULLs distinct in a unique index, and the
    // next healthy scan backfills it via applyShadowFingerprint.
    // A secret with a value is identified by its value, not its snippet, and
    // needs no occurrence index: never a NULL fingerprint for it.
    newVulnDetection.fingerprint = secretValueHash
      ? fingerprintForSecretValue(
          vulnDto.path,
          correspondance,
          projectId,
          scannerNameLowerCase,
          branch,
          secretValueHash,
        )
      : occurrenceIndex === null
        ? null
        : fingerprintForNewSastDetection(
            vulnDto,
            correspondance,
            projectId,
            scannerNameLowerCase,
            branch,
            occurrenceIndex,
          );
    newVulnDetection.vulnerableStartLine =
      vulnDto.codeSnippet.vulnerableStartLine;
    newVulnDetection.vulnerableEndLine = vulnDto.codeSnippet.vulnerableEndLine;
    newVulnDetection.vulnerability = correspondance.vulnerability;
    newVulnDetection.scannerRuleId = importedScannerRuleIdOf(vulnDto);
    newVulnDetection.language = vulnDto.language;
    // Persist the scanner-provided per-finding description (e.g. Gitleaks
    // emits an enriched text with commit SHA / author / date / message for
    // secrets found in git history). This is distinct from the static
    // `vulnerability.description` catalog text shared across all findings
    // of the same rule. Safe to also populate for SAST/IAC/CICD — the
    // column is TEXT + nullable, and preserving the scanner's per-finding
    // context is useful across the board.
    newVulnDetection.contextualExplanation = vulnDto.description || null;
    // Store branch for branch-based vulnerability isolation
    if (branch) {
      newVulnDetection.branch = branch;
    }

    if (isSecret) {
      const secretDetection = newVulnDetection as SecretVulnerabilityDetections;
      // Encrypt the plaintext secret value before persisting
      if (vulnDto.secretValue) {
        secretDetection.encryptedSecret = Buffer.from(
          this.secretEncryptionService.encrypt(vulnDto.secretValue),
          'utf8',
        );
        secretDetection.secretValueHash = secretValueHash;
      }
      secretDetection.commitSha = vulnDto.commitSha || null;
      secretDetection.source =
        vulnDto.secretSource === 'history' ? 'history' : 'head';
    }

    // A concurrent worker may already have written this exact identity.
    //
    // It is established that the race is real, not theoretical: a scan batch
    // runs on several concurrent workers, the queue is multi-consumer, and BullMQ
    // or the driver can replay an INSERT whose ack was lost. It was handled for
    // `code_snippet`; the detection row itself was left bare because a duplicate
    // was merely ugly — two rows, one identity.
    //
    // UNIQUE (projectId, branch, fingerprint) changes that: the loser of the race
    // now gets ER_DUP_ENTRY, and unguarded it aborts the WHOLE scan batch. The
    // constraint that protects the data would become an availability defect.
    //
    // Losing the race is a no-op, not an error: the winner wrote the same
    // identity and recorded its own sighting. We return WITHOUT continuing —
    // the history and code-snippet writes below reference a row this transaction
    // never created, and would fail on the foreign key.
    if (
      !(await this.saveNewDetection(newVulnDetection, {
        vulnType,
        path: vulnDto.path,
      }))
    ) {
      return;
    }

    await this.addVulnerabilityDetectionHistory(newVulnDetection, scanId);

    await this.addCodeSnippetToDetection(vulnDto, newVulnDetection);

    if (isSast && vulnDto.dataFlow && vulnDto.dataFlow.length > 0) {
      await this.addDataFlowItemsToDetection(
        vulnDto,
        newVulnDetection as SastVulnerabilityDetections,
      );
    }
  }

  /**
   * Add code snippet to the vulnerability detection.
   *
   * @param vulnDto - The vulnerability DTO.
   * @param detection - The vulnerability detection (SAST, IAC, or CICD).
   * @returns void
   */
  @Span()
  async addCodeSnippetToDetection(
    vulnDto: VulnerabilityDtoRequest,
    detection:
      | SastVulnerabilityDetections
      | IacVulnerabilityDetections
      | CicdVulnerabilityDetections
      | SecretVulnerabilityDetections,
  ): Promise<void> {
    const codeSnippet = new CodeSnippet();
    codeSnippet.startLine = vulnDto.codeSnippet.startLine;
    codeSnippet.endLine = vulnDto.codeSnippet.endLine;
    codeSnippet.vulnerableStartLine = vulnDto.codeSnippet.vulnerableStartLine;
    codeSnippet.vulnerableEndLine = vulnDto.codeSnippet.vulnerableEndLine;
    codeSnippet.code = JSON.stringify(vulnDto.codeSnippet.code);
    codeSnippet.language = vulnDto.codeSnippet.language;

    if (detection instanceof SastVulnerabilityDetections) {
      codeSnippet.sastVulnerabilityDetection = detection;
    } else if (detection instanceof IacVulnerabilityDetections) {
      codeSnippet.iacVulnerabilityDetection = detection;
    } else if (detection instanceof CicdVulnerabilityDetections) {
      codeSnippet.cicdVulnerabilityDetection = detection;
    } else if (detection instanceof SecretVulnerabilityDetections) {
      codeSnippet.secretVulnerabilityDetection = detection;
    }

    await this.addCodeSnippet(codeSnippet);
  }

  /**
   * Add data flow items to the vulnerability detection.
   *
   * @param vulnDto - The vulnerability DTO.
   * @param detection - The vulnerability detection.
   * @returns void
   */
  @Span()
  async addDataFlowItemsToDetection(
    vulnDto: VulnerabilityDtoRequest,
    detection: SastVulnerabilityDetections,
  ): Promise<void> {
    for (const dataFlowItemDto of vulnDto.dataFlow) {
      const dataFlowItem = new DataFlowItem();
      dataFlowItem.nameHighlight = dataFlowItemDto.nameHighlight;
      dataFlowItem.line = dataFlowItemDto.line;
      dataFlowItem.code = JSON.stringify(dataFlowItemDto.code);
      dataFlowItem.order = dataFlowItemDto.order;
      dataFlowItem.sastVulnerabilityDetection = detection;
      dataFlowItem.language = dataFlowItemDto.language;
      dataFlowItem.type = dataFlowItemDto.type;
      await this.addDataFlowItem(dataFlowItem);
    }
  }

  /**
   * Map the severity to priority.
   *
   * @param severity - The severity.
   * @returns The priority.
   */
  @Span()
  mapSeverityToPriority(severity: string): string {
    const severityLowerCase = severity.toLowerCase();
    if (severityLowerCase === 'critical') {
      return 'critical_urgent';
    } else if (severityLowerCase === 'high') {
      return 'urgent';
    } else if (severityLowerCase === 'medium') {
      return 'normal';
    } else if (severityLowerCase === 'low') {
      return 'low';
    } else {
      return 'low';
    }
  }

  /**
   * Check if two vulnerabilities are similar.
   *
   * @param vulnA - The first vulnerability.
   * @param vulnB - The second vulnerability.
   * @returns True if the vulnerabilities are similar, false otherwise
   *
   * No @Span(): a pure comparison, run for every pair of candidates in the
   * line-shift repair. Its span was the platform's largest producer (17.4 M
   * spans) and timed nothing but CPU.
   */
  async areVulnsSimilar(
    vulnA:
      | SastVulnerabilityDetections
      | IacVulnerabilityDetections
      | CicdVulnerabilityDetections,
    vulnB:
      | SastVulnerabilityDetections
      | IacVulnerabilityDetections
      | CicdVulnerabilityDetections,
  ): Promise<boolean> {
    // Detections of different scanner types (SAST/IaC/CICD) are never
    // the same finding. finalize shares one candidate pool (trulyNewVulns)
    // across types, and areVulnsSimilar is otherwise type-blind (path + snippet
    // only) — without this guard a re-detected CICD detection could be
    // cross-matched to a fixed IaC finding on the same CI YAML file, leaving the
    // IaC finding open and absorbing the live CICD detection.
    if (vulnA.constructor !== vulnB.constructor) {
      return false;
    }

    // The repair merges ONE finding whose lines moved; two catalogue
    // rules reported on the same line are two findings. Without this guard a
    // finding that left the scan (a cybedefend-ignore directive neutralised
    // its rule, or its code was fixed) absorbed a still-present finding of
    // another rule on that line: the survivor kept the vanished rule and the
    // live finding was DELETED (e.g. a neutralised readiness finding ate the
    // liveness finding of `containers:` on every scan).
    if (vulnA.vulnerability?.id !== vulnB.vulnerability?.id) {
      return false;
    }

    if (!vulnA.path || !vulnB.path || vulnA.path !== vulnB.path) {
      return false;
    }

    if (
      !vulnA.codeSnippets ||
      vulnA.codeSnippets.length === 0 ||
      !vulnB.codeSnippets ||
      vulnB.codeSnippets.length === 0
    ) {
      return false;
    }

    let snippetArrayA: any[];
    let snippetArrayB: any[];

    try {
      const codeA = vulnA.codeSnippets[0].code;
      snippetArrayA = typeof codeA === 'string' ? JSON.parse(codeA) : codeA;
    } catch {
      return false;
    }

    try {
      const codeB = vulnB.codeSnippets[0].code;
      snippetArrayB = typeof codeB === 'string' ? JSON.parse(codeB) : codeB;
    } catch {
      return false;
    }

    const vulnLinesA = snippetArrayA.filter(
      (line: any) =>
        line.line >= vulnA.vulnerableStartLine &&
        line.line <= vulnA.vulnerableEndLine,
    );
    const vulnLinesB = snippetArrayB.filter(
      (line: any) =>
        line.line >= vulnB.vulnerableStartLine &&
        line.line <= vulnB.vulnerableEndLine,
    );

    if (vulnLinesA.length === 0 || vulnLinesB.length === 0) {
      return false;
    }

    const normalize = (lines: any[], startLine: number): string => {
      const commentRegex = /(^|\s)(\/\/|#|--).*$/g;

      const normalizedArray = lines
        .map((line: any) => {
          const relativeLine = line.line - startLine;

          let tmp = line.content.replaceAll(commentRegex, '$1');

          tmp = tmp
            .replaceAll(/\s+$/g, '')
            .replaceAll(/^\s+/g, '')
            .replaceAll(/\s{2,}/g, ' ');

          return {
            rel: relativeLine,
            content: tmp,
          };
        })
        .sort((a, b) => a.rel - b.rel);

      const concatenated = normalizedArray
        .map((item) => item.content)
        .join('\n');
      return concatenated;
    };

    const normA = normalize(vulnLinesA, vulnA.vulnerableStartLine);
    const normB = normalize(vulnLinesB, vulnB.vulnerableStartLine);

    return normA === normB;
  }

  /**
   * Add a vulnerability detection history.
   *
   * This is the sighting funnel for the four code families: every path that
   * creates or re-detects a SAST / IaC / CICD / secret row goes through it, so
   * it is also where `first_detected_at` / `last_detected_at` are maintained.
   *
   * @param detection - The vulnerability detection.
   * @param scanId - The scan ID.
   * @returns void
   */
  @Span()
  async addVulnerabilityDetectionHistory(
    detection:
      | SastVulnerabilityDetections
      | IacVulnerabilityDetections
      | CicdVulnerabilityDetections
      | SecretVulnerabilityDetections,
    scanId: string,
  ): Promise<void> {
    const detectedAt = new Date();
    const detectionHistory = new VulnerabilityDetectionHistory();
    detectionHistory.scanId = scanId;
    detectionHistory.detectedAt = detectedAt;

    if (detection instanceof SastVulnerabilityDetections) {
      detectionHistory.sastVulnerabilityDetection = detection;
    } else if (detection instanceof IacVulnerabilityDetections) {
      detectionHistory.iacVulnerabilityDetection = detection;
    } else if (detection instanceof CicdVulnerabilityDetections) {
      // Link the ingestion history to the CICD detection so finalize
      // can tell a still-present CICD finding from a disappeared one.
      detectionHistory.cicdVulnerabilityDetection = detection;
    } else if (detection instanceof SecretVulnerabilityDetections) {
      // Same for a secret: the row used to be written with no detection at
      // all, so no scan ever counted as having seen a secret again.
      detectionHistory.secretVulnerabilityDetection = detection;
    }

    await this.vulnDetectHistoryRepository.save(detectionHistory);

    await this.recordDetectionSighting(detection, detectedAt);
  }

  /**
   * Move the GRC sighting timestamps forward for one detection.
   *
   * Written with a narrow `update` rather than an entity `save` on purpose:
   * three of the four callers of {@link addVulnerabilityDetectionHistory}
   * persist the row BEFORE calling it, so an in-memory mutation alone would be
   * dropped — and a full re-save from here would push whatever else the caller
   * has staged on the entity, which is not this method's business.
   */
  private async recordDetectionSighting(
    detection:
      | SastVulnerabilityDetections
      | IacVulnerabilityDetections
      | CicdVulnerabilityDetections
      | SecretVulnerabilityDetections,
    detectedAt: Date,
  ): Promise<void> {
    const repository =
      detection instanceof SastVulnerabilityDetections
        ? this.sastVulnDetectRepository
        : detection instanceof IacVulnerabilityDetections
          ? this.iacVulnDetectRepository
          : detection instanceof CicdVulnerabilityDetections
            ? this.cicdVulnDetectRepository
            : detection instanceof SecretVulnerabilityDetections
              ? this.secretVulnDetectRepository
              : null;

    if (!repository || !detection.id) return;

    const before = {
      firstDetectedAt: detection.firstDetectedAt ?? null,
      lastDetectedAt: detection.lastDetectedAt ?? null,
    };
    applySightingToDetection(detection, detectedAt);

    if (
      before.firstDetectedAt === detection.firstDetectedAt &&
      before.lastDetectedAt === detection.lastDetectedAt
    ) {
      return;
    }

    await repository.update(detection.id, {
      firstDetectedAt: detection.firstDetectedAt,
      lastDetectedAt: detection.lastDetectedAt,
    } as any);
  }

  /**
   * Inserts a new SAST, IaC, CICD or secret detection. Returns false when a
   * concurrent writer already persisted this exact identity (the unique
   * `(projectId, branch, fingerprint)` refused the insert): losing that race
   * is a no-op, not an error. Inside a transaction the insert runs in a
   * savepoint, so the refused insert leaves the transaction usable on
   * PostgreSQL.
   */
  private async saveNewDetection(
    newVulnDetection:
      | SastVulnerabilityDetections
      | IacVulnerabilityDetections
      | CicdVulnerabilityDetections
      | SecretVulnerabilityDetections,
    context: { vulnType: string; path: string },
  ): Promise<boolean> {
    try {
      if (newVulnDetection instanceof SastVulnerabilityDetections) {
        const repository = this.sastVulnDetectRepository;
        await withinSavepoint(repository.manager, () =>
          repository.save(newVulnDetection),
        );
      } else if (newVulnDetection instanceof CicdVulnerabilityDetections) {
        const repository = this.cicdVulnDetectRepository;
        await withinSavepoint(repository.manager, () =>
          repository.save(newVulnDetection),
        );
      } else if (newVulnDetection instanceof SecretVulnerabilityDetections) {
        const repository = this.secretVulnDetectRepository;
        await withinSavepoint(repository.manager, () =>
          repository.save(newVulnDetection),
        );
      } else {
        const repository = this.iacVulnDetectRepository;
        await withinSavepoint(repository.manager, () =>
          repository.save(newVulnDetection),
        );
      }
    } catch (e: unknown) {
      if (!isUniqueViolation(e)) throw e;
      this.logger.warn(
        `DETECTION_RACE_LOST type=${context.vulnType} path=${context.path} ` +
          `digest=${newVulnDetection.fingerprint} — an identical identity ` +
          `was persisted concurrently; this insert is a no-op`,
      );
      return false;
    }
    return true;
  }

  /**
   * Add Code Snippet to the database.
   *
   * @param codeSnippet - The code snippet.
   * @returns The code snippet.
   */
  @Span()
  async addCodeSnippet(codeSnippet: CodeSnippet): Promise<CodeSnippet> {
    try {
      const repository = this.codeSnippetRepository;
      return await withinSavepoint(repository.manager, () =>
        repository.save(codeSnippet),
      );
    } catch (e: any) {
      // A scan batch is processed by several concurrent workers
      // (processVulnsWithConcurrency), the queue is multi-consumer, and BullMQ /
      // the MySQL driver can replay an INSERT whose ack was lost. Any of these
      // can race to persist the very same code_snippet row, which MySQL rejects
      // with ER_DUP_ENTRY ("Duplicate entry '<uuid>' for key
      // 'code_snippet.PRIMARY'"). The row already exists, so the insert is a
      // harmless no-op — swallow it instead of letting it bubble up and fail the
      // entire scan batch. Mirrors the ER_DUP_ENTRY handling in
      // osv-sync.service / sca.service. Inside a transaction the save ran in a
      // savepoint, so the transaction stays usable on PostgreSQL.
      if (isUniqueViolation(e)) {
        this.logger.debug(
          `[SastIac] code_snippet already exists (duplicate PK), skipping: ${
            codeSnippet.id ?? '(id unknown)'
          }`,
        );
        return codeSnippet;
      }
      throw e;
    }
  }

  /**
   * Add Data Flow Item to the database.
   *
   * @param dataFlowItem - The data flow item.
   * @returns The data flow item.
   */
  @Span()
  async addDataFlowItem(dataFlowItem: DataFlowItem): Promise<DataFlowItem> {
    return this.dataFlowItemRepository.save(dataFlowItem);
  }

  /**
   * Update SAS vulnerabilities in the database.
   *
   * @param vuln - The vulnerability to update.
   * @param dto - The update result request DTO.
   * @returns The updated vulnerability.
   */
  @Span()
  async handleUpdateSast(
    vuln: SastVulnerabilityDetections,
    dto: UpdateResultRequest,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    // Reject a reasonless dismissal BEFORE any mutation — a
    // half-applied dismissal would change the row and still tell the
    // caller it failed. See assertDismissalReason for why the gateway
    // DTO is not sufficient on its own.
    assertDismissalReason(dto);

    const oldStatus = vuln.currentState;
    const oldPriority = vuln.currentPriority;

    if (dto.status) {
      vuln.currentState = dto.status;
      // Freeze DECIDED states (confirmed/ignored/resolved) against
      // scan re-evaluation so an explicit user/agent decision survives re-scans.
      // `to_verify` is the undecided, scan-managed state (the modal offers it to
      // revert an accidental confirm/ignore): it records no decision to freeze.
      // Mirror the migration backfill, which only flags confirmed/ignored — and
      // clear the flag on revert.
      vuln.stateManuallyModified = dto.status !== 'to_verify';
    }

    if (dto.priority && dto.exploitabilitySource !== 'agent') {
      vuln.currentPriority = dto.priority;
      vuln.priorityManualOverride = true;
    }

    const nextScoringSource = this.resolveScoringSourceFromUpdate(dto);
    if (nextScoringSource) {
      vuln.scoringSource = nextScoringSource;
    }

    // ONE clock for the whole decision: the detection stamps below and every
    // history_item.date written further down share this instant, which is what
    // lets backfill-lifecycle.ts join a dismissal comment to its transition.
    const date = new Date();
    applyTriageToDetection(vuln, dto, date);

    await this.sastVulnDetectRepository.save(vuln);

    if (dto.status && dto.status !== oldStatus) {
      const historyItem = new HistoryItem();
      historyItem.type = 'status_change';
      historyItem.value = dto.status;
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.sastVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);
    }

    if (dto.priority && dto.priority !== oldPriority) {
      const historyItem = new HistoryItem();
      historyItem.type = 'priority_change';
      historyItem.value = dto.priority;
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.sastVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);
    }

    if (dto.comment) {
      const historyItem = new HistoryItem();
      historyItem.type = 'comment';
      historyItem.value = dto.comment;
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.sastVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);
    }

    // Persist exploitability fields from agent or manual assessment.
    // The score is derived deterministically from the verdict — agent-supplied
    // scores are intentionally ignored.
    if (dto.exploitabilityVerdict === 'not_evaluated') {
      // Manual reset: set the verdict back to NULL, then recompute the base priority.
      clearExploitabilityFields(vuln);
      vuln.exploitabilityUpdatedAt = new Date();

      const historyItem = new HistoryItem();
      historyItem.type = 'exploitability_change';
      historyItem.value = JSON.stringify({ cleared: true });
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.sastVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);

      const result = await this.resultService.recalculatePriority(
        vuln,
        dto.projectId,
        undefined,
        { forceRecompute: dto.exploitabilitySource === 'manual' },
      );
      if (result) {
        vuln.priorityScore = result.priorityScore;
      }
      if (result && result.priority !== oldPriority) {
        vuln.currentPriority = result.priority;
        const priorityHistoryItem = new HistoryItem();
        priorityHistoryItem.type = 'priority_change';
        priorityHistoryItem.value = result.priority;
        priorityHistoryItem.date = date;
        // Inherit the triggering actor instead of forcing the
        // 'system' sentinel. A human edit attributes this recompute-derived
        // row to the editor (source='dashboard_manual'), so it no longer
        // renders as the AI agent; a genuine agent analysis sends
        // userId='system', so it correctly stays system-attributed.
        priorityHistoryItem.userId = dto.userId;
        priorityHistoryItem.sastVulnerabilityDetection = vuln;
        applyAgentAuditFields(priorityHistoryItem, dto);
        await this.resultService.addHistoryItem(priorityHistoryItem);
      }
      await this.sastVulnDetectRepository.save(vuln);
    } else if (dto.exploitabilityVerdict) {
      const verdict = dto.exploitabilityVerdict;
      // Scored by the edition's exploitability scorer.
      const exploitability = this.resolveUpdateExploitability(dto, 'sast');
      const score = exploitability.score ?? VERDICT_TO_SCORE.theoretical;
      vuln.exploitabilityVerdict = verdict as any;
      vuln.exploitabilityScore = score;
      vuln.exploitabilityReason = dto.exploitabilityReason;
      vuln.exploitabilityScoreReason =
        dto.exploitabilityScoreReason ?? vuln.exploitabilityScoreReason;
      // A verdict with no explicit source must not be silently
      // attributed to the agent; default to the conservative 'manual'.
      vuln.exploitabilitySource = (dto.exploitabilitySource || 'manual') as any;
      vuln.exploitabilityUpdatedAt = new Date();
      // when an analyst sets a manual exploitability verdict
      // (typically through the chat HITL flow), freeze the priority label
      // so the EPSS/OSV/agent reanalyze paths cannot churn it. The findStale
      // query already filters on ``source='agent'`` so manual rows are not
      // picked up — this just makes the in-memory state self-consistent for
      // the recalculatePriority call below.
      if (dto.exploitabilitySource === 'manual') {
        vuln.priorityManualOverride = true;
      }

      const historyItem = new HistoryItem();
      historyItem.type = 'exploitability_change';
      historyItem.value = JSON.stringify({
        score,
        verdict,
        ...(exploitability.factors ? { factors: exploitability.factors } : {}),
      });
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.sastVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);

      const result = await this.resultService.recalculatePriority(
        vuln,
        dto.projectId,
        undefined,
        { forceRecompute: dto.exploitabilitySource === 'manual' },
      );
      if (result) {
        vuln.priorityScore = result.priorityScore;
      }
      if (result && result.priority !== oldPriority) {
        vuln.currentPriority = result.priority;
        const priorityHistoryItem = new HistoryItem();
        priorityHistoryItem.type = 'priority_change';
        priorityHistoryItem.value = result.priority;
        priorityHistoryItem.date = date;
        // Inherit the triggering actor instead of forcing the
        // 'system' sentinel. A human edit attributes this recompute-derived
        // row to the editor (source='dashboard_manual'), so it no longer
        // renders as the AI agent; a genuine agent analysis sends
        // userId='system', so it correctly stays system-attributed.
        priorityHistoryItem.userId = dto.userId;
        priorityHistoryItem.sastVulnerabilityDetection = vuln;
        applyAgentAuditFields(priorityHistoryItem, dto);
        await this.resultService.addHistoryItem(priorityHistoryItem);
      }
      await this.sastVulnDetectRepository.save(vuln);
    }

    await this.cyberiskEnqueuer.enqueue(dto.projectId, 'vuln_update');

    return this.sastIacService.getSastVulnerabilityByIdInProject({
      projectId: dto.projectId,
      vulnerabilityId: dto.vulnerabilityId,
    });
  }

  /**
   * Update IAC vulnerabilities in the database.
   *
   * @param vuln - The vulnerability to update.
   * @param dto - The update result request DTO.
   * @returns The updated vulnerability.
   */
  @Span()
  async handleUpdateIac(
    vuln: IacVulnerabilityDetections,
    dto: UpdateResultRequest,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    // Reject a reasonless dismissal BEFORE any mutation — a
    // half-applied dismissal would change the row and still tell the
    // caller it failed. See assertDismissalReason for why the gateway
    // DTO is not sufficient on its own.
    assertDismissalReason(dto);

    const oldStatus = vuln.currentState;
    const oldPriority = vuln.currentPriority;

    if (dto.status) {
      vuln.currentState = dto.status;
      // Freeze DECIDED states (confirmed/ignored/resolved) against
      // scan re-evaluation so an explicit user/agent decision survives re-scans.
      // `to_verify` is the undecided, scan-managed state (the modal offers it to
      // revert an accidental confirm/ignore): it records no decision to freeze.
      // Mirror the migration backfill, which only flags confirmed/ignored — and
      // clear the flag on revert.
      vuln.stateManuallyModified = dto.status !== 'to_verify';
    }

    if (dto.priority && dto.exploitabilitySource !== 'agent') {
      vuln.currentPriority = dto.priority;
      vuln.priorityManualOverride = true;
    }

    const nextScoringSource = this.resolveScoringSourceFromUpdate(dto);
    if (nextScoringSource) {
      vuln.scoringSource = nextScoringSource;
    }

    // ONE clock for the whole decision: the detection stamps below and every
    // history_item.date written further down share this instant, which is what
    // lets backfill-lifecycle.ts join a dismissal comment to its transition.
    const date = new Date();
    applyTriageToDetection(vuln, dto, date);

    await this.iacVulnDetectRepository.save(vuln);

    if (dto.status && dto.status !== oldStatus) {
      const historyItem = new HistoryItem();
      historyItem.type = 'status_change';
      historyItem.value = dto.status;
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.iacVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);
    }

    if (dto.priority && dto.priority !== oldPriority) {
      const historyItem = new HistoryItem();
      historyItem.type = 'priority_change';
      historyItem.value = dto.priority;
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.iacVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);
    }

    if (dto.comment) {
      const historyItem = new HistoryItem();
      historyItem.type = 'comment';
      historyItem.value = dto.comment;
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.iacVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);
    }

    // Persist exploitability fields from agent or manual assessment.
    // The score is derived deterministically from the verdict — agent-supplied
    // scores are intentionally ignored.
    if (dto.exploitabilityVerdict === 'not_evaluated') {
      // Manual reset: set the verdict back to NULL, then recompute the base priority.
      clearExploitabilityFields(vuln);
      vuln.exploitabilityUpdatedAt = new Date();

      const historyItem = new HistoryItem();
      historyItem.type = 'exploitability_change';
      historyItem.value = JSON.stringify({ cleared: true });
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.iacVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);

      const result = await this.resultService.recalculatePriority(
        vuln,
        dto.projectId,
        undefined,
        { forceRecompute: dto.exploitabilitySource === 'manual' },
      );
      if (result) {
        vuln.priorityScore = result.priorityScore;
      }
      if (result && result.priority !== oldPriority) {
        vuln.currentPriority = result.priority;
        const priorityHistoryItem = new HistoryItem();
        priorityHistoryItem.type = 'priority_change';
        priorityHistoryItem.value = result.priority;
        priorityHistoryItem.date = date;
        // Inherit the triggering actor (see handleUpdateSast).
        priorityHistoryItem.userId = dto.userId;
        priorityHistoryItem.iacVulnerabilityDetection = vuln;
        applyAgentAuditFields(priorityHistoryItem, dto);
        await this.resultService.addHistoryItem(priorityHistoryItem);
      }
      await this.iacVulnDetectRepository.save(vuln);
    } else if (dto.exploitabilityVerdict) {
      const verdict = dto.exploitabilityVerdict;
      // Scored by the edition's exploitability scorer.
      const exploitability = this.resolveUpdateExploitability(dto, 'iac');
      const score = exploitability.score ?? VERDICT_TO_SCORE.theoretical;
      vuln.exploitabilityVerdict = verdict as any;
      vuln.exploitabilityScore = score;
      vuln.exploitabilityReason = dto.exploitabilityReason;
      vuln.exploitabilityScoreReason =
        dto.exploitabilityScoreReason ?? vuln.exploitabilityScoreReason;
      // A verdict with no explicit source must not be silently
      // attributed to the agent; default to the conservative 'manual'.
      vuln.exploitabilitySource = (dto.exploitabilitySource || 'manual') as any;
      vuln.exploitabilityUpdatedAt = new Date();
      // when an analyst sets a manual exploitability verdict
      // (typically through the chat HITL flow), freeze the priority label
      // so the EPSS/OSV/agent reanalyze paths cannot churn it. The findStale
      // query already filters on ``source='agent'`` so manual rows are not
      // picked up — this just makes the in-memory state self-consistent for
      // the recalculatePriority call below.
      if (dto.exploitabilitySource === 'manual') {
        vuln.priorityManualOverride = true;
      }

      const historyItem = new HistoryItem();
      historyItem.type = 'exploitability_change';
      historyItem.value = JSON.stringify({
        score,
        verdict,
        ...(exploitability.factors ? { factors: exploitability.factors } : {}),
      });
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.iacVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);

      const result = await this.resultService.recalculatePriority(
        vuln,
        dto.projectId,
        undefined,
        { forceRecompute: dto.exploitabilitySource === 'manual' },
      );
      if (result) {
        vuln.priorityScore = result.priorityScore;
      }
      if (result && result.priority !== oldPriority) {
        vuln.currentPriority = result.priority;
        const priorityHistoryItem = new HistoryItem();
        priorityHistoryItem.type = 'priority_change';
        priorityHistoryItem.value = result.priority;
        priorityHistoryItem.date = date;
        // Inherit the triggering actor (see handleUpdateSast).
        priorityHistoryItem.userId = dto.userId;
        priorityHistoryItem.iacVulnerabilityDetection = vuln;
        applyAgentAuditFields(priorityHistoryItem, dto);
        await this.resultService.addHistoryItem(priorityHistoryItem);
      }
      await this.iacVulnDetectRepository.save(vuln);
    }

    await this.cyberiskEnqueuer.enqueue(dto.projectId, 'vuln_update');

    return this.sastIacService.getIacVulnerabilityByIdInProject({
      projectId: dto.projectId,
      vulnerabilityId: dto.vulnerabilityId,
    });
  }

  /**
   * Update CICD vulnerabilities in the database.
   *
   * @param vuln - The vulnerability to update.
   * @param dto - The update result request DTO.
   * @returns The updated vulnerability.
   */
  @Span()
  async handleUpdateCicd(
    vuln: CicdVulnerabilityDetections,
    dto: UpdateResultRequest,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    // Reject a reasonless dismissal BEFORE any mutation — a
    // half-applied dismissal would change the row and still tell the
    // caller it failed. See assertDismissalReason for why the gateway
    // DTO is not sufficient on its own.
    assertDismissalReason(dto);

    const oldStatus = vuln.currentState;
    const oldPriority = vuln.currentPriority;

    if (dto.status) {
      vuln.currentState = dto.status;
      // Freeze DECIDED states (confirmed/ignored/resolved) against
      // scan re-evaluation so an explicit user/agent decision survives re-scans.
      // `to_verify` is the undecided, scan-managed state (the modal offers it to
      // revert an accidental confirm/ignore): it records no decision to freeze.
      // Mirror the migration backfill, which only flags confirmed/ignored — and
      // clear the flag on revert.
      vuln.stateManuallyModified = dto.status !== 'to_verify';
    }

    if (dto.priority && dto.exploitabilitySource !== 'agent') {
      vuln.currentPriority = dto.priority;
      vuln.priorityManualOverride = true;
    }

    const nextScoringSource = this.resolveScoringSourceFromUpdate(dto);
    if (nextScoringSource) {
      vuln.scoringSource = nextScoringSource;
    }

    // ONE clock for the whole decision: the detection stamps below and every
    // history_item.date written further down share this instant, which is what
    // lets backfill-lifecycle.ts join a dismissal comment to its transition.
    const date = new Date();
    applyTriageToDetection(vuln, dto, date);

    await this.cicdVulnDetectRepository.save(vuln);

    if (dto.status && dto.status !== oldStatus) {
      const historyItem = new HistoryItem();
      historyItem.type = 'status_change';
      historyItem.value = dto.status;
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.cicdVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);
    }

    if (dto.priority && dto.priority !== oldPriority) {
      const historyItem = new HistoryItem();
      historyItem.type = 'priority_change';
      historyItem.value = dto.priority;
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.cicdVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);
    }

    if (dto.comment) {
      const historyItem = new HistoryItem();
      historyItem.type = 'comment';
      historyItem.value = dto.comment;
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.cicdVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);
    }

    // Persist exploitability fields from agent or manual assessment.
    // The score is derived deterministically from the verdict — agent-supplied
    // scores are intentionally ignored.
    if (dto.exploitabilityVerdict === 'not_evaluated') {
      // Manual reset: set the verdict back to NULL, then recompute the base priority.
      clearExploitabilityFields(vuln);
      vuln.exploitabilityUpdatedAt = new Date();

      const historyItem = new HistoryItem();
      historyItem.type = 'exploitability_change';
      historyItem.value = JSON.stringify({ cleared: true });
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.cicdVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);

      const result = await this.resultService.recalculatePriority(
        vuln,
        dto.projectId,
        undefined,
        { forceRecompute: dto.exploitabilitySource === 'manual' },
      );
      if (result) {
        vuln.priorityScore = result.priorityScore;
      }
      if (result && result.priority !== oldPriority) {
        vuln.currentPriority = result.priority;
        const priorityHistoryItem = new HistoryItem();
        priorityHistoryItem.type = 'priority_change';
        priorityHistoryItem.value = result.priority;
        priorityHistoryItem.date = date;
        // Inherit the triggering actor (see handleUpdateSast).
        priorityHistoryItem.userId = dto.userId;
        priorityHistoryItem.cicdVulnerabilityDetection = vuln;
        applyAgentAuditFields(priorityHistoryItem, dto);
        await this.resultService.addHistoryItem(priorityHistoryItem);
      }
      await this.cicdVulnDetectRepository.save(vuln);
    } else if (dto.exploitabilityVerdict) {
      const verdict = dto.exploitabilityVerdict;
      // Scored by the edition's exploitability scorer.
      const exploitability = this.resolveUpdateExploitability(dto, 'cicd');
      const score = exploitability.score ?? VERDICT_TO_SCORE.theoretical;
      vuln.exploitabilityVerdict = verdict as any;
      vuln.exploitabilityScore = score;
      vuln.exploitabilityReason = dto.exploitabilityReason;
      vuln.exploitabilityScoreReason =
        dto.exploitabilityScoreReason ?? vuln.exploitabilityScoreReason;
      // A verdict with no explicit source must not be silently
      // attributed to the agent; default to the conservative 'manual'.
      vuln.exploitabilitySource = (dto.exploitabilitySource || 'manual') as any;
      vuln.exploitabilityUpdatedAt = new Date();
      // when an analyst sets a manual exploitability verdict
      // (typically through the chat HITL flow), freeze the priority label
      // so the EPSS/OSV/agent reanalyze paths cannot churn it. The findStale
      // query already filters on ``source='agent'`` so manual rows are not
      // picked up — this just makes the in-memory state self-consistent for
      // the recalculatePriority call below.
      if (dto.exploitabilitySource === 'manual') {
        vuln.priorityManualOverride = true;
      }

      const historyItem = new HistoryItem();
      historyItem.type = 'exploitability_change';
      historyItem.value = JSON.stringify({
        score,
        verdict,
        ...(exploitability.factors ? { factors: exploitability.factors } : {}),
      });
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.cicdVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);

      const result = await this.resultService.recalculatePriority(
        vuln,
        dto.projectId,
        undefined,
        { forceRecompute: dto.exploitabilitySource === 'manual' },
      );
      if (result) {
        vuln.priorityScore = result.priorityScore;
      }
      if (result && result.priority !== oldPriority) {
        vuln.currentPriority = result.priority;
        const priorityHistoryItem = new HistoryItem();
        priorityHistoryItem.type = 'priority_change';
        priorityHistoryItem.value = result.priority;
        priorityHistoryItem.date = date;
        // Inherit the triggering actor (see handleUpdateSast).
        priorityHistoryItem.userId = dto.userId;
        priorityHistoryItem.cicdVulnerabilityDetection = vuln;
        applyAgentAuditFields(priorityHistoryItem, dto);
        await this.resultService.addHistoryItem(priorityHistoryItem);
      }
      await this.cicdVulnDetectRepository.save(vuln);
    }

    await this.cyberiskEnqueuer.enqueue(dto.projectId, 'vuln_update');

    return this.sastIacService.getCicdVulnerabilityByIdInProject({
      projectId: dto.projectId,
      vulnerabilityId: dto.vulnerabilityId,
    });
  }

  /**
   * Update Secret vulnerabilities in the database.
   *
   * @param vuln - The vulnerability to update.
   * @param dto - The update result request DTO.
   * @returns The updated vulnerability.
   */
  @Span()
  async handleUpdateSecret(
    vuln: SecretVulnerabilityDetections,
    dto: UpdateResultRequest,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    // Reject a reasonless dismissal BEFORE any mutation — a
    // half-applied dismissal would change the row and still tell the
    // caller it failed. See assertDismissalReason for why the gateway
    // DTO is not sufficient on its own.
    assertDismissalReason(dto);

    const oldStatus = vuln.currentState;
    const oldPriority = vuln.currentPriority;

    if (dto.status) vuln.currentState = dto.status;

    if (dto.priority && dto.exploitabilitySource !== 'agent') {
      vuln.currentPriority = dto.priority;
      vuln.priorityManualOverride = true;
    }

    const nextScoringSource = this.resolveScoringSourceFromUpdate(dto);
    if (nextScoringSource) {
      vuln.scoringSource = nextScoringSource;
    }

    // ONE clock for the whole decision: the detection stamps below and every
    // history_item.date written further down share this instant, which is what
    // lets backfill-lifecycle.ts join a dismissal comment to its transition.
    const date = new Date();
    applyTriageToDetection(vuln, dto, date);

    await this.secretVulnDetectRepository.save(vuln);

    if (dto.status && dto.status !== oldStatus) {
      const historyItem = new HistoryItem();
      historyItem.type = 'status_change';
      historyItem.value = dto.status;
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.secretVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);
    }

    if (dto.priority && dto.priority !== oldPriority) {
      const historyItem = new HistoryItem();
      historyItem.type = 'priority_change';
      historyItem.value = dto.priority;
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.secretVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);
    }

    if (dto.comment) {
      const historyItem = new HistoryItem();
      historyItem.type = 'comment';
      historyItem.value = dto.comment;
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.secretVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);
    }

    // Exploitability is not applicable to secrets — a hardcoded credential IS
    // the exploit — and their priority is deterministic (critical_urgent). A
    // secret update therefore never touches the exploitability columns nor runs
    // the multi-signal composite; dto.exploitabilityVerdict is ignored here
    // (the gateway does not expose exploitability for secrets). Only status,
    // a manual priority override, and comments apply (handled above).

    await this.cyberiskEnqueuer.enqueue(dto.projectId, 'vuln_update');

    return this.sastIacService.getSecretVulnerabilityByIdInProject({
      projectId: dto.projectId,
      vulnerabilityId: dto.vulnerabilityId,
    });
  }
}
