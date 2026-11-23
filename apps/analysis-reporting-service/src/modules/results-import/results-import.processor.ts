import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import type { ClientGrpc } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Job } from 'bullmq';
import { firstValueFrom, timeout } from 'rxjs';
import { ulid } from 'ulid';
import type {
  ContainerPackage,
  ContainerVulnerability,
  Library,
  Result as ContainerResult,
  RuleMetadata,
  ScanAddContainerResultRequest,
  ScanAddContainerResultResponse,
  ScanAddResultRequest,
  ScanAddResultResponse,
  VulnerabilityDtoRequest,
} from '@grpc/analysis-reporting/result';
import type { CompleteImportScanRequest } from '@grpc/security-scanning/scan';
import {
  SCAN_SERVICE_NAME,
  ScanServiceClient,
} from '@grpc/security-scanning/security_scanning';
import { QUEUE_NAMES } from '../scan-queue/queue-names';
import { isCommunityEdition } from '../../edition/edition';
import { getQueueConcurrency } from '../scan-queue/concurrency.config';
import {
  ResultsImportJobData,
  ScanQueueService,
} from '../scan-queue/scan-queue.service';
import { ScanCompleteNotificationService } from '../scan-queue/scan-complete-notification.service';
import { RealtimeBatchPublisher } from '../../core/realtime/realtime-batch-publisher.service';
import { CatalogueFallbackService } from './catalogue-fallback.service';
import {
  AdvisoryFallbackService,
  AdvisoryInput,
} from './advisory-fallback.service';
import { ImportFileSource } from './import-file.source';
import { ImportError, ImportErrorCode } from './sarif/import-limits';
import { forEachSarifResult, readSarifHeaders } from './sarif/sarif-stream';
import {
  ImportSeverity,
  MapOutcome,
  RuleIndex,
  buildRuleIndex,
  mapSarifResult,
  resolveRule,
  sanitizeToolName,
} from './sarif/sarif-mapper';
import type { SarifResult, SarifRunHeader } from './sarif/sarif.types';
import { resultKindOf, typeTakesKind } from './sarif/result-kind';
import {
  ParsedVulnerability,
  parseVulnerabilityResult,
} from './sarif/vulnerability-parser';
import { isLanguageEcosystem } from './sarif/ecosystems';
import { VulnerabilityOsvAffected } from '../../entities/osv/vulnerability-osv-affected.entity';
import type { VulnerabilityOsv } from '../../entities/osv/vulnerability-osv.entity';
import type { ScaMatchedItem, ScaScanMeta } from '../sca/sca.service';
import { SbomSkip, readCycloneDx } from './sbom/cyclonedx';
import { SbomPicture } from './sbom/sbom-picture';

/** The failure codes an import ends with (77 for anything else; never ''). */
export type ImportFailureCode = ImportErrorCode | 'IMPORT_INTERNAL_ERROR';

/** DTOs per ingestion batch. */
export const IMPORT_BATCH_SIZE = 500;

/**
 * Every severity is asked for: the catalogue severity decides. A
 * Community cluster scan's container asks for the project's own instead.
 */
const IMPORT_SEVERITY_CSV = 'critical,high,medium,low';

/**
 * The severities the batches ask for: the project's for a Community cluster
 * scan's container, else every one.
 */
const severitiesOf = (data: ResultsImportJobData): string =>
  data.severities ?? IMPORT_SEVERITY_CSV;

/**
 * CompleteImportScan names the container of a Community cluster scan, so
 * security-scanning closes that container instead of the whole scan.
 */
const containerOf = (
  data: ResultsImportJobData,
): Pick<CompleteImportScanRequest, 'containerId'> =>
  data.containerId !== undefined ? { containerId: data.containerId } : {};

/** Waits before each retry of a batch answered UNAVAILABLE. */
const BATCH_RETRY_DELAYS_MS = [2_000, 5_000, 10_000];
/** Waits before each retry of CompleteImportScan. */
const COMPLETE_RETRY_DELAYS_MS = [1_000, 5_000, 30_000];
/** Deadline of one CompleteImportScan call. */
const COMPLETE_TIMEOUT_MS = 15_000;
/** `container_detected_images.imageId` is a varchar(255). */
const MAX_IMAGE_ID = 255;
/** `CompleteImportScan.tool_name` is cut there (security-scanning keeps the commas). */
const MAX_TOOL_NAMES = 255;

type SkipReason = Extract<MapOutcome, { kind: 'skipped' }>['reason'];
const SKIP_REASONS: readonly SkipReason[] = [
  'suppressed',
  'not_a_failure',
  'no_rule_id',
  'no_location',
  'invalid_path',
  'kind_mismatch',
];

