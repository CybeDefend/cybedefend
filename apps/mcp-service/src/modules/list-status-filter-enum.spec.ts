import { buildListVulnerabilitiesSastTool } from './sast/list-sast.tool';
import { buildListVulnerabilitiesScaTool } from './sca/list-sca.tool';
import { buildListVulnerabilitiesIacTool } from './iac/list-iac.tool';
import { buildListVulnerabilitiesSecretTool } from './secret/list-secret.tool';
import { buildListVulnerabilitiesCicdTool } from './cicd/list-cicd.tool';
import { buildListVulnerabilitiesContainerTool } from './container/list-container.tool';

// The MCP list tools forward `status` verbatim to Gateway, whose DTO now rejects
// the exploitability-derived statuses. Offering them here would make an agent's
// call 400. They must expose only lifecycle statuses.
const gateway = {} as any;

const TOOLS = [
  ['sast', buildListVulnerabilitiesSastTool],
  ['sca', buildListVulnerabilitiesScaTool],
  ['iac', buildListVulnerabilitiesIacTool],
  ['secret', buildListVulnerabilitiesSecretTool],
  ['cicd', buildListVulnerabilitiesCicdTool],
  ['container', buildListVulnerabilitiesContainerTool],
] as const;

describe.each(TOOLS)('%s list tool status filter enum', (_name, build) => {
  it('exposes only lifecycle statuses (no exploitability-derived values)', () => {
    const tool = build(gateway);
    const statusEnum = (tool.inputSchema as any).properties.status.items.enum;
    expect(statusEnum).toEqual([
      'to_verify',
      'resolved',
      'confirmed',
      'ignored',
    ]);
    expect(statusEnum).not.toContain('not_exploitable');
    expect(statusEnum).not.toContain('proposed_not_exploitable');
  });
});
