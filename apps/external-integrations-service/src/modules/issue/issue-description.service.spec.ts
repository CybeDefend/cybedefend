import { VulnerabilityInfo } from '@grpc/external-integrations/issue';
import type { ProductLinksPort } from '../../edition/ports/product-links.port';
import { IssueDescriptionService } from './issue-description.service';

const linksTo = (url: string | undefined): ProductLinksPort => ({
  ticketFooterUrl: () => url,
  githubInstallReturnUri: () => 'https://appsec.example.org',
});

const vuln = (extra: Partial<VulnerabilityInfo> = {}): VulnerabilityInfo =>
  ({
    vulnerabilityId: 'v-1',
    name: 'SQL injection',
    severity: 'high',
    scannerType: 'sast',
    filePath: 'src/db.ts',
    startLine: 12,
    cybedefendUrl: 'https://appsec.example.org/project/p-1/sast/v-1',
    cwe: [],
    owaspTop10: [],
    ...extra,
  }) as VulnerabilityInfo;

const everyText = (service: IssueDescriptionService): string[] => [
  service.generateClosingComment('fixed', 1),
  service.generateUpdateComment([vuln()]),
  service.generateSingleVulnerabilityIssue(vuln()).body,
  service.generateVulnerabilityTypeIssue([vuln()], 'SQL injection').body,
  service.generateFileIssue([vuln()], 'src/db.ts').body,
];

// The line that closes every ticket and comment links to the address the
// edition gives: the instance itself on a self-hosted instance.
describe('IssueDescriptionService footer', () => {
  it('links the footer of every ticket and comment to the address the edition gives', () => {
    const service = new IssueDescriptionService(
      linksTo('https://appsec.example.org'),
    );
    for (const text of everyText(service)) {
      expect(text).toMatch(
        /\*This (comment was generated|issue was automatically created) by \[CybeDefend\]\(https:\/\/appsec\.example\.org\)\*/,
      );
      expect(text).not.toContain('cybedefend.com');
    }
  });

  it('names CybeDefend without a link when the edition gives no address', () => {
    const service = new IssueDescriptionService(linksTo(undefined));
    for (const text of everyText(service)) {
      expect(text).toMatch(
        /\*This (comment was generated|issue was automatically created) by CybeDefend\*/,
      );
      expect(text).not.toMatch(/\[CybeDefend\]\(/);
      expect(text).not.toContain('cybedefend.com');
    }
  });
});
