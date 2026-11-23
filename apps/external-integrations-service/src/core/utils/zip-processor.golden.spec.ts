import { fork } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import archiver from 'archiver';
import * as yauzl from 'yauzl';
import { runZipProcessing } from './zip-processor';

/**
 * Golden + memory spec for the repository zip rewrite.
 *
 * This is the RED/GREEN anchor for the AdmZip → streaming rewrite:
 *
 *  - The "entry list" tests pin the OBSERVABLE contract of `runZipProcessing`:
 *    the exact sorted set of `[entryName, uncompressedSize]` pairs written to
 *    the output archive. They are written against, and MUST pass on, the old
 *    fully-buffered AdmZip implementation, and then on the streaming one —
 *    that equality is the proof the rewrite is behaviour-preserving.
 *
 *  - The "memory" test pins the peak RSS of the rewrite. The old
 *    implementation buffers the whole input archive, every inflated entry and
 *    the whole output archive at once (≈ 2×compressed + uncompressed + 2×.git
 *    per job), which is what got the repo-scan worker OOM-killed at 2 Gi.
 *
 * Fixture: a GitHub-zipball-shaped archive (everything nested under a single
 * top-level `owner-repo-sha/` folder, directory entries included) carrying
 * 2 000 small files plus one large incompressible file, together with a bare
 * `.git` mirror whose `objects/pack/*.pack` is large. ~50 MiB in total with
 * the default settings.
 *
 * Local soak run with a large repository (NOT run in CI — it needs >1 GiB of
 * headroom on the old implementation):
 *
 *   ZIP_MEMORY_TEST_MB=500 pnpm run test -- \
 *     --testPathPatterns='zip-processor.golden' --runInBand
 */

/**
 * Size in MiB of the single large file inside the fixture repository.
 *
 * 120, not 30: at 30 the old implementation grew RSS by 313 MiB against the
 * 300 MiB budget below — a 4 % margin, which RSS noise alone can move. A real
 * regression to buffering has to fail loudly, not by a coin flip.
 */
const BIG_FILE_MB = Number(process.env.ZIP_MEMORY_TEST_MB ?? 120);
/** Size in MiB of the fixture `.git/objects/pack/*.pack`. */
const GIT_PACK_MB = 20;
/** Number of small source files in the fixture repository. */
const SMALL_FILE_COUNT = 2000;
/** Peak RSS the rewrite is allowed to add, for the DEFAULT fixture. */
const MAX_RSS_GROWTH_BYTES = 300 * 1024 * 1024;

const MIB = 1024 * 1024;
/** GitHub nests every zipball entry under `<owner>-<repo>-<sha>/`. */
const TOP_LEVEL = 'cybedefend-api-microservices-abc1234';

jest.setTimeout(600_000);

/** Write `sizeBytes` of incompressible bytes to `filePath`, without buffering. */
function writeRandomFile(filePath: string, sizeBytes: number): Promise<void> {
  const chunkSize = 256 * 1024;
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(filePath);
    let written = 0;
    const pump = (): void => {
      while (written < sizeBytes) {
        const size = Math.min(chunkSize, sizeBytes - written);
        // A fresh buffer per chunk: fs.WriteStream keeps a reference to the
        // chunk until it is flushed, so a reused buffer would be corrupted.
        const chunk = crypto.randomBytes(size);
        written += size;
        if (!out.write(chunk)) {
          out.once('drain', pump);
          return;
        }
      }
      out.end();
    };
    out.on('error', reject);
    out.on('close', () => resolve());
    pump();
  });
}

