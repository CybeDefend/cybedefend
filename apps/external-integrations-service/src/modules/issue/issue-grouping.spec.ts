import {
  IssueCreationMode,
  VulnerabilityInfo,
} from '@grpc/external-integrations/issue';
import {
  buildCybeDefendGroupUrl,
  groupVulnerabilities,
  normalizeIssueCreationMode,
  vulnerabilityDisplayName,
} from './issue-grouping';

function vuln(overrides: Partial<VulnerabilityInfo> = {}): VulnerabilityInfo {
  return {
    vulnerabilityId: 'vuln-1',
    scannerType: 'sast',
    severity: 'high',
    name: 'SQL Injection',
    shortDescription: 'SQL injection vulnerability',
    description: 'Detailed description',
    filePath: 'src/app.ts',
    startLine: 10,
    endLine: 15,
    cwe: ['CWE-89'],
    owaspTop10: [],
    cvssScore: 8,
    packageName: '',
    packageVersion: '',
    fixedVersion: '',
    externalId: 'CWE-89',
    cybedefendUrl: '',
    branch: 'main',
    ...overrides,
  };
}

const keysOf = (groups: Map<string, VulnerabilityInfo[]>) => [...groups.keys()];
const idsOf = (groups: Map<string, VulnerabilityInfo[]>, key: string) =>
  (groups.get(key) ?? []).map((v) => v.vulnerabilityId);

describe('groupVulnerabilities', () => {
  describe('per vulnerability', () => {
    const mode = IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY;

    it('keys a code finding by id, file and line', () => {
      const groups = groupVulnerabilities(
        [
          vuln({ vulnerabilityId: 'a', filePath: 'src/a.ts', startLine: 3 }),
          vuln({ vulnerabilityId: 'b', filePath: '', startLine: 0 }),
        ],
        mode,
      );

      expect(keysOf(groups)).toEqual(['a:src/a.ts:3', 'b:unknown:0']);
    });

    it('keys an SCA finding by id, package and version', () => {
      const groups = groupVulnerabilities(
        [
          vuln({
            vulnerabilityId: 'a',
            scannerType: 'SCA',
            packageName: 'lodash',
            packageVersion: '4.17.20',
          }),
          vuln({
            vulnerabilityId: 'b',
            scannerType: 'sca',
            packageName: '',
            packageVersion: '',
          }),
        ],
        mode,
      );

      expect(keysOf(groups)).toEqual(['a:lodash@4.17.20', 'b:unknown@unknown']);
    });
  });

  describe('per vulnerability type', () => {
    const mode = IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY_TYPE;

    it('groups by external id, then name, then vulnerability id', () => {
      const groups = groupVulnerabilities(
        [
          vuln({ vulnerabilityId: 'a', externalId: 'CWE-89' }),
          vuln({ vulnerabilityId: 'b', externalId: 'CWE-89' }),
          vuln({ vulnerabilityId: 'c', externalId: '', name: 'XSS' }),
          vuln({ vulnerabilityId: 'd', externalId: '', name: '' }),
        ],
        mode,
      );

      expect(keysOf(groups)).toEqual(['CWE-89', 'XSS', 'd']);
      expect(idsOf(groups, 'CWE-89')).toEqual(['a', 'b']);
    });

    it('is the mode an unspecified or unknown value falls back to', () => {
      const vulns = [
        vuln({ vulnerabilityId: 'a', externalId: 'CWE-89' }),
        vuln({ vulnerabilityId: 'b', externalId: 'CWE-89', filePath: 'b.ts' }),
      ];

      for (const fallback of [
        IssueCreationMode.ISSUE_CREATION_MODE_UNSPECIFIED,
        IssueCreationMode.UNRECOGNIZED,
        'SOMETHING_ELSE' as unknown as IssueCreationMode,
      ]) {
        expect(keysOf(groupVulnerabilities(vulns, fallback))).toEqual([
          'CWE-89',
        ]);
      }
    });
  });

  describe('per file', () => {
    const mode = IssueCreationMode.ISSUE_CREATION_MODE_PER_FILE;

    it('groups code findings by scanner and file', () => {
      const groups = groupVulnerabilities(
        [
          vuln({ vulnerabilityId: 'a', scannerType: 'sast', filePath: 'x.ts' }),
          vuln({ vulnerabilityId: 'b', scannerType: 'sast', filePath: 'x.ts' }),
          vuln({ vulnerabilityId: 'c', scannerType: 'iac', filePath: 'x.ts' }),
          vuln({ vulnerabilityId: 'd', scannerType: '', filePath: '' }),
        ],
        mode,
      );

      expect(keysOf(groups)).toEqual(['sast:x.ts', 'iac:x.ts', 'SAST:unknown']);
      expect(idsOf(groups, 'sast:x.ts')).toEqual(['a', 'b']);
    });

    it('groups SCA findings by manifest', () => {
      const groups = groupVulnerabilities(
        [
          vuln({
            vulnerabilityId: 'a',
            scannerType: 'sca',
            filePath: 'pkg.json',
          }),
          vuln({ vulnerabilityId: 'b', scannerType: 'SCA', filePath: '' }),
        ],
        mode,
      );

      expect(keysOf(groups)).toEqual(['SCA:pkg.json', 'SCA:dependencies']);
    });
  });

  it('accepts the mode as its enum name, as a gRPC loader may send it', () => {
    const groups = groupVulnerabilities(
      [
        vuln({ vulnerabilityId: 'a', filePath: 'x.ts' }),
        vuln({ vulnerabilityId: 'b', filePath: 'x.ts' }),
      ],
      'ISSUE_CREATION_MODE_PER_FILE' as unknown as IssueCreationMode,
    );

    expect(keysOf(groups)).toEqual(['sast:x.ts']);
  });
});

