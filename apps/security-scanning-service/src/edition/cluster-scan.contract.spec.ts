import { loadSync } from '@grpc/proto-loader';
import { join } from 'node:path';

/**
 * The contract of Community scans on a connected Kubernetes cluster: the
 * upload-token RPCs and the capability RPC
 * on `ScanService`, and the per-container fields of the import path in
 * security-scanning, analysis-reporting and file-management. Read through
 * `@grpc/proto-loader` with keepCase, so snake_case field names appear as
 * written in the `.proto`. Same loader as `import-scan.contract.spec.ts`.
 */

interface FieldDescriptor {
  name: string;
  number: number;
  type: string;
  label: string;
  typeName?: string;
}

interface MessageDefinition {
  type: { field: FieldDescriptor[]; oneofDecl?: { name: string }[] };
}

interface ServiceDefinition {
  [method: string]: unknown;
}

type PackageDefinition = Record<string, MessageDefinition | ServiceDefinition>;

const PROTO_DIR = join(__dirname, '../../../../libs/protos');

// Loaded per test so a missing file or field fails that test, not the suite.
const load = (file: string): PackageDefinition =>
  loadSync(file, {
    keepCase: true,
    includeDirs: [PROTO_DIR],
  }) as unknown as PackageDefinition;

const pkg = (): PackageDefinition =>
  load('security-scanning/security_scanning.proto');

const messageOf = (
  defs: PackageDefinition,
  messageName: string,
): MessageDefinition => {
  const def = defs[messageName];
  if (!def || !('type' in def)) {
    throw new Error(`message not found in loaded protos: ${messageName}`);
  }
  return def as MessageDefinition;
};

const fieldsOf = (
  messageName: string,
  defs: PackageDefinition = pkg(),
): FieldDescriptor[] => messageOf(defs, messageName).type.field;

// protobufjs's descriptor output does not set proto3Optional; a proto3
// `optional` field instead gets a synthetic oneof named `_<field>`.
const isProto3Optional = (
  messageName: string,
  field: FieldDescriptor,
  defs: PackageDefinition = pkg(),
): boolean =>
  (messageOf(defs, messageName).type.oneofDecl ?? []).some(
    (o) => o.name === `_${field.name}`,
  );

const COMPLETE_IMPORT_SCAN =
  'cybedefend.security_scanning.CompleteImportScanRequest';

describe('security_scanning.proto — Community cluster scan contract', () => {
  it('declares exactly the three cluster RPCs on ClusterScanService', () => {
    const svc = pkg()[
      'cybedefend.security_scanning.ClusterScanService'
    ] as ServiceDefinition;
    expect(svc).toBeDefined();
    expect(Object.keys(svc).sort()).toEqual([
      'AuthorizeScanUpload',
      'GetScanCapabilities',
      'SubmitScanResults',
    ]);
  });

  it('leaves ScanService without the cluster RPCs', () => {
    const svc = pkg()[
      'cybedefend.security_scanning.ScanService'
    ] as ServiceDefinition;
    for (const rpc of [
      'AuthorizeScanUpload',
      'SubmitScanResults',
      'GetScanCapabilities',
    ]) {
      expect(Object.keys(svc)).not.toContain(rpc);
    }
  });

  it('numbers CompleteImportScanRequest.container_id 6, proto3 optional', () => {
    const f = fieldsOf(COMPLETE_IMPORT_SCAN).find(
      (x) => x.name === 'container_id',
    );
    expect(f).toMatchObject({ number: 6, type: 'TYPE_STRING' });
    expect(isProto3Optional(COMPLETE_IMPORT_SCAN, f)).toBe(true);
  });

  it.each([
    [
      'AuthorizeScanUploadRequest',
      [
        ['scan_id', 1],
        ['token_hash', 2],
        ['protocol_version', 3],
      ],
    ],
    [
      'AuthorizeScanUploadResponse',
      [
        ['project_id', 1],
        ['organization_id', 2],
        ['container_id', 3],
        ['category', 4],
      ],
    ],
    [
      'SubmitScanResultsRequest',
      [
        ['scan_id', 1],
        ['token_hash', 2],
        ['object_key', 3],
        ['sbom_object_key', 4],
      ],
    ],
    ['SubmitScanResultsResponse', [['accepted', 1]]],
    ['GetScanCapabilitiesRequest', []],
    ['GetScanCapabilitiesResponse', [['cluster_scans', 1]]],
  ] as [string, [string, number][]][])(
    '%s has exactly its fields',
    (msg, fields) => {
      expect(
        fieldsOf(`cybedefend.security_scanning.${msg}`).map((f) => [
          f.name,
          f.number,
        ]),
      ).toEqual(fields);
    },
  );

  it('numbers SubmitScanResultsRequest.sbom_object_key 4, proto3 optional (protocol 2, the sca container)', () => {
    const msg = 'cybedefend.security_scanning.SubmitScanResultsRequest';
    const f = fieldsOf(msg).find((x) => x.name === 'sbom_object_key');
    expect(f).toMatchObject({ number: 4, type: 'TYPE_STRING' });
    expect(isProto3Optional(msg, f)).toBe(true);
  });

  it('types the fields of the token messages', () => {
    const types = (msg: string) =>
      Object.fromEntries(
        fieldsOf(`cybedefend.security_scanning.${msg}`).map((f) => [
          f.name,
          f.type,
        ]),
      );
    expect(types('AuthorizeScanUploadRequest')).toEqual({
      scan_id: 'TYPE_STRING',
      token_hash: 'TYPE_STRING',
      protocol_version: 'TYPE_INT32',
    });
    expect(types('SubmitScanResultsResponse')).toEqual({
      accepted: 'TYPE_BOOL',
    });
    expect(types('GetScanCapabilitiesResponse')).toEqual({
      cluster_scans: 'TYPE_BOOL',
    });
  });

  it('ImportResultsRequest carries container_id 9 and severities 10', () => {
    const defs = load('analysis-reporting/result.proto');
    const msg = 'cybedefend.analysis_reporting.ImportResultsRequest';
    for (const [name, number] of [
      ['container_id', 9],
      ['severities', 10],
    ] as const) {
      const f = fieldsOf(msg, defs).find((x) => x.name === name);
      expect(f).toMatchObject({ number, type: 'TYPE_STRING' });
      expect(isProto3Optional(msg, f, defs)).toBe(true);
    }
  });

  it('file-management carries container_id 5 and audience 2', () => {
    const defs = load('file-management/file.proto');
    for (const [msg, name, number] of [
      ['RequestImportUploadUrlRequest', 'container_id', 5],
      ['GetDownloadUrlRequest', 'audience', 2],
    ] as const) {
      const full = `cybedefend.file_management.${msg}`;
      const f = fieldsOf(full, defs).find((x) => x.name === name);
      expect(f).toMatchObject({ number, type: 'TYPE_STRING' });
      expect(isProto3Optional(full, f, defs)).toBe(true);
    }
  });
});
