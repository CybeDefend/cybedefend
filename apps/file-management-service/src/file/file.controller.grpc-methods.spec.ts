import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PATTERN_METADATA } from '@nestjs/microservices/constants';
import { FileController } from './file.controller';

/**
 * A service whose export strips RPCs from its proto must not rely on
 * ts-proto's `@FileServiceControllerMethods()` + `implements
 * FileServiceController` — the exported tree stops compiling because the
 * generated interface no longer lists the stripped RPC. Every RPC the core
 * still serves is wired through an explicit `@GrpcMethod('FileService',
 * '<Rpc>')`, and the stripped diff-scan upload lives in the closed edition.
 */

// The core FileService RPCs that stay in the exported proto.
const CORE_RPCS = [
  'UploadFile',
  'DeleteFile',
  'GetDownloadUrl',
  'RequestReportUploadUrl',
  'FinalizeReportUpload',
  'DeleteReportObject',
  'RequestImportUploadUrl',
  'GetImportDownloadUrl',
  'DeleteImportObject',
] as const;

const DIFF_RPC = 'RequestDiffScanUploadUrl';

interface GrpcPattern {
  service: string;
  rpc: string;
  streaming?: string;
}

function handlersOf(proto: object): Array<[string, unknown]> {
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name) => [name, (proto as Record<string, unknown>)[name]]);
}

function patternsOf(handler: unknown): GrpcPattern[] {
  const metadata = Reflect.getMetadata(PATTERN_METADATA, handler);
  if (!metadata) return [];
  return (Array.isArray(metadata) ? metadata : [metadata]) as GrpcPattern[];
}

describe('FileController gRPC wiring', () => {
  it('serves every core FileService RPC through an explicit @GrpcMethod', () => {
    const handlers = handlersOf(FileController.prototype);
    for (const rpc of CORE_RPCS) {
      const found = handlers.some(([, handler]) =>
        patternsOf(handler).some(
          (p) => p.service === 'FileService' && p.rpc === rpc,
        ),
      );
      if (!found) {
        throw new Error(`no FileController method carries rpc '${rpc}'`);
      }
    }
  });

  it('the core controller does not serve the diff-scan upload', () => {
    const proto = FileController.prototype as unknown as Record<
      string,
      unknown
    >;
    expect(proto).not.toHaveProperty('requestDiffScanUploadUrl');
    for (const [, handler] of handlersOf(FileController.prototype)) {
      for (const p of patternsOf(handler)) {
        expect(p.rpc).not.toBe(DIFF_RPC);
      }
    }
  });

  it('no core file imports the diff-scan upload messages', () => {
    // Built by concatenation so this spec file itself does not contain the
    // literals it forbids.
    const needles = [
      'RequestDiffScanUploadUrl' + 'Request',
      'RequestDiffScanUploadUrl' + 'Response',
    ];
    const srcRoot = path.join(__dirname, '..');
    const grpcDir = path.join(srcRoot, 'core', 'grpc');
    const eeDir = path.join(srcRoot, 'ee');

    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue;
          if (full === eeDir) continue; // src/ee/ is dropped whole at export
          // src/core/grpc/<domain>/ is generated (gitignored) and rebuilt from
          // the stripped protos at export; scan only the handwritten files
          // directly under src/core/grpc/.
          if (path.dirname(full) === grpcDir) continue;
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          files.push(full);
        }
      }
    };
    walk(srcRoot);

    const offenders = files
      .filter((file) => {
        const text = fs.readFileSync(file, 'utf8');
        return needles.some((needle) => text.includes(needle));
      })
      .map((file) => path.relative(srcRoot, file));
    expect(offenders).toEqual([]);
  });
});