/** The part of SastIacService the import uses (token, as the SAST/IaC processor). */
type SastIacIngestion = {
  processSastIacBatch: (
    request: ScanAddResultRequest,
  ) => Promise<ScanAddResultResponse>;
  finalizeScan: (
    projectId: string,
    scanId: string,
    scannerName: string,
    onlyType?: 'sast' | 'iac' | 'cicd' | 'secret',
  ) => Promise<void>;
};

/** The part of ScaService the import uses (token, as the SCA processor). */
type ScaIngestion = {
  ingestMatched: (
    scanMeta: ScaScanMeta,
    items: ScaMatchedItem[],
  ) => Promise<string[]>;
  finalizeScan: (projectId: string, scanId: string) => Promise<void>;
};

/** The part of ContainerService the import uses (token, as the container processor). */
type ContainerIngestion = {
  processContainerBatch: (
    request: ScanAddContainerResultRequest,
    options?: { imageId?: string },
  ) => Promise<ScanAddContainerResultResponse>;
  finalizeScan: (projectId: string, scanId: string) => Promise<void>;
};

/** The two package import types: all-or-nothing, finalized per type. */
type PackageCategory = 'sca' | 'container';

const isPackageCategory = (category: string): category is PackageCategory =>
  category === 'sca' || category === 'container';

/** Why a package result is not imported (counted, never logged with the result). */
type PackageSkip = 'suppressed' | 'not_a_failure' | 'kind_mismatch';

interface RunContext {
  header: SarifRunHeader;
  rules: RuleIndex;
  toolName: string;
}

interface ImportSummary {
  tools: string[];
  mapped: number;
  skipped: Map<SkipReason, number>;
  /** Package imports: the results skipped by kind, per kind. */
  skippedKinds?: Map<string, number>;
  /** An sca import with a CycloneDX SBOM: its packages and its skips. */
  sbom?: { packages: number; skipped: Map<SbomSkip, number> };
}

/** The ingestion meta of an sca batch. */
const scaMetaOf = (data: ResultsImportJobData): ScaScanMeta => ({
  projectId: data.projectId,
  scanId: data.scanId,
  vulnerabilityType: severitiesOf(data),
});

const isUnavailable = (error: unknown): boolean => {
  if (error instanceof RpcException) {
    const inner = error.getError();
    return (
      typeof inner === 'object' &&
      inner !== null &&
      (inner as { code?: unknown }).code === status.UNAVAILABLE
    );
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === status.UNAVAILABLE
  );
};

/**
 * The SARIF import worker.
 *
 * Pass 1 reads the run headers and checks every limit before anything is
 * written. Pass 2 maps each result and sends the mapped ones per tool, in
 * batches of 500, through the scanners' own ingestion
 * (`processSastIacBatch`), after the catalogue fallback has made each rule
 * known. Then each tool is finalized once (all runs of a tool share one
 * finalization; a tool with no result sends one empty batch first, so its
 * old findings resolve), and the end of the scan is dispatched ONCE, after
 * the last tool: the import scan has no container, so each
 * `onScannerFinalized` would end the scan at the first tool. Last, the scan
 * is ended on security-scanning with CompleteImportScan.
 *
 * A Community cluster scan's job reads one scanner container's file: the
 * category is that container's (so trivy fs finalizes as sca and trivy config
 * as iac, though both write the tool `trivy`), the batches ask for the job's
 * severities, and CompleteImportScan carries `containerId`, which closes that
 * container rather than the scan. The scan end then waits for every
 * container (ScanCompleteNotificationService counts them by image).
 *
 * Nothing of the file (paths, rule ids or texts, snippets) and neither the
 * object key nor a signed URL is ever logged; failures are logged by code.
 */
