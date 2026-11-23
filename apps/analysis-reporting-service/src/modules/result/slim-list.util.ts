import { AutofixCountByType } from '@grpc/analysis-reporting/result';

/**
 * The autofix counters a slim list (`slim: true`, the MCP
 * surface) answers with: it does not read them, and the slim MCP item does
 * not carry them. Typed with the proto contract; a fresh object per call, so
 * no response shares it.
 */
export function emptyAutofixCountByType(): AutofixCountByType {
  const empty = () => ({ withAutofix: 0, withoutAutofix: 0 });
  return {
    sast: empty(),
    iac: empty(),
    cicd: empty(),
    secret: empty(),
    sca: empty(),
  };
}
