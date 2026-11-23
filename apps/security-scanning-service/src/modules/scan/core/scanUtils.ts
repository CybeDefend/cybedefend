import { Injectable } from '@nestjs/common';
import { Span } from 'nestjs-otel';

/**
 * Misc helpers used across the scan module.
 *
 * History: this class used to host `processZipFile`,
 * `downloadFile`, `calculateLOC`, `extractExtensions` and
 * `mapExtensionsToLanguages` — all of which downloaded the uploaded
 * archive a second time inside security-scanning and parsed it to
 * compute LOC / language / size. That work moved into
 * file-management-service (`FileService.computeZipMetrics`), and the
 * fallback that kept it as a safety net inside `startScan` has now been
 * removed too: the file URL is fetched only to be handed to the
 * scanner pods, and the metrics arrive pre-computed in StartScanRequest.
 *
 * What remains is the one tiny utility that other modules still use
 * (DB column width guard on error messages).
 */
@Injectable()
export class ScanUtils {
  /**
   * Truncate error message to prevent database field overflow.
   * Standard VARCHAR field in MySQL is typically 255 characters.
   * @param message The error message to truncate
   * @returns The truncated message
   */
  @Span()
  truncateErrorMessage(message: string | undefined | null): string | undefined {
    if (!message) return undefined;
    const maxLength = 255;
    return message.length > maxLength
      ? message.substring(0, maxLength - 3) + '...'
      : message;
  }
}