/** Materialise the fixture repository tree on disk; returns its root. */
async function createRepoTree(tmpDir: string): Promise<string> {
  const root = path.join(tmpDir, 'repo-src');
  fs.mkdirSync(path.join(root, 'src', 'modules'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });

  fs.writeFileSync(path.join(root, 'README.md'), '# fixture repository\n');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    '{"name":"fixture","version":"1.0.0"}\n',
  );
  for (let i = 0; i < SMALL_FILE_COUNT; i++) {
    const dir =
      i % 2 === 0 ? path.join(root, 'src', 'modules') : path.join(root, 'docs');
    fs.writeFileSync(
      path.join(dir, `file-${String(i).padStart(5, '0')}.txt`),
      `// fixture source file ${i}\nexport const value${i} = ${i};\n`,
    );
  }
  await writeRandomFile(path.join(root, 'assets.bin'), BIG_FILE_MB * MIB);
  return root;
}

/** Materialise a bare `.git` mirror on disk; returns its root. */
async function createGitMirror(tmpDir: string): Promise<string> {
  const gitDir = path.join(tmpDir, 'git-mirror');
  fs.mkdirSync(path.join(gitDir, 'objects', 'pack'), { recursive: true });
  fs.mkdirSync(path.join(gitDir, 'refs', 'heads'), { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(gitDir, 'config'), '[core]\n\tbare = true\n');
  fs.writeFileSync(
    path.join(gitDir, 'refs', 'heads', 'main'),
    'a'.repeat(40) + '\n',
  );
  await writeRandomFile(
    path.join(gitDir, 'objects', 'pack', 'pack-fixture.pack'),
    GIT_PACK_MB * MIB,
  );
  return gitDir;
}

/**
 * Zip `srcRoot` under a single top-level folder, the way a GitHub zipball is
 * shaped. Written with archiver so building the fixture does not itself
 * allocate the whole archive (which would pollute the RSS measurement).
 */
function zipAsGithubZipball(srcRoot: string, zipPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    out.on('close', () => resolve());
    out.on('error', reject);
    archive.on('error', reject);
    archive.pipe(out);
    archive.directory(srcRoot, TOP_LEVEL);
    void archive.finalize();
  });
}

/** Read the output archive's central directory (no inflation). */
async function readEntryList(zipPath: string): Promise<[string, number][]> {
  const zipfile = await yauzl.openPromise(zipPath, { lazyEntries: true });
  const entries: [string, number][] = [];
  for await (const entry of zipfile.eachEntry()) {
    entries.push([entry.fileName, entry.uncompressedSize]);
  }
  return entries.sort((a, b) => a[0].localeCompare(b[0]));
}

/** Every regular file under `dir`, as `[posixRelativePath, byteSize]`. */
function listFiles(dir: string, prefix = ''): [string, number][] {
  const out: [string, number][] = [];
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name);
    const rel = prefix ? `${prefix}/${dirent.name}` : dirent.name;
    if (dirent.isDirectory()) out.push(...listFiles(full, rel));
    else if (dirent.isFile()) out.push([rel, fs.statSync(full).size]);
  }
  return out;
}

/**
 * The rewrite is measured in a FORKED child process, not in the Jest worker.
 *
 * Two reasons, both load-bearing:
 *  - RSS never shrinks back inside a long-lived process, and a ts-jest worker
 *    is already ~1 GiB resident. Measured in-process, the old implementation's
 *    ~315 MiB of allocation disappears into that noise (77 MiB observed), so
 *    the assertion would not guard anything.
 *  - A fresh process is exactly the deployed shape: the rewrite runs in a
 *    worker thread inside a pod with a cgroup limit.
 *
 * The post-run reading is folded into the peak on purpose: a fully synchronous
 * implementation blocks the event loop for its whole duration, so the interval
 * sampler cannot fire even once (`sampleCount === 2`). Its true peak is reached
 * right before it returns and RSS does not shrink instantly, so the post-run
 * reading is a faithful lower bound. A streaming implementation is measured by
 * the interval samples.
 */
