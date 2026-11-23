import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';

import { grpcCodeOf } from './grpc-status.util';
import { FileManagementService } from '../../file/file-management.service';

/**
 * Gets the file URL for a scan that is ready to start.
 *
 * @param scanId The ID of the scan to get the file URL for.
 * @returns The URL to download the file from.
 */
export async function getScanFileUrl(
  files: FileManagementService,
  logger: Logger,
  scanId: string,
): Promise<string> {
  try {
    const fileUrl = await files.getDownloadUrl(scanId);
    return fileUrl as string;
  } catch (error) {
    logger.error(`Failed to get file URL for scan ${scanId}: ${error}`);
    throw new RpcException({
      code: status.INTERNAL,
      message: `Could not retrieve file`,
    });
  }
}

/** Suffix of the object key file-management gives a scan's history tar. */
const HISTORY_OBJECT_SUFFIX = '.history.tar';

/**
 * Whether a signed URL points at a history tar. A file-management that does
 * not know the artifact kind ignores it and signs the scan's archive: handed
 * to the secret scanner as its history, that archive would fail its history
 * pass on every scan.
 */
export function isHistoryTarUrl(url: string): boolean {
  try {
    return new URL(url).pathname.endsWith(HISTORY_OBJECT_SUFFIX);
  } catch {
    return false;
  }
}

/**
 * Gets the URL of a scan's git history artifact, or null when the scan has
 * none. A scan never fails because of its history: NOT_FOUND is the normal
 * "no history" answer, and any other error is logged and also yields null, as
 * is a URL that does not point at a history tar (never logged: it is a
 * credential).
 */
export async function getScanHistoryFileUrl(
  files: FileManagementService,
  logger: Logger,
  scanId: string,
): Promise<string | null> {
  try {
    const url =
      ((await files.getDownloadUrl(scanId, 'history')) as string) || '';
    if (!url) return null;
    if (!isHistoryTarUrl(url)) {
      logger.warn(
        `History URL of scan ${scanId} does not point at a history tar, scanning without it`,
      );
      return null;
    }
    return url;
  } catch (error) {
    if (grpcCodeOf(error) !== status.NOT_FOUND) {
      logger.warn(
        `History URL unavailable for scan ${scanId}, scanning without it: code=${grpcCodeOf(error) ?? 'UNKNOWN'}`,
      );
    }
    return null;
  }
}
