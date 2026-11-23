import { execFileSync, fork } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import Module from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import * as yauzl from 'yauzl';
import {
  ZIP_WORKER_RESOURCE_LIMITS,
  runZipProcessing,
  runZipProcessingInWorker,
} from './zip-processor';

/**
 * The repository zip rewrite, against REAL GitHub and GitLab archives.
 *
 * Every other spec in this directory builds its own archives, which means they
 * all share one blind spot: they only contain what this code already expects.
 * A synthetic fixture is sized in bytes and holds a couple of thousand
 * entries — it cannot see a per-entry leak, it never carries a symlink, a
 * stored-vs-deflated mix, a data descriptor, or the 65 535-entry boundary
 * where a writer has to switch to zip64. This spec runs the real thing.
 *
 * NEVER RUNS IN CI: it needs the network and downloads ~62 MiB. It is skipped
 * unless ZIP_REAL_ARCHIVES=1. Run it by hand with:
 *
 *   ZIP_REAL_ARCHIVES=1 pnpm run test \
 *     --testPathPatterns='zip-processor.real-archives' --runInBand
 *
 * Downloads and the `.git` mirror are cached under
 * `os.tmpdir()/cybedefend-zip-real-archives`, so a second run is offline and
 * fast. Delete that directory to refetch.
 *
 * It needs ~4 GiB of free RAM and a full clone: the former buffered baseline is
 * run in-process on the 55 MiB TypeScript zipball (peaks at ~2.9 GiB RSS), and
 * it is `git show`n from `f2a4a8fa0`, which a shallow clone cannot reach.
 *
 * Each archive is rewritten by BOTH the former buffered implementation (extracted
 * from `f2a4a8fa0` at runtime, still buffered, still on adm-zip) and the
 * current streaming one, and the two outputs are compared entry by entry on
 * `[name, uncompressedSize, crc32]` — crc32 included, so this compares the
 * bytes of every entry and not just its shape. Both outputs are then handed to
 * a third implementation, the system `unzip`, because two libraries agreeing
 * with each other proves less than one of them agreeing with the tool the
 * scanner side will use.
 */

const REAL_ARCHIVES = process.env.ZIP_REAL_ARCHIVES === '1';
const describeReal = REAL_ARCHIVES ? describe : describe.skip;

const CACHE_DIR = path.join(os.tmpdir(), 'cybedefend-zip-real-archives');
const MIB = 1024 * 1024;
const BASELINE_COMMIT = 'f2a4a8fa0';

jest.setTimeout(1_800_000);

interface Source {
  key: string;
  url: string;
  /** What this input is here to exercise. */
  covers: string;
}

const SOURCES: Source[] = [
  {
    key: 'express',
    url: 'https://codeload.github.com/expressjs/express/zip/refs/heads/master',
    covers: 'a small GitHub zipball with the usual nested owner-repo-sha/ root',
  },
  {
    key: 'typescript',
    url: 'https://codeload.github.com/microsoft/TypeScript/zip/refs/heads/main',
    covers: 'a GitHub monorepo past the 65 535-entry zip64 boundary',
  },
  {
    key: 'gitlab-runner',
    url: 'https://gitlab.com/gitlab-org/gitlab-runner/-/archive/main/gitlab-runner-main.zip',
    covers: 'a GitLab archive (different writer, and it carries a symlink)',
  },
];

interface EntryRow {
  name: string;
  size: number;
  crc: number;
  flags: number;
  method: number;
  mode: number;
}

async function readEntries(zipPath: string): Promise<EntryRow[]> {
  const zipfile = await yauzl.openPromise(zipPath, { lazyEntries: true });
  const rows: EntryRow[] = [];
  for await (const entry of zipfile.eachEntry()) {
    rows.push({
      name: entry.fileName,
      size: entry.uncompressedSize,
      crc: entry.crc32 >>> 0,
      flags: entry.generalPurposeBitFlag,
      method: entry.compressionMethod,
      mode: (entry.externalFileAttributes >>> 16) & 0xffff,
    });
  }
  return rows;
}

/** The comparable identity of an archive: every entry's name, size and CRC. */
function contentDigest(rows: EntryRow[]): string {
  return crypto
    .createHash('sha256')
    .update(
      rows
        .map((r) => `${r.name}\t${r.size}\t${r.crc}`)
        .sort()
        .join('\n'),
    )
    .digest('hex');
}