const RSS_PROBE_SOURCE = `
const { register } = require(process.env.TS_NODE_PATH);
register({ transpileOnly: true });
const { runZipProcessing } = require(process.env.ZIP_MODULE);
const [inputZip, outputZip, gitDir] = process.argv.slice(2);
(async () => {
  const before = process.memoryUsage.rss();
  const arrayBuffersBefore = process.memoryUsage().arrayBuffers;
  const samples = [before];
  let arrayBuffersPeak = arrayBuffersBefore;
  const sample = () => {
    samples.push(process.memoryUsage.rss());
    arrayBuffersPeak = Math.max(arrayBuffersPeak, process.memoryUsage().arrayBuffers);
  };
  const timer = setInterval(sample, 50);
  try {
    await Promise.resolve(runZipProcessing(inputZip, outputZip, gitDir || undefined));
  } finally {
    clearInterval(timer);
    sample();
  }
  process.send({
    before,
    peak: Math.max.apply(null, samples),
    sampleCount: samples.length,
    arrayBuffersBefore,
    arrayBuffersPeak,
  });
  process.exit(0);
})().catch((err) => {
  process.send({ error: String((err && err.stack) || err) });
  process.exit(1);
});
`;

interface RssProbeResult {
  before: number;
  peak: number;
  growth: number;
  sampleCount: number;
  /** Peak growth of ArrayBuffer memory: entry streams and their buffers. */
  arrayBuffersGrowth: number;
}

