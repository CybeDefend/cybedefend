/**
 * The `tools/call` handler a mocked SDK `Server` recorded, found by the
 * method its request schema names (the factory registers it under its own
 * schema, not the SDK's `CallToolRequestSchema`).
 */
export function toolsCallHandlerOf<H>(handlers: Map<unknown, H>): H {
  for (const [schema, handler] of handlers) {
    const method = (
      schema as { _zod?: { def?: { shape?: { method?: unknown } } } }
    )._zod?.def?.shape?.method as
      | { _zod?: { def?: { values?: unknown[] } } }
      | undefined;
    if (method?._zod?.def?.values?.[0] === 'tools/call') return handler;
  }
  throw new Error('no tools/call handler registered');
}
