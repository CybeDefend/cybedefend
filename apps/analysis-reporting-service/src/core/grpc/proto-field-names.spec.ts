import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { loadSync, Options } from '@grpc/proto-loader';
import { serverProtoPaths } from './server-proto-paths';

const PROTO_BASE = join(__dirname, '../../../../../libs/protos');

/**
 * The options of the server's own loader (`main.ts`): `keepCase: false`
 * makes protobufjs rename every field, and that renamed key is the only one
 * it reads from the object a handler returns.
 */
const LOADER_OPTIONS: Options = {
  includeDirs: [PROTO_BASE],
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

const MESSAGE_FORMAT = 'Protocol Buffer 3 DescriptorProto';

function protoFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return protoFiles(path);
    return entry.endsWith('.proto') ? [relative(PROTO_BASE, path)] : [];
  });
}

describe('proto field names on the wire', () => {
  /*
   * protobufjs only upper-cases a letter that follows an underscore
   * (`new_last_7_days` becomes `newLast_7Days`), while ts-proto drops every
   * underscore (`newLast7Days`). The service fills the ts-proto name, the
   * serializer looks for the protobufjs one, and the value is silently sent
   * as its default. A field name must therefore never put a digit or an
   * upper-case letter right after an underscore.
   */
  it('gives every field of every proto a runtime name without an underscore', () => {
    const files = protoFiles(PROTO_BASE);
    expect(files.length).toBeGreaterThan(0);

    const definition = loadSync(files, LOADER_OPTIONS);
    const offenders = Object.entries(definition).flatMap(([name, entry]) => {
      const message = entry as {
        format?: string;
        type?: { field?: { name: string }[] };
      };
      if (message.format !== MESSAGE_FORMAT) return [];
      return (message.type?.field ?? [])
        .filter((field) => field.name.includes('_'))
        .map((field) => `${name}.${field.name}`);
    });

    expect(offenders).toEqual([]);
  });

  it('carries the seven-day moves of projects, teams and top projects through the overview response', () => {
    const definition = loadSync(
      serverProtoPaths(PROTO_BASE),
      LOADER_OPTIONS,
    ) as unknown as Record<
      string,
      Record<
        string,
        {
          responseSerialize: (value: unknown) => Buffer;
          responseDeserialize: (bytes: Buffer) => Record<string, any>;
        }
      >
    >;
    const rpc =
      definition['cybedefend.analysis_reporting.ResultService']
        .GetOrganizationOverview;

    const decoded = rpc.responseDeserialize(
      rpc.responseSerialize({
        organizationId: 'org-1',
        projectsSummary: [
          { projectId: 'p-1', newLast7Days: 24, resolvedLast7Days: 3 },
        ],
        teamsSummary: [{ teamId: 't-1', newLast7Days: 24, resolvedLast7Days: 3 }],
        topVulnerableProjects: [{ projectId: 'p-1', newLast7Days: 24 }],
      }),
    );

    expect(decoded.projectsSummary[0]).toMatchObject({
      newLast7Days: 24,
      resolvedLast7Days: 3,
    });
    expect(decoded.teamsSummary[0]).toMatchObject({
      newLast7Days: 24,
      resolvedLast7Days: 3,
    });
    expect(decoded.topVulnerableProjects[0]).toMatchObject({
      newLast7Days: 24,
    });
  });
});
