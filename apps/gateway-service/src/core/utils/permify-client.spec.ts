import * as permify from '@permify/permify-node';
import {
  PERMIFY_PRESHARED_KEY,
  createPermifyClient,
  permifyPresharedKeyInterceptor,
  resetPermifyPresharedKeyWarning,
  warnOnceIfPermifyPresharedKeyMissing,
} from './permify-client';

jest.mock('@permify/permify-node', () => {
  const actual = jest.requireActual('@permify/permify-node');
  return {
    ...actual,
    grpc: {
      ...actual.grpc,
      newClient: jest.fn((...args: unknown[]) =>
        actual.grpc.newClient(...args),
      ),
    },
  };
});

type Middleware = ReturnType<typeof permifyPresharedKeyInterceptor>;

/** Runs one call through the middleware and returns the metadata it sent. */
async function metadataSentThrough(
  middleware: Middleware,
): Promise<{ get(key: string): unknown } | undefined> {
  let sent: { metadata?: { get(key: string): unknown } } | undefined;
  const call = {
    method: {},
    requestStream: false,
    responseStream: false,
    request: {},
    next: async function* (_request: unknown, options: typeof sent) {
      sent = options;
      return {};
    },
  };
  const run = middleware(call as never, {});
  for (let step = await run.next(); !step.done; step = await run.next()) {
    // a unary call yields nothing
  }
  return sent?.metadata;
}

describe('the Permify client authenticates with the preshared key', () => {
  it('names the variable and the secret PERMIFY_PRESHARED_KEY', () => {
    expect(PERMIFY_PRESHARED_KEY).toBe('PERMIFY_PRESHARED_KEY');
  });

  it('attaches the key as a Bearer authorization to every call', async () => {
    const metadata = await metadataSentThrough(
      permifyPresharedKeyInterceptor(() => 'k-123'),
    );
    expect(metadata?.get('authorization')).toBe('Bearer k-123');
  });

  it('reads the key at call time, so a secret loaded after construction is sent', async () => {
    const secrets: { key?: string } = {};
    const middleware = permifyPresharedKeyInterceptor(() => secrets.key);
    expect(
      (await metadataSentThrough(middleware))?.get('authorization'),
    ).toBeUndefined();
    secrets.key = 'loaded-later';
    expect((await metadataSentThrough(middleware))?.get('authorization')).toBe(
      'Bearer loaded-later',
    );
  });

  it.each([undefined, '', '   '])(
    'sends no authorization while no key is configured (%p)',
    async (key) => {
      const metadata = await metadataSentThrough(
        permifyPresharedKeyInterceptor(() => key),
      );
      expect(metadata?.get('authorization')).toBeUndefined();
    },
  );

  it('builds the client on the endpoint with the key interceptor', async () => {
    const newClient = permify.grpc.newClient as unknown as jest.Mock;
    newClient.mockClear();
    createPermifyClient('127.0.0.1:1', () => 'k-456');
    expect(newClient).toHaveBeenCalledTimes(1);
    const [config, ...interceptors] = newClient.mock.calls[0];
    expect(config).toEqual(
      expect.objectContaining({ endpoint: '127.0.0.1:1', insecure: true }),
    );
    expect(interceptors).toHaveLength(1);
    const metadata = await metadataSentThrough(interceptors[0]);
    expect(metadata?.get('authorization')).toBe('Bearer k-456');
  });
});

describe('a configured Permify without a preshared key is reported once at boot', () => {
  beforeEach(() => resetPermifyPresharedKeyWarning());

  it('warns once, naming the variable and never a value, while no key resolves', () => {
    const warn = jest.fn();
    expect(
      warnOnceIfPermifyPresharedKeyMissing('permify:3478', () => '  ', warn),
    ).toBe(true);
    expect(
      warnOnceIfPermifyPresharedKeyMissing(
        'permify:3478',
        () => undefined,
        warn,
      ),
    ).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(PERMIFY_PRESHARED_KEY);
  });

  it('stays silent when the key resolves, and never logs it', () => {
    const warn = jest.fn();
    expect(
      warnOnceIfPermifyPresharedKeyMissing('permify:3478', () => 'k-789', warn),
    ).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '  '])(
    'stays silent when Permify is not configured (%p)',
    (endpoint) => {
      const warn = jest.fn();
      expect(
        warnOnceIfPermifyPresharedKeyMissing(endpoint, () => undefined, warn),
      ).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it('still sends calls without a key after warning (fail closed on an enforcing Permify)', async () => {
    warnOnceIfPermifyPresharedKeyMissing('permify:3478', () => '', jest.fn());
    const metadata = await metadataSentThrough(
      permifyPresharedKeyInterceptor(() => ''),
    );
    expect(metadata?.get('authorization')).toBeUndefined();
  });
});
