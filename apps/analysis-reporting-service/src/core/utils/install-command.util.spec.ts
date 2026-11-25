import { buildInstallCommand, shellWord } from './install-command.util';

/**
 * The install command is shown with a copy button and run by a member of the
 * organization in his own shell. Its package name and version come from the
 * scanned repository, so a value that is not a name or a version of its
 * ecosystem must produce no command at all.
 */
describe('buildInstallCommand', () => {
  describe('ordinary names and versions give the expected command', () => {
    it.each([
      ['npm', 'express', '4.18.0', 'npm install express@4.18.0'],
      ['npm', '@types/node', '20.11.5', 'npm install @types/node@20.11.5'],
      ['npm', 'JSONStream', '1.3.5', 'npm install JSONStream@1.3.5'],
      ['npm', 'lodash.merge', '4.6.2', 'npm install lodash.merge@4.6.2'],
      ['npm', 'react', '19.0.0-rc.1', 'npm install react@19.0.0-rc.1'],
      ['npm', 'pkg', '1.0.0+build.5', 'npm install pkg@1.0.0+build.5'],
      ['pypi', 'requests', '2.31.0', 'pip install requests==2.31.0'],
      ['pypi', 'Django', '4.2.11', 'pip install Django==4.2.11'],
      ['pypi', 'zope.interface', '6.0', 'pip install zope.interface==6.0'],
      [
        'pypi',
        'typing_extensions',
        '4.9.0',
        'pip install typing_extensions==4.9.0',
      ],
      ['pypi', 'pkg', '1.0rc1', 'pip install pkg==1.0rc1'],
      ['pypi', 'pkg', '1.0.post1', 'pip install pkg==1.0.post1'],
      ['pypi', 'pkg', '2.0.0.dev3', 'pip install pkg==2.0.0.dev3'],
      ['pypi', 'pkg', '1.0+local.7', 'pip install pkg==1.0+local.7'],
      ['pip', 'urllib3', '2.2.1', 'pip install urllib3==2.2.1'],
      [
        'maven',
        'org.apache.logging.log4j:log4j-core',
        '2.17.1',
        '# Update org.apache.logging.log4j:log4j-core to version 2.17.1 in pom.xml',
      ],
      [
        'maven',
        'com.fasterxml.jackson.core:jackson-databind',
        '2.16.1',
        '# Update com.fasterxml.jackson.core:jackson-databind to version 2.16.1 in pom.xml',
      ],
      [
        'maven',
        'org.springframework:spring-core',
        '5.3.32.RELEASE',
        '# Update org.springframework:spring-core to version 5.3.32.RELEASE in pom.xml',
      ],
      ['go', 'golang.org/x/net', '0.23.0', 'go get golang.org/x/net@v0.23.0'],
      ['go', 'golang.org/x/net', 'v0.23.0', 'go get golang.org/x/net@v0.23.0'],
      [
        'go',
        'github.com/gin-gonic/gin',
        '1.9.1',
        'go get github.com/gin-gonic/gin@v1.9.1',
      ],
      ['go', 'gopkg.in/yaml.v3', '3.0.1', 'go get gopkg.in/yaml.v3@v3.0.1'],
      [
        'go',
        'github.com/docker/docker',
        '25.0.5+incompatible',
        'go get github.com/docker/docker@v25.0.5+incompatible',
      ],
      [
        'nuget',
        'Newtonsoft.Json',
        '13.0.3',
        'dotnet add package Newtonsoft.Json --version 13.0.3',
      ],
      [
        'nuget',
        'System.Text.Encodings.Web',
        '4.7.2',
        'dotnet add package System.Text.Encodings.Web --version 4.7.2',
      ],
      [
        'nuget',
        'Microsoft.Data.SqlClient',
        '5.1.0-preview2.22314.2',
        'dotnet add package Microsoft.Data.SqlClient --version 5.1.0-preview2.22314.2',
      ],
      [
        'packagist',
        'symfony/http-foundation',
        '6.4.8',
        'composer require symfony/http-foundation:6.4.8',
      ],
      [
        'packagist',
        'guzzlehttp/guzzle',
        'v7.8.1',
        'composer require guzzlehttp/guzzle:v7.8.1',
      ],
      // Composer names are case-insensitive and keep the case written.
      [
        'packagist',
        'Symfony/Console',
        '6.4.8',
        'composer require Symfony/Console:6.4.8',
      ],
      ['rubygems', 'rails', '7.1.3.2', 'gem install rails -v 7.1.3.2'],
      ['rubygems', 'nokogiri', '1.16.5', 'gem install nokogiri -v 1.16.5'],
      [
        'rubygems',
        'rack-session',
        '2.0.0',
        'gem install rack-session -v 2.0.0',
      ],
      ['rubygems', 'pkg', '1.0.0.pre', 'gem install pkg -v 1.0.0.pre'],
      ['crates', 'serde', '1.0.197', 'cargo add serde@1.0.197'],
      ['crates', 'tokio-util', '0.7.10', 'cargo add tokio-util@0.7.10'],
      // Swift packages are named by their repository, as the fix library
      // resolves them.
      [
        'swiftpm',
        'github.com/apple/swift-nio',
        '2.65.0',
        '# Update github.com/apple/swift-nio to version 2.65.0',
      ],
      [
        'swiftpm',
        'https://github.com/vapor/vapor',
        '4.92.4',
        '# Update https://github.com/vapor/vapor to version 4.92.4',
      ],
      [
        'swiftpm',
        'github.com/apple/swift-nio.git',
        '2.65.0',
        '# Update github.com/apple/swift-nio.git to version 2.65.0',
      ],
    ])('%s %s %s', (ecosystem, name, version, expected) => {
      expect(buildInstallCommand(ecosystem, name, version)).toBe(expected);
    });
  });

  describe('a value that is not a name or a version of its ecosystem gives no command', () => {
    // [label, value, also hostile when appended to a valid value]
    const hostile: Array<[string, string, boolean?]> = [
      ['a semicolon', 'x;id'],
      ['an ampersand pair', 'x&&id'],
      ['a single ampersand', 'x&id'],
      ['a pipe', 'x|id'],
      ['a back-tick', 'x`id`'],
      ['a command substitution', 'x$(id)'],
      ['a variable', 'x$HOME'],
      ['a newline', 'x\nid'],
      ['a carriage return', 'x\rid'],
      ['a tab', 'x\tid'],
      ['a NUL', 'x\u0000id'],
      ['a single quote', "x'id"],
      ['a double quote', 'x"id'],
      ['a typographic single quote', 'x’id'],
      ['a typographic double quote', 'x“id”'],
      ['a space', 'x id'],
      ['a non-breaking space', 'x id'],
      ['a redirection', 'x>out'],
      ['an input redirection', 'x<in'],
      ['a glob', 'x*'],
      ['a history expansion', 'x!1'],
      ['a cmd variable', 'x%PATH%'],
      ['a cmd escape', 'x^id'],
      ['a tilde', 'x~1'],
      ['a hash', 'x#id'],
      ['a backslash', 'x\\id'],
      ['a parenthesis', 'x(id)'],
      ['a brace', 'x{a,b}'],
      ['a bracket', 'x[a]'],
      ['a comma', 'x,id'],
      ['a non-ASCII letter', 'xé'],
      ['a full-width semicolon', 'x；id'],
      ['a leading dash', '-x', false],
      ['a leading double dash', '--registry=evil', false],
      ['a parent path', '../x'],
      ['an absolute path', '/etc/passwd', false],
      ['a home path', '~/x'],
      ['a URL', 'https://evil.example/x.tgz'],
      ['a git URL', 'git+ssh://evil.example/x.git'],
      ['an empty string', '', false],
    ];

    const valid: Record<string, [string, string]> = {
      npm: ['express', '4.18.0'],
      pypi: ['requests', '2.31.0'],
      pip: ['requests', '2.31.0'],
      maven: ['org.example:lib', '1.2.3'],
      go: ['golang.org/x/net', '0.23.0'],
      nuget: ['Newtonsoft.Json', '13.0.3'],
      packagist: ['symfony/http-foundation', '6.4.8'],
      rubygems: ['rails', '7.1.3'],
      crates: ['serde', '1.0.197'],
      swiftpm: ['github.com/apple/swift-nio', '2.65.0'],
    };

    const cases: Array<[string, string, string, string]> = [];
    for (const [ecosystem, [name, version]] of Object.entries(valid)) {
      for (const [label, value, asSuffix = true] of hostile) {
        cases.push([ecosystem, `name with ${label}`, value, version]);
        cases.push([ecosystem, `version with ${label}`, name, value]);
        if (!asSuffix) {
          continue;
        }
        cases.push([
          ecosystem,
          `name ending with ${label}`,
          `${name}${value}`,
          version,
        ]);
        cases.push([
          ecosystem,
          `version ending with ${label}`,
          name,
          `${version}${value}`,
        ]);
      }
    }

    it.each(cases)('%s: %s', (ecosystem, _label, name, version) => {
      expect(buildInstallCommand(ecosystem, name, version)).toBeNull();
    });

    it.each([
      [
        'npm',
        'a URL where a name is expected',
        'https://evil.example/x',
        '1.0.0',
      ],
      ['npm', 'a scope without a name', '@scope/', '1.0.0'],
      ['npm', 'two slashes', '@a/b/c', '1.0.0'],
      ['npm', 'a dist-tag', 'express', 'latest'],
      ['npm', 'a range', 'express', '>=4.0.0'],
      ['npm', 'a name too long', 'a'.repeat(215), '1.0.0'],
      ['pypi', 'extras', 'requests[socks]', '2.31.0'],
      ['pypi', 'an epoch', 'pkg', '1!2.0'],
      ['pypi', 'a trailing separator', 'requests-', '2.31.0'],
      ['maven', 'a missing group', ':artifact', '1.0'],
      ['maven', 'three parts', 'a:b:c', '1.0'],
      ['go', 'a path without a domain', 'net/http', '1.0.0'],
      ['go', 'a version that is not semantic', 'golang.org/x/net', 'master'],
      ['go', 'a dot element', 'golang.org/./net', '1.0.0'],
      ['go', 'a dot-dot element', 'golang.org/../net', '1.0.0'],
      ['packagist', 'a name without a vendor', 'guzzle', '7.8.1'],
      ['packagist', 'a constraint', 'symfony/console', '^6.4'],
      ['crates', 'a name starting with a digit', '1serde', '1.0.0'],
      ['crates', 'a dotted name', 'serde.json', '1.0.0'],
      ['nuget', 'a version range', 'Newtonsoft.Json', '[13.0.3,)'],
      ['swiftpm', 'a bare name', 'swift-nio', '2.65.0'],
      ['swiftpm', 'another host', 'gitlab.com/apple/swift-nio', '2.65.0'],
      ['swiftpm', 'a plain HTTP URL', 'http://github.com/a/b', '2.65.0'],
      ['swiftpm', 'an owner only', 'github.com/apple', '2.65.0'],
      ['swiftpm', 'a third element', 'github.com/a/b/c', '2.65.0'],
      ['swiftpm', 'a dot-dot element', 'github.com/../b', '2.65.0'],
      ['swiftpm', 'a dot-dot inside', 'github.com/a/b..c', '2.65.0'],
      ['swiftpm', 'a user in the URL', 'https://x@github.com/a/b', '2.65.0'],
      ['conan', 'an ecosystem the builder does not know', 'zlib', '1.3.1'],
    ])('%s: %s', (ecosystem, _label, name, version) => {
      expect(buildInstallCommand(ecosystem, name, version)).toBeNull();
    });

    it('refuses a value that is not a string', () => {
      expect(
        buildInstallCommand('npm', undefined as unknown as string, '1.0.0'),
      ).toBeNull();
      expect(
        buildInstallCommand('npm', 'express', null as unknown as string),
      ).toBeNull();
    });
  });
});

describe('shellWord', () => {
  it.each([
    ['express', 'express'],
    ['@types/node@20.11.5', '@types/node@20.11.5'],
    ['requests==2.31.0', 'requests==2.31.0'],
    ['symfony/http-foundation:6.4.8', 'symfony/http-foundation:6.4.8'],
    ['1.0.0+build', '1.0.0+build'],
  ])('leaves %s bare', (value, expected) => {
    expect(shellWord(value)).toBe(expected);
  });

  // Quoting differs between POSIX shells, PowerShell and cmd, so a value
  // that would need it is refused rather than quoted.
  it.each([
    ['-x'],
    ['--registry=evil'],
    [''],
    ['a b'],
    ['a;b'],
    ['$(id)'],
    ["it's"],
    ['a"b'],
    ['a%b'],
    ['a^b'],
  ])('refuses %j', (value) => {
    expect(shellWord(value)).toBeNull();
  });
});
