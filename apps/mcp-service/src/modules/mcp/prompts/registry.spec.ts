import { PromptRegistry } from './registry';
import { McpPromptDefinition } from './types';

const make = (name: string): McpPromptDefinition => ({
  name,
  description: `desc-${name}`,
  arguments: [],
  render: async () => ({ messages: [] }),
});

describe('PromptRegistry', () => {
  it('registers and lists prompts in registration order', () => {
    const r = new PromptRegistry();
    r.register(make('p1'));
    r.register(make('p2'));
    expect(r.all().map((p) => p.name)).toEqual(['p1', 'p2']);
  });

  it('throws on duplicate', () => {
    const r = new PromptRegistry();
    r.register(make('p1'));
    expect(() => r.register(make('p1'))).toThrow(/already registered/);
  });

  it('finds a registered prompt by name', () => {
    const r = new PromptRegistry();
    r.register(make('p1'));
    const found = r.get('p1');
    expect(found?.description).toBe('desc-p1');
    expect(r.get('missing')).toBeUndefined();
  });
});