@Processor(QUEUE_NAMES.RESULTS_IMPORT, {
  concurrency: getQueueConcurrency('RESULTS_IMPORT'),
  lockDuration: 300000,
  lockRenewTime: 60000,
})
export class ResultsImportProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ResultsImportProcessor.name);
  private scanClient: ScanServiceClient;

  /** The wait between two attempts (replaced by the specs). */
  delay: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  constructor(
    @Inject('SAST_IAC_SERVICE')
    private readonly sastIacService: SastIacIngestion,
    private readonly scanQueue: ScanQueueService,
    private readonly scanCompleteNotificationService: ScanCompleteNotificationService,
    private readonly realtimeBatch: RealtimeBatchPublisher,
    private readonly fallback: CatalogueFallbackService,
    private readonly files: ImportFileSource,
    @Inject('SECURITY_SCANNING_SERVICE')
    private readonly ssClient: ClientGrpc,
    @Inject('SCA_SERVICE')
    private readonly scaService: ScaIngestion,
    @Inject('CONTAINER_SERVICE')
    private readonly containerService: ContainerIngestion,
    private readonly advisories: AdvisoryFallbackService,
  ) {
    super();
  }

  onModuleInit(): void {
    this.scanClient =
      this.ssClient.getService<ScanServiceClient>(SCAN_SERVICE_NAME);
  }

  async process(job: Job<ResultsImportJobData>): Promise<void> {
    const { scanId } = job.data;
    const container =
      job.data.containerId !== undefined
        ? ` container=${job.data.containerId}`
        : '';
    let completion: CompleteImportScanRequest;
    try {
      // SARIF import is Community-only: ImportResults
      // refuses it elsewhere, and a job queued before a configuration change
      // or by any other path reads nothing and writes nothing either. The
      // scan is ended failed, as for any refused file.
      if (!isCommunityEdition()) {
        throw new ImportError(
          'IMPORT_TYPE_NOT_AVAILABLE',
          'SARIF import is a Community Edition feature',
        );
      }
      if (job.data.sbomFileKey !== undefined && job.data.category !== 'sca') {
        // ImportResults refuses it first: nothing is read or written.
        throw new ImportError(
          'IMPORT_INVALID_SBOM',
          'an SBOM goes with an sca import only',
        );
      }
      const summary = isPackageCategory(job.data.category)
        ? await this.importPackages(job.data, job.data.category)
        : await this.importFile(job.data);
      const skipped = [
        ...SKIP_REASONS.map(
          (reason) => `skipped_${reason}=${summary.skipped.get(reason) ?? 0}`,
        ),
        ...[...(summary.skippedKinds ?? new Map<string, number>())].map(
          ([kind, count]) => `skipped_kind_${kind}=${count}`,
        ),
        ...(summary.sbom
          ? [
              `sbom_packages=${summary.sbom.packages}`,
              ...[...summary.sbom.skipped].map(
                ([reason, count]) => `sbom_skipped_${reason}=${count}`,
              ),
            ]
          : []),
      ].join(' ');
      this.logger.log(
        `RESULTS_IMPORT_DONE scan=${scanId}${container} tools=${summary.tools.join(',')} mapped=${summary.mapped} ${skipped}`,
      );
      completion = {
        scanId,
        status: 'completed',
        errorCode: '',
        findingsCount: summary.mapped,
        toolName: summary.tools.join(',').slice(0, MAX_TOOL_NAMES),
        ...containerOf(job.data),
      };
    } catch (error) {
      const code: ImportFailureCode =
        error instanceof ImportError ? error.code : 'IMPORT_INTERNAL_ERROR';
      // The code and the error's class only: an error's text can quote the
      // file (a path, a rule) or a URL.
      this.logger.warn(
        `RESULTS_IMPORT_FAILED scan=${scanId}${container} code=${code} error=${error instanceof Error ? error.name : typeof error}`,
      );
      completion = {
        scanId,
        status: 'failed',
        errorCode: code,
        findingsCount: 0,
        toolName: '',
        ...containerOf(job.data),
      };
    }
    await this.complete(completion);
  }

  private async importFile(data: ResultsImportJobData): Promise<ImportSummary> {
    const { scanId, projectId, category, fileKey } = data;
    const source = this.files.open(projectId, fileKey);

    // Pass 1: every limit is checked here, before any write.
    const headers = await readSarifHeaders(source);
    const runs = new Map<number, RunContext>();
    const tools: string[] = [];
    for (const header of headers) {
      const toolName = sanitizeToolName(header.tool?.driver?.name);
      runs.set(header.index, {
        header,
        rules: buildRuleIndex(header.tool ?? { driver: {} }),
        toolName,
      });
      if (!tools.includes(toolName)) tools.push(toolName);
    }

    await this.scanQueue.registerScanQueueType(scanId, 'sast-iac');

    // Pass 2: map, buffer per tool, flush every 500.
    const buffers = new Map<string, VulnerabilityDtoRequest[]>(
      tools.map((tool) => [tool, []]),
    );
    const sentOnce = new Set<string>();
    const firstSeverity = new Map<string, ImportSeverity>();
    const skipped = new Map<SkipReason, number>();
    const kindSkips = new Map<
      string,
      { tool: string; kind: string; count: number }
    >();
    let mapped = 0;

    await forEachSarifResult(source, async (runIndex, result) => {
      const run = runs.get(runIndex);
      if (!run) return;
      const outcome = mapSarifResult(
        result,
        run.header,
        run.rules,
        run.toolName,
        category,
      );
      if (outcome.kind === 'skipped') {
        skipped.set(outcome.reason, (skipped.get(outcome.reason) ?? 0) + 1);
        if (outcome.reason === 'kind_mismatch') {
          const key = `${runIndex}\u0000${outcome.resultKind}`;
          const entry = kindSkips.get(key) ?? {
            tool: run.toolName,
            kind: outcome.resultKind,
            count: 0,
          };
          entry.count += 1;
          kindSkips.set(key, entry);
        }
        return;
      }

      const dto = outcome.dto;
      // A rule's catalogue severity is its FIRST result's, in this tool.
      const ruleKey = `${run.toolName}\u0000${dto.ruleId}`;
      let severity = firstSeverity.get(ruleKey);
      if (severity === undefined) {
        severity = dto.severity as ImportSeverity;
        firstSeverity.set(ruleKey, severity);
      }
      if (dto.ruleMetadata) {
        dto.ruleMetadata = { ...dto.ruleMetadata, severity };
      }
      mapped += 1;

      const buffer = buffers.get(run.toolName);
      buffer.push(dto);
      if (buffer.length >= IMPORT_BATCH_SIZE) {
        buffers.set(run.toolName, []);
        await this.sendBatch(data, run.toolName, buffer);
        sentOnce.add(run.toolName);
      }
    });

    for (const { tool, kind, count } of kindSkips.values()) {
      this.logger.log(
        `IMPORT_SKIPPED scan=${scanId} tool=${tool} kind=${kind} count=${count}`,
      );
    }

    // The rest of every buffer; one empty batch for a tool with no result.
    for (const tool of tools) {
      const buffer = buffers.get(tool);
      if (buffer.length > 0 || !sentOnce.has(tool)) {
        buffers.set(tool, []);
        await this.sendBatch(data, tool, buffer);
      }
    }

    // One finalization per tool, then the end of the scan once.
    for (const tool of tools) {
      await this.finalizeTool(data, tool);
    }
    if (tools.length > 0) {
      await this.scanCompleteNotificationService.onScannerFinalized(
        scanId,
        data.projectId,
        'sast-iac',
        tools[tools.length - 1],
      );
    }

    return { tools, mapped, skipped };
  }

  /** Pass 1 of every import: the headers, each run's tool and rule index. */
  private async readRuns(data: ResultsImportJobData): Promise<{
    headers: SarifRunHeader[];
    runs: Map<number, RunContext>;
    tools: string[];
  }> {
    const source = this.files.open(data.projectId, data.fileKey);
    const headers = await readSarifHeaders(source);
    const runs = new Map<number, RunContext>();
    const tools: string[] = [];
    for (const header of headers) {
      const toolName = sanitizeToolName(header.tool?.driver?.name);
      runs.set(header.index, {
        header,
        rules: buildRuleIndex(header.tool ?? { driver: {} }),
        toolName,
      });
      if (!tools.includes(toolName)) tools.push(toolName);
    }
    // A file with no run is the single tool `sarif`, so it still finalizes.
    if (tools.length === 0) tools.push(sanitizeToolName(undefined));
    return { headers, runs, tools };
  }

  /**
   * One package result: skipped (with why), unparsable, or parsed. The kind
   * check comes right after the rule lookup, as in mapSarifResult.
   */
  private classifyPackageResult(
    run: RunContext,
    result: SarifResult,
    category: PackageCategory,
  ):
    | { kind: 'skipped'; reason: PackageSkip; resultKind?: string }
    | { kind: 'unparsable'; reason: string }
    | { kind: 'parsed'; item: ParsedVulnerability } {
    const { rule, ruleId } = resolveRule(result, run.rules);
    const resultKind = resultKindOf(run.toolName, rule);
    if (resultKind !== null && !typeTakesKind(category, resultKind)) {
      return { kind: 'skipped', reason: 'kind_mismatch', resultKind };
    }
    if (
      result.suppressions?.some(
        (suppression) =>
          suppression.status === undefined || suppression.status === 'accepted',
      )
    ) {
      return { kind: 'skipped', reason: 'suppressed' };
    }
    if (result.kind !== undefined && result.kind !== 'fail') {
      return { kind: 'skipped', reason: 'not_a_failure' };
    }
    const parsed = parseVulnerabilityResult(
      result,
      rule,
      ruleId,
      run.header,
      run.toolName,
    );
    if (parsed.kind === 'unparsable') {
      return { kind: 'unparsable', reason: parsed.reason };
    }
    return { kind: 'parsed', item: parsed.item };
  }

  /**
   * The `sca` and `container` imports. All-or-nothing: pass A parses
   * every result and writes nothing, so one unparsable result fails the scan
   * with IMPORT_UNSUPPORTED_RESULT before any advisory, package or
   * finalization. Pass B ensures the advisories of each batch, then ingests
   * it (SCA through ingestMatched, containers through processContainerBatch,
   * both without matching). Then each tool is finalized with the import's
   * own queue type, and the scan end is dispatched once, after the last.
   *
   * The source is opened three times: headers, pass A, pass B.
   *
   * An `sca` import may come with a CycloneDX SBOM (`sbomFileKey`): read and
   * checked in pass A too, so a bad SBOM writes nothing. Its packages and the
   * SARIF's vulnerabilities are one picture of the branch: a vulnerable
   * package takes the SBOM's licenses, placement and path, the packages only
   * the SBOM names are ingested without advisories, then the one
   * finalization keeps them all.
   */
  private async importPackages(
    data: ResultsImportJobData,
    category: PackageCategory,
  ): Promise<ImportSummary> {
    const { scanId, projectId } = data;
    const { headers, runs, tools } = await this.readRuns(data);

    await this.scanQueue.registerScanQueueType(scanId, category);

    // Pass A: validation, nothing written.
    const skipped = new Map<SkipReason, number>();
    const kindSkips = new Map<
      string,
      { tool: string; kind: string; count: number }
    >();
    await forEachSarifResult(
      this.files.open(projectId, data.fileKey),
      async (runIndex, result) => {
        const run = runs.get(runIndex);
        if (!run) return;
        const outcome = this.classifyPackageResult(run, result, category);
        if (outcome.kind === 'unparsable') {
          throw new ImportError(
            'IMPORT_UNSUPPORTED_RESULT',
            `a vulnerability result cannot be read (${outcome.reason})`,
          );
        }
        if (outcome.kind !== 'skipped') return;
        skipped.set(outcome.reason, (skipped.get(outcome.reason) ?? 0) + 1);
        if (outcome.reason === 'kind_mismatch') {
          const key = `${runIndex}\u0000${outcome.resultKind}`;
          const entry = kindSkips.get(key) ?? {
            tool: run.toolName,
            kind: outcome.resultKind,
            count: 0,
          };
          entry.count += 1;
          kindSkips.set(key, entry);
        }
      },
    );
    const skippedKinds = new Map<string, number>();
    for (const { tool, kind, count } of kindSkips.values()) {
      this.logger.log(
        `IMPORT_SKIPPED scan=${scanId} tool=${tool} kind=${kind} count=${count}`,
      );
      skippedKinds.set(kind, (skippedKinds.get(kind) ?? 0) + count);
    }

    // Still pass A: the SBOM is read whole and checked before any write, so a
    // bad SBOM fails the scan with nothing ensured, ingested or resolved.
    const sbomInventory =
      data.sbomFileKey !== undefined
        ? await readCycloneDx(this.files.open(projectId, data.sbomFileKey))
        : null;
    const sbom = sbomInventory ? new SbomPicture(sbomInventory.packages) : null;

    // Pass B: the same filter; each parsed item into its tool's buffer.
    // The run's imageID (Trivy), else the image reference of the request;
    // `container_detected_images.imageId` is a varchar(255).
    const imageId =
      headers.find(
        (header) => header.imageId && header.imageId.length <= MAX_IMAGE_ID,
      )?.imageId ??
      data.image ??
      '';
    const buffers = new Map<string, ParsedVulnerability[]>(
      tools.map((tool) => [tool, []]),
    );
    const sentOnce = new Set<string>();
    const chunk = { next: 1 };
    let mapped = 0;
    const flush = async (
      tool: string,
      items: ParsedVulnerability[],
    ): Promise<void> => {
      await this.sendPackageBatch(
        data,
        category,
        tool,
        items,
        imageId,
        chunk,
        sbom,
      );
      sentOnce.add(tool);
    };

    await forEachSarifResult(
      this.files.open(projectId, data.fileKey),
      async (runIndex, result) => {
        const run = runs.get(runIndex);
        if (!run) return;
        const outcome = this.classifyPackageResult(run, result, category);
        if (outcome.kind === 'unparsable') {
          // pass A read the same bytes: only a changed object gets here
          throw new ImportError(
            'IMPORT_UNSUPPORTED_RESULT',
            `a vulnerability result cannot be read (${outcome.reason})`,
          );
        }
        if (outcome.kind !== 'parsed') return;
        mapped += 1;
        const buffer = buffers.get(run.toolName);
        buffer.push(outcome.item);
        if (buffer.length >= IMPORT_BATCH_SIZE) {
          buffers.set(run.toolName, []);
          await flush(run.toolName, buffer);
        }
      },
    );

    // The rest of every buffer. A container tool that sent nothing sends one
    // empty batch, so the image is marked with this scan and finalize
    // resolves its old packages; an SCA tool's finalize resolves the branch's
    // packages without one.
    for (const tool of tools) {
      const buffer = buffers.get(tool);
      buffers.set(tool, []);
      if (buffer.length > 0) await flush(tool, buffer);
      else if (category === 'container' && !sentOnce.has(tool)) {
        await flush(tool, buffer);
      }
    }

    // The packages only the SBOM names: no advisory, so no detection, and
    // marked with this scan, so finalize keeps them.
    if (sbom) {
      const rest = sbom.remaining();
      for (let i = 0; i < rest.length; i += IMPORT_BATCH_SIZE) {
        const batch: ScaMatchedItem[] = rest
          .slice(i, i + IMPORT_BATCH_SIZE)
          .map((library) => ({ library, affected: [] }));
        await this.withRetry(scanId, 'sbom', () =>
          this.scaService.ingestMatched(scaMetaOf(data), batch),
        );
      }
    }

    for (const tool of tools) {
      await this.finalizePackageTool(data, category, tool);
    }
    await this.scanCompleteNotificationService.onScannerFinalized(
      scanId,
      projectId,
      category,
      tools[tools.length - 1],
    );

    return {
      tools,
      mapped,
      skipped,
      skippedKinds,
      ...(sbomInventory
        ? {
            sbom: {
              packages: sbomInventory.packages.length,
              skipped: sbomInventory.skipped,
            },
          }
        : {}),
    };
  }

  /** ensureAdvisories for the batch, then its SCA or container ingestion. */
  private async sendPackageBatch(
    data: ResultsImportJobData,
    category: PackageCategory,
    tool: string,
    items: ParsedVulnerability[],
    imageId: string,
    chunk: { next: number },
    sbom: SbomPicture | null,
  ): Promise<void> {
    const advisories =
      items.length > 0
        ? await this.advisories.ensureAdvisories(
            items.map((item) => advisoryInputOf(item, tool)),
          )
        : new Map<string, VulnerabilityOsv>();

    if (category === 'sca') {
      const matched = scaItemsOf(items, advisories).map((item) =>
        sbom ? { ...item, library: sbom.complete(item.library) } : item,
      );
      await this.withRetry(data.scanId, tool, () =>
        this.scaService.ingestMatched(scaMetaOf(data), matched),
      );
      return;
    }

    const request: ScanAddContainerResultRequest = {
      projectId: data.projectId,
      scanId: data.scanId,
      scannerName: tool,
      startedAt: '',
      finishedAt: '',
      chunk: { index: chunk.next, isLast: false },
      os: { family: '', name: '', eosl: false },
      imageName: data.image ?? '',
      results: containerResultsOf(items),
    };
    chunk.next += 1;
    await this.withRetry(data.scanId, tool, () =>
      this.containerService.processContainerBatch(request, { imageId }),
    );
  }

  /** A call answered UNAVAILABLE is retried 2 s, 5 s, 10 s. */
  private async withRetry(
    scanId: string,
    tool: string,
    call: () => Promise<unknown>,
  ): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await call();
        return;
      } catch (error) {
        if (!isUnavailable(error) || attempt >= BATCH_RETRY_DELAYS_MS.length) {
          throw error;
        }
        this.logger.warn(
          `RESULTS_IMPORT_BATCH_RETRY scan=${scanId} tool=${tool} attempt=${attempt + 1}`,
        );
        await this.delay(BATCH_RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  /**
   * The SCA or container processor's finalize sequence, without its
   * `onScannerFinalized` (dispatched once, after the last tool).
   */
  private async finalizePackageTool(
    data: ResultsImportJobData,
    category: PackageCategory,
    tool: string,
  ): Promise<void> {
    const { scanId, projectId } = data;
    if (
      !(await this.scanQueue.tryAcquireFinalizeLock(category, scanId, tool))
    ) {
      this.logger.warn(
        `RESULTS_IMPORT_FINALIZE_LOCK_HELD scan=${scanId} tool=${tool}`,
      );
      return;
    }
    try {
      if (category === 'sca') {
        await this.scaService.finalizeScan(projectId, scanId);
      } else {
        await this.containerService.finalizeScan(projectId, scanId);
      }
      this.realtimeBatch.publishNow(
        `vuln:${projectId}:${scanId}:${category}`,
        this.batchAppendedEnvelope(scanId, projectId, category),
      );
      await this.scanQueue.clearBatchTracking(category, scanId, tool);
    } catch (error) {
      try {
        await this.scanQueue.releaseFinalizeLock(category, scanId, tool);
      } catch {
        this.logger.error(
          `RESULTS_IMPORT_LOCK_RELEASE_FAILED scan=${scanId} tool=${tool}`,
        );
      }
      throw error;
    }
  }

  /** The catalogue rules of the batch's distinct rules, then the ingestion. */
  private async sendBatch(
    data: ResultsImportJobData,
    tool: string,
    vulnerabilities: VulnerabilityDtoRequest[],
  ): Promise<void> {
    if (vulnerabilities.length > 0) {
      const byRuleId = new Map<string, RuleMetadata>();
      for (const dto of vulnerabilities) {
        if (dto.ruleMetadata && !byRuleId.has(dto.ruleMetadata.ruleId)) {
          byRuleId.set(dto.ruleMetadata.ruleId, dto.ruleMetadata);
        }
      }
      // Each finding is ingested under its catalogue rule id: the
      // organisation's own key for a rule outside the shipped catalogue,
      // so no organisation sees the wording another one imported.
      const catalogueIds = await this.fallback.catalogueRuleIds(
        tool,
        data.category,
        [...byRuleId.values()],
        data.organizationId || data.projectId,
      );
      vulnerabilities = vulnerabilities.map((dto) => {
        const ruleId = catalogueIds.get(dto.ruleId) ?? dto.ruleId;
        return ruleId === dto.ruleId ? dto : { ...dto, ruleId };
      });
    }

    const request: ScanAddResultRequest = {
      projectId: data.projectId,
      scanId: data.scanId,
      scannerName: tool,
      vulnerabilityType: severitiesOf(data),
      vulnerabilities,
      isLastRequest: false,
      ignoredPaths: [],
      runningDockerImage: 'sarif-import',
      runningDockerImageVersion: '',
      startedAt: '',
      finishedAt: '',
    };

    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.sastIacService.processSastIacBatch(request);
        return;
      } catch (error) {
        if (!isUnavailable(error) || attempt >= BATCH_RETRY_DELAYS_MS.length) {
          throw error;
        }
        this.logger.warn(
          `RESULTS_IMPORT_BATCH_RETRY scan=${data.scanId} tool=${tool} attempt=${attempt + 1}`,
        );
        await this.delay(BATCH_RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  /**
   * The SAST/IaC processor's finalize sequence, without its
   * `onScannerFinalized` (dispatched once, after the last tool).
   */
  private async finalizeTool(
    data: ResultsImportJobData,
    tool: string,
  ): Promise<void> {
    const { scanId, projectId } = data;
    if (
      !(await this.scanQueue.tryAcquireFinalizeLock('sast-iac', scanId, tool))
    ) {
      this.logger.warn(
        `RESULTS_IMPORT_FINALIZE_LOCK_HELD scan=${scanId} tool=${tool}`,
      );
      return;
    }
    try {
      // Only the import's own type: another import of the same tool (a Trivy
      // file holds IaC findings and secrets) keeps its findings.
      await this.sastIacService.finalizeScan(
        projectId,
        scanId,
        tool,
        data.category as 'sast' | 'iac' | 'cicd' | 'secret',
      );
      this.realtimeBatch.publishNow(
        `vuln:${projectId}:${scanId}:sast`,
        this.batchAppendedEnvelope(scanId, projectId, 'sast'),
      );
      await this.scanQueue.clearBatchTracking('sast-iac', scanId, tool);
    } catch (error) {
      try {
        await this.scanQueue.releaseFinalizeLock('sast-iac', scanId, tool);
      } catch {
        this.logger.error(
          `RESULTS_IMPORT_LOCK_RELEASE_FAILED scan=${scanId} tool=${tool}`,
        );
      }
      throw error;
    }
  }

  /** CompleteImportScan, retried 1 s, 5 s, 30 s; then one ERROR line. */
  private async complete(request: CompleteImportScanRequest): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await firstValueFrom(
          this.scanClient
            .completeImportScan(request)
            .pipe(timeout(COMPLETE_TIMEOUT_MS)),
        );
        return;
      } catch {
        if (attempt >= COMPLETE_RETRY_DELAYS_MS.length) {
          // security-scanning's watchdog then fails the scan (IMPORT_TIMEOUT).
          this.logger.error(
            `RESULTS_IMPORT_COMPLETE_FAILED scan=${request.scanId} code=${request.errorCode || request.status}`,
          );
          return;
        }
        await this.delay(COMPLETE_RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  /**
   * The envelope the SAST/IaC, SCA or container queue processor publishes
   * after a finalization.
   */
  private batchAppendedEnvelope(
    scanId: string,
    projectId: string,
    scannerType: 'sast' | PackageCategory,
  ) {
    return {
      eventId: ulid(),
      type: 'VULNERABILITY_BATCH_APPENDED',
      scope: { projectId },
      payload: {
        vulnerabilityBatchAppended: {
          scanId,
          scannerType,
          addedCount: 0,
          sampleVulnerabilityIds: [],
        },
      },
    };
  }
}

/** One AdvisoryInput per item; fixes = fixed versions × (ecosystem, package). */
function advisoryInputOf(
  item: ParsedVulnerability,
  toolName: string,
): AdvisoryInput {
  return {
    id: item.advisoryId,
    toolName,
    summary: item.advisory.summary,
    details: item.advisory.details,
    cweIds: item.advisory.cweIds,
    severity: item.severity,
    cvssV3Vector: item.advisory.cvssV3Vector,
    helpUri: item.advisory.helpUri,
    aliases: item.aliases,
    fixes: item.fixedVersions.map((fixed) => ({
      ecosystem: item.ecosystem,
      packageName: item.packageName,
      fixed,
    })),
  };
}

/**
 * The SCA items of a batch, grouped by `lower(trim(name))@version` (the
 * package key of processScaBatch), each with one in-memory affected row per
 * item: a complete match for batchHandleVulnerabilities (I-13).
 */
function scaItemsOf(
  items: ParsedVulnerability[],
  advisories: Map<string, VulnerabilityOsv>,
): ScaMatchedItem[] {
  const groups = new Map<string, ScaMatchedItem>();
  for (const item of items) {
    const key = `${item.packageName.toLowerCase().trim()}@${item.installedVersion}`;
    let group = groups.get(key);
    if (!group) {
      const library: Library = {
        name: item.packageName,
        version: item.installedVersion,
        file: item.target,
        ecosystem: item.ecosystem,
        isTransitive: false,
        isDev: false,
        path: [],
        dependencyInfoAvailable: false,
        importLocations: [],
        licenses: [],
      };
      group = { library, affected: [] };
      groups.set(key, group);
    }
    const vulnerability = advisories.get(item.advisoryId);
    if (!vulnerability) continue;
    group.affected.push(
      Object.assign(new VulnerabilityOsvAffected(), {
        ecosystem: item.ecosystem,
        packageName: item.packageName,
        severity: null,
        vulnerability,
      }),
    );
  }
  return [...groups.values()];
}

/**
 * The container results of a batch: one Result per (target, class), one
 * package per (name, version), one vulnerability per item.
 */
function containerResultsOf(items: ParsedVulnerability[]): ContainerResult[] {
  const results = new Map<
    string,
    { result: ContainerResult; packages: Set<string> }
  >();
  for (const item of items) {
    const cls = isLanguageEcosystem(item.ecosystem) ? 'lang-pkgs' : 'os-pkgs';
    const type = item.ecosystem.toLowerCase();
    const key = `${item.target}\u0000${cls}`;
    let entry = results.get(key);
    if (!entry) {
      entry = {
        result: {
          target: item.target,
          class: cls,
          type,
          packages: [],
          vulnerabilities: [],
        },
        packages: new Set<string>(),
      };
      results.set(key, entry);
    }
    const packageKey = `${item.packageName}\u0000${item.installedVersion}`;
    if (!entry.packages.has(packageKey)) {
      entry.packages.add(packageKey);
      const pkg: ContainerPackage = {
        id: '',
        name: item.packageName,
        version: item.installedVersion,
        arch: '',
        srcName: '',
        srcVersion: '',
        digest: '',
        licenses: [],
        dependsOn: [],
        fullVersion: '',
        srcFullVersion: '',
      };
      entry.result.packages.push(pkg);
    }
    const { cvssV3Vector, cvssScore, helpUri } = item.advisory;
    const vulnerability: ContainerVulnerability = {
      vulnerabilityId: item.advisoryId,
      pkgName: item.packageName,
      installedVersion: item.installedVersion,
      fixedVersion: item.fixedVersions.join(', '),
      severity: item.severity.toUpperCase(),
      title: item.advisory.summary,
      description: item.advisory.details,
      primaryUrl: helpUri,
      publishedDate: '',
      lastModifiedDate: '',
      layerDigest: '',
      target: item.target,
      class: cls,
      type,
      cweIds: item.advisory.cweIds,
      dataSource: undefined,
      cvss:
        cvssV3Vector || cvssScore
          ? {
              sarif: {
                v2Vector: '',
                v3Vector: cvssV3Vector ?? '',
                v2Score: 0,
                v3Score: cvssScore ?? 0,
              },
            }
          : {},
      references: helpUri ? [helpUri] : [],
      internalId: '',
    };
    entry.result.vulnerabilities.push(vulnerability);
  }
  return [...results.values()].map((entry) => entry.result);
}
