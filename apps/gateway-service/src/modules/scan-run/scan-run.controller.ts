import type { MultipartFile } from '@fastify/multipart';
import {
  Controller,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { Logger } from 'nestjs-pino';
import { importRefusal, importRefusalCode } from '../scan/import/import-errors';
import {
  checkImportFile,
  checkImportSbom,
} from '../scan/import/import-request';
import { IMPORT_BUSY_RETRY_AFTER_S } from '../scan/import/scan-import.controller';
import { ScanImportService } from '../scan/import/scan-import.service';
import { clusterScanRefusal, grpcStatusName } from './scan-run-errors';
import { ScanRunThrottleGuard } from './scan-run-throttle.guard';
import { ScanRunClient } from './scan-run.client';
import {
  ScanRunContext,
  ScanRunRequest,
  ScanUploadTokenGuard,
} from './scan-upload-token.guard';

/** The scan-run protocol in which the sca container may send its SBOM. */
export const SCAN_RUN_SBOM_PROTOCOL = 2;

interface ScanRunFile {
  filename: string;
  body: Buffer;
}

/**
 * A multipart error as a refusal, as the import route maps it: a file over
 * the limit is 413 IMPORT_UPLOAD_TOO_LARGE, anything else the stream refuses
 * is 400 IMPORT_INVALID_REQUEST.
 */
function multipartRefusal(error: unknown): HttpException {
  if (importRefusalCode(error)) return error as HttpException;
  const code = (error as { code?: unknown } | null)?.code;
  return importRefusal(
    code === 'FST_REQ_FILE_TOO_LARGE'
      ? 'IMPORT_UPLOAD_TOO_LARGE'
      : 'IMPORT_INVALID_REQUEST',
  );
}

/**
 * PUBLIC route, no user behind it: the scanner results route. A
 * scanner pod on a connected cluster uploads its SARIF here, authenticated
 * by its per-container token (`ScanUploadTokenGuard`) instead of
 * CombinedAuthRateLimitGuard, so no Permify relation is checked. The per-IP
 * throttle runs first. Excluded from Swagger: only the scanner runner
 * calls it (`POST /scan-runs/:scanId/results`, multipart part `file`,
 * headers `Authorization: Bearer cdst_…` and `X-CybeDefend-Scan-Protocol: 1`,
 * answer 202 `{ accepted: true }`; refusals carry a fixed `body.code`).
 *
 * Protocol 2: the sca container (trivy fs) may also send its CycloneDX SBOM
 * as the part `sbom` (`*.json` or `*.json.gz`, 50 MiB, checked as the import
 * route checks it, IMPORT_INVALID_SBOM). It rides on the same submission and
 * the same single-use token: both objects are stored, then one
 * SubmitScanResults names both. An `sbom` part in protocol 1, or from any
 * other container, is 400 IMPORT_INVALID_REQUEST with nothing stored.
 *
 * Community only (ScanRunModule is in COMMUNITY_ONLY_MODULES): the cloud
 * never mounts this route, so a cloud call is a 404.
 */
@ApiExcludeController()
@Controller()
export class ScanRunController {
  constructor(
    private readonly importService: ScanImportService,
    private readonly client: ScanRunClient,
    private readonly logger: Logger,
  ) {}

  @UseGuards(ScanRunThrottleGuard, ScanUploadTokenGuard)
  @HttpCode(202)
  @Post('/scan-runs/:scanId/results')
  async upload(
    @Req() req: ScanRunRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ accepted: true }> {
    // Set by ScanUploadTokenGuard, which refuses every request it cannot set it for.
    const run = req.scanRun as ScanRunContext;

    if (!this.importService.tryAcquireSlot()) {
      reply.header('Retry-After', String(IMPORT_BUSY_RETRY_AFTER_S));
      throw importRefusal('IMPORT_BUSY');
    }
    try {
      return await this.store(run, req);
    } finally {
      this.importService.releaseSlot();
    }
  }

  private async store(
    run: ScanRunContext,
    req: ScanRunRequest,
  ): Promise<{ accepted: true }> {
    const { file, sbom } = await this.readFiles(req);
    // Every refusal of the request comes before anything is stored.
    if (
      sbom &&
      (run.protocolVersion !== SCAN_RUN_SBOM_PROTOCOL || run.category !== 'sca')
    ) {
      throw importRefusal('IMPORT_INVALID_REQUEST');
    }
    const { gzip } = checkImportFile(file.filename, file.body.subarray(0, 8));
    const sbomGzip = sbom
      ? checkImportSbom('sca', sbom.filename, sbom.body.subarray(0, 8)).gzip
      : false;

    this.logger.log(
      `SCAN_RUN_UPLOAD scan=${run.scanId} container=${run.containerId} category=${run.category} bytes=${file.body.length}${
        sbom ? ` sbom_bytes=${sbom.body.length}` : ''
      }`,
    );

    const objectKey = await this.importService.storeImportFile(
      run.scanId,
      run.projectId,
      file.body,
      gzip,
      run.containerId,
    );
    const storedKeys = [objectKey];
    let sbomObjectKey: string | undefined;
    if (sbom) {
      try {
        sbomObjectKey = await this.importService.storeImportFile(
          run.scanId,
          run.projectId,
          sbom.body,
          sbomGzip,
          run.containerId,
          'sbom',
        );
      } catch (error) {
        // Nothing was submitted: the SARIF just stored belongs to no import.
        await this.importService.deleteImportObject(run.projectId, objectKey);
        throw error;
      }
      storedKeys.push(sbomObjectKey);
    }

    let accepted: boolean;
    try {
      const answer = await this.client.submitScanResults({
        scanId: run.scanId,
        tokenHash: run.tokenHash,
        objectKey,
        ...(sbomObjectKey !== undefined ? { sbomObjectKey } : {}),
      });
      accepted = answer?.accepted === true;
    } catch (error) {
      const refusal = clusterScanRefusal(error);
      this.logger.warn(
        `SCAN_RUN_UPLOAD_REFUSED scan=${run.scanId} container=${run.containerId} step=submit status=${grpcStatusName(error)}`,
      );
      // ALREADY_EXISTS means a concurrent upload of this container won
      // and imports this very key; an unknown outcome may have spent the
      // token. Only a refusal before the claim leaves an orphan to delete.
      if (refusal.refusedBeforeClaim) {
        for (const key of storedKeys) {
          await this.importService.deleteImportObject(run.projectId, key);
        }
      }
      throw refusal.exception;
    }
    if (!accepted) {
      this.logger.warn(
        `SCAN_RUN_UPLOAD_REFUSED scan=${run.scanId} container=${run.containerId} step=submit status=not_accepted`,
      );
      throw importRefusal('IMPORT_UNAVAILABLE');
    }

    this.logger.log(
      `SCAN_RUN_SUBMITTED scan=${run.scanId} container=${run.containerId}`,
    );
    return { accepted: true };
  }

  /**
   * The parts of the request, buffered within the multipart limits: one file
   * named `file` (the SARIF) and, at most once, one named `sbom`, in any
   * order. A field, a repeated part or a file under another name is a
   * malformed request.
   */
  private async readFiles(
    req: ScanRunRequest,
  ): Promise<{ file: ScanRunFile; sbom?: ScanRunFile }> {
    if (!req.isMultipart()) throw importRefusal('IMPORT_INVALID_REQUEST');
    const files: { file?: ScanRunFile; sbom?: ScanRunFile } = {};
    try {
      for await (const part of req.parts()) {
        if (part.type !== 'file') throw importRefusal('IMPORT_INVALID_REQUEST');
        const filePart = part as MultipartFile;
        const name = filePart.fieldname;
        if ((name !== 'file' && name !== 'sbom') || files[name] !== undefined) {
          throw importRefusal('IMPORT_INVALID_REQUEST');
        }
        files[name] = {
          filename: filePart.filename ?? '',
          body: await filePart.toBuffer(),
        };
      }
    } catch (error) {
      throw multipartRefusal(error);
    }
    if (!files.file) throw importRefusal('IMPORT_INVALID_REQUEST');
    return { file: files.file, ...(files.sbom ? { sbom: files.sbom } : {}) };
  }
}
