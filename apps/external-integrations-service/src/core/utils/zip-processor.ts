import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { Worker } from 'node:worker_threads';
import archiver from 'archiver';
import * as yauzl from 'yauzl';
import { assertArchiveWithinUncompressedLimit } from './zip-size-gate';

type Archive = archiver.Archiver;

/**
 * Deflate level used for the rewritten archive. 6 is zlib's own default: the
 * output only has to travel to the bucket and back to a scanner pod, so the
 * CPU that level 9 costs on a multi-GiB repository buys nothing.
 */
const ZIP_COMPRESSION_LEVEL = 6;

/**
 * Heap ceiling for the zip worker thread.
 *
 * The rewrite is a stream, so it needs a few MiB — the ceiling exists so that a
 * pathological archive (or a future regression back to buffering) kills its own
 * worker with `ERR_WORKER_OUT_OF_MEMORY` and fails that one job, rather than
 * running until the cgroup SIGKILLs the whole process (exit 137) along with
 * every other in-flight job.
 *
 * It bounds ONE runaway job, not the pod: with the repo-scan worker at
 * concurrency N there can be N of these threads, so the pod's memory limit must
 * still cover N × this ceiling plus the process baseline.
 */
export const ZIP_WORKER_RESOURCE_LIMITS = {
  maxOldGenerationSizeMb: 1024,
  maxYoungGenerationSizeMb: 128,
} as const;

/** The slice of AdmZip's surface {@link addGitDirToArchive} relies on. */
export interface BufferBackedArchive {
  addFile(entryName: string, data: Buffer): void;
}

/**
 * Recursively walk `gitDir`, calling `visit` for every regular file (skipping
 * symlinks and path-traversal attempts) with its absolute path and the POSIX
 * path it must take under `.git/`.
 */
function walkGitDir(
  gitDir: string,
  visit: (fullPath: string, entryName: string) => void,
): void {
  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const dirent of entries) {
      // Skip symlinks — never chase them outside the gitDir
      if (dirent.isSymbolicLink()) continue;

      const fullPath = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        walk(fullPath);
      } else if (dirent.isFile()) {
        const relativePath = path.relative(gitDir, fullPath);
        // Normalise to POSIX separators
        const posixRel = relativePath.replace(/\\/g, '/');
        // Defence-in-depth: skip if the path escapes the gitDir
        if (posixRel.startsWith('..') || path.isAbsolute(posixRel)) continue;

        visit(fullPath, '.git/' + posixRel);
      }
    }
  };
  walk(gitDir);
}

/**
 * Recursively walk `gitDir` and add every regular file (skipping symlinks and
 * path-traversal attempts) to `zip` under the `.git/` prefix.
 *
 * Buffer-backed: it reads each file whole and hands the buffer to an archive
 * that retains it. The repository rewrite does NOT use this any more (see
 * {@link runZipProcessing}, which streams each file straight to disk); it is
 * kept for the AdmZip-based callers that still build an in-memory archive.
 */
export function addGitDirToArchive(
  zip: BufferBackedArchive,
  gitDir: string,
): void {
  walkGitDir(gitDir, (fullPath, entryName) => {
    zip.addFile(entryName, fs.readFileSync(fullPath));
  });
}

/** Strip the single top-level directory GitHub/GitLab wrap a zipball in. */
function stripTopLevelDirectory(entryName: string): string {
  return entryName.split('/').slice(1).join('/');
}

interface FailureSignal {
  /** Record the first fatal event of the output pipeline. */
  fail: (err: unknown) => void;
  /** Resolve `promise`, or reject as soon as the pipeline fails. */
  guard: <T>(promise: Promise<T>) => Promise<T>;
}

/**
 * The pipeline's fatal-error channel, as a Set of one-shot waiters rather than
 * a long-lived rejected promise.
 *
 * This is NOT a `Promise.race` against a single never-settling promise, and
 * the difference is the whole ball game on a real repository. Racing against a
 * promise that never settles leaves one reaction record on it per await,
 * forever — and a reaction record retains the race's resolution machinery,
 * which retains the value the race resolved with. For the `openReadStream`
 * await that value is the entry's read stream, ~16 KiB of buffers, so the
 * rewrite silently held one stream per entry for the whole run: +1 037 MiB of
 * ArrayBuffers on microsoft/TypeScript's 67 323-entry zipball, and the reaction
 * list itself made the run several times slower. Invisible on a byte-sized
 * synthetic fixture; fatal on the archives this code actually processes.
 *
 * Each waiter here is removed as soon as its await settles, so the retained set
 * is the in-flight entry and nothing else.
 */
