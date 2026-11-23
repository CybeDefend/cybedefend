import {
  IssueCreationMode,
  VulnerabilityInfo,
} from '@grpc/external-integrations/issue';
import { LinearDescriptionService } from './linear-description.service';

const GROUP_URL =
  'https://app.example.com/project/proj-1/sast?search=SQL%20Injection';

function vuln(overrides: Partial<VulnerabilityInfo> = {}): VulnerabilityInfo {
  return {
    vulnerabilityId: 'vuln-1',
    scannerType: 'sast',
    severity: 'high',
    name: 'SQL Injection',
    shortDescription: 'User input reaches a SQL query.',
    description: 'How to prevent: use parameterised queries.',
    filePath: 'src/app.ts',
    startLine: 10,
    endLine: 15,
    cwe: ['CWE-89'],
    owaspTop10: ['A03:2021'],
    cvssScore: 8.1,
    packageName: '',
    packageVersion: '',
    fixedVersion: '',
    externalId: 'CWE-89',
    cybedefendUrl: '',
    branch: 'main',
    ...overrides,
  };
}

function scaVuln(overrides: Partial<VulnerabilityInfo> = {}) {
  return vuln({
    vulnerabilityId: 'sca-1',
    scannerType: 'sca',
    severity: 'critical',
    name: 'GHSA-35jh-r3h4-6jhm',
    shortDescription: 'Prototype pollution',
    filePath: 'package.json',
    startLine: 0,
    endLine: 0,
    cwe: [],
    owaspTop10: [],
    packageName: 'lodash',
    packageVersion: '4.17.20',
    fixedVersion: '4.17.21',
    externalId: 'GHSA-35jh-r3h4-6jhm',
    ...overrides,
  });
}

describe('LinearDescriptionService', () => {
  const service = new LinearDescriptionService();

  describe('severityToPriority', () => {
    it.each([
      ['critical', 1],
      ['HIGH', 2],
      ['medium', 3],
      ['Low', 4],
      ['info', 0],
      ['', 0],
    ])('maps %p to priority %p', (severity, priority) => {
      expect(service.severityToPriority(severity)).toBe(priority);
    });
  });

  describe('buildTitle', () => {
    it('names the type and its occurrences', () => {
      expect(
        service.buildTitle(
          [vuln(), vuln({ vulnerabilityId: 'vuln-2' })],
          IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY_TYPE,
          'CWE-89',
        ),
      ).toBe('[CybeDefend] SQL Injection (2 occurrences)');
      expect(
        service.buildTitle(
          [vuln()],
          IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY_TYPE,
          'CWE-89',
        ),
      ).toBe('[CybeDefend] SQL Injection (1 occurrence)');
    });

    it('names an advisory by its package in per-vulnerability mode', () => {
      expect(
        service.buildTitle(
          [scaVuln()],
          IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY,
          'sca-1:lodash@4.17.20',
        ),
      ).toBe('[CybeDefend] lodash: Prototype pollution');
    });

    it('names the file in per-file mode', () => {
      expect(
        service.buildTitle(
          [vuln(), vuln({ vulnerabilityId: 'vuln-2', name: 'XSS' })],
          IssueCreationMode.ISSUE_CREATION_MODE_PER_FILE,
          'sast:src/app.ts',
        ),
      ).toBe('[CybeDefend] 2 vulnerabilities in sast:src/app.ts');
    });

    it('is cut to 255 characters', () => {
      const title = service.buildTitle(
        [vuln({ name: 'A'.repeat(400) })],
        IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY,
        'x',
      );

      expect(title.length).toBeLessThanOrEqual(255);
      expect(title.startsWith('[CybeDefend] AAAA')).toBe(true);
      expect(title.endsWith('…')).toBe(true);
    });

    it('stays on one line', () => {
      expect(
        service.buildTitle(
          [vuln({ name: 'SQL\nInjection\u0007' })],
          IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY,
          'x',
        ),
      ).toBe('[CybeDefend] SQL Injection');
    });
  });

  describe('buildDescription', () => {
    it('links the group of findings in CybeDefend', () => {
      expect(service.buildDescription([vuln()], GROUP_URL)).toContain(
        `[Open in CybeDefend](${GROUP_URL})`,
      );
      expect(
        service.buildDescription(
          [vuln(), vuln({ vulnerabilityId: 'vuln-2' })],
          GROUP_URL,
        ),
      ).toContain(`[Open in CybeDefend](${GROUP_URL})`);
    });

    it('keeps the link whole when the group URL holds parentheses', () => {
      const url = 'https://app.example.com/project/p/sast?search=eval(x)';

      expect(service.buildDescription([vuln()], url)).toContain(
        '[Open in CybeDefend](https://app.example.com/project/p/sast?search=eval%28x%29)',
      );
    });

    it('gives the path and the lines of a code finding', () => {
      const single = service.buildDescription([vuln()], GROUP_URL);
      expect(single).toContain('`src/app.ts:10-15`');
      expect(single).toContain('HIGH');
      expect(single).toContain('CWE-89');
      expect(single).toContain('`main`');
      expect(single).toContain('User input reaches a SQL query');

      const grouped = service.buildDescription(
        [vuln(), vuln({ vulnerabilityId: 'vuln-2', startLine: 42 })],
        GROUP_URL,
      );
      expect(grouped).toContain('`src/app.ts:10`');
      expect(grouped).toContain('`src/app.ts:42`');
      expect(grouped).toContain('2 vulnerabilities detected');
    });

    it('gives the package and the fixed version of an SCA finding', () => {
      for (const description of [
        service.buildDescription([scaVuln()], GROUP_URL),
        service.buildDescription(
          [scaVuln(), scaVuln({ vulnerabilityId: 'sca-2' })],
          GROUP_URL,
        ),
      ]) {
        expect(description).toContain('`lodash@4.17.20`');
        expect(description).toContain('`4.17.21`');
      }
    });

    it('lists 50 occurrences at most, then how many more', () => {
      const vulns = Array.from({ length: 53 }, (_, i) =>
        vuln({ vulnerabilityId: `v-${i}`, startLine: 1000 + i }),
      );

      const description = service.buildDescription(vulns, GROUP_URL);

      expect(description).toContain('`src/app.ts:1049`');
      expect(description).not.toContain('`src/app.ts:1050`');
      expect(description).toContain('… and 3 more');
      expect(description).toContain('53 vulnerabilities detected');
    });

    it('carries the finding metadata only: no remediation text, no link from the finding', () => {
      const description = service.buildDescription(
        [vuln({ cybedefendUrl: 'https://evil.example/x' })],
        GROUP_URL,
      );

      expect(description).not.toContain('How to prevent');
      expect(description).not.toContain('evil.example');
    });

    it('never turns finding text into Markdown links or markup', () => {
      const description = service.buildDescription(
        [
          vuln({
            name: '[click me](https://evil.example)',
            shortDescription: '<img src=x onerror=alert(1)> **bold**',
            filePath: 'src/`odd`.ts',
          }),
        ],
        GROUP_URL,
      );

      // An unescaped character is one no backslash precedes.
      expect(description).not.toMatch(/(^|[^\\])\]\(https:\/\/evil/);
      expect(description).not.toMatch(/(^|[^\\])<img/);
      expect(description).not.toMatch(/(^|[^\\])\*\*bold/);
      expect(description).toContain('\\[click me\\]');
      expect(description).toContain("`src/'odd'.ts:10-15`");
    });
  });
});
