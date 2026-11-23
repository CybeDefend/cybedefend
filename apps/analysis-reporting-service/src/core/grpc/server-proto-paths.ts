import { join } from 'node:path';
import { editionProtoPaths } from '../../edition/edition-protos';

/**
 * The proto files this service's gRPC server loads, joined to `protoBasePath`:
 * the exported contract first, then health, then the edition's extra protos
 * (`editionProtoPaths()`, empty in the Community Edition). The closed
 * MCP services reach the wire in the cloud through that list, not through an
 * import of `analysis_reporting.proto`.
 */
export function serverProtoPaths(protoBasePath: string): string[] {
  return [
    join(protoBasePath, 'analysis-reporting/analysis_reporting.proto'),
    join(protoBasePath, 'health/health.proto'),
    ...editionProtoPaths().map((p) => join(protoBasePath, p)),
  ];
}