function createFailureSignal(): FailureSignal {
  let failure: Error | undefined;
  const waiters = new Set<(err: Error) => void>();

  const fail = (err: unknown): void => {
    if (failure) return;
    failure = err instanceof Error ? err : new Error(String(err));
    const pending = [...waiters];
    waiters.clear();
    for (const waiter of pending) waiter(failure);
  };

  const guard = <T>(promise: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const onFail = (err: Error): void => {
        waiters.delete(onFail);
        reject(err);
      };
      waiters.add(onFail);
      // Attached unconditionally, so a promise that loses the race still has a
      // rejection handler and can never surface as an unhandled rejection.
      promise.then(
        (value) => {
          waiters.delete(onFail);
          resolve(value);
        },
        (err) => {
          waiters.delete(onFail);
          reject(err);
        },
      );
      if (failure) onFail(failure);
    });

  return { fail, guard };
}

/**
 * Hand one source to `archive` and resolve once archiver has fully consumed it.
 *
 * This one-at-a-time handshake is what bounds the memory: without it every
 * entry would be queued up front and the whole repository would be in flight at
 * once. The listeners are attached BEFORE the append so the completion event
 * cannot be missed.
 *
 * A `warning` is treated as fatal on purpose. archiver emits it (and never an
 * `entry`) when it cannot stat a source — which would otherwise hang this
 * promise forever — and silently dropping a `.git` object from a secrets scan
 * is worse than failing the job, which is what the previous `readFileSync`
 * implementation did.
 */
function appendAndWait(
  archive: Archive,
  name: string,
  add: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      archive.removeListener('entry', onEntry);
      archive.removeListener('error', onFailure);
      archive.removeListener('warning', onFailure);
    };
    const onEntry = (): void => {
      cleanup();
      resolve();
    };
    const onFailure = (err: unknown): void => {
      cleanup();
      reject(
        err instanceof Error
          ? err
          : new Error(`Failed to add ${name} to the archive`),
      );
    };
    archive.once('entry', onEntry);
    archive.once('error', onFailure);
    archive.once('warning', onFailure);
    add();
  });
}

/**
 * Rewrite a GitHub/GitLab zipball: drop the top-level directory, optionally
 * inject a `.git` mirror, and write the cleaned archive to `outputPath`.
 *
 * Fully streaming, one entry at a time: yauzl reads the input archive entry by
 * entry (`lazyEntries`, so nothing is read ahead) and each entry's read stream
 * is piped straight into the archiver output before the next entry is
 * requested; the `.git` mirror is added with `archive.file()`, which archiver
 * reads from disk lazily. Peak memory is therefore a couple of stream buffers,
 * independent of the repository size.
 *
 * It replaces a fully-buffered AdmZip implementation that held the whole input
 * archive, every inflated entry and the whole output archive in memory at once
 * (≈ 2×compressed + uncompressed + 2×`.git` per job) and could exhaust the
 * repo-scan worker's memory.
 *
 * The archive is refused up front when its total uncompressed size exceeds the
 * configured ceiling — see `zip-size-gate`.
 */
