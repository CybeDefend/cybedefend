import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import archiver from 'archiver';
import * as yauzl from 'yauzl';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import * as path from 'node:path';
import { Repository } from 'typeorm';
import { v6 as uuidv6 } from 'uuid';
import { shouldExcludeFile } from '../core/data/filter-patterns';
import { languageExtension } from '../core/data/language-extension';
import { FileScan, FileStatus } from '../entities/file.entity';
import {
  OBJECT_STORAGE_BACKEND,
  ObjectStorageBackend,
} from '../edition/ports/object-storage-backend.port';
import { status } from '@grpc/grpc-js';
import { historyKeyForArchive, historyObjectKey } from './scan-history-key';
import {
  DeleteFileRequest,
  DeleteFileResponse,
  DeleteImportObjectRequest,
  DeleteImportObjectResponse,
  DeleteReportObjectRequest,
  DeleteReportObjectResponse,
  FinalizeReportUploadRequest,
  FinalizeReportUploadResponse,
  GetDownloadUrlRequest,
  GetDownloadUrlResponse,
  GetImportDownloadUrlRequest,
  GetImportDownloadUrlResponse,
  RequestImportUploadUrlRequest,
  RequestImportUploadUrlResponse,
  RequestReportUploadUrlRequest,
  RequestReportUploadUrlResponse,
  UploadFileRequest,
  UploadFileResponse,
} from '@grpc/file-management/file';
import {
  IMPORT_DOWNLOAD_TTL_SECONDS,
  IMPORT_MAX_UPLOAD_BYTES,
  IMPORT_UPLOAD_TTL_SECONDS,
  assertImportContainerId,
  assertImportKind,
  assertImportObjectKey,
  importContentType,
  importObjectKey,
  importSbomObjectKey,
  ImportEncoding,
} from './import-object';
import {
  validateDiffZipEntries,
  isUnsafeDiffPath,
  DiffArchiveCaps,
  DiffZipEntry,
} from './diff-archive.util';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import {
  SCAN_SERVICE_NAME,
  ScanServiceClient,
} from '@grpc/security-scanning/security_scanning';
import type { UploadFilterSummary } from '@grpc/security-scanning/scan';
import { safeGrpcCall } from '@grpc/wrapper-grpc.module';
import SecretsService from 'src/core/secrets/secrets.service';
import { currentEdition, isCommunityEdition } from '../edition/edition';
import type { StorageTarget } from './data-purge/storage-purge';
import {
  ARCHIVE_FAILURE_CATEGORY,
  ArchiveLimitError,
  InflateMeter,
  ScannerArchiveLimits,
  ZipLimits,
  formatBytes,
  forwardedZipLimits,
  resolveZipLimits,
  scannerArchiveLimits,
} from './zip-limits.util';
import {
  GitConfigScanner,
  SAFE_GIT_CONFIG_ENTRY,
  gitEntryDecision,
} from './scan-archive-git.util';
import { isSecretScanFile } from '../core/data/secret-scan-files';
import { isScannerConfigurationFile } from './scanner-config-files';
import { UploadFilterSummaryBuilder } from './upload-filter-summary';
import {
  CheckedZip,
  ZipEntryRecord,
  assertScannableZip,
  isSystemError,
  openCheckedZip,
} from './zip-archive.util';

/** What filterZipFile uses of an archiver instance (the package ships no types). */
interface ZipWriter extends NodeJS.EventEmitter {
  append(source: NodeJS.ReadableStream | Buffer, data: { name: string }): void;
}

/** The filtered archive's writer: entries in, a ZIP stream out. */
interface ArchiveWriter extends ZipWriter {
  pipe(destination: NodeJS.WritableStream): NodeJS.WritableStream;
  finalize(): Promise<void>;
  abort(): void;
}

/**
 * Times an upload is put back for a later tick after a failure of this
 * service's file system (too many open files, no space, an I/O error) before
 * its scan is failed: such a failure says nothing of the archive, and usually
 * passes once other uploads have released their files and disk.
 */
export const MAX_SYSTEM_FAILURE_RETRIES = 3;

/**
 * How long one archive may take to be read and rewritten before it is
 * stopped and its upload failed (FILE_SCAN_ARCHIVE_DEADLINE_MS). The largest
 * archive the limits accept inflates to 5 GiB; read, inflated and deflated
 * again at a conservative 10 MiB/s on a throttled pod, that is about
 * 512 s. Ten minutes covers it, and stays under the 15-minute processing
 * timeout after which the scan is failed anyway.
 */
export const DEFAULT_ARCHIVE_DEADLINE_MS = 10 * 60 * 1000;

/**
 * An archive stopped at its processing deadline. It is this service's limit,
 * not a fault of the archive: the scan fails as a processing error naming the
 * time limit, without an archive failure code.
 */
export class ProcessingDeadlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProcessingDeadlineError';
  }
}

/**
 * The entries of an uploaded archive left out of the archive forwarded to
 * the scanners, by reason. An archive past a limit is refused whole, so no
 * entry is left out for a limit.
 */
export interface DroppedEntryCounts {
  /** A scanner's own configuration file (SCANNER_CONFIGURATION_FILES). */
  scannerConfiguration: number;
  /** An excluded folder or name pattern (dependencies, build output, …). */
  excludedPath: number;
  /** A binary or media file, a file type no scanner reads, or documentation below the root. */
  excludedType: number;
  /** A name that is absolute or climbs out of the archive's folder. */
  unsafeName: number;
  /** Git metadata git would execute (hooks, attributes, nested repositories). */
  gitMetadata: number;
}

/**
 * The filtered archive written for the scanners, and what it left out: the
 * counts by reason, and the bounded summary sent to security-scanning with
 * the start of the scan (see UploadFilterSummaryBuilder).
 */
export interface FilteredArchive {
  path: string;
  dropped: DroppedEntryCounts;
  summary: UploadFilterSummary;
}