const isSymlink = (row: EntryRow): boolean => (row.mode & 0xf000) === 0xa000;
const hasDataDescriptor = (row: EntryRow): boolean => (row.flags & 0x08) !== 0;

function report(line: string): void {
  console.log(`[real-archives] ${line}`);
}

async function download(url: string, dest: string): Promise<void> {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`GET ${url} → HTTP ${response.status}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(`${dest}.part`, body);
  fs.renameSync(`${dest}.part`, dest);
}

/** A real bare `.git` mirror, the way the service produces one. */
function cloneMirror(dest: string): string {
  if (fs.existsSync(path.join(dest, 'HEAD'))) return dest;
  fs.rmSync(dest, { recursive: true, force: true });
  execFileSync(
    'git',
    ['clone', '--mirror', 'https://github.com/expressjs/express.git', dest],
    { stdio: 'pipe' },
  );
  return dest;
}

/**
 * Compile the former buffered implementation from git and load it.
 *
 * It lands under `node_modules/.cache` so that its `require('adm-zip')`
 * resolves against the service's own dependencies, and so that a forked probe
 * can require it by path too. Nothing is written into `src/`.
 */
function buildBaseline(): string {
  const serviceRoot = path.resolve(__dirname, '..', '..', '..');
  const outDir = path.join(
    serviceRoot,
    'node_modules',
    '.cache',
    'zip-baseline',
  );
  const outFile = path.join(outDir, 'zip-processor.baseline.js');
  fs.mkdirSync(outDir, { recursive: true });

  const source = execFileSync(
    'git',
    [
      'show',
      `${BASELINE_COMMIT}:external-integrations-service/src/core/utils/zip-processor.ts`,
    ],
    { cwd: serviceRoot, maxBuffer: 64 * MIB },
  ).toString();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ts = require('typescript') as typeof import('typescript');
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  fs.writeFileSync(outFile, js);
  return outFile;
}

type Rewrite = (
  inputPath: string,
  outputPath: string,
  gitDir?: string,
) => void | Promise<void>;

function loadBaseline(baselineFile: string): { runZipProcessing: Rewrite } {
  const loaded = new Module(baselineFile, null) as Module & {
    _compile(code: string, filename: string): void;
    paths: string[];
  };
  loaded.filename = baselineFile;
  loaded.paths = (
    Module as unknown as { _nodeModulePaths(dir: string): string[] }
  )._nodeModulePaths(path.dirname(baselineFile));
  loaded._compile(fs.readFileSync(baselineFile, 'utf8'), baselineFile);
  return loaded.exports as { runZipProcessing: Rewrite };
}

/** The system `unzip`: a third reader, independent of yauzl and archiver. */
function unzipTest(zipPath: string): { ok: boolean; detail: string } {
  try {
    const out = execFileSync('unzip', ['-t', zipPath], {
      maxBuffer: 256 * MIB,
    }).toString();
    return {
      ok: /No errors detected/.test(out),
      detail: out.trim().slice(-120),
    };
  } catch (err) {
    return { ok: false, detail: String((err as Error).message).slice(0, 300) };
  }
}

function unzipCount(zipPath: string): number {
  const out = execFileSync('unzip', ['-l', zipPath], {
    maxBuffer: 256 * MIB,
  }).toString();
  const match = out
    .trim()
    .split('\n')
    .pop()
    ?.match(/(\d+)\s+files?/);
  return match ? Number(match[1]) : -1;
}

/** Wall time and peak RSS of one rewrite, measured in a clean child process. */
const PROBE_SOURCE = `
const path = require('node:path');
const { register } = require(process.env.TS_NODE_PATH);
register({ transpileOnly: true });
const run = process.env.ZIP_BASELINE
  ? require(process.env.ZIP_BASELINE).runZipProcessing
  : require(process.env.ZIP_MODULE).runZipProcessing;
const [inputZip, outputZip, gitDir] = process.argv.slice(2);
(async () => {
  const before = process.memoryUsage.rss();
  const samples = [before];
  const timer = setInterval(() => samples.push(process.memoryUsage.rss()), 50);
  const startedAt = Date.now();
  let failure = null;
  try {
    await Promise.resolve(run(inputZip, outputZip, gitDir || undefined));
  } catch (err) {
    failure = String((err && err.stack) || err);
  } finally {
    clearInterval(timer);
    samples.push(process.memoryUsage.rss());
  }
  process.send({
    failure,
    ms: Date.now() - startedAt,
    before,
    peak: Math.max.apply(null, samples),
    sampleCount: samples.length,
  });
  process.exit(0);
})();
`;

interface ProbeResult {
  failure: string | null;
  ms: number;
  before: number;
  peak: number;
  sampleCount: number;
}

function probe(
  which: 'old' | 'new',
  baselineFile: string,
  inputZip: string,
  outputZip: string,
  gitDir = '',
): Promise<ProbeResult> {
  const probePath = path.join(CACHE_DIR, 'probe.cjs');
  fs.writeFileSync(probePath, PROBE_SOURCE);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TS_NODE_PATH: require.resolve('ts-node'),
  };
  if (which === 'old') env.ZIP_BASELINE = baselineFile;
  else env.ZIP_MODULE = path.join(__dirname, 'zip-processor.ts');

  return new Promise((resolve, reject) => {
    const child = fork(probePath, [inputZip, outputZip, gitDir], {
      cwd: path.resolve(__dirname, '..', '..', '..'),
      env,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    let settled = false;
    child.on('message', (msg) => {
      settled = true;
      resolve(msg as ProbeResult);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (!settled) reject(new Error(`probe exited with code ${code}`));
    });
  });
}

describeReal('zip-processor against real GitHub/GitLab archives', () => {
  let baselineFile: string;
  const inputs = new Map<string, string>();

  beforeAll(async () => {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    baselineFile = buildBaseline();
    for (const source of SOURCES) {
      const dest = path.join(CACHE_DIR, `${source.key}.zip`);
      await download(source.url, dest);
      inputs.set(source.key, dest);
      report(
        `${source.key}: ${(fs.statSync(dest).size / MIB).toFixed(1)} MiB — ${source.covers}`,
      );
    }
  });

  it.each(SOURCES.map((s) => [s.key] as const))(
    '%s — old and new implementations produce the same archive',
    async (key) => {
      const inputZip = inputs.get(key);
      const oldOut = path.join(CACHE_DIR, `${key}-old.zip`);
      const newOut = path.join(CACHE_DIR, `${key}-new.zip`);

      const sourceRows = await readEntries(inputZip);
      report(
        `${key} SOURCE: ${sourceRows.length} entries, ` +
          `${sourceRows.filter((r) => r.method === 0).length} stored / ` +
          `${sourceRows.filter((r) => r.method === 8).length} deflated, ` +
          `${sourceRows.filter(hasDataDescriptor).length} with a data descriptor (bit 3), ` +
          `${sourceRows.filter(isSymlink).length} symlink entries`,
      );

      let oldFailure: string | null = null;
      try {
        await Promise.resolve(
          loadBaseline(baselineFile).runZipProcessing(inputZip, oldOut),
        );
      } catch (err) {
        oldFailure = String((err as Error).message);
      }

      await runZipProcessing(inputZip, newOut);

      const newRows = await readEntries(newOut);
      const newCheck = unzipTest(newOut);
      report(
        `${key} NEW: ${newRows.length} entries, digest ${contentDigest(newRows).slice(0, 16)}…, ` +
          `unzip -t ${newCheck.ok ? 'OK' : 'FAILED'}, unzip -l counts ${unzipCount(newOut)}`,
      );
      expect(newCheck.ok).toBe(true);

      if (oldFailure) {
        // (b) The old implementation could not handle this input at all. That
        // is the finding; the new output is then checked on its own against a
        // third reader and the source entry count.
        report(`${key} OLD: FAILED — ${oldFailure}`);
        const expectedFiles = sourceRows.filter(
          (r) => !r.name.endsWith('/') && r.name.split('/').slice(1).join('/'),
        ).length;
        expect(newRows).toHaveLength(expectedFiles);
        return;
      }

      const oldRows = await readEntries(oldOut);
      const oldCheck = unzipTest(oldOut);
      report(
        `${key} OLD: ${oldRows.length} entries, digest ${contentDigest(oldRows).slice(0, 16)}…, ` +
          `unzip -t ${oldCheck.ok ? 'OK' : 'FAILED'}`,
      );

      const oldSymlinks = oldRows.filter(isSymlink).length;
      const newSymlinks = newRows.filter(isSymlink).length;
      if (sourceRows.some(isSymlink)) {
        report(
          `${key} SYMLINKS: source ${sourceRows.filter(isSymlink).length}, ` +
            `old output ${oldSymlinks}, new output ${newSymlinks} ` +
            `(both write the link target as file content)`,
        );
      }

      // Attributes are outside the digest: pin the symlink handling explicitly,
      // so a divergence between the two writers cannot hide in a report line.
      expect(newSymlinks).toBe(oldSymlinks);
      expect(newRows).toHaveLength(oldRows.length);
      expect(contentDigest(newRows)).toBe(contentDigest(oldRows));
    },
  );

  it('rewrites a real repository plus a real .git mirror, through the worker', async () => {
    const inputZip = inputs.get('express');
    const gitDir = cloneMirror(path.join(CACHE_DIR, 'express-mirror.git'));
    const workerOut = path.join(CACHE_DIR, 'express-worker.zip');
    const inlineOut = path.join(CACHE_DIR, 'express-inline.zip');

    // (c) The real runtime path: the COMPILED worker entry, a real mirror.
    // `defaultZipWorkerFactory` resolves the worker next to itself, which under
    // ts-jest is `src/`, where no `.js` exists — so the factory is pointed at
    // `dist/` explicitly. That is the artifact the pod actually runs, which
    // makes this a stronger check than the default factory would be.
    const serviceRoot = path.resolve(__dirname, '..', '..', '..');
    execFileSync('pnpm', ['run', 'build'], {
      cwd: serviceRoot,
      stdio: 'pipe',
      maxBuffer: 64 * MIB,
    });
    const workerEntry = path.join(
      serviceRoot,
      'dist',
      'core',
      'utils',
      'zip-processor.worker.js',
    );
    expect(fs.existsSync(workerEntry)).toBe(true);
    await runZipProcessingInWorker(
      inputZip,
      workerOut,
      gitDir,
      (workerData) =>
        new Worker(workerEntry, {
          workerData,
          resourceLimits: { ...ZIP_WORKER_RESOURCE_LIMITS },
        }),
    );
    await runZipProcessing(inputZip, inlineOut, gitDir);

    const workerRows = await readEntries(workerOut);
    const inlineRows = await readEntries(inlineOut);
    const gitEntries = workerRows.filter((r) => r.name.startsWith('.git/'));
    const check = unzipTest(workerOut);
    report(
      `worker path: ${workerRows.length} entries (${gitEntries.length} under .git/), ` +
        `unzip -t ${check.ok ? 'OK' : 'FAILED'}`,
    );

    expect(check.ok).toBe(true);
    expect(gitEntries.length).toBeGreaterThan(10);
    expect(workerRows.some((r) => r.name === '.git/HEAD')).toBe(true);
    expect(contentDigest(workerRows)).toBe(contentDigest(inlineRows));
  });

  it('is cheaper than the old implementation on the largest archive', async () => {
    const inputZip = inputs.get('typescript');
    const oldResult = await probe(
      'old',
      baselineFile,
      inputZip,
      path.join(CACHE_DIR, 'typescript-old-probe.zip'),
    );
    const newResult = await probe(
      'new',
      baselineFile,
      inputZip,
      path.join(CACHE_DIR, 'typescript-new-probe.zip'),
    );

    for (const [label, r] of [
      ['OLD', oldResult],
      ['NEW', newResult],
    ] as const) {
      report(
        `${label} on typescript.zip: ${(r.ms / 1000).toFixed(1)} s, ` +
          `rss ${(r.before / MIB).toFixed(0)} → ${(r.peak / MIB).toFixed(0)} MiB ` +
          `(+${((r.peak - r.before) / MIB).toFixed(0)} MiB), ${r.sampleCount} samples` +
          (r.failure ? `, FAILED: ${r.failure.split('\n')[0]}` : ''),
      );
    }

    expect(newResult.failure).toBeNull();
    // The point of the streaming rewrite: it no longer scales its memory with the
    // repository, and it yields to the event loop while it works.
    expect(newResult.peak - newResult.before).toBeLessThan(
      oldResult.peak - oldResult.before,
    );
    expect(newResult.sampleCount).toBeGreaterThan(10);
    expect(oldResult.sampleCount).toBeLessThan(5);
  });
});