export async function runZipProcessing(
  inputPath: string,
  outputPath: string,
  gitDir?: string,
): Promise<void> {
  await assertArchiveWithinUncompressedLimit(inputPath);

  const output = fs.createWriteStream(outputPath);
  const archive = archiver('zip', { zlib: { level: ZIP_COMPRESSION_LEVEL } });
  const { fail, guard } = createFailureSignal();

  output.on('error', fail);
  archive.on('error', fail);
  const closed = new Promise<void>((resolve) => output.once('close', resolve));
  archive.pipe(output);

  let readStream: Readable | undefined;
  try {
    // `decodeStrings` is yauzl's default, spelled out because it is
    // load-bearing: it runs `validateFileName`, which refuses zip-slip entry
    // names. The size gate above opens the archive the same way and so turns a
    // malicious one away first; this is the backstop that keeps the rewrite
    // safe on its own, because stripping the top-level directory turns
    // `top/../../evil.txt` into `../../evil.txt` — an archive that escapes its
    // own extraction directory on the scanner side.
    const zipfile = await yauzl.openPromise(inputPath, {
      lazyEntries: true,
      decodeStrings: true,
    });
    for await (const entry of zipfile.eachEntry()) {
      // Directory entries carry no data and are not reproduced in the output.
      if (entry.fileName.endsWith('/')) continue;

      const newName = stripTopLevelDirectory(entry.fileName);
      if (!newName) continue;

      readStream = await guard(zipfile.openReadStreamPromise(entry));
      // An entry stream can fail AFTER archiver has taken it (a truncated or
      // mis-declared entry trips yauzl's size assertion part-way through).
      // archiver does not re-emit that as its own `error`, so without this the
      // `entry` event never arrives, the handshake below never settles and the
      // whole rewrite hangs until the job's lock expires.
      readStream.on('error', fail);
      await guard(
        appendAndWait(archive, newName, () =>
          archive.append(readStream, { name: newName }),
        ),
      );
      readStream = undefined;
    }

    // Inject .git mirror contents when available
    if (gitDir && fs.existsSync(gitDir)) {
      const gitFiles: [string, string][] = [];
      walkGitDir(gitDir, (fullPath, entryName) =>
        gitFiles.push([fullPath, entryName]),
      );
      for (const [fullPath, entryName] of gitFiles) {
        await guard(
          appendAndWait(archive, entryName, () =>
            archive.file(fullPath, { name: entryName }),
          ),
        );
      }
    }

    await guard(archive.finalize());
    await guard(closed);
  } catch (err) {
    // `zipfile.close()` only unrefs the reader — a stream already handed out
    // keeps its slice of the fd open, so destroy the one still in flight.
    readStream?.destroy();
    archive.abort();
    output.destroy();
    throw err;
  }
}

export interface ZipWorkerLike {
  once(event: string, listener: (...args: any[]) => void): unknown;
  terminate?(): unknown;
}

export type ZipWorkerFactory = (workerData: {
  inputPath: string;
  outputPath: string;
  gitDir?: string;
}) => ZipWorkerLike;

/**
 * Default factory: spawns the compiled worker entry next to this module, with
 * a heap ceiling so a runaway rewrite takes down its own thread and not the
 * pod (see {@link ZIP_WORKER_RESOURCE_LIMITS}).
 */
export const defaultZipWorkerFactory: ZipWorkerFactory = (workerData) =>
  new Worker(path.join(__dirname, 'zip-processor.worker.js'), {
    workerData,
    resourceLimits: { ...ZIP_WORKER_RESOURCE_LIMITS },
  });

/** `true` when the worker died because it hit its own heap ceiling. */
function isWorkerOutOfMemory(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'ERR_WORKER_OUT_OF_MEMORY'
  );
}

/**
 * Run {@link runZipProcessing} inside a worker thread so the zip work never
 * blocks the main event loop (keeps the gRPC liveness probe responsive during
 * large-repo scans) and so its heap is bounded independently of the process.
 *
 * `createWorker` is injectable for unit testing.
 */
export function runZipProcessingInWorker(
  inputPath: string,
  outputPath: string,
  gitDir: string | undefined,
  createWorker: ZipWorkerFactory = defaultZipWorkerFactory,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    const worker = createWorker({ inputPath, outputPath, gitDir });

    worker.once('message', (msg: { ok?: boolean; error?: string }) => {
      settle(
        msg?.ok
          ? undefined
          : new Error(msg?.error || 'ZIP processing failed in worker'),
      );
      worker.terminate?.();
    });
    worker.once('error', (err: unknown) => {
      if (isWorkerOutOfMemory(err)) {
        // Deliberate, stable wording: this is the one worker failure an
        // operator needs to tell apart from a corrupt archive.
        settle(
          new Error(
            'ZIP worker ran out of memory (heap limit reached) while rewriting the archive',
          ),
        );
        return;
      }
      settle(err instanceof Error ? err : new Error(String(err)));
    });
    worker.once('exit', (code: number) => {
      if (code !== 0) {
        settle(new Error(`ZIP worker stopped with exit code ${code}`));
      }
    });
  });
}
