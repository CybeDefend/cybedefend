import { editionServerProtos } from './edition-protos';

/**
 * The server proto list of src/main.ts is edition-dependent: the Community
 * Edition serves only the core protos, the cloud adds the closed ones
 * (EE_PROTO_PATHS, stripped from the export). currentEdition() reads
 * CYBEDEFEND_EDITION at each call, so each test sets the variable itself.
 */
// The cloud case lives in the closed edition.
describe('editionServerProtos', () => {
  const savedEnv = process.env;

  afterEach(() => {
    process.env = savedEnv;
  });

  it('serves only the core protos in community mode', () => {
    process.env = { ...savedEnv, CYBEDEFEND_EDITION: 'community' };
    expect(editionServerProtos()).toEqual([
      'global-management/global_management.proto',
      // The local auth proto loads in every edition; in the cloud no
      // handler binds it, so every call answers UNIMPLEMENTED.
      'global-management/local_auth.proto',
      'health/health.proto',
    ]);
  });
});
