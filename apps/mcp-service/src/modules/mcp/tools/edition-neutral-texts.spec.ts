import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { McpToolDefinition } from './types';

/**
 * What an MCP client reads of a core tool (its description and its input
 * schema) describes the instance it talks to: a Community instance has no
 * plan to upgrade, no enrichment cron and no authorization engine to name.
 * Every `build…Tool` export of src/modules is built with stand-in
 * dependencies and its text checked.
 */
const FORBIDDEN = [
  /\bplans?\b/i,
  /\bupgrade\b/i,
  /\bEPSS\b/i,
  /\bOSV\b/i,
  /\bPermify\b/i,
  /\bcrons?\b/i,
  /\btrial\b/i,
  /\bbilling\b/i,
];

const MODULES_ROOT = join(__dirname, '..', '..');

function toolFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return toolFiles(path);
    return name.endsWith('.tool.ts') ? [path] : [];
  });
}

/** Any property read answers a callable stand-in. */
const standIn: unknown = new Proxy(() => standIn, {
  get: () => standIn,
  apply: () => standIn,
});

function builtTools(): McpToolDefinition[] {
  const tools: McpToolDefinition[] = [];
  for (const file of toolFiles(MODULES_ROOT)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exported = require(file) as Record<string, unknown>;
    for (const [name, value] of Object.entries(exported)) {
      if (!/^build\w*Tools?$/.test(name) || typeof value !== 'function')
        continue;
      const built = (value as (...args: unknown[]) => unknown)(
        standIn,
        standIn,
        standIn,
      );
      for (const tool of [built].flat() as McpToolDefinition[]) {
        if (tool && typeof tool === 'object' && 'name' in tool)
          tools.push(tool);
      }
    }
  }
  return tools;
}

describe('core MCP tool texts', () => {
  const tools = builtTools();

  it('builds the core tools', () => {
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'list_organizations',
        'create_project',
        'get_user_posture',
        'set_exploitability',
      ]),
    );
  });

  it.each(tools.map((tool) => [tool.name, tool] as const))(
    '%s names nothing the instance may not have',
    (_name, tool) => {
      const text = JSON.stringify({
        description: tool.description,
        inputSchema: tool.inputSchema,
      });
      for (const word of FORBIDDEN) expect(text).not.toMatch(word);
    },
  );
});
