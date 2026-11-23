import { Readable, Transform, TransformCallback } from 'stream';
import { Gunzip, createGunzip } from 'zlib';
import { parserStream as makeParser } from 'stream-json';
import { Assembler } from 'stream-json/assembler.js';
import {
  ImportError,
  MAX_IMPORT_JSON_DEPTH,
  SARIF_IMPORT_LIMITS,
  SarifLimits,
  SarifSource,
} from './import-limits';
import {
  SarifArtifactLocation,
  SarifResult,
  SarifRunHeader,
  SarifTool,
} from './sarif.types';

/**
 * Decodes the stored import object: counts the raw bytes (over
 * `maxUploadedBytes` → IMPORT_TOO_LARGE), gunzips when the first two bytes
 * are 1f 8b, counts the decoded bytes (over `maxDecompressedBytes` →
 * IMPORT_TOO_LARGE) and drops a leading UTF-8 BOM. Compression is found
 * from the magic bytes, never from a file name: the object key always ends
 * `.sarif` whatever the encoding.
 */
export function decodeSarifBytes(
  raw: Readable,
  limits: {
    maxUploadedBytes: number;
    maxDecompressedBytes: number;
  } = SARIF_IMPORT_LIMITS,
): Readable {
  let rawBytes = 0;
  let decodedBytes = 0;
  let gunzip: Gunzip | null = null;
  let bomChecked = false;
  let bomBuf = Buffer.alloc(0);

  const countRaw = new Transform({
    transform(
      chunk: Buffer,
      _encoding: BufferEncoding,
      callback: TransformCallback,
    ): void {
      rawBytes += chunk.length;
      if (rawBytes > limits.maxUploadedBytes) {
        raw.destroy();
        callback(
          new ImportError(
            'IMPORT_TOO_LARGE',
            `stored object is ${rawBytes} bytes, over the limit of ${limits.maxUploadedBytes}`,
          ),
        );
        return;
      }
      callback(null, chunk);
    },
  });

  const decoded = new Transform({
    transform(
      chunk: Buffer,
      _encoding: BufferEncoding,
      callback: TransformCallback,
    ): void {
      decodedBytes += chunk.length;
      if (decodedBytes > limits.maxDecompressedBytes) {
        raw.destroy();
        if (gunzip) gunzip.destroy();
        callback(
          new ImportError(
            'IMPORT_TOO_LARGE',
            `decompressed object is ${decodedBytes} bytes, over the limit of ${limits.maxDecompressedBytes}`,
          ),
        );
        return;
      }
      let out: Buffer = chunk;
      if (!bomChecked) {
        bomBuf = Buffer.concat([bomBuf, chunk]);
        if (bomBuf.length < 3) {
          // wait for enough decoded bytes to recognise a BOM
          callback();
          return;
        }
        bomChecked = true;
        out = bomBuf;
        bomBuf = Buffer.alloc(0);
        if (out[0] === 0xef && out[1] === 0xbb && out[2] === 0xbf) {
          out = out.subarray(3);
        }
      }
      if (out.length === 0) callback();
      else callback(null, out);
    },
    flush(callback: TransformCallback): void {
      if (!bomChecked && bomBuf.length > 0) {
        // fewer than three decoded bytes in total: cannot start with a BOM
        this.push(bomBuf);
      }
      callback();
    },
  });

  const writeTo = (
    target: Transform,
    chunk: Buffer,
    callback: (err?: Error | null) => void,
  ): void => {
    let settled = false;
    const onError = (err: Error): void => finish(err);
    const onDrain = (): void => finish();
    const finish = (err?: Error | null): void => {
      if (settled) return;
      settled = true;
      target.removeListener('error', onError);
      target.removeListener('drain', onDrain);
      callback(err);
    };
    target.once('error', onError);
    target.once('drain', onDrain);
    if (target.write(chunk)) finish();
  };

  let decided = false;
  let head = Buffer.alloc(0);

  const detect = new Transform({
    transform(
      chunk: Buffer,
      _encoding: BufferEncoding,
      callback: TransformCallback,
    ): void {
      if (decided) {
        writeTo(gunzip ?? decoded, chunk, callback);
        return;
      }
      head = Buffer.concat([head, chunk]);
      if (head.length < 2) {
        callback();
        return;
      }
      decided = true;
      const first = head;
      head = Buffer.alloc(0);
      if (first[0] === 0x1f && first[1] === 0x8b) {
        gunzip = createGunzip();
        gunzip.on('error', (err: Error) => decoded.destroy(err));
        gunzip.pipe(decoded);
        writeTo(gunzip, first, callback);
      } else {
        writeTo(decoded, first, callback);
      }
    },
    flush(callback: TransformCallback): void {
      if (!decided && head.length > 0) {
        decided = true;
        decoded.write(head);
        head = Buffer.alloc(0);
      }
      if (gunzip) gunzip.end();
      else decoded.end();
      callback();
    },
  });

  raw.pipe(countRaw);
  countRaw.pipe(detect);
  // pipe() does not forward errors
  raw.on('error', (err) => countRaw.destroy(err));
  countRaw.on('error', (err) => detect.destroy(err));
  detect.on('error', (err) => decoded.destroy(err));
  return decoded;
}

