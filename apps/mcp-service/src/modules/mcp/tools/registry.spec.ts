import { ToolRegistry } from './registry';
import { McpToolDefinition } from './types';

function makeTool(name: string): McpToolDefinition {
  return {
    name,
    description: `stub tool ${name}`,
    inputSchema: { type: 'object', properties: {} },
    run: async () => ({ ok: true }),
  };
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('is empty on construction', () => {
    expect(registry.all()).toHaveLength(0);
  });

  it('exposes a registered tool via all()', () => {
    const tool = makeTool('alpha');
    registry.register(tool);
    expect(registry.all()).toHaveLength(1);
    expect(registry.all()[0]).toBe(tool);
  });

  it('throws when a tool name is already registered', () => {
    registry.register(makeTool('alpha'));
    expect(() => registry.register(makeTool('alpha'))).toThrow(
      /alpha.*already registered/i,
    );
  });

  it('preserves registration order in all()', () => {
    registry.register(makeTool('first'));
    registry.register(makeTool('second'));
    registry.register(makeTool('third'));
    expect(registry.all().map((t) => t.name)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });
});
