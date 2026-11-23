import {
  isSafeDependencyPathEntry,
  isSafePackageName,
  isSafePackageVersion,
} from './package-coordinates.util';

/**
 * Package names and versions come from the customer's manifests and lockfiles.
 * The SCA autofix writes them into files a package manager evaluates (the closed
 * autofix library's sandbox Gemfile, build.gradle, .csproj, pyproject.toml, go.mod) and into the
 * customer's manifest. Only the characters registries really use may pass.
 */
describe('package coordinates', () => {
  describe('isSafePackageName', () => {
    it.each([
      'lodash',
      '@babel/core',
      'org.apache.logging.log4j:log4j-core',
      'github.com/gin-gonic/gin',
      'golang.org/x/net',
      'monolog/monolog',
      'Newtonsoft.Json',
      'zope.interface',
      'rack',
      'serde_json',
    ])('accepts the registry name %s', (name) => {
      expect(isSafePackageName(name)).toBe(true);
    });

    it.each([
      // Ruby / Groovy / TOML string escapes (the closed autofix library writes `gem '<name>'`).
      ["nokogiri', '1.0'\nsystem('id')\n#"],
      ['x"; system("id"); "'],
      // XML into a generated pom.xml or .csproj.
      ['x" /><Target Name="t" BeforeTargets="Restore"><Exec Command="id"'],
      // Shell metacharacters and whitespace.
      ['x$(id)'],
      ['x`id`'],
      ['x;id'],
      ['x id'],
      ['x\nid'],
      // Command-line options when passed as an argument.
      ['--registry=https://attacker.example'],
      ['-c'],
      // URLs and paths a package manager would fetch or build.
      ['https://attacker.example/x.zip'],
      ['git+https://attacker.example/x'],
      ['github.com/x/../../etc'],
      ['./local-package'],
      [''],
      ['a'.repeat(257)],
    ])('refuses %j', (name) => {
      expect(isSafePackageName(name)).toBe(false);
    });

    it('refuses a value that is not a string', () => {
      expect(isSafePackageName(undefined)).toBe(false);
      expect(isSafePackageName(null)).toBe(false);
      expect(isSafePackageName(42)).toBe(false);
    });
  });

  describe('isSafePackageVersion', () => {
    it.each([
      '4.17.21',
      'v1.9.1',
      '2.0.0-beta.1',
      '1.0.0+build.5',
      '1.2.3.RELEASE',
      'v0.0.0-20210101120000-abcdef123456',
      '2.0rc1',
      '0',
    ])('accepts the version %s', (version) => {
      expect(isSafePackageVersion(version)).toBe(true);
    });

    it.each([
      ["1.0'\nsystem('id')\n#"],
      ['1.0"'],
      ['1.0 || 2.0'],
      ['>=1.0'],
      ['file:../x'],
      ['https://attacker.example/x.zip'],
      ['github:attacker/x'],
      ['-1.0'],
      [''],
      ['1'.repeat(65)],
    ])('refuses %j', (version) => {
      expect(isSafePackageVersion(version)).toBe(false);
    });
  });

  describe('isSafeDependencyPathEntry', () => {
    it.each([
      'express@4.17.1',
      '@babel/core@7.0.0',
      '@babel/core',
      'express',
      'org.springframework:spring-core@5.3.0',
    ])('accepts %s', (entry) => {
      expect(isSafeDependencyPathEntry(entry)).toBe(true);
    });

    it.each([
      ["express@4.17.1'\nsystem('id')\n#"],
      ["evil', '1.0'\nsystem('id')\n#@1.0.0"],
      ['express@https://attacker.example/x.zip'],
      ['express@'],
      ['@'],
      [''],
    ])('refuses %j', (entry) => {
      expect(isSafeDependencyPathEntry(entry)).toBe(false);
    });
  });
});
