import {
  advisoryViewOf,
  displayedCveOf,
  entriesOfPackage,
  fixesOfFinding,
  isImportedAdvisoryView,
} from './imported-advisory.view';
import { VulnerabilityOsv } from '../../entities/osv/vulnerability-osv.entity';

const fix = (ecosystem: string, packageName: string, fixed: string) => ({
  ecosystem,
  packageName,
  fixed,
});

describe('entriesOfPackage', () => {
  const entries = [
    fix('npm', 'lodash', '5.0.0'),
    fix('npm', 'lodash-es', '4.17.21'),
    fix('PyPI', 'lodash', '1.0.0'),
  ];

  it("keeps the finding's own package and ecosystem only", () => {
    expect(
      entriesOfPackage(entries, { packageName: 'Lodash', ecosystem: 'NPM' }),
    ).toEqual([fix('npm', 'lodash', '5.0.0')]);
  });

  it('keeps every ecosystem of the package when none matches the finding', () => {
    expect(
      entriesOfPackage(entries, { packageName: 'lodash', ecosystem: 'other' }),
    ).toEqual([fix('npm', 'lodash', '5.0.0'), fix('PyPI', 'lodash', '1.0.0')]);
  });

  it("never takes another package's fix when the advisory names several", () => {
    expect(
      entriesOfPackage(entries, {
        packageName: 'underscore',
        ecosystem: 'npm',
      }),
    ).toEqual([]);
  });

  it('takes the fixes of an advisory about one single package spelled differently', () => {
    const single = [
      fix('PyPI', 'Django', '4.2.1'),
      fix('PyPI', 'django', '4.1.9'),
    ];
    expect(
      entriesOfPackage(single, { packageName: 'django-x', ecosystem: 'PyPI' }),
    ).toEqual(single);
  });

  it('takes nothing without a package', () => {
    expect(entriesOfPackage(entries, null)).toEqual([]);
  });
});

describe('displayedCveOf', () => {
  it('is the advisory id when it is a CVE', () => {
    expect(displayedCveOf('CVE-2024-9', ['CVE-2024-1'])).toBe('CVE-2024-9');
  });

  it('is the first CVE alias in the given order otherwise', () => {
    expect(
      displayedCveOf('GHSA-x', ['GHSA-y', 'CVE-2024-1', 'CVE-2024-2']),
    ).toBe('CVE-2024-1');
  });

  it("is '' without any CVE", () => {
    expect(displayedCveOf('GHSA-x', ['GHSA-y'])).toBe('');
  });
});

describe('advisoryViewOf', () => {
  const content = {
    advisoryId: 'GHSA-view',
    toolName: 'trivy',
    summary: 'summary',
    details: 'details',
    severity: 'high',
    cvssV3Vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    cweIds: ['CWE-79'],
    aliases: ['GHSA-view', 'CVE-2024-2', 'CVE-2024-1'],
    referenceUrls: ['https://example.com/a'],
    fixes: [fix('npm', 'a', '1.0.1'), fix('npm', 'b', '2.0.1')],
  };

  it('carries the declared text, severity rows and sorted aliases, and is marked imported', () => {
    const view = advisoryViewOf(content);
    expect(view).toBeInstanceOf(VulnerabilityOsv);
    expect(isImportedAdvisoryView(view)).toBe(true);
    expect(isImportedAdvisoryView(new VulnerabilityOsv())).toBe(false);
    expect(view.summary).toBe('summary');
    expect(view.databaseSpecific).toEqual({
      cwe_ids: ['CWE-79'],
      severity: 'HIGH',
      source: 'sarif:trivy',
    });
    expect(view.aliases.map((a) => a.alias)).toEqual([
      'CVE-2024-1',
      'CVE-2024-2',
      'GHSA-view',
    ]);
    expect(view.severities.map((s) => [s.type, s.score])).toEqual([
      ['DATABASE_SPECIFIC', 'HIGH'],
      ['CVSS_V3', content.cvssV3Vector],
    ]);
    expect(view.references.map((r) => r.url)).toEqual([
      'https://example.com/a',
    ]);
    expect(view.affected).toEqual([]);
  });

  it("lists the finding's own package first, then the others; its fixes are its own package's only", () => {
    const view = advisoryViewOf(content, {
      packageName: 'b',
      ecosystem: 'npm',
    });
    expect(view.affected.map((a) => a.packageName)).toEqual(['b', 'a']);
    expect(
      fixesOfFinding(view, { packageName: 'b', ecosystem: 'npm' }, new Map()),
    ).toEqual(['2.0.1']);
  });
});

