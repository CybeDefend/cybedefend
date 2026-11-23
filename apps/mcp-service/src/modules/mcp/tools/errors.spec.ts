import {
  InternalMcpError,
  InvalidArgumentError,
  MCP_ERROR_CODES,
  McpToolError,
  NotFoundError,
  PermissionDeniedError,
  UnavailableError,
} from './errors';

describe('McpToolError', () => {
  it('captures code, message and optional details on the instance', () => {
    const err = new McpToolError('INTERNAL', 'boom', { hint: 'x' });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('INTERNAL');
    expect(err.message).toBe('boom');
    expect(err.details).toEqual({ hint: 'x' });
  });

  it('toPayload() returns { code, message } when details are absent', () => {
    const err = new McpToolError('INTERNAL', 'boom');
    expect(err.toPayload()).toEqual({ code: 'INTERNAL', message: 'boom' });
  });

  it('toPayload() includes details when provided', () => {
    const err = new McpToolError('NOT_FOUND', 'missing', { id: 'x' });
    expect(err.toPayload()).toEqual({
      code: 'NOT_FOUND',
      message: 'missing',
      details: { id: 'x' },
    });
  });

  it('McpToolError.expectedOutcome defaults to false', () => {
    const err = new McpToolError('INTERNAL', 'boom') as McpToolError & {
      expectedOutcome?: boolean;
    };
    expect(err.expectedOutcome).toBe(false);
  });
});

describe('PermissionDeniedError', () => {
  it('is a McpToolError with code=PERMISSION_DENIED', () => {
    const err = new PermissionDeniedError('p-1');
    expect(err).toBeInstanceOf(McpToolError);
    expect(err).toBeInstanceOf(PermissionDeniedError);
    expect(err.code).toBe('PERMISSION_DENIED');
  });

  it('exposes projectId for backwards compatibility', () => {
    const err = new PermissionDeniedError('p-foreign');
    expect(err.projectId).toBe('p-foreign');
    expect(err.message).toMatch(/p-foreign/);
  });

  it('toPayload() carries the projectId in details', () => {
    expect(new PermissionDeniedError('p-1').toPayload()).toEqual({
      code: 'PERMISSION_DENIED',
      message: 'Project p-1 not in accessible_project_ids',
      details: { projectId: 'p-1' },
    });
  });
});

describe('NotFoundError', () => {
  it('builds a payload describing the missing resource', () => {
    expect(new NotFoundError('Vulnerability', 'v-1').toPayload()).toEqual({
      code: 'NOT_FOUND',
      message: 'Vulnerability v-1 not found',
      details: { resource: 'Vulnerability', id: 'v-1' },
    });
  });
});

describe('InvalidArgumentError', () => {
  it('builds a payload describing the offending argument', () => {
    expect(
      new InvalidArgumentError('projectId', 'must be a UUID').toPayload(),
    ).toEqual({
      code: 'INVALID_ARGUMENT',
      message: "Invalid argument 'projectId': must be a UUID",
      details: { argument: 'projectId', reason: 'must be a UUID' },
    });
  });
});

describe('UnavailableError', () => {
  it('builds a payload pointing at the unavailable service', () => {
    expect(new UnavailableError('gateway').toPayload()).toEqual({
      code: 'UNAVAILABLE',
      message: 'Service gateway is unavailable',
      details: { service: 'gateway' },
    });
  });

  it('merges extra details when provided', () => {
    const err = new UnavailableError('gateway', { status: 502 });
    expect(err.toPayload().details).toEqual({
      service: 'gateway',
      status: 502,
    });
  });
});

describe('InternalMcpError', () => {
  it('builds a payload with code=INTERNAL', () => {
    expect(new InternalMcpError('boom').toPayload()).toEqual({
      code: 'INTERNAL',
      message: 'boom',
    });
  });
});

describe('MCP_ERROR_CODES', () => {
  it('has no product-specific code', () => {
    expect(Object.keys(MCP_ERROR_CODES)).toEqual([
      'UNAUTHENTICATED',
      'PERMISSION_DENIED',
      'NOT_FOUND',
      'INVALID_ARGUMENT',
      'ALREADY_EXISTS',
      'RESOURCE_EXHAUSTED',
      'UNAVAILABLE',
      'INTERNAL',
    ]);
  });

  it('exposes the canonical set of error codes', () => {
    expect(MCP_ERROR_CODES).toEqual({
      UNAUTHENTICATED: 'UNAUTHENTICATED',
      PERMISSION_DENIED: 'PERMISSION_DENIED',
      NOT_FOUND: 'NOT_FOUND',
      INVALID_ARGUMENT: 'INVALID_ARGUMENT',
      ALREADY_EXISTS: 'ALREADY_EXISTS',
      RESOURCE_EXHAUSTED: 'RESOURCE_EXHAUSTED',
      UNAVAILABLE: 'UNAVAILABLE',
      INTERNAL: 'INTERNAL',
    });
  });
});