interface Token {
  name: string;
  value?: string | boolean | null;
}

type AssemblerToken = Parameters<Assembler['consume']>[0];

const asAssemblerToken = (token: Token): AssemblerToken =>
  token as unknown as AssemblerToken;

interface Frame {
  kind: 'object' | 'array';
  key: string;
  /** The dotted path of this value from the root (root = ''), kept per frame. */
  path: string;
  index: number;
  pendingKey: string | null;
}

interface Assembly {
  assembler: Assembler;
  target: 'tool' | 'uriBaseIds' | 'location' | 'result';
  runIndex: number;
}

const RUN_PATH = /^runs\.(\d+)$/;
const RESULTS_PARENT_PATH = /^runs\.(\d+)\.results$/;
const TOOL_PATH = /^runs\.(\d+)\.tool$/;
const URI_BASE_IDS_PATH = /^runs\.(\d+)\.originalUriBaseIds$/;
const ARTIFACT_LOCATION_PATH = /^runs\.(\d+)\.artifacts\.\d+\.location$/;
const RUN_PROPERTIES_PATH = /^runs\.(\d+)\.properties$/;
const RULES_PARENT_PATH =
  /^runs\.(\d+)\.tool\.(?:driver|extensions\.\d+)\.rules$/;
const ARTIFACTS_PARENT_PATH = /^runs\.(\d+)\.artifacts$/;

type PassMode = 'headers' | 'results';

/**
 * One pass over the stored object. Pass 1 (`headers`) assembles the run
 * headers and only counts the results; pass 2 (`results`) assembles each
 * result and awaits `onResult` before reading on. Both enforce the run and
 * result limits and stop the stream the moment one is crossed.
 */
