import type { McpEditionTexts } from '../ports/mcp-edition-texts.port';

// The import types and the `--image` option are those of the CLI's
// `cybedefend import`. No MCP tool imports results.
export const COMMUNITY_MCP_EDITION_TEXTS: McpEditionTexts = {
  serverInstructions:
    'CybeDefend AppSec MCP server. Resolve the project id from .cybedefend/config.json ({"projectId": "<uuid>"}) at the repository root; if it is absent, call list_organizations then search_projects. Read findings with list_vulnerabilities_<type> and get_vulnerability_<type> (sast, sca, iac, cicd, secret, container); summarise with get_project_overview and get_user_posture. Change a finding only with update_vulnerability or set_exploitability, after the user agreed. Results are imported from CI scanners as SARIF (cybedefend import).',
  noScanYetNextStep:
    "No results yet: import a scanner's SARIF file with `cybedefend import --format sarif --type <sast|iac|secret|cicd|sca|container> --branch <branch> [--image <ref>] <file>` (`--image` is required for `container`), or from the project's results page in the dashboard.",
};
