import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  ImportResultsRequest,
  ImportResultsResponse,
} from '@grpc/analysis-reporting/result';
import { ScanQueueService } from '../scan-queue/scan-queue.service';
import { currentEdition } from '../../edition/edition';
import type { ImportCategory } from './catalogue-fallback.service';

/** The six import types. */
const IMPORT_TYPES: readonly ImportCategory[] = [
  'sast',
  'iac',
  'secret',
  'cicd',
  'sca',
  'container',
];

/** `container_detected_images.artifactName` is a varchar(255). */
const MAX_IMAGE = 255;

/** A scanner container's id: the UUID security-scanning gave it. */
const CONTAINER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The severities a project keeps (`ImportResultsRequest.severities`). */
const SEVERITIES: readonly string[] = ['critical', 'high', 'medium', 'low'];

/** Each element one of SEVERITIES, comma-joined, nothing else. */
const isSeverityList = (value: string): boolean =>
  value.split(',').every((severity) => SEVERITIES.includes(severity));

const refused = (message: string): RpcException =>
  new RpcException({ code: status.INVALID_ARGUMENT, message });

const invalid = (): RpcException => refused('IMPORT_INVALID_REQUEST');

/**
 * ImportResults: security-
 * scanning hands an import scan's file over; the answer comes once the job
 * `results-import-<scanId>` is queued. A repeated call answers accepted and
 * queues nothing (BullMQ keeps one job per jobId).
 *
 * A Community cluster scan hands over one file per scanner container: with
 * `containerId`, the key is `import/<p>/<s>/<containerId>.sarif`, the job
 * `results-import-<scanId>-<containerId>`, and `severities` (the project's)
 * replaces the import's « every severity ». The category is the request's
 * type either way: it decides how the file is finalized (trivy config and
 * trivy fs both write the tool `trivy`, as iac and as sca).
 *
 * Served next to ResultController on the same `ResultService` (Nest merges
 * the handlers of every controller of a service).
 */
@Controller()
export class ResultsImportController {
  private readonly logger = new Logger(ResultsImportController.name);

  constructor(private readonly scanQueue: ScanQueueService) {}

  @GrpcMethod('ResultService', 'importResults')
  async importResults(
    request: ImportResultsRequest,
  ): Promise<ImportResultsResponse> {
    const {
      scanId,
      projectId,
      organizationId,
      branch,
      vulnerabilityType,
      format,
      fileKey,
      image,
    } = request;
    // An empty optional is no value, as for `image`.
    const containerId = request.containerId || undefined;
    const severities = request.severities || undefined;
    const sbomFileKey = request.sbomFileKey || undefined;

    if (!scanId || !projectId || !branch || !fileKey) throw invalid();
    if (containerId !== undefined && !CONTAINER_ID.test(containerId)) {
      throw invalid();
    }
    // The key is rebuilt from the request's own ids: a key naming another
    // scan, project or container is refused, whatever the compression.
    const expectedKey =
      containerId === undefined
        ? `import/${projectId}/${scanId}.sarif`
        : `import/${projectId}/${scanId}/${containerId}.sarif`;
    if (fileKey !== expectedKey) throw invalid();
    if (severities !== undefined && !isSeverityList(severities)) {
      throw invalid();
    }
    // The SBOM of an sca import sits next to its SARIF, rebuilt from the same
    // ids: `import/<p>/<s>.sbom` for a file import, and, for the sca
    // container of a Community cluster scan (trivy fs), that container's own
    // `import/<p>/<s>/<c>.sbom`.
    const expectedSbomKey =
      containerId === undefined
        ? `import/${projectId}/${scanId}.sbom`
        : `import/${projectId}/${scanId}/${containerId}.sbom`;
    if (
      sbomFileKey !== undefined &&
      (vulnerabilityType !== 'sca' || sbomFileKey !== expectedSbomKey)
    ) {
      throw invalid();
    }
    if (format !== 'sarif') throw invalid();
    const category = IMPORT_TYPES.find((t) => t === vulnerabilityType);
    if (category === undefined) throw invalid();
    // SARIF import is a Community Edition feature, every type of it. The
    // gateway and security-scanning refuse it too; this check keeps every
    // other path (a direct call, a future route) from bringing imported
    // findings into a hosted deployment. Nothing is queued before it.
    if (currentEdition() !== 'community') {
      throw refused('IMPORT_TYPE_NOT_AVAILABLE');
    }
    // An image belongs to a container import, which needs one. The
    // gateway has already checked the reference's shape.
    if (category === 'container') {
      if (!image || image.length > MAX_IMAGE) throw invalid();
    } else if (image) {
      throw invalid();
    }

    try {
      await this.scanQueue.addResultsImportJob({
        scanId,
        projectId,
        organizationId,
        branch,
        category,
        format: 'sarif',
        fileKey,
        ...(category === 'container' ? { image } : {}),
        ...(containerId !== undefined ? { containerId } : {}),
        ...(severities !== undefined ? { severities } : {}),
        ...(sbomFileKey !== undefined ? { sbomFileKey } : {}),
      });
    } catch {
      this.logger.error(
        `RESULTS_IMPORT_ENQUEUE_FAILED scan=${scanId} project=${projectId}`,
      );
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'results-import queue unavailable',
      });
    }

    this.logger.log(
      `RESULTS_IMPORT_QUEUED scan=${scanId} project=${projectId} type=${category}${containerId !== undefined ? ` container=${containerId}` : ''}${sbomFileKey !== undefined ? ' sbom=true' : ''}`,
    );
    return { accepted: true };
  }
}
