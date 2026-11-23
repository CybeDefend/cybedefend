import * as Joi from 'joi';

type EditionEnvSchemaModule = typeof import('./edition-env-schema');

async function load(
  edition: string | undefined,
): Promise<EditionEnvSchemaModule> {
  if (edition === undefined) {
    delete process.env.CYBEDEFEND_EDITION;
  } else {
    process.env.CYBEDEFEND_EDITION = edition;
  }
  let mod: EditionEnvSchemaModule | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock('./ee-modules', () => ({
      EE_MODULES: [],
      EE_BINDINGS: [],
      EE_CONTEXT_MODULES: {},
      EE_PROTO_PATHS: [],
      EE_ENV_SCHEMA: { X_CLOSED: Joi.string().required() },
      EE_MIGRATIONS: [],
    }));
    mod = await import('./edition-env-schema');
  });
  return mod as EditionEnvSchemaModule;
}

// The cloud cases are tested by the cloud edition.
describe('editionEnvSchema', () => {
  const KEY = 'CYBEDEFEND_EDITION';
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

  it('community adds no closed key', async () => {
    const mod = await load('community');
    expect(mod.editionEnvSchema()).toEqual({});
  });
});
