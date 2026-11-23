// A module, not a script: its helpers must not collide with another spec's globals.
export {};

type EditionProtosModule = typeof import('./edition-protos');

async function load(edition: string | undefined): Promise<EditionProtosModule> {
  if (edition === undefined) {
    delete process.env.CYBEDEFEND_EDITION;
  } else {
    process.env.CYBEDEFEND_EDITION = edition;
  }
  let mod: EditionProtosModule | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock('./ee-modules', () => ({
      EE_MODULES: [],
      EE_BINDINGS: [],
      EE_CONTEXT_MODULES: {},
      EE_PROTO_PATHS: ['x/y.proto'],
      EE_ENV_SCHEMA: {},
      EE_MIGRATIONS: [],
    }));
    mod = await import('./edition-protos');
  });
  return mod as EditionProtosModule;
}

// The cloud cases are tested by the cloud edition.
describe('editionProtoPaths', () => {
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

  it('community loads no closed proto', async () => {
    const mod = await load('community');
    expect(mod.editionProtoPaths()).toEqual([]);
  });
});
