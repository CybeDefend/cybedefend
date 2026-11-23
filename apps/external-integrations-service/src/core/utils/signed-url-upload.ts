import axios from 'axios';
import * as fs from 'node:fs';

/**
 * Headers of a PUT to a signed upload URL. The content type must be the one
 * the URL was signed for; a GCS URL is also signed with the create-only and
 * size conditions file-management sets, which the request must repeat.
 */
export function signedUploadHeaders(
  uploadUrl: string,
  contentType: string,
): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': contentType };
  if (uploadUrl.includes('googleapis.com')) {
    headers['x-goog-if-generation-match'] = '0';
    headers['x-goog-content-length-range'] = '0,5368709120';
  }
  return headers;
}

/**
 * PUT `filePath` to a signed storage upload URL, streamed from disk.
 *
 * `maxRedirects: 0` keeps the body out of memory. With axios' default, the
 * request goes through follow-redirects, which keeps every chunk of the body
 * until the response arrives so it can replay it on a redirect: the whole
 * archive ends up in memory, outside any heap limit, and a repository of a few
 * GB OOM-kills the worker. A signed upload URL never redirects.
 */
export async function uploadFileToSignedUrl(
  uploadUrl: string,
  filePath: string,
  headers: Record<string, string>,
): Promise<void> {
  const stats = await fs.promises.stat(filePath);
  const fileStream = fs.createReadStream(filePath);
  try {
    await axios.put(uploadUrl, fileStream, {
      headers: { ...headers, 'Content-Length': stats.size.toString() },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      maxRedirects: 0,
    });
  } finally {
    fileStream.destroy();
  }
}