describe('normalizeIssueCreationMode', () => {
  it('names the three modes, numeric or by enum name', () => {
    expect(
      normalizeIssueCreationMode(
        IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY,
      ),
    ).toBe('per_vulnerability');
    expect(
      normalizeIssueCreationMode('ISSUE_CREATION_MODE_PER_VULNERABILITY_TYPE'),
    ).toBe('per_vulnerability_type');
    expect(normalizeIssueCreationMode('3')).toBe('per_file');
    expect(
      normalizeIssueCreationMode(
        IssueCreationMode.ISSUE_CREATION_MODE_UNSPECIFIED,
      ),
    ).toBe('per_vulnerability_type');
  });
});

describe('buildCybeDefendGroupUrl', () => {
  it('opens the scanner results of the project filtered on the name', () => {
    expect(
      buildCybeDefendGroupUrl(
        'https://app.example.com',
        'proj-1',
        'SCA',
        'lodash: Prototype pollution',
      ),
    ).toBe(
      'https://app.example.com/project/proj-1/sca?search=lodash%3A%20Prototype%20pollution',
    );
  });

  it('defaults to the SAST results without a scanner type', () => {
    expect(buildCybeDefendGroupUrl('https://x', 'p', '', 'n')).toBe(
      'https://x/project/p/sast?search=n',
    );
  });
});

describe('vulnerabilityDisplayName', () => {
  it('names an advisory by its package and summary', () => {
    expect(
      vulnerabilityDisplayName(
        vuln({
          name: 'GHSA-xxxx',
          packageName: 'lodash',
          shortDescription: 'Prototype pollution',
        }),
      ),
    ).toBe('lodash: Prototype pollution');
    expect(
      vulnerabilityDisplayName(
        vuln({
          name: 'CVE-2024-1',
          packageName: 'lodash',
          shortDescription: '',
        }),
      ),
    ).toBe('lodash (CVE-2024-1)');
  });

  it('keeps any other name, then the external id', () => {
    expect(vulnerabilityDisplayName(vuln({ name: 'SQL Injection' }))).toBe(
      'SQL Injection',
    );
    expect(
      vulnerabilityDisplayName(vuln({ name: '', externalId: 'CWE-79' })),
    ).toBe('CWE-79');
    expect(vulnerabilityDisplayName(vuln({ name: '', externalId: '' }))).toBe(
      'Vulnerability',
    );
  });
});