async function pump(
  source: SarifSource,
  mode: PassMode,
  onResult: ((runIndex: number, result: SarifResult) => Promise<void>) | null,
  limits: SarifLimits,
): Promise<SarifRunHeader[]> {
  const raw = await source();
  const decoded = decodeSarifBytes(raw, limits);
  const parser = decoded.pipe(
    makeParser({
      packKeys: true,
      packStrings: true,
      packNumbers: true,
      streamValues: false,
    }),
  );

  return new Promise<SarifRunHeader[]>((resolve, reject) => {
    const stack: Frame[] = [];
    const assemblies: Assembly[] = [];
    const runs: SarifRunHeader[] = [];
    const queue: { runIndex: number; result: SarifResult }[] = [];
    let totalResults = 0;
    const rulesPerRun = new Map<number, number>();
    const artifactsPerRun = new Map<number, number>();
    // What the open assemblies have built: the whole header pass together,
    // or the result being read.
    let assembledValues = 0;
    let assembledChars = 0;
    let rootKind: string | null = null;
    let runsKeySeen = false;
    let runsIsArray = false;
    let stopped = false;
    let awaiting = false;

    const wrap = (err: unknown): ImportError =>
      err instanceof ImportError
        ? err
        : new ImportError(
            'IMPORT_INVALID_SARIF',
            err instanceof Error ? err.message : String(err),
          );

    const fail = (err: unknown): void => {
      if (stopped) return;
      stopped = true;
      parser.destroy();
      decoded.destroy();
      raw.destroy();
      reject(wrap(err));
    };

    // Each frame keeps its own path, so opening a value costs its key, not
    // the whole stack.
    const currentPath = (): string =>
      stack.length === 0 ? '' : stack[stack.length - 1].path;

    const childSegment = (frame: Frame): string => {
      if (frame.kind === 'object') {
        const key = frame.pendingKey ?? '';
        frame.pendingKey = null;
        return key;
      }
      const key = String(frame.index);
      frame.index += 1;
      return key;
    };

    const completeAssembly = (assembly: Assembly): void => {
      const run = runs[assembly.runIndex];
      if (!run) return;
      const value = assembly.assembler.current as unknown;
      const isObject =
        typeof value === 'object' && value !== null && !Array.isArray(value);
      switch (assembly.target) {
        case 'tool':
          run.tool = isObject ? (value as SarifTool) : { driver: {} };
          break;
        case 'uriBaseIds':
          run.originalUriBaseIds = isObject
            ? (value as Record<string, SarifArtifactLocation>)
            : {};
          break;
        case 'location':
          if (isObject) {
            const loc = value as SarifArtifactLocation;
            run.artifacts.push({ uri: loc.uri, uriBaseId: loc.uriBaseId });
          }
          break;
        case 'result':
          queue.push({
            runIndex: assembly.runIndex,
            result: value as SarifResult,
          });
          break;
      }
    };

    /**
     * Charges one token to the budget of what is being assembled; false
     * (and the pass failed) past a limit, before the value is built.
     */
    const chargeAssembled = (token: Token): boolean => {
      if (token.name === 'endObject' || token.name === 'endArray') return true;
      assembledValues += 1;
      if (typeof token.value === 'string') {
        assembledChars += token.value.length;
      }
      const [maxValues, maxChars, what] =
        mode === 'results'
          ? [limits.maxValuesPerResult, limits.maxCharsPerResult, 'a result']
          : [limits.maxHeaderValues, limits.maxHeaderChars, 'the run headers'];
      if (assembledValues > maxValues) {
        fail(
          new ImportError(
            'IMPORT_TOO_LARGE',
            `${what} hold more than ${maxValues} values`,
          ),
        );
        return false;
      }
      if (assembledChars > maxChars) {
        fail(
          new ImportError(
            'IMPORT_TOO_LARGE',
            `${what} hold more than ${maxChars} characters of text`,
          ),
        );
        return false;
      }
      return true;
    };

    const processToken = (token: Token): void => {
      let newAssembly: Assembly | null = null;
      if (token.name === 'keyValue') {
        const top = stack[stack.length - 1];
        if (top) {
          top.pendingKey = String(token.value);
          if (stack.length === 1 && top.pendingKey === 'runs')
            runsKeySeen = true;
        }
      } else if (token.name === 'startObject' || token.name === 'startArray') {
        const kind = token.name === 'startObject' ? 'object' : 'array';
        if (stack.length >= MAX_IMPORT_JSON_DEPTH) {
          fail(
            new ImportError(
              'IMPORT_INVALID_SARIF',
              `the file nests values deeper than ${MAX_IMPORT_JSON_DEPTH} levels`,
            ),
          );
          return;
        }
        const parent = currentPath();
        const key =
          stack.length === 0 ? '' : childSegment(stack[stack.length - 1]);
        const path = parent === '' ? key : `${parent}.${key}`;
        stack.push({ kind, key, path, index: 0, pendingKey: null });
        if (stack.length === 1) rootKind = kind;
        if (path === 'runs' && kind === 'array') runsIsArray = true;
        const runMatch = RUN_PATH.exec(path);
        if (runMatch && kind === 'object') {
          const runIndex = Number(runMatch[1]);
          if (runIndex + 1 > limits.maxRuns) {
            fail(
              new ImportError(
                'IMPORT_TOO_MANY_RUNS',
                `file has more than ${limits.maxRuns} runs`,
              ),
            );
            return;
          }
          runs.push({
            index: runIndex,
            tool: { driver: {} },
            originalUriBaseIds: {},
            artifacts: [],
            resultCount: 0,
          });
        }
        const rulesParent = RULES_PARENT_PATH.exec(parent);
        if (rulesParent) {
          const runIndex = Number(rulesParent[1]);
          const count = (rulesPerRun.get(runIndex) ?? 0) + 1;
          rulesPerRun.set(runIndex, count);
          if (count > limits.maxRulesPerRun) {
            fail(
              new ImportError(
                'IMPORT_TOO_LARGE',
                `a run has more than ${limits.maxRulesPerRun} rules`,
              ),
            );
            return;
          }
        }
        const artifactsParent = ARTIFACTS_PARENT_PATH.exec(parent);
        if (artifactsParent) {
          const runIndex = Number(artifactsParent[1]);
          const count = (artifactsPerRun.get(runIndex) ?? 0) + 1;
          artifactsPerRun.set(runIndex, count);
          if (count > limits.maxArtifactsPerRun) {
            fail(
              new ImportError(
                'IMPORT_TOO_LARGE',
                `a run has more than ${limits.maxArtifactsPerRun} artifacts`,
              ),
            );
            return;
          }
        }
        const resultsParent = RESULTS_PARENT_PATH.exec(parent);
        if (resultsParent && token.name === 'startObject') {
          const runIndex = Number(resultsParent[1]);
          const run = runs[runIndex];
          if (run) run.resultCount += 1;
          totalResults += 1;
          if (totalResults > limits.maxResults) {
            fail(
              new ImportError(
                'IMPORT_TOO_MANY_RESULTS',
                `file has more than ${limits.maxResults} results`,
              ),
            );
            return;
          }
          if (mode === 'results') {
            assembledValues = 0;
            assembledChars = 0;
            newAssembly = {
              assembler: new Assembler(),
              target: 'result',
              runIndex,
            };
          }
        }
        if (mode === 'headers') {
          const toolMatch = TOOL_PATH.exec(path);
          const uriMatch = URI_BASE_IDS_PATH.exec(path);
          const locMatch = ARTIFACT_LOCATION_PATH.exec(path);
          if (toolMatch) {
            newAssembly = {
              assembler: new Assembler(),
              target: 'tool',
              runIndex: Number(toolMatch[1]),
            };
          } else if (uriMatch) {
            newAssembly = {
              assembler: new Assembler(),
              target: 'uriBaseIds',
              runIndex: Number(uriMatch[1]),
            };
          } else if (locMatch) {
            newAssembly = {
              assembler: new Assembler(),
              target: 'location',
              runIndex: Number(locMatch[1]),
            };
          }
        }
      } else if (token.name === 'endObject' || token.name === 'endArray') {
        stack.pop();
      } else if (
        mode === 'headers' &&
        token.name === 'stringValue' &&
        assemblies.length === 0
      ) {
        // `runs[i].properties.imageID`, a string directly under the run's
        // property bag: the one value of that bag pass 1 keeps.
        const top = stack[stack.length - 1];
        if (top?.kind === 'object' && top.pendingKey === 'imageID') {
          const propsMatch = RUN_PROPERTIES_PATH.exec(currentPath());
          const run = propsMatch ? runs[Number(propsMatch[1])] : undefined;
          if (run && run.imageId === undefined) {
            run.imageId = String(token.value);
          }
        }
      }

      if (newAssembly) assemblies.push(newAssembly);
      if (assemblies.length > 0 && !chargeAssembled(token)) return;
      for (let i = assemblies.length - 1; i >= 0; i -= 1) {
        const assembly = assemblies[i];
        assembly.assembler.consume(asAssemblerToken(token));
        if (assembly.assembler.done) {
          assemblies.splice(i, 1);
          completeAssembly(assembly);
        }
      }
    };

    parser.on('data', (token: Token) => {
      if (stopped) return;
      try {
        processToken(token);
      } catch (err) {
        fail(err);
        return;
      }
      if (stopped) return;
      if (onResult && queue.length > 0 && !awaiting) {
        // backpressure: pause the source while awaiting onResult
        awaiting = true;
        parser.pause();
        const step = (): void => {
          const item = queue.shift();
          if (!item) {
            awaiting = false;
            if (!stopped) parser.resume();
            return;
          }
          Promise.resolve(onResult(item.runIndex, item.result)).then(
            step,
            fail,
          );
        };
        step();
      }
    });
    parser.on('end', () => {
      if (stopped) return;
      try {
        if (rootKind !== 'object') {
          throw new ImportError(
            'IMPORT_INVALID_SARIF',
            'the root of the file is not a JSON object',
          );
        }
        if (!runsKeySeen || !runsIsArray) {
          throw new ImportError(
            'IMPORT_INVALID_SARIF',
            'the file has no runs array',
          );
        }
      } catch (err) {
        fail(err);
        return;
      }
      resolve(runs);
    });
    parser.on('error', fail);
    decoded.on('error', fail);
    raw.on('error', fail);
  });
}

/** Pass 1: the run headers (tool, base URIs, artifact locations, counts). */
export function readSarifHeaders(
  source: SarifSource,
  limits: SarifLimits = SARIF_IMPORT_LIMITS,
): Promise<SarifRunHeader[]> {
  return pump(source, 'headers', null, limits);
}

/** Pass 2: every result, in file order, one awaited at a time. */
export async function forEachSarifResult(
  source: SarifSource,
  onResult: (runIndex: number, result: SarifResult) => Promise<void>,
  limits: SarifLimits = SARIF_IMPORT_LIMITS,
): Promise<void> {
  await pump(source, 'results', onResult, limits);
}
