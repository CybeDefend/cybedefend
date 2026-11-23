import { parentPort, workerData } from 'node:worker_threads';
import { runZipProcessing } from './zip-processor';

/**
 * Worker-thread entry for {@link runZipProcessing}. Runs the archive rewrite
 * off the main event loop so the service's gRPC liveness probe stays
 * responsive while a (potentially large) repository archive is rewritten, and
 * under its own heap ceiling so it can never take the process down with it.
 */
const { inputPath, outputPath, gitDir } = workerData as {
  inputPath: string;
  outputPath: string;
  gitDir?: string;
};

runZipProcessing(inputPath, outputPath, gitDir)
  .then(() => parentPort?.postMessage({ ok: true }))
  .catch((err: unknown) =>
    parentPort?.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