function measureRewriteRss(
  tmpDir: string,
  inputZip: string,
  outputZip: string,
  gitDir = '',
): Promise<RssProbeResult> {
  const probePath = path.join(tmpDir, 'rss-probe.cjs');
  fs.writeFileSync(probePath, RSS_PROBE_SOURCE);

  return new Promise((resolve, reject) => {
    const child = fork(probePath, [inputZip, outputZip, gitDir], {
      cwd: path.resolve(__dirname, '..', '..', '..'),
      env: {
        ...process.env,
        TS_NODE_PATH: require.resolve('ts-node'),
        ZIP_MODULE: path.join(__dirname, 'zip-processor.ts'),
      },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    let settled = false;
    child.on(
      'message',
      (msg: {
        before?: number;
        peak?: number;
        sampleCount?: number;
        arrayBuffersBefore?: number;
        arrayBuffersPeak?: number;
        error?: string;
      }) => {
        settled = true;
        if (msg.error) reject(new Error(msg.error));
        else
          resolve({
            before: msg.before,
            peak: msg.peak,
            growth: msg.peak - msg.before,
            sampleCount: msg.sampleCount,
            arrayBuffersGrowth: msg.arrayBuffersPeak - msg.arrayBuffersBefore,
          });
      },
    );
    child.on('error', reject);
    child.on('exit', (code) => {
      if (!settled) reject(new Error(`RSS probe exited with code ${code}`));
    });
  });
}

describe('zip-processor — golden entry list', () => {
  let tmpDir: string;
  let inputZip: string;
  let outputZip: string;
  let gitDir: string;
  let expectedEntries: [string, number][];

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-golden-'));
    inputZip = path.join(tmpDir, 'input.zip');
    outputZip = path.join(tmpDir, 'output.zip');

    const repoRoot = await createRepoTree(tmpDir);
    gitDir = await createGitMirror(tmpDir);
    await zipAsGithubZipball(repoRoot, inputZip);

    // The contract: the top-level folder is stripped from every source entry,
    // directory entries are dropped, and the mirror lands under `.git/`.
    expectedEntries = [
      ...listFiles(repoRoot),
      ...listFiles(gitDir).map(([name, size]): [string, number] => [
        `.git/${name}`,
        size,
      ]),
    ].sort((a, b) => a[0].localeCompare(b[0]));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('keeps peak RSS during the rewrite under the worker budget', async () => {
    const out = path.join(tmpDir, 'output-memory.zip');

    const { before, peak, growth, sampleCount } = await measureRewriteRss(
      tmpDir,
      inputZip,
      out,
      gitDir,
    );

    // Only when someone is deliberately measuring: a normal CI run stays quiet.
    if (process.env.ZIP_MEMORY_TEST_MB) {
      console.log(
        `bigFile=${BIG_FILE_MB} MiB rss before=${(before / MIB).toFixed(1)} MiB ` +
          `peak=${(peak / MIB).toFixed(1)} MiB growth=${(growth / MIB).toFixed(1)} MiB ` +
          `samples=${sampleCount}`,
      );
    }

    expect(growth).toBeLessThan(MAX_RSS_GROWTH_BYTES);
  });

  it('writes exactly the expected [name, uncompressedSize] entries', async () => {
    // `Promise.resolve` so this spec reads identically against the old
    // synchronous implementation and the streaming (async) one.
    await Promise.resolve(runZipProcessing(inputZip, outputZip, gitDir));

    const actual = await readEntryList(outputZip);

    expect(actual.length).toBe(expectedEntries.length);
    expect(actual).toEqual(expectedEntries);
  });
});

/** Entries in the many-entries fixture, and the payload each one carries. */
const MANY_ENTRY_COUNT = 20000;
const MANY_ENTRY_BYTES = 16 * 1024;
/** ArrayBuffer growth allowed across the whole many-entries rewrite. */
const MAX_ARRAY_BUFFER_GROWTH_BYTES = 128 * 1024 * 1024;
/** Total RSS growth allowed for it — see the note on archiver's floor below. */
const MAX_MANY_ENTRY_RSS_GROWTH_BYTES = 500 * 1024 * 1024;

/**
 * Memory must not scale with the entry COUNT.
 *
 * The fixture above is sized in bytes, which cannot see a per-entry leak: a
 * real GitHub monorepo is not one big file, it is ~100 000 small ones
 * (microsoft/TypeScript's zipball has 67 323 entries). A few KiB retained per
 * entry is invisible at 2 000 entries and fatal at 67 000 — precisely the
 * failure that survives a byte-sized fixture, and precisely the one that was
 * in this code: `Promise.race` against a never-settling promise held every
 * entry's read stream for the whole run (+1 037 MiB of ArrayBuffers on
 * TypeScript's zipball).
 *
 * The payload is compressible, so the fixture costs ~4.5 MiB on disk while
 * still making yauzl allocate real stream buffers per entry — without that,
 * the retention is too small to measure and the test proves nothing.
 *
 * The primary assertion is on ArrayBuffer growth, which is the entry streams
 * and nothing else. RSS gets a looser ceiling because it also carries a floor
 * this code does not control: archiver holds the whole central directory in
 * memory until `finalize()`, ~8 KiB of heap per entry, which no amount of
 * streaming removes (measured: 471 MiB of heap for 67 323 entries).
 */
describe('zip-processor — many entries', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-many-'));
  });
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('retains no entry stream across a 20 000-entry archive', async () => {
    const inputZip = path.join(tmpDir, 'many.zip');
    const outputZip = path.join(tmpDir, 'many-out.zip');
    const payload = Buffer.alloc(MANY_ENTRY_BYTES, 0x41);
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(inputZip);
      const archive = archiver('zip', { zlib: { level: 1 } });
      out.on('close', () => resolve());
      out.on('error', reject);
      archive.on('error', reject);
      archive.pipe(out);
      for (let i = 0; i < MANY_ENTRY_COUNT; i++) {
        archive.append(payload, {
          name: `${TOP_LEVEL}/src/f${String(i).padStart(6, '0')}.bin`,
        });
      }
      void archive.finalize();
    });

    const { before, peak, growth, sampleCount, arrayBuffersGrowth } =
      await measureRewriteRss(tmpDir, inputZip, outputZip);

    if (process.env.ZIP_MEMORY_TEST_MB) {
      console.log(
        `${MANY_ENTRY_COUNT} entries rss before=${(before / MIB).toFixed(1)} MiB ` +
          `peak=${(peak / MIB).toFixed(1)} MiB growth=${(growth / MIB).toFixed(1)} MiB ` +
          `arrayBuffers=+${(arrayBuffersGrowth / MIB).toFixed(1)} MiB samples=${sampleCount}`,
      );
    }

    expect(await readEntryList(outputZip)).toHaveLength(MANY_ENTRY_COUNT);
    expect(arrayBuffersGrowth).toBeLessThan(MAX_ARRAY_BUFFER_GROWTH_BYTES);
    expect(growth).toBeLessThan(MAX_MANY_ENTRY_RSS_GROWTH_BYTES);
  });
});

