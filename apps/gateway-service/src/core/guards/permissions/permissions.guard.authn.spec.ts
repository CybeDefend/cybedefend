import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import SecretsService from 'src/core/secrets/secrets.service';
import {
  createPermifyClient,
  resetPermifyPresharedKeyWarning,
} from 'src/core/utils/permify-client';
import { PermissionsGuard } from './permissions.guard';

jest.mock('src/core/utils/permify-client', () => ({
  ...jest.requireActual('src/core/utils/permify-client'),
  createPermifyClient: jest.fn(() => ({ permission: { check: jest.fn() } })),
}));

describe('PermissionsGuard authenticates to Permify', () => {
  const build = (env: Record<string, string>, secret?: string) => {
    const secrets = {
      getSecret: jest.fn((key: string) =>
        key === 'PERMIFY_PRESHARED_KEY' ? secret : undefined,
      ),
    } as unknown as SecretsService;
    new PermissionsGuard(
      { get: jest.fn() } as unknown as Reflector,
      new ConfigService(env),
      secrets,
      { error: jest.fn() } as unknown as Logger,
    );
    const mock = createPermifyClient as jest.Mock;
    const [endpoint, readKey] = mock.mock.calls[mock.mock.calls.length - 1];
    return { endpoint, readKey: readKey as () => string | undefined };
  };

  it('builds its client on PERMIFY_ENDPOINT through the key-sending factory', () => {
    const { endpoint } = build({ PERMIFY_ENDPOINT: 'permify:3478' });
    expect(endpoint).toBe('permify:3478');
  });

  it('sends PERMIFY_PRESHARED_KEY from the environment first', () => {
    const { readKey } = build(
      { PERMIFY_ENDPOINT: 'p:1', PERMIFY_PRESHARED_KEY: 'from-env' },
      'from-secrets',
    );
    expect(readKey()).toBe('from-env');
  });

  it('else the PERMIFY_PRESHARED_KEY secret', () => {
    const { readKey } = build({ PERMIFY_ENDPOINT: 'p:1' }, 'from-secrets');
    expect(readKey()).toBe('from-secrets');
  });

  describe('at boot', () => {
    const boot = async (env: Record<string, string>, secret?: string) => {
      resetPermifyPresharedKeyWarning();
      const warn = jest.fn();
      const ensureCacheLoaded = jest.fn(async () => undefined);
      const guard = new PermissionsGuard(
        { get: jest.fn() } as unknown as Reflector,
        new ConfigService(env),
        {
          getSecret: jest.fn(() => secret),
          ensureCacheLoaded,
        } as unknown as SecretsService,
        { error: jest.fn(), warn } as unknown as Logger,
      );
      await guard.onModuleInit();
      return { warn, ensureCacheLoaded };
    };

    it('warns once, after the secrets are loaded, when no preshared key resolves', async () => {
      const { warn, ensureCacheLoaded } = await boot({
        PERMIFY_ENDPOINT: 'permify:3478',
      });
      expect(ensureCacheLoaded).toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('PERMIFY_PRESHARED_KEY');
    });

    it('stays silent when the key resolves', async () => {
      const { warn } = await boot({ PERMIFY_ENDPOINT: 'p:1' }, 'k-1');
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
