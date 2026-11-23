import multipart from '@fastify/multipart';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/**
 * The limits of the multipart routes, the SARIF import
 * (`POST /project/:projectId/scan/import/start`) and a cluster
 * scan's results: two files of at most 50 MiB each (the SARIF `file`, and
 * the CycloneDX `sbom` an sca import may send with it), the five fields the
 * import knows (`type`, `branch`, `commit`, `format`, `image`) of at most
 * 1 KiB each, and nothing more. A part beyond them makes `request.parts()`
 * throw, so a client cannot make the gateway buffer more than this; each
 * route refuses a file part it does not know.
 */
export const IMPORT_MULTIPART_LIMITS = {
  fileSize: 52_428_800,
  files: 2,
  fields: 5,
  fieldSize: 1024,
  parts: 7,
} as const;

/**
 * Registers `@fastify/multipart`. Its content-type parser reads nothing: the
 * body is streamed only when a handler calls `request.parts()`, i.e. after
 * the route's guards ran. JSON routes are untouched.
 */
export async function registerMultipart(
  app: NestFastifyApplication,
): Promise<void> {
  await app.register(multipart, { limits: IMPORT_MULTIPART_LIMITS });
}
