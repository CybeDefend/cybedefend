import { ResultController } from './result.controller';
import { PATTERN_METADATA } from '@nestjs/microservices/constants';
import { loadSync } from '@grpc/proto-loader';
import { join } from 'node:path';

/**
 * ResultController declares every one of its handlers with an
 * explicit @GrpcMethod('ResultService', '<camelCase>') instead of the
 * generated @ResultServiceControllerMethods() (the exported proto loses the
 * closed RPCs, so the core controller must not implement the full generated
 * interface). This spec imports nothing from the closed code; the core +
 * closed union is pinned by a closed spec.
 */

interface GrpcPattern {
  service: string;
  rpc: string;
  streaming?: string;
}

interface MethodDefinition {
  originalName: string;
}

const PROTO_DIR = join(__dirname, '../../../../../libs/protos');

/** The camelCase RPC names of the proto's ResultService (proto-loader's originalName). */
const protoResultRpcs = (): string[] => {
  const def = loadSync('analysis-reporting/analysis_reporting.proto', {
    includeDirs: [PROTO_DIR],
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: false,
  });
  const service = def['cybedefend.analysis_reporting.ResultService'] as Record<
    string,
    MethodDefinition
  >;
  return Object.values(service).map((m) => m.originalName);
};

/** The ResultService rpc names of PATTERN_METADATA, over the controller's prototype. */
const handlersOf = (ctrl: { prototype: object }): string[] => {
  const handled: string[] = [];
  const proto = ctrl.prototype as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === 'constructor') continue;
    const fn = proto[key];
    if (typeof fn !== 'function') continue;
    const patterns = Reflect.getMetadata(PATTERN_METADATA, fn) as
      | GrpcPattern[]
      | undefined;
    for (const pattern of patterns ?? []) {
      if (pattern.service === 'ResultService') handled.push(pattern.rpc);
    }
  }
  return handled;
};

describe('ResultController RPC ownership', () => {
  it('ResultController serves only ResultService RPCs of the proto, each once', () => {
    const protoRpcs = protoResultRpcs();
    const handled = handlersOf(ResultController);
    expect(handled.filter((r) => !protoRpcs.includes(r))).toEqual([]);
    expect(new Set(handled).size).toBe(handled.length);
  });
});
