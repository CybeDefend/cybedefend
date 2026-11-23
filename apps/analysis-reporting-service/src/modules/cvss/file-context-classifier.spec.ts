import { classifyFileContext } from './file-context-classifier';

describe('classifyFileContext', () => {
  // Only an unambiguous test-FILE suffix demotes a finding. Directory-name
  // heuristics (tests/, migrations/, examples/, docs/, vendor/, node_modules/…)
  // were removed because they hid real production vulnerabilities — e.g. a
  // `docs/` SEARCH module is production code, not documentation.
  describe('test files detected by suffix only', () => {
    it.each([
      'src/foo/foo.test.ts',
      'src/foo/foo.spec.ts',
      'tests/integration/auth.test.py',
      'test/api_test.go',
      'pkg/service/auth_test.go',
      'src/utils/helper_test.rb',
      'app/spec/models/user_spec.rb',
      'apps/web/src/components/Button.test.tsx',
    ])('%s → test', (path) => {
      expect(classifyFileContext(path)).toBe('test');
    });
  });

  describe('directory-name heuristics no longer demote — they stay production', () => {
    it.each([
      // test DIRECTORIES with no test-suffix filename
      'src/foo/__tests__/foo.ts',
      'tests/conftest.py',
      'spec/spec_helper.rb',
      // migration directories
      'db/migrate/20231001_add_users.rb',
      'src/migrations/0001_init.ts',
      // example / sample / docs / fixtures directories
      'examples/quick-start/main.py',
      'samples/usage.go',
      'docs/snippets/hello.py',
      'tests/fixtures/data.json',
      // the real-world false negative this change fixes: a docs SEARCH module
      // is production runtime code, not documentation
      'ingestion-service/app/modules/docs/search/doc_searcher.py',
      // vendored / installed third-party code
      'node_modules/lodash/lodash.js',
      'vendor/google/cloud/storage.go',
      'third_party/zlib/zlib.c',
      '.venv/lib/python3.11/site-packages/foo.py',
    ])('%s → production', (path) => {
      expect(classifyFileContext(path)).toBe('production');
    });
  });

  describe('config/template marker files are NOT demoted (only test suffixes are)', () => {
    it.each([
      'config.example.yaml',
      'docker-compose.example.yml',
      '.env.sample',
      '.env.example',
    ])('%s → production', (path) => {
      expect(classifyFileContext(path)).toBe('production');
    });
  });

  // A test is, by definition, executable CODE. A .test/.spec marker on a DATA
  // or CONFIG file (OpenAPI/Swagger spec, *_spec.json, .env.test.*) almost
  // always means "specification" or "test-environment config" — not test code —
  // and a real vuln/secret there must NOT be hidden.
  describe('test-like suffix on a NON-code (data/config) extension → production', () => {
    it.each([
      'api/openapi.spec.json',
      'public/swagger.spec.yaml',
      'proto/payments.spec.proto',
      'graphql/schema_spec.graphql',
      'src/schema.spec.json',
      'data/users_spec.csv',
      'docs/feature.spec.md',
      '.env.test.local',
      'config/db.test.env',
      'src/credentials.test.json',
      'infra/terraform.test.tfvars',
    ])('%s → production', (path) => {
      expect(classifyFileContext(path)).toBe('production');
    });
  });

  describe('production / application code (default)', () => {
    it.each([
      'src/index.ts',
      'app/controllers/user_controller.rb',
      'pkg/service/auth.go',
      'src/components/Login.tsx',
      'main.py',
      'lib/db/connection.js',
    ])('%s → production', (path) => {
      expect(classifyFileContext(path)).toBe('production');
    });
  });

  describe('edge cases', () => {
    it('null → production (default — no signal to demote)', () => {
      expect(classifyFileContext(null)).toBe('production');
    });

    it('undefined → production', () => {
      expect(classifyFileContext(undefined)).toBe('production');
    });

    it('empty string → production', () => {
      expect(classifyFileContext('')).toBe('production');
    });

    it('case-insensitive suffix matching: src/Foo.TEST.ts → test', () => {
      expect(classifyFileContext('src/Foo.TEST.ts')).toBe('test');
    });

    it('Windows path separators with a test suffix: src\\foo.test.ts → test', () => {
      expect(classifyFileContext('src\\foo.test.ts')).toBe('test');
    });

    it('substring "test" inside a filename is NOT misclassified', () => {
      // "test" must be on a separator boundary to count as a suffix marker.
      expect(classifyFileContext('src/contest/winner.go')).toBe('production');
      expect(classifyFileContext('src/attestation/issuer.ts')).toBe(
        'production',
      );
      expect(classifyFileContext('src/latest.ts')).toBe('production');
    });
  });
});
