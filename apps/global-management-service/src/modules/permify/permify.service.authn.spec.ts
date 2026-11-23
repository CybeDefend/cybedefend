import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import SecretsService from 'src/core/secrets/secrets.service';
import {
  createPermifyClient,
  resetPermifyPresharedKeyWarning,
} from './permify-client';
import { PermifyService } from './permify.service';

jest.mock('./permify-client', () => ({
  ...jest.requireActual('./permify-client'),
  createPermifyClient: jest.fn(() => ({})),
}));

describe('PermifyService authenticates to Permify', () => {
  const build = (env: Record<string, string>, secret?: string) => {
    const secrets = {
      getSecret: jest.fn((key: string) =>
        key === 'PERMIFY_PRESHARED_KEY' ? secret : undefined,
      ),
    } as unknown as SecretsService;
    new PermifyService(new ConfigService(env), secrets, {
      log: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger);
    const mock = createPermifyClient as jest.Mock;
    const [endpoint, readKey] = mock.mock.calls[mock.mock.calls.length - 1];
    return { endpoint, readKey: readKey as () => string | undefined };
  };

  it('builds its client on PERMIFY_ENDPOINT through the key-sending factory', () => {
    expect(build({ PERMIFY_ENDPOINT: 'permify:3478' }).endpoint).toBe(
      'permify:3478',
    );
  });

  it('sends PERMIFY_PRESHARED_KEY from the environment first', () => {
    const { readKey } = build(
      { PERMIFY_ENDPOINT: 'p:1', PERMIFY_PRESHARED_KEY: 'from-env' },
      'from-secrets',
    );
    expect(readKey()).toBe('from-env');
  });

  it('else the PERMIFY_PRESHARED_KEY secret, read at call time', () => {
    const { readKey } = build({ PERMIFY_ENDPOINT: 'p:1' }, 'from-secrets');
    expect(readKey()).toBe('from-secrets');
  });

  describe('at boot', () => {
    const boot = async (env: Record<string, string>, secret?: string) => {
      resetPermifyPresharedKeyWarning();
      const warn = jest.fn();
      const ensureCacheLoaded = jest.fn(async () => undefined);
      const service = new PermifyService(
        new ConfigService({ PERMIFY_SCHEMA_VERSION: 'v1', ...env }),
        {
          getSecret: jest.fn((key: string) =>
            key === 'PERMIFY_PRESHARED_KEY' ? secret : undefined,
          ),
          ensureCacheLoaded,
        } as unknown as SecretsService,
        { log: jest.fn(), error: jest.fn(), warn } as unknown as Logger,
      );
      await service.onModuleInit();
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
