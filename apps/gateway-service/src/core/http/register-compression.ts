import compress from '@fastify/compress';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/**
 * Registers HTTP response compression on the gateway. Brotli is preferred
 * over gzip when the client advertises both; payloads under 1 KB are sent
 * uncompressed because the per-response CPU cost dominates the size win
 * below that threshold.
 *
 * Called from main.ts BEFORE app.listen so the encoder hook is wired into
 * the Fastify request pipeline early.
 *
 * Request bodies are never decompressed (`globalDecompression: false`). The
 * plugin decodes `br`, `gzip` and `deflate` bodies by default, in a preParsing
 * hook that runs before any guard, so every client could feed the Brotli
 * decoder bundled with Node.js: Node2Shell (CVE-2026-111497) is an
 * out-of-bounds write in that decoder. No caller of the gateway compresses
 * what it sends; a compressed body now fails JSON parsing with a 400.
 */
export async function registerCompression(
  app: NestFastifyApplication,
): Promise<void> {
  await app.register(compress, {
    encodings: ['br', 'gzip'],
    threshold: 1024,
    globalDecompression: false,
  });
}