function formatDuration(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000} min`;
  if (ms >= 1000) return `${Math.round(ms / 100) / 10} s`;
  return `${ms} ms`;
}

/**
 * Uploads of one project registered and not yet received
 * (FILE_SCAN_MAX_PENDING_UPLOADS_PER_PROJECT). An upload is normally pending
 * for the few seconds its archive takes to arrive: twenty leaves room for a
 * project that starts scans of many branches at once.
 */
export const DEFAULT_MAX_PENDING_UPLOADS_PER_PROJECT = 20;

/** Attempts of the filtered archive upload to S3 (see uploadFilteredArchive). */
const FILTERED_UPLOAD_ATTEMPTS = 3;

/** Signed-download lifetimes, in seconds. */
const DOWNLOAD_URL_TTL_SECONDS = 20 * 60;
// The scanner reads the history tar only after its pull and its whole HEAD pass, so it needs far longer than the archive.
const HISTORY_DOWNLOAD_URL_TTL_SECONDS = 3 * 60 * 60;

@Injectable()
export class FileService implements OnModuleInit {
  private scanServiceClient!: ScanServiceClient;

  // The object store: the edition's backend when one is bound
  // (OBJECT_STORAGE_BACKEND), the S3-compatible store (MinIO, SeaweedFS…)
  // otherwise.
  private readonly backend: ObjectStorageBackend | null;
  private s3Client?: S3Client;
  // Presigner for the URLs handed to a browser or an agent, signed on
  // S3_PUBLIC_ENDPOINT when set (the same object as s3Client otherwise).
  private s3PresignClient?: S3Client;
  // Uploads the filtered archive as a stream of its file (see
  // uploadFilteredArchive). The same object as s3Client in the Community
  // Edition, whose client already computes checksums only when required.
  private s3UploadClient?: S3Client;
  // Delay before a new attempt of that upload, doubled at each attempt.
  private readonly uploadRetryDelayMs: number;

  // Filenames to always keep (lowercase)
  private readonly alwaysKeepNames = new Set<string>(
    [
      'dockerfile',
      'dockerfile.dev',
      'dockerfile.prod',
      'dockerfile.test',
      'dockerfile.build',
      'dockerfile.local',
      'dockerfile.staging',
      'makefile',
      'jenkinsfile',
      'cmakelists.txt',
      'gradle',
      'gradlew',
      'gradlew.bat',
      'package.json',
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'composer.json',
      'composer.lock',
      'requirements.txt',
      'pipfile',
      'pipfile.lock',
      'go.mod',
      'go.sum',
      'cargo.toml',
      'cargo.lock',
      'gemfile',
      'gemfile.lock',
      // SAST exclusion file. `.cybeignore` is the recommended name;
      // `.cybedefend` is deprecated but still read by the scanner, and only
      // works when it is a *file* — a repository linked with a closed product has a
      // `.cybedefend/` directory instead. Neither has an extension, so this
      // allowlist is the only thing keeping them in the scanned ZIP.
      '.cybeignore',
      '.cybedefend',
      // Secret-scanner: dotfiles and sensitive files that may contain credentials
      '.npmrc',
      '.yarnrc',
      '.esmtprc',
      '.netrc',
      '.git-credentials',
      '.gitconfig',
      '.dockercfg',
      '.pgpass',
      '.bash_profile',
      '.bashrc',
      '.zshrc',
      '.profile',
      '.bash_history',
      '.zsh_history',
      '.env',
      '.env.local',
      '.env.development',
      '.env.production',
      '.env.staging',
      '.env.test',
      '.htpasswd',
      '.ftpconfig',
      '.s3cfg',
      '.boto',
      '.aws/credentials',
      'credentials',
      'shadow',
      'passwd',
      'id_rsa',
      'id_dsa',
      'id_ecdsa',
      'id_ed25519',
      'known_hosts',
      'authorized_keys',
      'wp-config.php',
      'web.config',
      '.travis.yml',
      'filezilla.xml',
      'recentservers.xml',
      'ventrilo_srv.ini',
    ].map((n) => n.toLowerCase()),
  );

  // Map file extensions to languages (programming only)
  private extensionToLanguageMap: Set<string> = new Set();

  // Parallel map: extension → language display name (e.g. ".ts" → "TypeScript").
  // Populated alongside `extensionToLanguageMap` so we can surface the language
  // list when passing pre-computed file metrics in StartScanRequest, sparing
  // security-scanning-service from re-downloading + re-parsing the ZIP.
  private extensionToLanguageNameMap: Map<string, string> = new Map();

  // Extensions for configuration files we want to keep
  private configFileExtensions: Set<string> = new Set([
    '.json',
    '.yaml',
    '.yml',
    '.toml',
    '.xml',
    '.ini',
    '.conf',
    '.config',
    // Secret-scanner: key/certificate extensions
    '.pem',
    '.key',
    '.ppk',
    '.p12',
    '.pfx',
    '.jks',
    '.keystore',
    '.crt',
    '.cer',
    '.der',
    '.pub',
    // Documentation (keep at all levels, not just root)
    '.md',
    '.markdown',
  ]);

  // Documentation files allowed ONLY at root level (`.txt` is kept at any
  // depth for the secret scanner, see isSecretScanFile)
  private rootOnlyDocExtensions: Set<string> = new Set([
    '.rst',
    '.adoc',
    '.asciidoc',
  ]);

  // Documentation filenames (without extension) allowed ONLY at root
  private rootOnlyDocNames: Set<string> = new Set([
    'license',
    'licence',
    'readme',
    'changelog',
    'contributing',
    'authors',
    'contributors',
    'notice',
    'copyright',
  ]);

  // Binary/media extensions to always exclude
  private binaryExtensions: Set<string> = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.bmp',
    '.ico',
    '.svg',
    '.webp',
    '.pdf',
    '.zip',
    '.tar',
    '.gz',
    '.bz2',
    '.7z',
    '.rar',
    '.exe',
    '.dll',
    '.so',
    '.dylib',
    '.bin',
    '.dat',
    '.db',
    '.sqlite',
    '.mp3',
    '.mp4',
    '.avi',
    '.mov',
    '.wav',
    '.woff',
    '.woff2',
    '.ttf',
    '.eot',
    '.otf',
  ]);

  // Valid filenames without extension
  private readonly validFilesWithoutExtension: Set<string> = new Set([
    'dockerfile',
    'dockerfile.dev',
    'dockerfile.prod',
    'dockerfile.test',
    'Makefile',
    'Dockerfile',
    'Procfile',
    'Jenkinsfile',
    'Rakefile',
    'Vagrantfile',
    'BUILD',
    'WORKSPACE',
    'Gemfile',
    'Pipfile',
    'CMakeLists.txt',
  ]);

  // Thresholds for file validation and timeouts
  private readonly minFileSizeBytes: number;
  private readonly minFileAgeSeconds: number;
  readonly uploadTimeoutMinutes: number;
  readonly processingTimeoutMinutes: number;

  // S3-compatible endpoint and bucket name
  private readonly s3Endpoint?: string;
  // Browser-reachable endpoint the public URLs are signed on
  private readonly s3PublicEndpoint?: string;
  private readonly s3BucketName?: string;

  // Track files under processing
  processingFiles: Map<string, boolean> = new Map();
  // File-system failures of each upload put back for a retry (scanId -> count).
  private readonly systemFailures = new Map<string, number>();

  constructor(
    @InjectRepository(FileScan)
    private readonly fileScanRepository: Repository<FileScan>,
    private readonly logger: Logger,
    private readonly configService: ConfigService,
    private readonly secretsService: SecretsService,
    @Inject('SECURITY_SCANNING_SERVICE')
    private readonly scanningClient: ClientGrpc,
    @Optional()
    @Inject(OBJECT_STORAGE_BACKEND)
    backend: ObjectStorageBackend | null = null,
  ) {
    this.backend = backend ?? null;

    // Load thresholds from config
    this.minFileSizeBytes = this.configService.get<number>(
      'FILE_SCAN_MIN_FILE_SIZE_BYTES',
      10,
    );
    this.minFileAgeSeconds = this.configService.get<number>(
      'FILE_SCAN_MIN_FILE_AGE_SECONDS',
      5,
    );
    this.uploadRetryDelayMs = Number(
      this.configService.get('FILE_UPLOAD_RETRY_DELAY_MS', 1000),
    );
    this.uploadTimeoutMinutes = this.configService.get<number>(
      'FILE_SCAN_UPLOAD_TIMEOUT_MINUTES',
      30,
    );
    this.processingTimeoutMinutes = this.configService.get<number>(
      'FILE_SCAN_PROCESSING_TIMEOUT_MINUTES',
      15,
    );

    // Initialize the S3 client unless an edition backend serves the storage
    if (!this.backend) {
      this.s3Endpoint = this.configService.get<string>('S3_ENDPOINT');
      this.s3PublicEndpoint =
        this.configService.get<string>('S3_PUBLIC_ENDPOINT');
      this.s3BucketName = this.configService.get<string>('S3_BUCKET_NAME');
      const awsRegion = this.configService.get<string>(
        'AWS_REGION',
        'eu-west-1',
      );
      const accessKeyId = this.secretsService.getSecret('S3_ACCESS_KEY_ID');
      const secretAccessKey = this.secretsService.getSecret(
        'S3_SECRET_ACCESS_KEY',
      );
      if (!accessKeyId || !secretAccessKey) {
        this.logger.error('S3 mode selected but credentials are missing');
        throw new TypeError('Missing S3 credentials');
      }
      // Community Edition only: a checksum only when the operation requires
      // one or the caller asks for it, and a response checked only on
      // ChecksumMode=ENABLED (the behaviour of @aws-sdk/client-s3 before
      // 3.729). Its later default (WHEN_SUPPORTED) signs x-amz-checksum-crc32
      // of the EMPTY body into every presigned PUT, and SeaweedFS, the
      // Community Edition's storage, refuses the upload with 400 BadDigest.
      // Other editions keep the SDK default, unchanged.
      const checksumOptions = isCommunityEdition()
        ? ({
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
          } as const)
        : {};
      this.s3Client = new S3Client({
        endpoint: this.s3Endpoint,
        region: awsRegion,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true,
        ...checksumOptions,
      });
      // An internal compose endpoint (http://storage:9000) is unreachable
      // from a browser, which receives the scan upload URL, the diff upload URL
      // and the report download URL. Those are signed on S3_PUBLIC_ENDPOINT when
      // one is set; without one, the presigner is the storage client itself.
      const presignEndpoint = this.s3PublicEndpoint ?? this.s3Endpoint;
      this.s3PresignClient =
        presignEndpoint === this.s3Endpoint
          ? this.s3Client
          : new S3Client({
              endpoint: presignEndpoint,
              region: awsRegion,
              credentials: { accessKeyId, secretAccessKey },
              forcePathStyle: true,
              ...checksumOptions,
            });
      // A stream sent with the SDK's default checksums goes out as aws-chunked
      // with a trailing checksum, which not every S3-compatible store accepts.
      // The filtered archive is a stream, so it goes through a client that
      // sends a checksum only when the operation requires one, as the
      // presigned browser uploads already do.
      this.s3UploadClient = isCommunityEdition()
        ? this.s3Client
        : new S3Client({
            endpoint: this.s3Endpoint,
            region: awsRegion,
            credentials: { accessKeyId, secretAccessKey },
            forcePathStyle: true,
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
          });
    }

    // Build extension to language map (programming languages only)
    languageExtension.forEach((lang) => {
      // Keep programming languages, markup (HTML, XML), and some useful data formats
      // Exclude: prose (documentation like .md, .adoc)
      if (
        lang.type === 'programming' ||
        lang.type === 'markup' ||
        (lang.type === 'data' && lang.name === 'YAML') ||
        (lang.type === 'data' && lang.name === 'JSON')
      ) {
        if (Array.isArray(lang.extensions)) {
          lang.extensions.forEach((ext) => {
            const lower = ext.toLowerCase();
            this.extensionToLanguageMap.add(lower);
            // First language wins for a given extension (matches the
            // single-name semantics historically used by scanUtils.ts).
            if (!this.extensionToLanguageNameMap.has(lower)) {
              this.extensionToLanguageNameMap.set(lower, lang.name);
            }
          });
        }
      }
    });
  }

  /**
   * The store, for the data purge (`data-purge/`), which lists and deletes
   * every version under a prefix. Read at call time: an edition backend's
   * client only exists once `onModuleInit` ran.
   */
  storageTarget(): StorageTarget {
    if (this.backend) {
      return { provider: 'backend', backend: this.backend };
    }
    if (!this.s3Client || !this.s3BucketName) {
      throw new Error('S3 storage is not initialised');
    }
    return { provider: 's3', client: this.s3Client, bucket: this.s3BucketName };
  }

  /**
   * The client a presigned URL is signed on. 'browser' URLs (the scan
   * upload, the diff upload, the report download, and the archive download
   * of a scanner pod on an external cluster, `GetDownloadUrl` audience
   * 'external') are signed on S3_PUBLIC_ENDPOINT when one is set; 'internal'
   * URLs (scanner downloads,
   * the import upload/download, the report upload) always stay on
   * S3_ENDPOINT — both of their callers sit inside the network. Storage calls
   * (HeadObject, GetObject, PutObject, DeleteObject, the purge) never use
   * this: they always go to S3_ENDPOINT.
   */
  private presignClient(audience: 'browser' | 'internal'): S3Client {
    if (!this.s3Client) {
      throw new Error('S3 storage is not initialised');
    }
    return audience === 'browser'
      ? (this.s3PresignClient ?? this.s3Client)
      : this.s3Client;
  }

  /**
   * On module init:
   * - Initialize the edition's storage backend, if any
   * - Initialize gRPC scanning client
   */
  async onModuleInit(): Promise<void> {
    if (this.backend) {
      await this.backend.init();
    }
    this.scanServiceClient =
      this.scanningClient.getService<ScanServiceClient>(SCAN_SERVICE_NAME);
  }

  /**
   * Refuse a new upload of a project that already holds
   * FILE_SCAN_MAX_PENDING_UPLOADS_PER_PROJECT pending ones: each is checked
   * in storage by the one upload processor until its deadline. The count and
   * the insert are not one transaction, so concurrent starts may pass the
   * bound by a few; the processor's per-tick bounds still hold.
   */
  private async assertPendingUploadRoom(projectId: string): Promise<void> {
    const max = this.maxPendingUploadsPerProject();
    const pending = await this.fileScanRepository.count({
      where: { projectId, status: FileStatus.PENDING_UPLOAD },
    });
    if (pending >= max) {
      throw new RpcException({
        code: status.RESOURCE_EXHAUSTED,
        message: `The project already has ${max} scans waiting for their archive: upload those archives, or wait for them to time out, before starting another scan`,
      });
    }
  }

  private maxPendingUploadsPerProject(): number {
    const raw = Number(
      this.configService.get('FILE_SCAN_MAX_PENDING_UPLOADS_PER_PROJECT'),
    );
    return Number.isFinite(raw) && raw > 0
      ? Math.floor(raw)
      : DEFAULT_MAX_PENDING_UPLOADS_PER_PROJECT;
  }

  /**
   * Generate a signed URL for upload and record pending upload
   */
  @Span()
  async uploadFile(request: UploadFileRequest): Promise<UploadFileResponse> {
    const artifact = request.artifact ?? 'archive';
    if (artifact !== 'archive' && artifact !== 'history') {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `Unknown artifact kind: ${artifact}`,
      });
    }
    // The history tar is a side artifact of the scan: no FileScan row, so the
    // upload cron never processes it.
    const isHistory = artifact === 'history';
    const objectPath = isHistory
      ? historyObjectKey(request.projectId, request.scanId)
      : `scan/${request.projectId}/${request.scanId}.zip`;
    const contentType = isHistory ? 'application/x-tar' : 'application/zip';
    console.log(
      `UploadFile called for scanId=${request.scanId}, projectId=${request.projectId}`,
    );
    if (!isHistory) await this.assertPendingUploadRoom(request.projectId);
    if (this.backend) {
      // Generate signed URL for upload
      // If bucket is inaccessible, this will fail with appropriate error
      const { url: signedUrl } = await this.backend.signPut(objectPath, {
        contentType,
        expiresAtMs: Date.now() + 10000, // 10 seconds
        createOnly: true,
        sizeRange: { min: 0, max: 5368709120 },
      });

      if (!signedUrl) {
        throw new RpcException({
          code: status.INTERNAL,
          message: `Failed to generate signed URL for ${this.backend.label} upload`,
        });
      }

      if (isHistory) {
        return { url: signedUrl, scanId: request.scanId };
      }

      // Save pending upload record
      const fileRecord = this.fileScanRepository.create({
        scanId: request.scanId,
        fileName: path.basename(objectPath),
        typeScan: request.typeScan,
        projectId: request.projectId,
        status: FileStatus.PENDING_UPLOAD,
        objectPath,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await this.fileScanRepository.save(fileRecord);

      return { url: signedUrl, scanId: request.scanId };
    } else {
      // S3-compatible mode
      const bucket = this.s3BucketName!;
      const s3 = this.s3Client!;

      // Check if object exists
      try {
        await s3.send(
          new HeadObjectCommand({ Bucket: bucket, Key: objectPath }),
        );
        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message: `File ${request.scanId} already exists`,
        });
      } catch (err: any) {
        if (err.name !== 'NotFound' && err.$metadata?.httpStatusCode !== 404) {
          this.logger.error('Error checking S3 object existence', err);
          console.log(err);
          throw new RpcException({
            code: status.INTERNAL,
            message: 'Error checking S3 object existence',
          });
        }
      }

      // Generate presigned URL. The client PUTs the archive from its browser,
      // so the URL is signed on the public endpoint when one is set.
      const putCmd = new PutObjectCommand({
        Bucket: bucket,
        Key: objectPath,
        ContentType: contentType,
      });

      let presignedUrl: string;
      try {
        presignedUrl = await getSignedUrl(
          this.presignClient('browser'),
          putCmd,
          {
            expiresIn: 10,
          },
        );
      } catch (e) {
        this.logger.error('Error generating presigned URL for S3', e);
        throw new RpcException({
          code: status.INTERNAL,
          message: 'Failed to generate presigned URL for S3 upload',
        });
      }

      if (isHistory) {
        return { url: presignedUrl, scanId: request.scanId };
      }

      // Save pending upload record
      const fileRecord = this.fileScanRepository.create({
        scanId: request.scanId,
        fileName: path.basename(objectPath),
        typeScan: request.typeScan,
        projectId: request.projectId,
        status: FileStatus.PENDING_UPLOAD,
        objectPath,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await this.fileScanRepository.save(fileRecord);

      return { url: presignedUrl, scanId: request.scanId };
    }
  }

  /** Extract a human-readable message from an RpcException or plain Error. */
  private extractRpcMessage(e: unknown): string {
    if (e instanceof RpcException) {
      const err = e.getError();
      if (typeof err === 'string') return err;
      if (err && typeof err === 'object' && 'message' in err) {
        return String((err as { message?: unknown }).message ?? 'rejected');
      }
      return 'rejected';
    }
    return e instanceof Error ? e.message : String(e);
  }

  /**
   * Sign a PUT URL for one object and return the headers the PUT must send.
   * The signature covers every returned header, so the uploader gets them
   * back with the URL (it cannot guess the size cap). GCS also signs
   * `x-goog-if-generation-match: '0'` (no overwrite); on S3, `exactBytes`
   * pins `ContentLength` when set. Errors keep the historical INTERNAL
   * messages.
   *
   * `audience: 'browser'` (default 'internal') signs the URL on
   * S3_PUBLIC_ENDPOINT when one is set, for the uploaders that sit outside
   * the network (the diff-scan agent). The import upload URLs stay internal:
   * the gateway PUTs them inside the network.
   */
  async signObjectPut(
    objectKey: string,
    opts: {
      contentType: string;
      ttlSeconds: number;
      minBytes: number;
      maxBytes: number;
      exactBytes?: number;
      audience?: 'browser' | 'internal';
    },
  ): Promise<{
    uploadUrl: string;
    uploadHeaders: Record<string, string>;
    expiresAtMs: number;
  }> {
    const {
      contentType,
      ttlSeconds,
      minBytes,
      maxBytes,
      exactBytes,
      audience = 'internal',
    } = opts;
    const expiresAtMs = Date.now() + ttlSeconds * 1000;
    let uploadHeaders: Record<string, string> = { 'Content-Type': contentType };
    if (this.backend) {
      // Object must not already exist + bound the upload size.
      const { url: signedUrl, signedHeaders } = await this.backend.signPut(
        objectKey,
        {
          contentType,
          expiresAtMs,
          createOnly: true,
          sizeRange: { min: minBytes, max: maxBytes },
        },
      );
      uploadHeaders = { 'Content-Type': contentType, ...signedHeaders };
      if (!signedUrl) {
        throw new RpcException({
          code: status.INTERNAL,
          message: `Failed to generate signed URL for ${this.backend.label} upload`,
        });
      }
      return { uploadUrl: signedUrl, uploadHeaders, expiresAtMs };
    }
    // S3-compatible: PUT presigned URL.
    try {
      const uploadUrl = await getSignedUrl(
        this.presignClient(audience),
        new PutObjectCommand({
          Bucket: this.s3BucketName!,
          Key: objectKey,
          ContentType: contentType,
          ...(exactBytes !== undefined ? { ContentLength: exactBytes } : {}),
        }),
        { expiresIn: ttlSeconds },
      );
      return { uploadUrl, uploadHeaders, expiresAtMs };
    } catch (e) {
      this.logger.error('Error generating presigned URL for S3 upload', e);
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Failed to generate presigned URL for S3 upload',
      });
    }
  }

  /**
   * Stage a PENDING_UPLOAD file_scan row so the cron processes the object once
   * the caller PUTs it. `isDiffScan` tells the cron to apply the strict diff
   * guards.
   */
  async stagePendingUpload(row: {
    scanId: string;
    projectId: string;
    typeScan: string;
    objectPath: string;
    isDiffScan: boolean;
  }): Promise<void> {
    // Held to the same per-project bound as an upload registered by
    // uploadFile: the processor checks every pending upload alike.
    await this.assertPendingUploadRoom(row.projectId);
    const fileRecord = this.fileScanRepository.create({
      scanId: row.scanId,
      fileName: path.basename(row.objectPath),
      typeScan: row.typeScan,
      projectId: row.projectId,
      status: FileStatus.PENDING_UPLOAD,
      objectPath: row.objectPath,
      isDiffScan: row.isDiffScan,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await this.fileScanRepository.save(fileRecord);
  }

  /**
   * List the entries of an uploaded diff ZIP for validation. The
   * archive is untrusted (agent-built), so this is the zip-bomb guard: excluded
   * subtrees (node_modules, …) are skipped WITHOUT decompressing, and each kept
   * entry is streamed under a hard per-file + aggregate decompression budget —
   * the reader never buffers more than ~maxFileBytes for a single entry, and
   * bails as soon as the aggregate exceeds maxTotalBytes. Unsafe paths are
   * recorded (size 0, never decompressed) so `validateDiffZipEntries` makes the
   * final accept/reject decision from one place. The returned list feeds that
   * pure validator.
   */
  private readDiffZipEntries(
    zipFilePath: string,
    caps: DiffArchiveCaps,
  ): Promise<DiffZipEntry[]> {
    return new Promise((resolve, reject) => {
      const entries: DiffZipEntry[] = [];
      let aggregate = 0;
      let settled = false;
      let zipfileRef: yauzl.ZipFile | null = null;

      const closeSafely = () => {
        try {
          (zipfileRef as unknown as { close?: () => void } | null)?.close?.();
        } catch {
          /* ignore */
        }
      };
      const fail = (e: unknown) => {
        if (settled) return;
        settled = true;
        closeSafely();
        reject(e);
      };
      const done = () => {
        if (settled) return;
        settled = true;
        resolve(entries);
      };

      yauzl.open(
        zipFilePath,
        { lazyEntries: true, autoClose: true },
        (err, zipfile) => {
          if (err || !zipfile) {
            // The reader's error is logged; the caller gets a stable message.
            this.logger.warn({ err, msg: 'Unreadable diff archive' });
            return fail(
              new RpcException({
                code: status.INVALID_ARGUMENT,
                message: 'Unreadable diff archive',
              }),
            );
          }
          zipfileRef = zipfile;
          const readNext = () => {
            if (settled) return;
            try {
              zipfile.readEntry();
            } catch (e) {
              fail(e);
            }
          };

          zipfile.on('entry', (entry: yauzl.Entry) => {
            if (settled) return;
            const name = entry.fileName;
            // Directory entry — nothing to scan.
            if (name.endsWith('/')) return readNext();
            // Pathological archive guard.
            if (entries.length >= 50_000) {
              return fail(
                new RpcException({
                  code: status.INVALID_ARGUMENT,
                  message: 'Too many entries in the diff archive',
                }),
              );
            }
            // Unsafe path: record without decompressing; the pure validator
            // rejects it (keeps the accept/reject decision in one place).
            if (isUnsafeDiffPath(name)) {
              entries.push({ path: name, size: 0 });
              return readNext();
            }
            const normalized = path.posix.normalize(name.replaceAll('\\', '/'));
            // Excluded subtree (node_modules, …): skip WITHOUT decompressing —
            // this is the zip-bomb defence (a bomb hidden under node_modules is
            // never expanded) and matches selectDiffFiles dropping excluded
            // files before the caps.
            if (shouldExcludeFile(normalized)) return readNext();
            // A scanner configuration file is never forwarded either.
            if (isScannerConfigurationFile(normalized)) return readNext();

            zipfile.openReadStream(entry, (streamErr, readStream) => {
              if (streamErr || !readStream)
                return fail(streamErr ?? new Error('no stream'));
              let size = 0;
              let aborted = false;
              readStream.on('data', (chunk: Buffer) => {
                if (settled || aborted) return;
                size += chunk.length;
                aggregate += chunk.length;
                // Aggregate budget blown → stop the whole archive (zip-bomb).
                // Destroy the stream so a single oversize entry can't keep
                // decompressing past the budget.
                if (aggregate > caps.maxTotalBytes) {
                  aborted = true;
                  readStream.destroy();
                  entries.push({ path: normalized, size });
                  return fail(
                    new RpcException({
                      code: status.INVALID_ARGUMENT,
                      message: `Changed files exceed the aggregate size cap (${caps.maxTotalBytes} bytes); run a full scan instead`,
                    }),
                  );
                }
                // Stop reading a single oversize entry early (memory bound). The
                // recorded (over-cap) size makes the pure validator reject it
                // with a precise per-file message on 'close'.
                if (size > caps.maxFileBytes) {
                  aborted = true;
                  readStream.destroy();
                }
              });
              readStream.on('error', (re) => {
                // A bare destroy() emits 'close', not 'error'; treat any real
                // stream error as a hard reject.
                if (!settled) fail(re);
              });
              readStream.on('close', () => {
                if (settled) return;
                entries.push({ path: normalized, size });
                readNext();
              });
            });
          });
          zipfile.on('end', () => done());
          zipfile.on('error', (ze) => fail(ze));
          readNext();
        },
      );
    });
  }

  /**
   * Returns true when a posix-normalized entry path is a path traversal attempt.
   * Covers both relative traversal (`..`) and absolute paths.
   */
  private isPathTraversal(normalized: string): boolean {
    return normalized.startsWith('..') || path.isAbsolute(normalized);
  }

  /**
   * Returns true when an entry name, as written in the uploaded archive, is
   * refused before any other check: a backslash (the archive writer turns it
   * into a separator, so the name would change meaning after every check), a
   * NUL, a `..` segment, or an absolute path (a leading `/` or a drive
   * letter).
   */
  private isUnsafeEntryName(name: string): boolean {
    if (name.includes('\\') || name.includes('\0')) return true;
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return true;
    return name.split('/').some((segment) => segment === '..');
  }

  /**
   * Extract supported files from ZIP and create filtered ZIP; the path of the
   * filtered archive (see {@link filterArchive}).
   */
  private async filterZipFile(
    zipFilePath: string,
    tempDir: string,
    checked?: CheckedZip,
  ): Promise<string> {
    return (await this.filterArchive(zipFilePath, tempDir, checked)).path;
  }

  /**
   * Write the entries of the uploaded archive the scanners read to
   * `tempDir/filtered.zip`, and count the entries left out, by reason.
   *
   * `checked` is the archive as opened and checked by the caller: the filter
   * reads those same entries from that same open file, so what is forwarded
   * is what was checked. Without it, the archive is opened and checked here.
   */
  private async filterArchive(
    zipFilePath: string,
    tempDir: string,
    checked?: CheckedZip,
  ): Promise<FilteredArchive> {
    // Prevent path traversal
    if (zipFilePath.includes('..') || tempDir.includes('..')) {
      this.logger.error('Invalid path provided to filterZipFile');
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Invalid path',
      });
    }

    // Check existence
    await fs.promises.access(zipFilePath, fs.constants.F_OK);
    await fs.promises.access(tempDir, fs.constants.F_OK);

    const zip =
      checked ?? (await openCheckedZip(zipFilePath, this.declaredLimits()));
    try {
      return await this.writeFilteredZip(zip, tempDir);
    } finally {
      if (!checked) zip.close();
    }
  }

  /** Write the entries of `zip` the scanners read to `tempDir/filtered.zip`. */
  private async writeFilteredZip(
    zip: CheckedZip,
    tempDir: string,
  ): Promise<FilteredArchive> {
    const leftOut = new UploadFilterSummaryBuilder();
    // Every read of an entry goes through one meter, whoever reads it: the
    // sizes the archive declares were checked before filtering, but they are
    // written by whoever built it, so the bytes really inflated are counted
    // too and the read aborts past a limit.
    const meter = new InflateMeter(this.forwardedLimits());
    // The entry streams being read, so the deadline can stop them.
    const reading = new Set<Readable>();
    const entryOf = (record: ZipEntryRecord) => ({
      open: async () => {
        const stream = meter.wrap(
          await zip.openEntry(record),
          record.name,
        ) as Readable;
        reading.add(stream);
        stream.once('close', () => reading.delete(stream));
        return stream;
      },
    });

    // Prepare output
    const outPath = path.join(tempDir, 'filtered.zip');
    const output = fs.createWriteStream(outPath);
    const archive = this.createArchiveWriter();
    // Listened from the start: an entry that fails makes the archiver emit
    // 'error', possibly after the entry's own promise has settled, and an
    // unlistened 'error' would crash the process.
    let archiveError: Error | null = null;
    archive.on('error', (e: Error) => {
      archiveError ??= e;
    });
    const written = new Promise<void>((resolve, reject) => {
      output.on('close', () => resolve());
      output.on('error', reject);
      archive.on('error', reject);
    });
    // Settled by the caller's await below or by the abort path.
    written.catch(() => undefined);
    archive.pipe(output);
    // A refused or broken entry: stop writing (the caller removes the
    // temporary directory, the partial output with it).
    // Settled when the writing is stopped (a deadline, a refused or broken
    // entry): every wait on the writer is raced against it, since a writer
    // aborted once its finalisation has started never settles.
    let stop: (reason: Error) => void = () => undefined;
    const stopped = new Promise<never>((_resolve, reject) => {
      stop = reject;
    });
    stopped.catch(() => undefined);
    const abort = () => {
      stop(archiveError ?? new Error('The filtered archive was not written'));
      archive.abort();
      output.destroy();
    };
    meter.onLimit(abort);

    // One archive may not hold the processing slot for longer than its
    // deadline: past it, the entry being read and the output are stopped
    // through the same abort path, and this upload alone fails.
    const deadlineMs = this.archiveDeadlineMs();
    const overDeadline = new ProcessingDeadlineError(
      `The archive took longer than ${formatDuration(deadlineMs)} to filter on this service: the scan was stopped`,
    );
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      stop(overDeadline);
      for (const stream of reading) stream.destroy(overDeadline);
      abort();
    }, deadlineMs);
    try {
      // Helper: Check if file is at root level (no subdirectories)
      const isAtRoot = (filePath: string): boolean => {
        const normalized = filePath.replaceAll('\\', '/');
        const parts = normalized.split('/').filter((p) => p.length > 0);
        return parts.length === 1;
      };

      // The uploaded .git/config is read for two facts only (see
      // GitConfigScanner) and never forwarded.
      const gitConfig = new GitConfigScanner();
      let gitHistoryKept = false;

      // Process entries
      for (const record of zip.entries) {
        const origName = record.name;
        const normalized = path.posix.normalize(origName);
        const entry = entryOf(record);
        if (expired) throw overDeadline;

        // skip directories
        if (record.uncompressedSize === 0 && /[/\\]$/.test(origName)) continue;

        // block path traversal, judged on the name as uploaded
        if (
          this.isUnsafeEntryName(origName) ||
          this.isPathTraversal(normalized)
        ) {
          this.logger.warn(`Blocked path traversal: ${origName}`);
          leftOut.unsafeName();
          continue;
        }

        // .git: the secret scanner reads the commit history
        // (gitleaks --log-opts=--all), so the objects, refs and HEAD are kept,
        // streamed and metered like any other entry. Nothing git would execute
        // is forwarded: hooks, attributes, submodule configs and nested .git
        // directories are skipped without being inflated, and the repository
        // config is replaced by a minimal one once every entry is read.
        const gitDecision = gitEntryDecision(normalized);
        if (gitDecision === 'config') {
          await this.scanEntry(entry, (chunk) => gitConfig.write(chunk), abort);
          continue;
        }
        if (gitDecision === 'drop') {
          this.logger.debug(`Dropped git metadata: ${normalized}`);
          leftOut.gitMetadata();
          continue;
        }
        if (gitDecision === 'keep') {
          await this.appendEntryStream(archive, entry, normalized, abort);
          gitHistoryKept = true;
          continue;
        }

        // A scanner's own configuration file is never forwarded: committed to
        // the repository, it could switch the scanner's detection off (see
        // SCANNER_CONFIGURATION_FILES).
        if (isScannerConfigurationFile(normalized)) {
          this.logger.debug(`Dropped scanner configuration: ${normalized}`);
          leftOut.scannerConfiguration();
          continue;
        }

        // exclude patterns
        if (shouldExcludeFile(normalized)) {
          this.logger.debug(`Excluded by pattern: ${normalized}`);
          leftOut.excludedPath(normalized);
          continue;
        }

        // Additional safety: double-check the path doesn't contain excluded directories
        const pathSegments = normalized.split('/');
        const hasExcludedDir = pathSegments.some((segment) => {
          const lower = segment.toLowerCase();
          return (
            lower === 'node_modules' ||
            lower === 'vendor' ||
            lower === '__pycache__' ||
            lower === '.venv' ||
            lower === 'venv' ||
            lower === 'dist' ||
            lower === 'build'
          );
        });

        if (hasExcludedDir) {
          this.logger.debug(`Excluded by directory check: ${normalized}`);
          leftOut.excludedPath(normalized);
          continue;
        }

        // check by name or extension
        const base = path.basename(normalized).toLowerCase();
        const ext = path.extname(base).toLowerCase();
        const baseName = path.basename(normalized, ext).toLowerCase();

        // PRIORITY 1: Exclude binary/media files FIRST (before any other check)
        if (this.binaryExtensions.has(ext)) {
          this.logger.debug(
            `Excluded binary/media file: ${normalized} (extension: ${ext})`,
          );
          leftOut.excludedType();
          continue;
        }

        // PRIORITY 2: Check if file should ALWAYS be kept (requirements.txt, package.json, etc.)
        const keepByName = this.alwaysKeepNames.has(base);
        const keepByExt = this.extensionToLanguageMap.has(ext);
        const keepByConfigExt = this.configFileExtensions.has(ext);
        // Configuration and data files the secret scanner reads, at any depth.
        const keepForSecrets = isSecretScanFile(base, ext);
        const isDockerfileVariant = base.startsWith('dockerfile');
        const isValidFileWithoutExt = this.validFilesWithoutExtension.has(
          path.basename(origName),
        );

        // If file matches any "always keep" criteria, keep it regardless of location
        if (
          keepByName ||
          keepByExt ||
          keepByConfigExt ||
          keepForSecrets ||
          isDockerfileVariant ||
          isValidFileWithoutExt
        ) {
          this.logger.debug(
            `Keeping required file: ${normalized} (keepByName=${keepByName}, keepByExt=${keepByExt}, keepByConfigExt=${keepByConfigExt}, keepForSecrets=${keepForSecrets})`,
          );
          await this.appendEntryStream(archive, entry, normalized, abort);
          continue;
        }

        // PRIORITY 3: Handle documentation files - only allowed at root
        if (this.rootOnlyDocExtensions.has(ext)) {
          if (isAtRoot(normalized)) {
            this.logger.debug(`Keeping root documentation: ${normalized}`);
            await this.appendEntryStream(archive, entry, normalized, abort);
            continue;
          } else {
            this.logger.debug(
              `Excluded non-root documentation: ${normalized} (extension: ${ext})`,
            );
            leftOut.excludedType();
            continue;
          }
        }

        // PRIORITY 4: Handle documentation files by name (LICENSE, README, etc.)
        if (this.rootOnlyDocNames.has(baseName)) {
          if (isAtRoot(normalized)) {
            this.logger.debug(
              `Keeping root documentation file: ${normalized} (name: ${baseName})`,
            );
            await this.appendEntryStream(archive, entry, normalized, abort);
            continue;
          } else {
            this.logger.debug(
              `Excluded non-root documentation: ${normalized} (name: ${baseName})`,
            );
            leftOut.excludedType();
            continue;
          }
        }

        // If we reach here, the file doesn't match any criteria - exclude it
        this.logger.debug(`Excluded by name/extension: ${normalized}`);
        leftOut.excludedType();
        continue;
      }

      if (gitHistoryKept) {
        archive.append(Buffer.from(gitConfig.safeConfig()), {
          name: SAFE_GIT_CONFIG_ENTRY,
        });
      }

      // Finalize
      if (expired) throw overDeadline;
      if (archiveError) throw archiveError;
      await Promise.race([archive.finalize(), stopped]);
      await Promise.race([written, stopped]);
      if (expired) throw overDeadline;
      const summary = leftOut.summary();
      const dropped: DroppedEntryCounts = {
        scannerConfiguration: summary.scannerConfiguration,
        excludedPath: summary.excludedPath,
        excludedType: summary.excludedType,
        unsafeName: summary.unsafeName,
        gitMetadata: summary.gitMetadata,
      };
      return { path: outPath, dropped, summary };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Append one entry to `archive` as a stream and wait until the archiver has
   * read all of it, so a single entry is in memory a chunk at a time and the
   * next entry is opened only once this one is done. Rejects on the entry's
   * stream error (an inflate failure, a limit of the meter) or the archiver's.
   */
  private async appendEntryStream(
    archive: ZipWriter,
    entry: { open: () => Promise<NodeJS.ReadableStream> },
    name: string,
    abort: () => void,
  ): Promise<void> {
    let source: NodeJS.ReadableStream;
    try {
      source = await entry.open();
    } catch (err) {
      abort();
      throw err;
    }
    return new Promise<void>((resolve, reject) => {
      const done = (err?: Error) => {
        source.removeListener('end', onEnd);
        source.removeListener('error', done);
        archive.removeListener('error', done);
        if (err) {
          abort();
          reject(err);
        } else resolve();
      };
      const onEnd = () => done();
      source.once('end', onEnd);
      source.once('error', done);
      archive.once('error', done);
      archive.append(source, { name });
    });
  }

  /**
   * Read one entry a chunk at a time into `onChunk`, without writing it to the
   * archive. The entry's stream is the metered one, so the limits apply; on an
   * error the output is aborted, as in {@link appendEntryStream}.
   */
  private async scanEntry(
    entry: { open: () => Promise<NodeJS.ReadableStream> },
    onChunk: (chunk: Buffer) => void,
    abort: () => void,
  ): Promise<void> {
    let source: NodeJS.ReadableStream;
    try {
      source = await entry.open();
    } catch (err) {
      abort();
      throw err;
    }
    return new Promise<void>((resolve, reject) => {
      source.on('data', (chunk: Buffer) => onChunk(chunk));
      source.once('end', () => resolve());
      source.once('error', (err: Error) => {
        abort();
        reject(err);
      });
    });
  }

  /**
   * The writer of the filtered archive. Compression level 6 = zlib default:
   * level 9 ate ~5x more CPU for only ~5-8% smaller output, a bad trade on a
   * CPU-throttled pod.
   */
  private createArchiveWriter(): ArchiveWriter {
    return archiver('zip', { zlib: { level: 6 } }) as ArchiveWriter;
  }

  /** How long one archive may take to be read and rewritten. */
  private archiveDeadlineMs(): number {
    const raw = Number(this.configService.get('FILE_SCAN_ARCHIVE_DEADLINE_MS'));
    return Number.isFinite(raw) && raw > 0
      ? Math.floor(raw)
      : DEFAULT_ARCHIVE_DEADLINE_MS;
  }

  /** The size limits of an uploaded full-scan archive. */
  private zipLimits(): ZipLimits {
    return resolveZipLimits((key) => this.configService.get(key));
  }

  /** What this edition's scanners accept of the forwarded archive; null: no bound of their own. */
  private scannerLimits(): Readonly<ScannerArchiveLimits> | null {
    return scannerArchiveLimits(currentEdition());
  }

  /** The limits of what is forwarded to the scanners (the filtered archive). */
  private forwardedLimits(): ZipLimits {
    return forwardedZipLimits(this.zipLimits(), this.scannerLimits());
  }

  /**
   * The limits the uploaded archive's central directory is held to before
   * anything is inflated. The entry count bounds the forwarded archive too (it
   * never holds more entries than the upload), so the scanners' own bound
   * applies to it.
   */
  private declaredLimits(): ZipLimits {
    return {
      ...this.zipLimits(),
      maxEntries: this.forwardedLimits().maxEntries,
    };
  }

  /**
   * Refuse a filtered archive larger than the scanners download: they would
   * each refuse it, so no scan starts.
   */
  private async assertForwardableSize(filteredZipPath: string): Promise<void> {
    const scanner = this.scannerLimits();
    if (!scanner) return;
    const { size } = await fs.promises.stat(filteredZipPath);
    if (size > scanner.maxArchiveBytes) {
      throw new ArchiveLimitError(
        'ARCHIVE_TOO_LARGE',
        `The archive kept for scanning is too large: ${formatBytes(size)} exceeds the ${formatBytes(scanner.maxArchiveBytes)} the scanners download`,
      );
    }
  }

  /**
   * Compute file metrics from a local ZIP (LOC, total size, detected
   * languages). Mirrors what security-scanning's `scanUtils.processZipFile`
   * does, but runs here while we still have the filtered ZIP on disk —
   * eliminating the second download + parse round trip that used to block
   * `startScan` long enough for the service-mesh upstream timeout to fire.
   *
   * Languages are returned as a deduplicated list of display names
   * (e.g. ["TypeScript", "Python"]).
   *
   * `totalLOC` only counts non-empty lines from files whose extension is
   * recognised as code (same predicate as the filter step).
   *
   * **Hang protection.** A single zip entry whose stream
   * never emits `close` (e.g., a malformed file picked up as code because
   * of its extension) would leave `yauzl` and the underlying file
   * descriptor open forever, blocking the surrounding `processUploadedFile`
   * await and leaking `/tmp` directories + FDs at every cron tick.
   *
   * The hardened implementation:
   *  - per-file timeout (`perFileTimeoutMs`): if a single entry stream
   *    stalls, we destroy it, log a warning, and resume with the next
   *    entry. The metric is partial (missing LOC for that file) but the
   *    promise still resolves.
   *  - overall timeout (`overallTimeoutMs`): hard cap on the whole pass.
   *    On expiry we close the zipfile and reject so the caller's catch
   *    can fall back to security-scanning's `processZipFile`.
   *  - per-entry size guard (`maxEntrySize`): skips entries whose
   *    uncompressed size exceeds the cap (most often: a giant minified
   *    JSON / SVG / generated file that would dominate the LOC count
   *    anyway and risks reading hundreds of MB into memory).
   *  - listeners on `rs.on('error')` AND `rl.on('error')` AND
   *    `openReadStream` callback's err — readline does not always forward
   *    stream errors, so we wire all three.
   *  - `streamErr` on a single entry no longer rejects the whole promise:
   *    we skip the entry and continue, same as for timeouts.
   */
  @Span()
  async computeZipMetrics(
    zipFilePath: string,
    opts: {
      overallTimeoutMs?: number;
      perFileTimeoutMs?: number;
      maxEntrySize?: number;
    } = {},
  ): Promise<{
    totalLOC: number;
    totalSize: string;
    language: string[];
  }> {
    const overallTimeoutMs = opts.overallTimeoutMs ?? 90_000;
    // 8 s per file: at byte-counting throughput a healthy 500 KB file
    // completes in <100 ms. 8 s is generous enough to ride out a CFS
    // throttle hiccup on the cron pod but short enough that four
    // pathological files don't burn the entire 60 s overall budget.
    const perFileTimeoutMs = opts.perFileTimeoutMs ?? 8_000;
    const maxEntrySize = opts.maxEntrySize ?? 5 * 1024 * 1024; // 5 MiB

    const stats = await fs.promises.stat(zipFilePath);
    const fileSizeInMb = stats.size / (1024 * 1024);
    const totalSize = `${fileSizeInMb.toFixed(2)}Mo`;

    return new Promise((resolve, reject) => {
      let totalLOC = 0;
      const languageNames = new Set<string>();
      let zipfileRef: yauzl.ZipFile | null = null;
      let settled = false;

      const closeZipfileSafely = () => {
        try {
          // yauzl exposes `close()` on the zipfile object; calling it
          // releases the underlying fd even if `autoClose` could not
          // trigger (because we never reached `end`).
          (zipfileRef as unknown as { close?: () => void } | null)?.close?.();
        } catch {
          /* ignore */
        }
      };

      const overallTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        closeZipfileSafely();
        // Resolve with PARTIAL metrics rather than reject. Languages are
        // detected from file extensions BEFORE any byte is read, so even
        // a timeout-heavy run typically yields the full language list —
        // and that's the field SAST scanner selection depends on. LOC may
        // be incomplete (we drop the in-flight entry's count), but
        // partial LOC is strictly better than `language: []` which
        // disables SAST entirely downstream: a rejected promise would make
        // the caller drop the languages, security-scanning would save
        // `language: []`, and the SAST pod would never be launched.
        this.logger.warn(
          `[ZIP metrics] overall timeout after ${overallTimeoutMs}ms — returning partial metrics (totalLOC=${totalLOC}, languages=${languageNames.size})`,
        );
        resolve({
          totalLOC,
          totalSize,
          language: Array.from(languageNames),
        });
      }, overallTimeoutMs);
      // Avoid keeping the event loop alive just for this timer.
      (overallTimer as unknown as { unref?: () => void }).unref?.();

      const resolveOk = () => {
        if (settled) return;
        settled = true;
        clearTimeout(overallTimer);
        resolve({
          totalLOC,
          totalSize,
          language: Array.from(languageNames),
        });
      };

      const failHard = (e: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(overallTimer);
        closeZipfileSafely();
        reject(e);
      };

      yauzl.open(
        zipFilePath,
        { lazyEntries: true, autoClose: true },
        (err, zipfile) => {
          if (err) return failHard(err);
          zipfileRef = zipfile;

          const readNext = () => {
            if (settled) return;
            try {
              zipfile.readEntry();
            } catch (e) {
              failHard(e instanceof Error ? e : new Error(String(e)));
            }
          };

          readNext();

          zipfile.on('entry', (entry) => {
            if (settled) return;

            // Skip directories
            if (/\/$/.test(entry.fileName)) return readNext();

            // Path-traversal guard (also enforced earlier by filterZipFile,
            // but defensive belt-and-braces is cheap here).
            const normalized = path.normalize(entry.fileName);
            if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
              this.logger.warn(
                `[ZIP metrics] Ignored entry (path traversal): ${entry.fileName}`,
              );
              return readNext();
            }

            // Skip the `.git/*` tree wholesale. `filterZipFile` keeps it in
            // the archive on purpose so that gitleaks can scan commit
            // history in the scanner pod via `--log-opts=--all`, but
            // none of those entries should contribute to LOC or language
            // metrics:
            //  - blobs (`.git/objects/<sha>`, often thousands) have no
            //    extension and would be filtered out implicitly anyway,
            //    but iterating through them costs CPU we don't have on
            //    a throttled cron pod;
            //  - the pack file (`.git/objects/pack/*.pack`) is large and
            //    would otherwise hit the size guard, polluting the logs
            //    with a WARN every scan.
            // Doing the skip here, before the size guard / language
            // classification, is purely an optimisation + log hygiene.
            if (normalized === '.git' || normalized.startsWith('.git/')) {
              return readNext();
            }

            // Size guard: skip oversized entries (usually huge minified or
            // generated files that would dominate the LOC count and risk
            // hanging readline / blowing up memory).
            const uncompressedSize = Number(
              (entry as unknown as { uncompressedSize?: number })
                .uncompressedSize ?? 0,
            );
            if (uncompressedSize > maxEntrySize) {
              this.logger.warn(
                `[ZIP metrics] Skipping oversized entry ${entry.fileName} (${uncompressedSize} bytes > ${maxEntrySize})`,
              );
              return readNext();
            }

            // Classify by extension OR by well-known extension-less name.
            const fileExt = path.extname(entry.fileName).toLowerCase();
            let langName: string | undefined;
            if (fileExt) {
              langName = this.extensionToLanguageNameMap.get(fileExt);
            } else if (
              this.validFilesWithoutExtension.has(path.basename(entry.fileName))
            ) {
              langName = path.basename(entry.fileName);
            }

            if (!langName) return readNext();
            languageNames.add(langName);

            // JSON-family entries: detect the language for scanner
            // selection (so the JSON scanner can run if relevant), but
            // skip the byte-counting pass entirely. Real-world JSON
            // files in scanned repos are either generated artifacts
            // (e.g., agent analysis outputs, OpenAPI dumps, schema
            // files) where LOC is meaningless, or huge data dumps.
            // Keeping the language in the result preserves the signal
            // that JSON exists in the repo.
            if (
              fileExt === '.json' ||
              fileExt === '.jsonc' ||
              fileExt === '.json5'
            ) {
              return readNext();
            }

            // Lockfiles: SCA needs them in the archive (and
            // filterZipFile keeps them via `alwaysKeepNames`), but the
            // content is machine-generated and dominates LOC if counted.
            // `*.lock` covers yarn.lock, uv.lock, Cargo.lock,
            // composer.lock, Pipfile.lock, Gemfile.lock, mix.lock,
            // flake.lock, etc. `pnpm-lock.yaml/yml` is the YAML-based
            // variant pnpm uses — the only one not caught by the
            // `.lock` extension match (and a frequent cause of per-file
            // timeouts).
            const basenameLower = path.basename(entry.fileName).toLowerCase();
            if (
              fileExt === '.lock' ||
              basenameLower === 'pnpm-lock.yaml' ||
              basenameLower === 'pnpm-lock.yml'
            ) {
              return readNext();
            }

            // Stream the file, count non-empty lines via raw byte scan
            // (no readline / no per-line string allocation). On a
            // CPU-throttled cron pod this is ~10× faster than the
            // readline path, which hits per-file timeouts on routine
            // ~500 KB JSON / YAML files.
            //
            // A "line" is counted as non-empty when it contains at least
            // one byte that is not `\n` / `\r` / space / tab. UTF-8
            // continuation bytes (0x80-0xBF) count as content too. The
            // last line without a trailing newline is also counted.
            zipfile.openReadStream(entry, (streamErr, rs) => {
              if (settled) return;
              if (streamErr) {
                this.logger.warn(
                  `[ZIP metrics] openReadStream failed for ${entry.fileName}: ${streamErr.message}`,
                );
                return readNext();
              }

              let perFileDone = false;
              let lineHasContent = false;
              let entryLOC = 0;

              const perFileTimer = setTimeout(() => {
                if (perFileDone) return;
                perFileDone = true;
                this.logger.warn(
                  `[ZIP metrics] per-file timeout (${perFileTimeoutMs}ms) for ${entry.fileName} — skipping`,
                );
                try {
                  rs.destroy();
                } catch {
                  /* ignore */
                }
                readNext();
              }, perFileTimeoutMs);
              (perFileTimer as unknown as { unref?: () => void }).unref?.();

              const finishFile = (commit: boolean) => {
                if (perFileDone) return;
                perFileDone = true;
                clearTimeout(perFileTimer);
                if (commit) {
                  if (lineHasContent) entryLOC += 1; // tail line w/o \n
                  totalLOC += entryLOC;
                }
                readNext();
              };

              rs.on('data', (chunk: Buffer) => {
                for (let i = 0; i < chunk.length; i++) {
                  const b = chunk[i];
                  if (b === 0x0a /* \n */) {
                    if (lineHasContent) entryLOC += 1;
                    lineHasContent = false;
                  } else if (
                    b !== 0x09 /* \t */ &&
                    b !== 0x20 /* space */ &&
                    b !== 0x0d /* \r */
                  ) {
                    lineHasContent = true;
                  }
                }
              });
              rs.on('end', () => finishFile(true));
              rs.on('error', (rsErr) => {
                this.logger.warn(
                  `[ZIP metrics] read stream error for ${entry.fileName}: ${rsErr.message}`,
                );
                finishFile(false);
              });
              // `close` fires after `end` or after `destroy()` — covers
              // the case where the stream is torn down without an `end`.
              rs.on('close', () => finishFile(false));
            });
          });

          zipfile.on('end', resolveOk);
          zipfile.on('error', failHard);
        },
      );
    });
  }

  /**
   * Delete a file from storage and DB record
   */
  @Span()
  async deleteFile(request: DeleteFileRequest): Promise<DeleteFileResponse> {
    const record = await this.fileScanRepository.findOne({
      where: { scanId: request.scanId },
    });
    if (!record) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `File not found`,
      });
    }
    const objectPath = record.objectPath;
    // A scan may hold the raw key, the derived `filtered/` key, and/or
    // the legacy `.filtered.zip` key (best-effort raw-delete can leave
    // the raw; straddling scans may hold the legacy key). Sweep all, idempotent.
    const keys = [
      objectPath,
      this.filteredScanKey(objectPath),
      this.legacyFilteredScanKey(objectPath),
      historyObjectKey(record.projectId, request.scanId),
    ];

    await this.fileScanRepository.delete({ scanId: request.scanId });
    for (const key of keys) {
      try {
        if (this.backend) {
          await this.backend.delete(key);
        } else {
          await this.s3Client!.send(
            new DeleteObjectCommand({ Bucket: this.s3BucketName!, Key: key }),
          );
        }
      } catch (err: any) {
        if (err?.code === 404 || err?.name === 'NotFound') continue;
        this.logger.error(`Delete error for ${key}`, err);
      }
    }
    return {
      success: true,
      message: `Deleted from ${this.backend?.label ?? 'S3'}`,
    };
  }

  /**
   * The clean artifact lives under a dedicated `filtered/` prefix the
   * client's presign (scoped to `scan/`) can never overwrite — on GCS and S3
   * alike — closing the TOCTOU re-write race between server-side filtering and
   * the scanner's read. Applies to every scan, diff scans included.
   */
  private filteredScanKey(objectPath: string): string {
    if (!objectPath.startsWith('scan/')) {
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Cannot derive filtered key: object path is not under scan/',
      });
    }
    return objectPath.replace(/^scan\//, 'filtered/');
  }

  /**
   * Legacy same-folder derived key (`scan/<…>.filtered.zip`). Transitional
   * only: read fallback + cleanup sweep for diff scans whose artifact was
   * written before the `filtered/` prefix existed. Remove once no in-flight
   * scans reference it.
   */
  private legacyFilteredScanKey(objectPath: string): string {
    return objectPath.replace(/\.zip$/i, '.filtered.zip');
  }

  /**
   * Generate a signed URL for download
   */
  @Span()
  async getDownloadUrl(
    data: GetDownloadUrlRequest,
  ): Promise<GetDownloadUrlResponse> {
    const record = await this.fileScanRepository.findOne({
      where: { scanId: data.scanId },
    });
    if (!record) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `File not found in DB`,
      });
    }
    const objectPath = record.objectPath;
    // Every scan's scanner-readable artifact lives on the derived
    // `filtered/` key. Try it first, then the legacy `.filtered.zip` key,
    // then the raw key (transitional fallbacks for scans straddling an
    // upgrade: an older full scan's filtered bytes sat on the raw key).
    // The history artifact has its own key and never falls back to the
    // archive keys: a missing history is NOT_FOUND.
    const candidateKeys =
      (data.artifact ?? 'archive') === 'history'
        ? [historyObjectKey(record.projectId, data.scanId)]
        : [
            this.filteredScanKey(objectPath),
            this.legacyFilteredScanKey(objectPath),
            objectPath,
          ];
    // A scanner pod on an external cluster (Community cluster scans) cannot
    // reach S3_ENDPOINT: `audience: 'external'` signs on S3_PUBLIC_ENDPOINT
    // (the storage client when none is set). Absent or any other value keeps
    // the internal client, as before. The existence check always goes to the
    // storage client. An edition backend's signed URLs are public already.
    const signer = this.backend
      ? undefined
      : this.presignClient(
          data.audience === 'external' ? 'browser' : 'internal',
        );

    const ttlSeconds =
      (data.artifact ?? 'archive') === 'history'
        ? HISTORY_DOWNLOAD_URL_TTL_SECONDS
        : DOWNLOAD_URL_TTL_SECONDS;

    for (const key of candidateKeys) {
      if (this.backend) {
        if (!(await this.backend.exists(key))) continue;
        const url = await this.backend.signGet(key, {
          expiresAtMs: Date.now() + ttlSeconds * 1000,
        });
        return { url };
      }
      try {
        await this.s3Client!.send(
          new HeadObjectCommand({ Bucket: this.s3BucketName!, Key: key }),
        );
      } catch (err: any) {
        if (err.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) {
          continue;
        }
        this.logger.error('Error checking S3 object for download', err);
        throw new RpcException({
          code: status.INTERNAL,
          message: 'Error checking S3 object',
        });
      }
      const url = await getSignedUrl(
        signer,
        new GetObjectCommand({ Bucket: this.s3BucketName!, Key: key }),
        { expiresIn: ttlSeconds },
      );
      return { url };
    }

    throw new RpcException({
      code: status.NOT_FOUND,
      message: `File not found`,
    });
  }

  /**
   * Mapping from MIME type to file extension for the generic report-upload
   * flow. Kept private so the proto contract stays the source of truth and
   * we never accept an arbitrary client-supplied extension.
   */
  private extensionForContentType(contentType: string): string {
    switch (contentType) {
      case 'application/pdf':
        return '.pdf';
      case 'text/html':
        return '.html';
      case 'application/json':
        return '.json';
      case 'text/markdown':
        return '.md';
      default:
        return '.bin';
    }
  }

  /**
   * Hand analysis-reporting a signed PUT URL so the report binary
   * never transits over gRPC. The signed URL is a v4 60s write URL pinned
   * to the supplied content type and capped at 100MB by header.
   */
  @Span()
  async requestReportUploadUrl(
    request: RequestReportUploadUrlRequest,
  ): Promise<RequestReportUploadUrlResponse> {
    if (!request.projectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'projectId is required',
      });
    }
    if (!request.contentType) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'contentType is required',
      });
    }

    const ext = this.extensionForContentType(request.contentType);
    const reportId = uuidv6();
    const objectPath = `reports/${request.projectId}/${reportId}${ext}`;
    const expiresAtMs = Date.now() + 60_000; // 60s

    if (this.backend) {
      const { url: uploadUrl } = await this.backend.signPut(objectPath, {
        contentType: request.contentType,
        expiresAtMs,
        // Cap to ~100MB so a malicious caller can't fill the bucket. The
        // bound is a *signed* header: the caller (analysis-reporting
        // ReportUploadService) MUST echo it verbatim on the PUT. Keep the
        // value in lockstep with the range it sends.
        sizeRange: { min: 0, max: 104857600 },
      });
      if (!uploadUrl) {
        throw new RpcException({
          code: status.INTERNAL,
          message: `Failed to generate signed URL for ${this.backend.label} upload`,
        });
      }
      return {
        uploadUrl,
        objectPath,
        uploadExpiresAtMs: expiresAtMs as unknown as number,
      };
    }

    // S3-compatible: PUT signed URL via aws-sdk presigner.
    const uploadUrl = await getSignedUrl(
      this.s3Client!,
      new PutObjectCommand({
        Bucket: this.s3BucketName!,
        Key: objectPath,
        ContentType: request.contentType,
      }),
      { expiresIn: 60 },
    );
    return {
      uploadUrl,
      objectPath,
      uploadExpiresAtMs: expiresAtMs as unknown as number,
    };
  }

  /**
   * Build a Content-Disposition header value that forces the browser to
   * download the report rather than render it inline (PDFs default to
   * inline display, which broke the dashboard download button).
   *
   * Sanitization:
   *   - basename only (strips path traversal `/` and `\`)
   *   - drops CR/LF/TAB (header-injection defence)
   *   - replaces `"` and `\` with `_` (RFC 6266 quoted-string safety)
   * Empty/missing filename → bare `attachment` (browser falls back to the
   * URL's last segment, which is the UUID-named object key).
   */
  private buildContentDisposition(filename?: string): string {
    if (!filename) return 'attachment';
    const basename = filename.split(/[/\\]/).pop() ?? '';
    const safe = basename.replace(/[\r\n\t]/g, '').replace(/["\\]/g, '_');
    if (!safe) return 'attachment';
    return `attachment; filename="${safe}"`;
  }

  /**
   * Once analysis-reporting has PUT the buffer to GCS/S3 via the
   * URL returned by requestReportUploadUrl, this verifies the object is
   * actually there and hands back a signed READ URL with a configurable
   * TTL (default 15 minutes).
   *
   * The signed URL embeds Content-Disposition: attachment so the browser
   * downloads the file instead of rendering it inline — the dashboard
   * navigates to this URL via a synthetic anchor click, and PDFs would
   * otherwise open in-tab.
   */
  @Span()
  async finalizeReportUpload(
    request: FinalizeReportUploadRequest,
  ): Promise<FinalizeReportUploadResponse> {
    const objectPath = request.objectPath ?? '';
    if (!objectPath.startsWith('reports/')) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'objectPath must start with reports/',
      });
    }

    // Enforce that the objectPath belongs to the caller's projectId.
    // Reports are persisted under `reports/<projectId>/...`. Without this
    // check, a tenant with finalize-permission could exfiltrate another
    // tenant's PDF by replaying an objectPath observed elsewhere.
    //
    // FinalizeReportUploadRequest.project_id is required on the proto
    // contract. We still re-validate at
    // runtime in case a hand-crafted client emits an empty string.
    const callerProjectId = request.projectId ?? '';
    if (!callerProjectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'projectId is required',
      });
    }
    const expectedPrefix = `reports/${callerProjectId}/`;
    if (!objectPath.startsWith(expectedPrefix)) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `objectPath does not belong to projectId=${callerProjectId}`,
      });
    }

    const ttlSeconds =
      request.ttlSeconds && request.ttlSeconds > 0 ? request.ttlSeconds : 900;
    const expiresAtMs = Date.now() + ttlSeconds * 1000;
    const contentDisposition = this.buildContentDisposition(request.filename);

    if (this.backend) {
      if (!(await this.backend.exists(objectPath))) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: `Report not found at ${objectPath}`,
        });
      }
      const downloadUrl = await this.backend.signGet(objectPath, {
        signatureVersion: 'v4',
        expiresAtMs,
        responseDisposition: contentDisposition,
      });
      return {
        downloadUrl,
        expiresAtMs: expiresAtMs as unknown as number,
      };
    }

    // S3-compatible
    try {
      await this.s3Client!.send(
        new HeadObjectCommand({
          Bucket: this.s3BucketName!,
          Key: objectPath,
        }),
      );
    } catch (err: any) {
      if (err.name === 'NotFound') {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: `Report not found at ${objectPath}`,
        });
      }
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Error checking S3 object for download',
      });
    }
    // The dashboard navigates to this URL from a browser: sign it on the
    // public endpoint when one is set.
    const downloadUrl = await getSignedUrl(
      this.presignClient('browser'),
      new GetObjectCommand({
        Bucket: this.s3BucketName!,
        Key: objectPath,
        ResponseContentDisposition: contentDisposition,
      }),
      { expiresIn: ttlSeconds },
    );
    return {
      downloadUrl,
      expiresAtMs: expiresAtMs as unknown as number,
    };
  }

  /**
   * Check if object is ready for processing
   */
  @Span()
  async isFileReady(objectPath: string): Promise<boolean> {
    if (this.backend) {
      try {
        const meta = await this.backend.stat(objectPath);
        const size = meta.size;
        const ageSec = (Date.now() - meta.updated.getTime()) / 1000;
        const contentType = meta.contentType;
        this.logger.debug(
          `${this.backend.label} ready-check ${objectPath}: size=${size}, age=${ageSec}, type=${contentType}`,
        );
        return (
          size >= this.minFileSizeBytes &&
          ageSec >= this.minFileAgeSeconds &&
          contentType === 'application/zip'
        );
      } catch (err: any) {
        if (this.backend.isNotFound(err)) return false;
        this.logger.error(
          `${this.backend.label} isFileReady error for ${objectPath}`,
          err,
        );
        throw err;
      }
    } else {
      try {
        const head = await this.s3Client!.send(
          new HeadObjectCommand({
            Bucket: this.s3BucketName!,
            Key: objectPath,
          }),
        );
        const size = head.ContentLength ?? 0;
        const ageSec =
          (Date.now() - (head.LastModified?.getTime() ?? 0)) / 1000;
        const contentType = head.ContentType ?? '';
        this.logger.debug(
          `S3 ready-check ${objectPath}: size=${size}, age=${ageSec}, type=${contentType}`,
        );
        return (
          size >= this.minFileSizeBytes &&
          ageSec >= this.minFileAgeSeconds &&
          contentType === 'application/zip'
        );
      } catch (err: any) {
        if (err.name === 'NotFound') return false;
        this.logger.error(`S3 isFileReady error for ${objectPath}`, err);
        throw err;
      }
    }
  }

  /**
   * Open the uploaded archive once and refuse it unless it is a ZIP that can
   * be scanned: a `.zip` file starting with a ZIP signature, with exactly one
   * reading (see openCheckedZip), within `limits`, and holding at least one
   * file, none encrypted and none whose path is absolute or leaves the
   * archive's folder.
   *
   * Every refusal is a rejection of the returned promise (never a stream
   * 'error' event that could escape the caller), mostly an ArchiveLimitError
   * that names the reason. The caller filters the returned archive, which
   * holds the entries checked here, and closes it.
   */
  private async openUploadedArchive(
    filePath: string,
    limits: ZipLimits,
  ): Promise<CheckedZip> {
    if (!filePath.toLowerCase().endsWith('.zip')) {
      throw new TypeError("File must have '.zip' extension");
    }
    const fd = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(4);
    await fd.read(buf, 0, 4, 0);
    await fd.close();
    // A local file header, or the end-of-central-directory record of a ZIP
    // that holds nothing (refused below as empty, not as not a ZIP).
    const signature = buf.toString('hex').toUpperCase();
    if (signature !== '504B0304' && signature !== '504B0506') {
      throw new ArchiveLimitError(
        'ARCHIVE_INVALID',
        'The uploaded file is not a ZIP archive: only .zip archives are scanned',
      );
    }
    const zip = await openCheckedZip(filePath, limits);
    try {
      assertScannableZip(zip);
    } catch (err) {
      zip.close();
      throw err;
    }
    return zip;
  }

  /**
   * Download the uploaded archive `objectPath` to `destination`, refusing it
   * past `maxBytes` with `ARCHIVE_TOO_LARGE`: first from the size the store
   * reports, before a byte is read, then by counting the bytes as they
   * stream to disk (a reported size can be absent or stale). A signed S3 PUT
   * carries no size range and the GCS one allows 5 GiB, so this is where the
   * configured limit holds on both stores.
   */
  private async downloadUploadedArchive(
    objectPath: string,
    destination: string,
    maxBytes: number,
  ): Promise<void> {
    const tooLarge = (size?: number) =>
      new ArchiveLimitError(
        'ARCHIVE_TOO_LARGE',
        size === undefined
          ? `The uploaded archive is too large: it exceeds the ${formatBytes(maxBytes)} limit`
          : `The uploaded archive is too large: ${formatBytes(size)} exceeds the ${formatBytes(maxBytes)} limit`,
      );
    const counter = () => {
      let received = 0;
      return new Transform({
        transform(chunk: Buffer, _enc, cb) {
          received += chunk.length;
          if (received > maxBytes) return cb(tooLarge());
          cb(null, chunk);
        },
      });
    };

    if (this.backend) {
      this.logger.debug(
        `Downloading from ${this.backend.label}: ${objectPath}`,
      );
      const metadata = await this.backend.stat(objectPath);
      const size = Number(metadata?.size);
      if (Number.isFinite(size) && size > maxBytes) throw tooLarge(size);
      await pipeline(
        this.backend.createReadStream(objectPath),
        counter(),
        fs.createWriteStream(destination),
      );
      return;
    }

    this.logger.debug(`Downloading from S3: ${objectPath}`);
    const resp = await this.s3Client!.send(
      new GetObjectCommand({ Bucket: this.s3BucketName!, Key: objectPath }),
    );
    if (!resp.Body) throw new TypeError('Empty S3 response body');
    if (
      typeof resp.ContentLength === 'number' &&
      resp.ContentLength > maxBytes
    ) {
      (resp.Body as { destroy?: () => void }).destroy?.();
      throw tooLarge(resp.ContentLength);
    }
    const body = resp.Body as any;
    if (body.pipe) {
      await pipeline(body, counter(), fs.createWriteStream(destination));
    } else {
      const buf = Buffer.from(await body.transformToByteArray());
      if (buf.length > maxBytes) throw tooLarge(buf.length);
      await fs.promises.writeFile(destination, buf);
    }
  }

  /**
   * Remove the upload of a refused archive. Best effort: a failure is logged
   * by `deleteFileFromStorage` and the scan is failed either way.
   */
  private async removeRefusedUpload(objectPath: string): Promise<void> {
    try {
      await this.deleteFileFromStorage(objectPath);
    } catch {
      // logged by deleteFileFromStorage
    }
  }

  /**
   * Download, validate, filter, upload, and start scan
   */
  @Span()
  /**
   * Upload the filtered archive from its file, as a stream. It used to be read
   * whole into a Buffer first: hundreds of MB on top of what the filter holds,
   * in a pod that processes several uploads.
   *
   * A stream cannot be sent twice, so the S3 SDK cannot retry it as it did a
   * Buffer: each attempt sends a fresh stream of the file. GCS keeps its own
   * retry rules, as for the Buffer it was given before.
   */
  private async uploadFilteredArchive(
    filePath: string,
    key: string,
  ): Promise<void> {
    if (this.backend) {
      await this.backend.uploadFile(filePath, key, 'application/zip');
      return;
    }
    const { size } = await fs.promises.stat(filePath);
    const client = this.s3UploadClient ?? this.s3Client!;
    for (let attempt = 1; ; attempt++) {
      const body = fs.createReadStream(filePath);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: this.s3BucketName!,
            Key: key,
            Body: body,
            ContentLength: size,
            ContentType: 'application/zip',
          }),
        );
        return;
      } catch (err) {
        if (attempt >= FILTERED_UPLOAD_ATTEMPTS) throw err;
        this.logger.warn(
          `Upload of the filtered archive failed (attempt ${attempt}/${FILTERED_UPLOAD_ATTEMPTS}), retrying: ${
            err instanceof Error ? err.message : err
          }`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, this.uploadRetryDelayMs * 2 ** (attempt - 1)),
        );
      } finally {
        body.destroy();
      }
    }
  }

  /**
   * After a failure of this service's file system, put the upload back for a
   * later tick (its archive stays in storage, its scan is not failed), at
   * most MAX_SYSTEM_FAILURE_RETRIES times. Returns whether it was put back.
   */
  private async retryAfterSystemFailure(
    fileRecord: FileScan,
    err: unknown,
    tempDir: string,
  ): Promise<boolean> {
    if (!isSystemError(err)) {
      this.systemFailures.delete(fileRecord.scanId);
      return false;
    }
    const failures = (this.systemFailures.get(fileRecord.scanId) ?? 0) + 1;
    if (failures > MAX_SYSTEM_FAILURE_RETRIES) {
      this.systemFailures.delete(fileRecord.scanId);
      return false;
    }
    this.systemFailures.set(fileRecord.scanId, failures);
    this.logger.warn(
      `File-system failure while processing ${fileRecord.scanId} (${err.code}), retry ${failures}/${MAX_SYSTEM_FAILURE_RETRIES}`,
    );
    await this.fileScanRepository.update(
      { id: fileRecord.id },
      { status: FileStatus.PENDING_UPLOAD, updatedAt: new Date() },
    );
    await fs.promises
      .rm(tempDir, { recursive: true, force: true })
      .catch(() => undefined);
    return true;
  }

  async processUploadedFile(fileRecord: FileScan): Promise<boolean> {
    const fileId = uuidv6();
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';
    const tempDir = isProd
      ? path.join('/tmp', fileId)
      : path.join(__dirname, '../../uploads', fileId);
    // The uploaded archive once opened, closed whatever happens.
    let openZip: CheckedZip | null = null;

    try {
      const limits = this.zipLimits();
      // create temporary directory
      await fs.promises.mkdir(tempDir, { recursive: true });
      const tempZip = path.join(tempDir, 'original.zip');
      const objectPath = fileRecord.objectPath;

      // download from storage, bounded by the archive limit
      await this.downloadUploadedArchive(
        objectPath,
        tempZip,
        limits.maxArchiveBytes,
      );

      // Open the archive once: every check below and the filter read this
      // same reading of its bytes. A refused archive ends in the catch below,
      // which fails the scan with the reason named.
      let zip: CheckedZip;
      try {
        zip = await this.openUploadedArchive(tempZip, this.declaredLimits());
        this.logger.debug(`ZIP validation passed for ${tempZip}`);
      } catch (valErr) {
        if (valErr instanceof ArchiveLimitError || isSystemError(valErr)) {
          throw valErr;
        }
        this.logger.error(`ZIP validation failed: ${valErr.message}`);
        await this.fileScanRepository.update(
          { id: fileRecord.id },
          { status: FileStatus.FAILED },
        );
        await this.removeRefusedUpload(fileRecord.objectPath);
        await safeGrpcCall(
          this.scanServiceClient.updateScanData({
            scanId: fileRecord.scanId,
            state: 'failed',
            errorMessage: `Invalid ZIP: ${valErr.message}`,
          }),
        );
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        return false;
      }
      openZip = zip;
      this.logger.debug(
        `ZIP within limits for ${fileRecord.scanId}: ${zip.entries.length} entries, ${zip.declaredTotalBytes} bytes uncompressed`,
      );

      // The diff ZIP is built and uploaded by the agent — an
      // untrusted input. Enforce the diff guards (path traversal / .git / caps /
      // exclusions / zip-bomb) on the uploaded archive before it enters the scan
      // pipeline. On violation, fail the scan with a clear message so the agent
      // can fall back to a full scan. Normal scans (isDiffScan=false) are
      // unaffected — a full-repo ZIP legitimately exceeds these caps.
      if (fileRecord.isDiffScan) {
        try {
          const caps: DiffArchiveCaps = {
            maxFiles:
              this.configService.get<number>('DIFF_SCAN_MAX_FILES') ?? 300,
            maxFileBytes:
              this.configService.get<number>('DIFF_SCAN_MAX_FILE_BYTES') ??
              1_000_000,
            maxTotalBytes:
              this.configService.get<number>('DIFF_SCAN_MAX_TOTAL_BYTES') ??
              3_000_000,
          };
          const zipEntries = await this.readDiffZipEntries(tempZip, caps);
          const accepted = validateDiffZipEntries(zipEntries, caps);
          this.logger.log(
            `[DiffScan] Validated ${accepted.length} changed file(s) for scan ${fileRecord.scanId}`,
          );
        } catch (diffErr) {
          const message = this.extractRpcMessage(diffErr);
          this.logger.error(
            `[DiffScan] Rejected uploaded archive for ${fileRecord.scanId}: ${message}`,
          );
          await this.fileScanRepository.update(
            { id: fileRecord.id },
            { status: FileStatus.FAILED },
          );
          await this.removeRefusedUpload(fileRecord.objectPath);
          await safeGrpcCall(
            this.scanServiceClient.updateScanData({
              scanId: fileRecord.scanId,
              state: 'failed',
              errorMessage: `Diff archive rejected: ${message}`,
            }),
          );
          await fs.promises.rm(tempDir, { recursive: true, force: true });
          return false;
        }
      }

      // filter ZIP
      this.logger.debug(`Starting ZIP filtering for ${tempZip}`);
      let filteredZipPath: string;
      let uploadFilterSummary: UploadFilterSummary;
      try {
        const filtered = await this.filterArchive(tempZip, tempDir, zip);
        filteredZipPath = filtered.path;
        uploadFilterSummary = filtered.summary;
        this.logger.debug(
          `Left out of ${fileRecord.scanId}: ${JSON.stringify(filtered.dropped)}`,
        );
        this.logger.debug(`Filtered ZIP created at ${filteredZipPath}`);
      } catch (filterErr) {
        // An entry that inflated past a limit: the outer catch fails the
        // scan with the limit named. A failure of this service's file
        // system (a full disk on the write, an I/O error on a read): the
        // outer catch puts the upload back for a retry.
        // Past its processing deadline: failed as a processing error that
        // names the time limit, not as a fault of the archive.
        if (
          filterErr instanceof ArchiveLimitError ||
          filterErr instanceof ProcessingDeadlineError ||
          isSystemError(filterErr)
        ) {
          throw filterErr;
        }
        this.logger.error(`Error filtering ZIP: ${filterErr}`);
        await this.fileScanRepository.update(
          { id: fileRecord.id },
          { status: FileStatus.FAILED },
        );
        throw new RpcException({
          code: status.INTERNAL,
          message: 'Error filtering ZIP',
        });
      }
      if (!filteredZipPath) {
        this.logger.error('Filtering returned no ZIP');
        await this.fileScanRepository.update(
          { id: fileRecord.id },
          { status: FileStatus.FAILED },
        );
        return false;
      }

      // The original archive is no longer read: free its disk now rather than
      // at the end, while the filtered copy is uploaded and measured.
      zip.close();
      openZip = null;
      await fs.promises.rm(tempZip, { force: true });

      await this.assertForwardableSize(filteredZipPath);

      // Upload the filtered ZIP. The sanitized artifact always goes to
      // the derived `filtered/` key the client's presign (scoped to `scan/`)
      // cannot overwrite, so the scanner never reads client-controlled bytes
      // (closes the TOCTOU re-write race). Applies to full and diff scans alike.
      const targetKey = this.filteredScanKey(objectPath);
      await this.uploadFilteredArchive(filteredZipPath, targetKey);

      // Drop the raw upload once the filtered copy exists on the
      // derived key. The client may still re-PUT the raw `scan/…zip` within its
      // presign TTL, but nothing reads it. Best-effort / non-fatal. All scans.
      try {
        if (this.backend) {
          await this.backend.delete(objectPath);
        } else {
          await this.s3Client!.send(
            new DeleteObjectCommand({
              Bucket: this.s3BucketName!,
              Key: objectPath,
            }),
          );
        }
      } catch (rawDelErr) {
        this.logger.warn(
          `Could not delete raw upload ${objectPath}: ${
            rawDelErr instanceof Error ? rawDelErr.message : rawDelErr
          }`,
        );
      }

      // mark as processed
      await this.fileScanRepository.update(
        { id: fileRecord.id },
        { status: FileStatus.PROCESSED },
      );
      this.logger.log(`Processed and re-uploaded ${objectPath}`);

      // Compute LOC / size / languages from the local filtered ZIP. We do
      // this here so we can pass the metrics to `startScan` and spare
      // security-scanning the second download + parse round trip. Failures
      // are non-fatal: security-scanning falls back to its own
      // `processZipFile` when metrics are absent.
      let preComputedMetrics: {
        totalLOC: number;
        totalSize: string;
        language: string[];
      } | null = null;
      try {
        preComputedMetrics = await this.computeZipMetrics(filteredZipPath);
        this.logger.log(
          `Computed ZIP metrics for ${fileRecord.scanId}: totalLOC=${preComputedMetrics.totalLOC} totalSize=${preComputedMetrics.totalSize} languages=${preComputedMetrics.language.length}`,
        );
      } catch (metricsErr) {
        // Note: computeZipMetrics
        // only rejects when yauzl itself can't open the archive. Timeouts now
        // resolve with partial metrics so this catch is the truly-unreadable
        // branch — security-scanning will receive `language: []` and the SAST
        // scanner pod will not be launched (no scanners matched).
        this.logger.warn(
          `computeZipMetrics failed for ${fileRecord.scanId} — SAST scanner will be skipped: ${metricsErr instanceof Error ? metricsErr.message : metricsErr}`,
        );
      }

      // cleanup
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        this.logger.error(`Error cleaning up temp dir: ${cleanupErr}`);
      }

      await safeGrpcCall(
        this.scanServiceClient.startScan({
          scanId: fileRecord.scanId,
          projectId: fileRecord.projectId,
          // What the filter left out, recorded on the scan and shown with
          // it, so a scan never reads as complete when files were not read.
          uploadFilterSummary,
          ...(preComputedMetrics
            ? {
                totalLOC: preComputedMetrics.totalLOC,
                totalSize: preComputedMetrics.totalSize,
                language: preComputedMetrics.language,
              }
            : { language: [] }),
        }),
      );
      this.logger.log(`Scan started for ${fileRecord.scanId}`);
      this.systemFailures.delete(fileRecord.scanId);

      return true;
    } catch (err) {
      if (await this.retryAfterSystemFailure(fileRecord, err, tempDir)) {
        return false;
      }
      if (err instanceof ArchiveLimitError) {
        // The user's archive, not a fault of this service.
        this.logger.warn(
          `Archive refused for ${fileRecord.scanId}: ${err.scanErrorMessage}`,
        );
      } else {
        this.logger.error(err);
      }
      await this.fileScanRepository.update(
        { id: fileRecord.id },
        { status: FileStatus.FAILED },
      );
      // An archive refused on a limit is never scanned: its upload is
      // removed first, so a scan service that cannot be told does not leave
      // it behind. On S3 the signed browser PUT carries no size range, so
      // this is what bounds what an upload can leave in the bucket.
      if (err instanceof ArchiveLimitError) {
        await this.removeRefusedUpload(fileRecord.objectPath);
      }
      // A refusal is stored with its stable code (`errorCode`, category
      // `archive`) and a message naming the limit.
      await safeGrpcCall(
        this.scanServiceClient.updateScanData(
          err instanceof ArchiveLimitError
            ? {
                scanId: fileRecord.scanId,
                state: 'failed',
                errorMessage: err.scanErrorMessage,
                errorCode: err.errorCode,
                errorCategory: ARCHIVE_FAILURE_CATEGORY,
              }
            : {
                scanId: fileRecord.scanId,
                state: 'failed',
                errorMessage: `Processing error: ${err.message}`,
              },
        ),
      );
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {}
      return false;
    } finally {
      openZip?.close();
    }
  }

  /**
   * Delete a file from storage
   */
  /**
   * Hard-delete a stored report object (retention purge +
   * user-initiated delete). Enforces the same cross-tenant boundary as
   * `finalizeReportUpload` (object_path must live under reports/<projectId>/)
   * and is idempotent: a missing object resolves successfully so the purge
   * cron and delete endpoints never error on already-gone artifacts.
   */
  async deleteReportObject(
    request: DeleteReportObjectRequest,
  ): Promise<DeleteReportObjectResponse> {
    const objectPath = request.objectPath ?? '';
    const callerProjectId = request.projectId ?? '';

    if (!objectPath.startsWith('reports/')) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'objectPath must start with reports/',
      });
    }
    if (!callerProjectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'projectId is required',
      });
    }
    const expectedPrefix = `reports/${callerProjectId}/`;
    if (!objectPath.startsWith(expectedPrefix)) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `objectPath does not belong to projectId=${callerProjectId}`,
      });
    }

    try {
      await this.deleteFileFromStorage(objectPath);
    } catch (err: any) {
      // Idempotent: a missing object means the desired state (gone) is
      // already achieved. GCS throws { code: 404 }; S3 DeleteObject is
      // already idempotent but we tolerate NotFound defensively.
      if (
        err?.code === 404 ||
        err?.code === status.NOT_FOUND ||
        err?.name === 'NotFound' ||
        err?.$metadata?.httpStatusCode === 404 ||
        String(err?.message ?? '')
          .toLowerCase()
          .includes('no such object')
      ) {
        return { success: true, message: 'Report object already deleted' };
      }
      // Any other storage failure (permissions, network, throttling, ...) is a
      // genuine error. Never leak the raw storage SDK error over gRPC — wrap it
      // in an RpcException so the gateway maps it to a 500 (microservices must
      // throw RpcException, never raw/HTTP errors).
      if (err instanceof RpcException) throw err;
      // The SDK's error (bucket, key, request id) is logged, not answered.
      this.logger.error({ err, msg: 'Failed to delete report object' });
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Failed to delete report object',
      });
    }
    return { success: true, message: 'ok' };
  }

  async deleteFileFromStorage(
    objectPath: string,
    sweepDerivedKeys = false,
  ): Promise<void> {
    // A scan artifact may live on the raw key, the derived `filtered/`
    // key, and/or the legacy `.filtered.zip` key — sweep all three when
    // asked. NotFound is treated as success (idempotent). The default
    // `sweepDerivedKeys=false` keeps the report-delete caller (reports/…) and
    // any single-key caller unchanged.
    const keys = sweepDerivedKeys
      ? [
          objectPath,
          this.filteredScanKey(objectPath),
          this.legacyFilteredScanKey(objectPath),
        ]
      : [objectPath];
    // The git history tar is uploaded before the archive, so a failed or
    // timed-out scan can leave it with no FileScan row pointing at it.
    const historyKey = sweepDerivedKeys
      ? historyKeyForArchive(objectPath)
      : null;
    if (historyKey) keys.push(historyKey);
    let lastErr: unknown = null;
    for (const key of keys) {
      try {
        if (this.backend) {
          await this.backend.delete(key);
        } else {
          await this.s3Client!.send(
            new DeleteObjectCommand({ Bucket: this.s3BucketName!, Key: key }),
          );
        }
        this.logger.log(`Deleted file ${key} from storage`);
      } catch (delErr: any) {
        if (delErr?.code === 404 || delErr?.name === 'NotFound') continue;
        lastErr = delErr;
        this.logger.error(`Failed to delete object ${key}`, delErr);
      }
    }
    if (lastErr) throw lastErr;
  }

  /**
   * Hand the caller a signed PUT URL for the import object
   * `import/<projectId>/<scanId>.sarif`, or, with `containerId` (a Community
   * cluster scan), `import/<projectId>/<scanId>/<containerId>.sarif`, or, with
   * `kind: sbom` (the CycloneDX SBOM of an sca import),
   * `import/<projectId>/<scanId>.sbom`, `.../<containerId>.sbom` with a
   * container (a cluster scan's sca container) — the same key whatever the
   * compression, which only sets the signed Content-Type. The size is pinned
   * exactly (S3 ContentLength / GCS x-goog-content-length-range) and the URL
   * is valid 300 s. No `file_scan` row is staged: the upload cron never sees
   * import objects.
   */
  @Span()
  async requestImportUploadUrl(
    request: RequestImportUploadUrlRequest,
  ): Promise<RequestImportUploadUrlResponse> {
    const encoding = request.contentEncoding as ImportEncoding;
    if (encoding !== 'identity' && encoding !== 'gzip') {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `content_encoding must be 'identity' or 'gzip'`,
      });
    }
    const contentLength = Number(request.contentLength);
    if (
      !Number.isInteger(contentLength) ||
      contentLength < 1 ||
      contentLength > IMPORT_MAX_UPLOAD_BYTES
    ) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `content_length must be 1..${IMPORT_MAX_UPLOAD_BYTES}`,
      });
    }
    // A Community cluster scan names the scanner container the file belongs
    // to; it must be a uuid before it builds a key ('' included: an unset
    // proto3 optional arrives as undefined, never as '').
    assertImportContainerId(request.containerId);
    // The SBOM of an sca import (`kind: sbom`) has its own key: the scan's,
    // or, with a container (a cluster scan's sca container), the container's.
    assertImportKind(request.kind);
    const kind = request.kind === 'sbom' ? 'sbom' : 'sarif';
    const objectKey =
      kind === 'sbom'
        ? importSbomObjectKey(
            request.projectId ?? '',
            request.scanId ?? '',
            request.containerId,
          )
        : importObjectKey(
            request.projectId ?? '',
            request.scanId ?? '',
            request.containerId,
          );
    // Also refuses a projectId or scanId that is not a uuid: the key would not
    // match either import key pattern.
    assertImportObjectKey(request.projectId ?? '', objectKey);

    try {
      const { uploadUrl, uploadHeaders, expiresAtMs } =
        await this.signObjectPut(objectKey, {
          contentType: importContentType(encoding, kind),
          ttlSeconds: IMPORT_UPLOAD_TTL_SECONDS,
          minBytes: contentLength,
          maxBytes: contentLength,
          exactBytes: contentLength,
        });
      return {
        uploadUrl,
        objectKey,
        uploadExpiresAtMs: expiresAtMs,
        uploadHeaders,
      };
    } catch (e) {
      // Any signing/storage failure is a storage outage for the caller; the
      // validation RpcExceptions above are thrown before this try.
      this.logger.error('Failed to sign the import upload URL', e);
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'IMPORT_STORAGE_UNAVAILABLE',
      });
    }
  }

  /**
   * Signed GET URL (1200 s) for an import object plus its
   * size, so the reader can bound its read. The key must belong to the
   * caller's project. A missing object answers NOT_FOUND; any other storage
   * failure answers UNAVAILABLE `IMPORT_STORAGE_UNAVAILABLE` (logged without
   * the URL).
   */
  @Span()
  async getImportDownloadUrl(
    request: GetImportDownloadUrlRequest,
  ): Promise<GetImportDownloadUrlResponse> {
    const key = request.objectKey ?? '';
    assertImportObjectKey(request.projectId ?? '', key);

    try {
      if (this.backend) {
        const meta = await this.backend.stat(key);
        const url = await this.backend.signGet(key, {
          signatureVersion: 'v4',
          expiresAtMs: Date.now() + IMPORT_DOWNLOAD_TTL_SECONDS * 1000,
        });
        return { url, sizeBytes: Number.isNaN(meta.size) ? 0 : meta.size };
      }
      let head: { ContentLength?: number };
      try {
        head = await this.s3Client!.send(
          new HeadObjectCommand({ Bucket: this.s3BucketName!, Key: key }),
        );
      } catch (err: any) {
        if (
          err?.name === 'NotFound' ||
          err?.$metadata?.httpStatusCode === 404
        ) {
          throw new RpcException({
            code: status.NOT_FOUND,
            message: 'Import object not found',
          });
        }
        throw err;
      }
      const url = await getSignedUrl(
        this.s3Client!,
        new GetObjectCommand({ Bucket: this.s3BucketName!, Key: key }),
        { expiresIn: IMPORT_DOWNLOAD_TTL_SECONDS },
      );
      return { url, sizeBytes: Number(head.ContentLength ?? 0) };
    } catch (e: any) {
      if (e instanceof RpcException) throw e;
      if (e?.code === 404) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: 'Import object not found',
        });
      }
      this.logger.error(
        'IMPORT_STORAGE_UNAVAILABLE while reading the import object',
        e,
      );
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'IMPORT_STORAGE_UNAVAILABLE',
      });
    }
  }

  /**
   * Delete an import object. The key must belong to the
   * caller's project. Idempotent: a missing object still succeeds. Any other
   * storage failure answers UNAVAILABLE `IMPORT_STORAGE_UNAVAILABLE`.
   */
  @Span()
  async deleteImportObject(
    request: DeleteImportObjectRequest,
  ): Promise<DeleteImportObjectResponse> {
    const key = request.objectKey ?? '';
    assertImportObjectKey(request.projectId ?? '', key);

    try {
      if (this.backend) {
        await this.backend.delete(key);
      } else {
        await this.s3Client!.send(
          new DeleteObjectCommand({ Bucket: this.s3BucketName!, Key: key }),
        );
      }
    } catch (e: any) {
      if (
        e?.code === 404 ||
        e?.name === 'NotFound' ||
        e?.$metadata?.httpStatusCode === 404
      ) {
        return { success: true };
      }
      this.logger.error(
        'IMPORT_STORAGE_UNAVAILABLE while deleting the import object',
        e,
      );
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'IMPORT_STORAGE_UNAVAILABLE',
      });
    }
    return { success: true };
  }
}
