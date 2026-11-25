import type { MultipartFile, MultipartValue } from '@fastify/multipart';
import {
  Controller,
  ForbiddenException,
  HttpCode,
  HttpException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import { v6 as uuidv6 } from 'uuid';
import {
  FORBIDDEN_EXAMPLE,
  UNAUTHORIZED_EXAMPLE,
} from 'src/core/constants/api-response-examples';
import { ErrorDto } from 'src/core/constants/error.dto';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import {
  Permission,
  SubjectType,
} from 'src/core/guards/permissions/decorator/permission.decorator';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { isCommunityEdition } from 'src/edition/edition';
import { ScanService } from '../scan.service';
import { importRefusal, importRefusalCode } from './import-errors';
import {
  checkImportFile,
  checkImportSbom,
  IMPORT_TYPES,
  importSourceType,
  parseImportFields,
} from './import-request';
import { ScanImportService } from './scan-import.service';

export { IMPORT_BUSY_RETRY_AFTER_S } from './scan-import.service';

type ImportRequest = FastifyRequest & { user?: { sub?: string } };

interface ImportFilePart {
  filename: string;
  body: Buffer;
}

/** The parts of an import, read within the multipart limits. */
interface ImportParts {
  fields: Record<string, string>;
  file?: ImportFilePart;
  /** The optional CycloneDX SBOM of an sca import. */
  sbom?: ImportFilePart;
}

const hasOwn = (o: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, key);

/**
 * A multipart error as an import refusal. A file over the limit is a large
 * upload (413); anything else the stream refuses (a second file, a sixth
 * field, a seventh part, a prototype field name, a malformed body) is a
 * malformed request (400), never @fastify/multipart's own 413 or 406.
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

/** True when StartScan answered the import's own UNAVAILABLE: the scan is already failed. */
function isImportUnavailable(error: unknown): boolean {
  if (importRefusalCode(error) === 'IMPORT_UNAVAILABLE') return true;
  if (error instanceof HttpException) {
    const body = error.getResponse();
    return (
      typeof body === 'object' &&
      body !== null &&
      (body as { code?: unknown }).code === 'IMPORT_UNAVAILABLE'
    );
  }
  return false;
}

@ApiTags('Scan')
@Controller()
@UseGuards(CombinedAuthRateLimitGuard)
export class ScanImportController {
  constructor(
    private readonly scanService: ScanService,
    private readonly importService: ScanImportService,
    private readonly logger: Logger,
  ) {}

  /**
   * Imports a SARIF file as a scan. Community Edition only.
   * Authentication and the Permify check run before any part is read; the
   * file is stored before the scan exists, and the scan is started here.
   */
  @Span()
  @ApiOperation({
    summary: 'Import SARIF results (Community Edition only)',
    description:
      'Community Edition only: the cloud does not serve this route. Imports the results of a scanner as a scan, from a SARIF file (multipart/form-data). The parts may come in any order. An sca import may also send the CycloneDX JSON SBOM of the same scan (`sbom`): its packages, licenses and direct or transitive dependencies are stored with the vulnerabilities. Refusals carry a fixed `code`.',
  })
  @ApiParam({
    name: 'projectId',
    type: 'string',
    format: 'uuid',
    description: 'The unique identifier of the project',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'type', 'branch'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '*.sarif, *.json or *.sarif.gz, 50 MiB at most',
        },
        sbom: {
          type: 'string',
          format: 'binary',
          description:
            'type=sca only, optional: a CycloneDX 1.4-1.6 JSON SBOM of the same scan, *.json or *.json.gz, 50 MiB at most',
        },
        type: { type: 'string', enum: [...IMPORT_TYPES] },
        branch: { type: 'string', maxLength: 255 },
        commit: { type: 'string', pattern: '^[0-9a-f]{7,40}$' },
        format: { type: 'string', enum: ['sarif'] },
        image: {
          type: 'string',
          maxLength: 255,
          description: 'Required for type=container, refused otherwise',
        },
      },
    },
  })
  @ApiResponse({
    status: 202,
    description: 'The import scan was created and started',
    schema: { example: { scanId: '1f0b7c1e-9c1a-6a40-8000-000000000000' } },
  })
  @ApiResponse({ status: 400, description: 'Bad Request', type: ErrorDto })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @ApiResponse({ status: 413, description: 'File too large', type: ErrorDto })
  @ApiResponse({ status: 503, description: 'Unavailable', type: ErrorDto })
  @SubjectType('project')
  @Permission('start_scan')
  @UseGuards(PermissionsGuard)
  @HttpCode(202)
  @Post('/project/:projectId/scan/import/start')
  async startImport(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Req() req: ImportRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ scanId: string }> {
    // Community only. The cloud does not mount this
    // controller (ScanImportModule is in COMMUNITY_ONLY_MODULES); if it ever
    // did, the request is still refused before a slot, a part or a call.
    if (!isCommunityEdition()) throw importRefusal('IMPORT_TYPE_NOT_AVAILABLE');

    const userId = req.user?.sub;
    if (!userId) throw new ForbiddenException('Permission denied');

    // The organization's share, a read place held until the answer, the
    // body within its deadline, then a slot (ScanImportService.runUpload).
    const organizationId =
      await this.importService.organizationOfProject(projectId);
    return this.importService.runUpload(
      organizationId,
      req,
      reply,
      () => this.readParts(req),
      (parts) => this.runImport(projectId, userId, req, parts),
    );
  }

  private async runImport(
    projectId: string,
    userId: string,
    req: ImportRequest,
    { fields, file, sbom }: ImportParts,
  ): Promise<{ scanId: string }> {
    // The caller's id, so the storage key can name the scan before it exists.
    const scanId = uuidv6();

    if (!file) throw importRefusal('IMPORT_INVALID_REQUEST');

    // Every refusal of the request comes before an upload URL is asked for.
    // No checkExistingScan: an import blocks nothing and is blocked by nothing.
    const request = parseImportFields(fields);
    const { gzip } = checkImportFile(file.filename, file.body.subarray(0, 8));
    const sbomGzip = sbom
      ? checkImportSbom(request.type, sbom.filename, sbom.body.subarray(0, 8))
          .gzip
      : false;

    this.logger.log(
      `IMPORT_START scan=${scanId} project=${projectId} user=${userId} type=${request.type} bytes=${file.body.length}${sbom ? ` sbom_bytes=${sbom.body.length}` : ''}`,
    );

    const objectKey = await this.importService.storeImportFile(
      scanId,
      projectId,
      file.body,
      gzip,
    );
    const storedKeys = [objectKey];
    if (sbom) {
      try {
        storedKeys.push(
          await this.importService.storeImportFile(
            scanId,
            projectId,
            sbom.body,
            sbomGzip,
            undefined,
            'sbom',
          ),
        );
      } catch (error) {
        // No scan owns the stored SARIF either.
        await this.importService.deleteImportObject(projectId, objectKey);
        throw error;
      }
    }

    try {
      await this.scanService.createScan({
        scanId,
        projectId,
        initializerUserId: userId,
        privateScan: false,
        vulnerabilityTypes: [],
        branch: request.branch,
        sourceType: importSourceType(req.headers['user-agent']),
        importFormat: 'sarif',
        importType: request.type,
        ...(request.type === 'container' ? { importImage: request.image } : {}),
        ...(sbom ? { importSbom: true } : {}),
      });
    } catch (error) {
      // No scan row owns the stored files, and no terminal move of
      // security-scanning will ever delete them.
      for (const key of storedKeys) {
        await this.importService.deleteImportObject(projectId, key);
      }
      throw error;
    }

    try {
      await this.scanService.startScan({
        scanId,
        projectId,
        branch: request.branch,
        language: [],
      });
    } catch (error) {
      // security-scanning already failed the scan and deleted the file.
      if (isImportUnavailable(error)) throw importRefusal('IMPORT_UNAVAILABLE');
      // Still waiting_for_file (writes blocked, a project limit): cancel it.
      await this.cancelQuietly(scanId, projectId);
      throw error;
    }

    return { scanId };
  }

  /**
   * Reads every part within the multipart limits, in any order: the fields,
   * the file part named `file` and the optional one named `sbom`, each
   * buffered and at most once. A repeated or truncated field, or a file part
   * under another name, is a malformed request.
   */
  private async readParts(req: ImportRequest): Promise<ImportParts> {
    if (!req.isMultipart()) throw importRefusal('IMPORT_INVALID_REQUEST');
    const fields: Record<string, string> = Object.create(null);
    const files: { file?: ImportFilePart; sbom?: ImportFilePart } = {};
    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          const filePart = part as MultipartFile;
          const name = filePart.fieldname;
          if ((name !== 'file' && name !== 'sbom') || files[name]) {
            throw importRefusal('IMPORT_INVALID_REQUEST');
          }
          const body = await filePart.toBuffer();
          files[name] = { filename: filePart.filename ?? '', body };
        } else {
          const fieldPart = part as MultipartValue<unknown>;
          if (
            fieldPart.fieldnameTruncated ||
            fieldPart.valueTruncated ||
            typeof fieldPart.value !== 'string' ||
            hasOwn(fields, fieldPart.fieldname)
          ) {
            throw importRefusal('IMPORT_INVALID_REQUEST');
          }
          fields[fieldPart.fieldname] = fieldPart.value;
        }
      }
    } catch (error) {
      throw multipartRefusal(error);
    }
    return { fields, ...files };
  }

  private async cancelQuietly(scanId: string, projectId: string) {
    try {
      await this.scanService.cancelScan(scanId, projectId);
    } catch (error) {
      const status =
        error instanceof HttpException ? error.getStatus() : 'unknown';
      this.logger.warn(
        `IMPORT_SCAN_NOT_CANCELLED scan=${scanId} status=${status}`,
      );
    }
  }
}
