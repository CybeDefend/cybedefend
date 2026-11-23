/**
 * Test-only helper: build a `ToolContext` with the minimal identity payload
 * tools see at runtime.
 *
 * Excluded from runtime use by the `__test-utils__` directory convention —
 * Jest picks it up because it lives under `src/`, prod code never imports
 * from this folder.
 */
import type { ToolContext } from '../types';

export function makeMcpContext(
  overrides: Partial<ToolContext> = {},
): ToolContext {
  return {
    userId: 'u',
    accessToken: 't',
    ...overrides,
  };
}
