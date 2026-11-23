import gatewayAPI from '@/server/api/gatewayAPI';

/**
 * SARIF import: one
 * multipart request to the gateway, which stores the file and starts the
 * scan, then answers 202 `{ scanId }`. The client never sees a storage URL.
 */
export type ImportType = 'sast' | 'iac' | 'secret' | 'cicd' | 'sca' | 'container';

/** The dialog's segments, in this order. */
export const IMPORT_TYPES: readonly ImportType[] = ['sast', 'iac', 'secret', 'cicd', 'sca', 'container'];

/** 50 MiB, the gateway's limit (the dialog says « 50 MB »). */
export const IMPORT_MAX_BYTES = 50 * 1024 * 1024;

export const IMPORT_EXTENSIONS: readonly ['.sarif', '.json', '.sarif.gz'] = ['.sarif', '.json', '.sarif.gz'];

export interface ImportRequest {
  projectId: string;
  file: File;
  type: ImportType;
  branch: string;
  /** ^[0-9a-f]{7,40}$: sent, then dropped by the gateway in phase 1. */
  commit?: string;
  /** Required when `type` is container; never sent with another type. */
  image?: string;
}

export type ImportFileProblem = 'extension' | 'size' | 'empty';

const isGzipName = (name: string): boolean => name.toLowerCase().endsWith('.sarif.gz');

/** What the client refuses before any request; null when the file may be sent. */
export function importFileProblem(file: File): ImportFileProblem | null {
  const name = file.name.toLowerCase();
  if (!IMPORT_EXTENSIONS.some((extension) => name.endsWith(extension))) return 'extension';
  if (file.size > IMPORT_MAX_BYTES) return 'size';
  if (file.size === 0) return 'empty';
  return null;
}

export async function importResults(
  req: ImportRequest,
  onProgress?: (fraction: number) => void,
): Promise<{ scanId: string }> {
  const form = new FormData();
  form.append('type', req.type);
  form.append('branch', req.branch);
  if (req.commit) form.append('commit', req.commit);
  if (req.type === 'container' && req.image !== undefined) form.append('image', req.image);
  form.append('format', 'sarif');
  // The gateway reads gzip from the part name: always `results.sarif.gz`.
  form.append('file', req.file, isGzipName(req.file.name) ? 'results.sarif.gz' : req.file.name);

  const { data } = await gatewayAPI.post<{ scanId?: unknown }>(
    `/project/${encodeURIComponent(req.projectId)}/scan/import/start`,
    form,
    {
      // Not the client's JSON default, which would make axios serialise the
      // form; the browser then sets the multipart boundary itself.
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (event: { loaded: number; total?: number }) => {
        if (onProgress && event.total) onProgress(event.loaded / event.total);
      },
    },
  );
  if (!data || typeof data.scanId !== 'string' || data.scanId === '') {
    throw new Error('IMPORT_NO_SCAN_ID');
  }
  return { scanId: data.scanId };
}

export default { importResults };
