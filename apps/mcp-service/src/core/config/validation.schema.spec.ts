import type * as Joi from 'joi';
import { EE_ENV_SCHEMA } from '../../edition/ee-modules';

// `jose@6` ships only as native ESM, which Jest's CJS runtime cannot load,
// and src/edition/ee-modules.ts reaches it through the cloud BEARER_VERIFIER
// binding. Nothing here verifies a token, so a stub is enough.
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => 'mock-jwks'),
  jwtVerify: jest.fn(),
}));

/**
 * The environment schema in community mode: the core keys only. The cloud
 * cases are tested by the cloud edition.
 */
describe('validationSchema', () => {
  describe('editions', () => {
    const KEY = 'CYBEDEFEND_EDITION';
    const COMMUNITY_ENV = {
      CYBEDEFEND_EDITION: 'community',
      PUBLIC_URL: 'http://localhost:3010',
      CYBEDEFEND_API_RESOURCE: 'http://gateway:3000',
      OTEL_DISABLED: 'true',
    };
    let saved: string | undefined;

    beforeEach(() => {
      saved = process.env[KEY];
    });

    afterEach(() => {
      if (saved === undefined) {
        delete process.env[KEY];
      } else {
        process.env[KEY] = saved;
      }
    });

    // The schema adds the closed keys when it is loaded, so each case loads
    // it again, in its own registry, after setting the edition.
    function loadSchema(edition: string | undefined): Joi.ObjectSchema {
      if (edition === undefined) {
        delete process.env[KEY];
      } else {
        process.env[KEY] = edition;
      }
      let schema: Joi.ObjectSchema | undefined;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod: typeof import('./validation.schema') = require('./validation.schema');
        schema = mod.validationSchema;
      });
      return schema!;
    }

    it('validates a community environment with only the core keys', () => {
      const { error } = loadSchema('community').validate(COMMUNITY_ENV);
      expect(error).toBeUndefined();
    });

    it('rejects an unknown NODE_ENV value in community mode', () => {
      const { error } = loadSchema('community').validate({
        ...COMMUNITY_ENV,
        NODE_ENV: 'staging',
      });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/NODE_ENV/);
    });

    it('requires FRONTEND_URL in production in community mode', () => {
      const { error } = loadSchema('community').validate({
        ...COMMUNITY_ENV,
        NODE_ENV: 'production',
      });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/FRONTEND_URL/);
    });

    it('requires CYBEDEFEND_API_RESOURCE in community mode', () => {
      const env: Record<string, string> = { ...COMMUNITY_ENV };
      delete env.CYBEDEFEND_API_RESOURCE;
      const { error } = loadSchema('community').validate(env);
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/CYBEDEFEND_API_RESOURCE/);
    });

    it('registers no key of the cloud schema in community mode', () => {
      for (const key of ['LOGTO_ENDPOINT', ...Object.keys(EE_ENV_SCHEMA)]) {
        const { error } = loadSchema('community').validate({
          ...COMMUNITY_ENV,
          [key]: 'x',
        });
        expect(error?.message).toMatch(new RegExp(`"${key}" is not allowed`));
      }
    });
  });
});
