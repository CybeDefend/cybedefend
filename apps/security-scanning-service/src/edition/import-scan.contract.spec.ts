import { loadSync } from '@grpc/proto-loader';
import { join } from 'node:path';

/**
 * The import-scan contract: the import-scan fields on
 * `CreateScanRequest` and the `CompleteImportScan` RPC on `ScanService`.
 * Read through `@grpc/proto-loader` with keepCase, so snake_case field names
 * appear as written in the `.proto`.
 */

interface FieldDescriptor {
  name: string;
  number: number;
  type: string;
  label: string;
  typeName?: string;
  proto3Optional?: boolean;
}

interface MessageDefinition {
  type: { field: FieldDescriptor[]; oneofDecl?: { name: string }[] };
}

// protobufjs's descriptor output does not set proto3Optional; a proto3
// `optional` field instead gets a synthetic oneof named `_<field>`.
const isProto3Optional = (
  messageName: string,
  field: FieldDescriptor,
): boolean => {
  const def = pkg()[messageName] as MessageDefinition;
  return (def.type.oneofDecl ?? []).some((o) => o.name === `_${field.name}`);
};

interface ServiceDefinition {
  [method: string]: unknown;
}

type PackageDefinition = Record<string, MessageDefinition | ServiceDefinition>;

const PROTO_DIR = join(__dirname, '../../../../libs/protos');

// Loaded per test so a missing file or field fails that test, not the suite.
const pkg = (): PackageDefinition =>
  loadSync('security-scanning/security_scanning.proto', {
    keepCase: true,
    includeDirs: [PROTO_DIR],
  }) as unknown as PackageDefinition;

const CREATE_SCAN = 'cybedefend.security_scanning.CreateScanRequest';
const COMPLETE_IMPORT_SCAN =
  'cybedefend.security_scanning.CompleteImportScanRequest';

const fieldsOf = (messageName: string): FieldDescriptor[] => {
  const def = pkg()[messageName];
  if (!def || !('type' in def)) {
    throw new Error(`message not found in loaded protos: ${messageName}`);
  }
  return (def as MessageDefinition).type.field;
};

const fieldByNumber = (
  messageName: string,
  number: number,
): FieldDescriptor => {
  const field = fieldsOf(messageName).find((f) => f.number === number);
  if (!field) {
    throw new Error(`${messageName} has no field ${number}`);
  }
  return field;
};

describe('scan.proto — import scan contract', () => {
  it('adds import_format = 13, import_tool = 14 and import_type = 15 to CreateScanRequest', () => {
    for (const [number, name] of [
      [13, 'import_format'],
      [14, 'import_tool'],
      [15, 'import_type'],
    ] as const) {
      const field = fieldByNumber(CREATE_SCAN, number);
      expect(field.name).toBe(name);
      expect(field.type).toBe('TYPE_STRING');
      expect(isProto3Optional(CREATE_SCAN, field)).toBe(true);
    }
  });

  it('adds import_image = 16 to CreateScanRequest', () => {
    const field = fieldByNumber(CREATE_SCAN, 16);
    expect(field.name).toBe('import_image');
    expect(field.type).toBe('TYPE_STRING');
    expect(isProto3Optional(CREATE_SCAN, field)).toBe(true);
  });

  it('adds no commit field (an import scan carries no commit)', () => {
    expect(fieldsOf(CREATE_SCAN).some((f) => f.name === 'commit')).toBe(false);
  });

  it('declares CompleteImportScan on ScanService', () => {
    const service = pkg()[
      'cybedefend.security_scanning.ScanService'
    ] as ServiceDefinition;
    expect(Object.keys(service)).toContain('CompleteImportScan');
  });

  it('carries scan_id, status, error_code, findings_count, tool_name as 1 to 5, then container_id 6', () => {
    // container_id = 6: Community cluster scans, pinned in cluster-scan.contract.spec.ts.
    const fields = fieldsOf(COMPLETE_IMPORT_SCAN);
    expect(fields.map((f) => f.name)).toEqual([
      'scan_id',
      'status',
      'error_code',
      'findings_count',
      'tool_name',
      'container_id',
    ]);
    expect(fields.map((f) => f.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(fieldByNumber(COMPLETE_IMPORT_SCAN, 4).type).toBe('TYPE_INT32');
  });
});
