import { extractClientName, sanitizeClientName } from './client-name';

describe('extractClientName', () => {
  it('reads clientInfo.name from an initialize request', () => {
    expect(
      extractClientName({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'claude-code', version: '2.1.3' },
        },
      }),
    ).toBe('claude-code');
  });

  it('finds the initialize message inside a JSON-RPC batch', () => {
    expect(
      extractClientName([
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { clientInfo: { name: 'cursor-vscode', version: '1.0.0' } },
        },
      ]),
    ).toBe('cursor-vscode');
  });

  it('ignores any request that is not initialize', () => {
    expect(
      extractClientName({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { clientInfo: { name: 'claude-code' } },
      }),
    ).toBeUndefined();
  });

  it('returns undefined when the client declared no usable name', () => {
    expect(
      extractClientName({ method: 'initialize', params: {} }),
    ).toBeUndefined();
    expect(
      extractClientName({
        method: 'initialize',
        params: { clientInfo: { name: 42 } },
      }),
    ).toBeUndefined();
    expect(extractClientName(undefined)).toBeUndefined();
    expect(extractClientName('initialize')).toBeUndefined();
  });
});

describe('sanitizeClientName', () => {
  it('keeps an ordinary client name as declared', () => {
    expect(sanitizeClientName('Visual Studio Code')).toBe('Visual Studio Code');
  });

  it('strips control and invisible format characters, then trims', () => {
    expect(sanitizeClientName('  claude\u0000-co\u202Ede\n ')).toBe(
      'claude-code',
    );
  });

  it('caps the name at 100 characters', () => {
    expect(sanitizeClientName('a'.repeat(250))).toBe('a'.repeat(100));
  });

  it('rejects a value that is not a non-blank string', () => {
    expect(sanitizeClientName(42)).toBeUndefined();
    expect(sanitizeClientName(null)).toBeUndefined();
    expect(sanitizeClientName(' \t\u200B ')).toBeUndefined();
  });
});