describe('zip-processor — entry-name edge cases', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-golden-edge-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Build a zip from an explicit `[name, contents]` list, directories included. */
  function buildZip(entries: [string, string | null][]): Promise<string> {
    const zipPath = path.join(tmpDir, 'edge.zip');
    return new Promise((resolve, reject) => {
      const out = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 0 } });
      out.on('close', () => resolve(zipPath));
      out.on('error', reject);
      archive.on('error', reject);
      archive.pipe(out);
      for (const [name, contents] of entries) {
        if (contents === null) archive.append(null, { name });
        else archive.append(Buffer.from(contents), { name });
      }
      void archive.finalize();
    });
  }

  it('drops directory entries and strips only the first path segment', async () => {
    const inputZip = await buildZip([
      ['top-abc/', null],
      ['top-abc/src/', null],
      ['top-abc/src/app.js', 'console.log(1)'],
      ['top-abc/README.md', '# readme'],
    ]);
    const outputZip = path.join(tmpDir, 'out.zip');

    await Promise.resolve(runZipProcessing(inputZip, outputZip));

    expect(await readEntryList(outputZip)).toEqual([
      ['README.md', 8],
      ['src/app.js', 14],
    ]);
  });

  it('drops an entry that has no path segment left after stripping', async () => {
    const inputZip = await buildZip([
      ['loose-file-at-root', 'x'],
      ['top-abc/keep.txt', 'keep'],
    ]);
    const outputZip = path.join(tmpDir, 'out.zip');

    await Promise.resolve(runZipProcessing(inputZip, outputZip));

    expect(await readEntryList(outputZip)).toEqual([['keep.txt', 4]]);
  });

  it('writes no .git entries when no gitDir is given', async () => {
    const inputZip = await buildZip([['top-abc/keep.txt', 'keep']]);
    const outputZip = path.join(tmpDir, 'out.zip');

    await Promise.resolve(runZipProcessing(inputZip, outputZip));

    const names = (await readEntryList(outputZip)).map(([name]) => name);
    expect(names.filter((n) => n.startsWith('.git/'))).toHaveLength(0);
  });

  it('ignores a gitDir that does not exist', async () => {
    const inputZip = await buildZip([['top-abc/keep.txt', 'keep']]);
    const outputZip = path.join(tmpDir, 'out.zip');

    await expect(
      Promise.resolve(
        runZipProcessing(inputZip, outputZip, path.join(tmpDir, 'absent')),
      ),
    ).resolves.toBeUndefined();

    expect(await readEntryList(outputZip)).toEqual([['keep.txt', 4]]);
  });

  it('skips symlinks inside the .git mirror', async () => {
    const inputZip = await buildZip([['top-abc/keep.txt', 'keep']]);
    const outputZip = path.join(tmpDir, 'out.zip');
    const gitDir = path.join(tmpDir, 'git');
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
    try {
      fs.symlinkSync(
        path.join(gitDir, 'HEAD'),
        path.join(gitDir, 'link-to-head'),
      );
    } catch {
      return; // platform without symlink privileges
    }

    await Promise.resolve(runZipProcessing(inputZip, outputZip, gitDir));

    const names = (await readEntryList(outputZip)).map(([name]) => name);
    expect(names).toContain('.git/HEAD');
    expect(names).not.toContain('.git/link-to-head');
  });
});