describe('entriesOfPackage: the package name forms the ingestion matcher accepts', () => {
  const cases: Array<{
    name: string;
    advisory: Array<[string, string]>;
    finding: {
      packageName: string;
      ecosystem: string;
      alternateNames?: string[];
    };
    expected: string[];
  }> = [
    {
      name: 'PyPI: underscore form of a hyphenated distribution',
      advisory: [
        ['PyPI', 'apache-airflow'],
        ['PyPI', 'apache-airflow-providers-http'],
      ],
      finding: { packageName: 'apache_airflow', ecosystem: 'pip' },
      expected: ['apache-airflow'],
    },
    {
      name: 'PyPI: dotted, capitalised form',
      advisory: [
        ['PyPI', 'apache-airflow'],
        ['PyPI', 'apache-airflow-providers-http'],
      ],
      finding: { packageName: 'Apache.Airflow', ecosystem: 'PyPI' },
      expected: ['apache-airflow'],
    },
    {
      name: 'PyPI forms never fold another ecosystem',
      advisory: [
        ['npm', 'left_pad'],
        ['npm', 'right-pad'],
      ],
      finding: { packageName: 'left-pad', ecosystem: 'npm' },
      expected: [],
    },
    {
      name: 'scoped npm package, case-insensitive',
      advisory: [
        ['npm', '@babel/traverse'],
        ['npm', '@babel/core'],
      ],
      finding: { packageName: '@Babel/Traverse', ecosystem: 'npm' },
      expected: ['@babel/traverse'],
    },
    {
      name: 'Maven group:artifact is compared whole',
      advisory: [
        ['Maven', 'org.apache.logging.log4j:log4j-core'],
        ['Maven', 'org.apache.logging.log4j:log4j-api'],
      ],
      finding: {
        packageName: 'org.apache.logging.log4j:log4j-core',
        ecosystem: 'maven',
      },
      expected: ['org.apache.logging.log4j:log4j-core'],
    },
    {
      name: 'Maven artifact alone is not the group:artifact',
      advisory: [
        ['Maven', 'org.apache.logging.log4j:log4j-core'],
        ['Maven', 'org.apache.logging.log4j:log4j-api'],
      ],
      finding: { packageName: 'log4j-core', ecosystem: 'maven' },
      expected: [],
    },
    {
      name: 'Go module path',
      advisory: [
        ['Go', 'golang.org/x/net'],
        ['Go', 'golang.org/x/text'],
      ],
      finding: { packageName: 'golang.org/x/net', ecosystem: 'golang' },
      expected: ['golang.org/x/net'],
    },
    {
      name: 'container binary package matched by its source name',
      advisory: [
        ['Debian:12', 'openssl'],
        ['Debian:12', 'curl'],
      ],
      finding: {
        packageName: 'libssl3',
        ecosystem: '',
        alternateNames: ['openssl'],
      },
      expected: ['openssl'],
    },
  ];

  it.each(cases)('$name', ({ advisory, finding, expected }) => {
    const entries = advisory.map(([ecosystem, packageName]) =>
      fix(ecosystem, packageName, '1.0.0'),
    );
    expect(
      entriesOfPackage(entries, finding).map((e) => e.packageName),
    ).toEqual(expected);
  });
});
