import { loadSync } from '@grpc/proto-loader';
import { join } from 'node:path';

/**
 * Contract of `ImportResults` on
 * `ResultService`, the seven request fields plus `image`, `RuleMetadata` and
 * `rule_metadata = 14` on `VulnerabilityDtoRequest`. Read through
 * `@grpc/proto-loader` with keepCase, so snake_case field names appear as
 * written in the `.proto`.
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
  loadSync(
    [
      'analysis-reporting/analysis_reporting.proto',
      'analysis-reporting/result.proto',
    ],
    {
      keepCase: true,
      includeDirs: [PROTO_DIR],
    },
  ) as unknown as PackageDefinition;

const IMPORT_RESULTS_REQUEST =
  'cybedefend.analysis_reporting.ImportResultsRequest';
const VULNERABILITY_DTO_REQUEST =
  'cybedefend.analysis_reporting.VulnerabilityDtoRequest';
const RULE_METADATA = 'cybedefend.analysis_reporting.RuleMetadata';

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

describe('result.proto / analysis_reporting.proto — import results contract', () => {
  it('declares ImportResults on ResultService', () => {
    const service = pkg()[
      'cybedefend.analysis_reporting.ResultService'
    ] as ServiceDefinition;
    expect(Object.keys(service)).toContain('ImportResults');
  });

  it('carries the seven original request fields as 1 to 7', () => {
    // Fields 1 to 7 are the original ones; image = 8 has its own test below.
    const fields = fieldsOf(IMPORT_RESULTS_REQUEST).filter(
      (f) => f.number <= 7,
    );
    expect(fields.map((f) => f.name)).toEqual([
      'scan_id',
      'project_id',
      'organization_id',
      'branch',
      'vulnerability_type',
      'format',
      'file_key',
    ]);
    expect(fields.map((f) => f.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('adds image = 8 to ImportResultsRequest', () => {
    const field = fieldByNumber(IMPORT_RESULTS_REQUEST, 8);
    expect(field.name).toBe('image');
    expect(field.type).toBe('TYPE_STRING');
    expect(isProto3Optional(IMPORT_RESULTS_REQUEST, field)).toBe(true);
  });

  it('adds rule_metadata = 14 to VulnerabilityDtoRequest', () => {
    const field = fieldByNumber(VULNERABILITY_DTO_REQUEST, 14);
    expect(field.name).toBe('rule_metadata');
    expect(field.type).toBe('TYPE_MESSAGE');
    expect(isProto3Optional(VULNERABILITY_DTO_REQUEST, field)).toBe(true);
    expect(field.typeName).toMatch(/RuleMetadata$/);
  });

  it('carries the nine original RuleMetadata fields as 1 to 9', () => {
    // Fields 1 to 9 are the original ones; owasp_top10 = 10 has its own test below.
    const fields = fieldsOf(RULE_METADATA).filter((f) => f.number <= 9);
    expect(fields.map((f) => f.name)).toEqual([
      'tool_name',
      'rule_id',
      'name',
      'short_description',
      'full_description',
      'help_markdown',
      'cwe',
      'severity',
      'help_uri',
    ]);
    expect(fields.map((f) => f.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('adds owasp_top10 = 10 to RuleMetadata', () => {
    const field = fieldByNumber(RULE_METADATA, 10);
    expect(field.name).toBe('owasp_top10');
    expect(field.type).toBe('TYPE_STRING');
    expect(field.label).toBe('LABEL_REPEATED');
  });
});
