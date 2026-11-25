import { VulnerabilityInfo } from '@grpc/external-integrations/issue';
import type { ProductLinksPort } from '../../edition/ports/product-links.port';
import { IssueDescriptionService } from './issue-description.service';

// GitHub and GitLab render a ticket body as Markdown. The text of a finding
// (its name, description, file path, package, branch) comes from scanned
// content and is written as text: it may not add a link, an image, HTML, a
// heading, a table cell, a mention, a reference to another issue, merge
// request, snippet or milestone, or a GitLab quick action (a line starting
// with `/`, which GitLab runs when the issue is created through its API).

const links: ProductLinksPort = {
  ticketFooterUrl: () => 'https://appsec.example.org',
  githubInstallReturnUri: () => 'https://appsec.example.org',
};

const HOSTILE_DESCRIPTION = [
  'Fix needed. @acme-corp/security-team please review. Fixes #12, closes !7.',
  '[Click here to view the patch](https://evil.example/patch)',
  '![x](https://evil.example/pixel.png)',
  '<img src=https://evil.example/p.png> <a href="https://evil.example">here</a>',
  '# Urgent: rotate your keys',
  '| injected | table |',
  '/close',
  '   /move other/project',
  '/confidential',
  'See docs/setup for details',
  'Related: GH-5, gh-6, $12 and %3',
  'Setext heading text',
  '===',
  'Another heading',
  '---',
  'invoice\u202Egnp.exe and \u2066isolated\u2069',
].join('\n');

// Bidirectional controls that can reorder how a name is displayed.
const BIDI_CONTROLS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
const ZERO_WIDTH_JOINER = '\u200D';

const hostile = (extra: Partial<VulnerabilityInfo> = {}): VulnerabilityInfo =>
  ({
    vulnerabilityId: 'v-1',
    name: 'Rule @admin [x](https://evil.example) #3',
    severity: 'high',
    scannerType: 'sast',
    externalId: 'ID-1 | **cell** | <b>x</b>',
    filePath: 'src/a.ts` | **injected cell** | `',
    startLine: 3,
    endLine: 0,
    branch: 'main` <img src=x> [y](https://evil.example) `',
    description: HOSTILE_DESCRIPTION,
    shortDescription: HOSTILE_DESCRIPTION,
    packageName: 'pkg|[l](https://evil.example)',
    packageVersion: '1.0.0 @owner',
    fixedVersion: '2.0.0 <script>',
    cvssScore: 0,
    cybedefendUrl: 'https://appsec.example.org/project/p-1/sast/v-1',
    cwe: ['CWE-89 [z](https://evil.example)'],
    owaspTop10: ['A03 @team'],
    ...extra,
  }) as VulnerabilityInfo;

// The only links a ticket holds are the ones the builder writes itself.
const OWN_LINK_LABELS = new Set([
  '📊 View detailed analysis and remediation guidance',
  'View',
  'View in CybeDefend',
  'CybeDefend',
]);

function expectInert(markdown: string): void {
  // Every code span is closed by the builder: back-ticks come in pairs on
  // every line.
  for (const line of markdown.split('\n')) {
    expect((line.match(/`/g) ?? []).length % 2).toBe(0);
  }
  // Text inside a code span is shown literally, and so is the address of a
  // link the builder writes; the rest is rendered.
  const rendered = markdown
    .replace(/`[^`\n]*`/g, '')
    .replace(/\]\([^)\s]*\)/g, '](…)');
  // Links and images: every unescaped `[label](` is one of ours.
  for (const match of rendered.matchAll(/(?<!\\)\[([^\]]*)\]\(/g)) {
    expect(OWN_LINK_LABELS).toContain(match[1]);
  }
  // HTML.
  expect(rendered).not.toMatch(/(?<!\\)<[a-zA-Z!/]/);
  // Mentions and references to issues, merge requests, snippets,
  // milestones and epics (a code span shows them literally).
  expect(rendered).not.toMatch(/@[A-Za-z0-9]/);
  expect(rendered).not.toMatch(/[#!$%&]\d/);
  expect(rendered).not.toMatch(/\bGH-\d/i);
  // GitLab quick actions: no line starts with `/`.
  for (const line of markdown.split('\n')) {
    expect(line).not.toMatch(/^\s*\//);
  }
  // Setext headings: no line made only of `=` or `-` from the finding text
  // (the builder's own `---` rule is followed by its footer).
  const lines = markdown.split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(=+|-+)\s*$/.test(line)) {
      expect(line).toBe('---');
      expect(lines[i - 1]).toBe('');
    }
  });
  // Bidirectional controls.
  expect(markdown).not.toMatch(BIDI_CONTROLS);
  // Headings only from the builder: the description's line stays text.
  for (const line of markdown.split('\n')) {
    if (/^#{1,6} /.test(line)) {
      expect(line).not.toMatch(/Urgent/);
    }
  }
  // Table rows keep their two cells.
  for (const line of markdown.split('\n').filter((l) => l.startsWith('|'))) {
    expect(line.match(/(?<!\\)\|/g)).toHaveLength(3);
  }
}

describe('IssueDescriptionService — finding text is written as inert Markdown', () => {
  const service = new IssueDescriptionService(links);

  it('single finding: body and title', () => {
    const { title, body } = service.generateSingleVulnerabilityIssue(hostile());
    expectInert(body);
    expect(title).not.toMatch(/@[A-Za-z0-9]|#\d|\n/);
    // The text is still there, as text.
    expect(body).toContain('please review');
    expect(body).toContain('Click here to view the patch');
    // A slash later in a line is left as it is.
    expect(body).toContain('See docs/setup for details');
  });

  it('GitLab quick actions in a description or a short description never start a line', () => {
    const quickActions = [
      'Intro',
      '/close',
      '   /move other/project',
      '\t/confidential',
      '/label ~bug',
      'See docs/setup for details',
    ].join('\n');
    const bodies = [
      service.generateSingleVulnerabilityIssue(
        hostile({ description: quickActions }),
      ).body,
      service.generateSingleVulnerabilityIssue(
        hostile({ description: '', shortDescription: quickActions }),
      ).body,
      service.generateVulnerabilityTypeIssue(
        [hostile({ description: quickActions })],
        'Rule',
      ).body,
      service.generateFileIssue(
        [hostile({ shortDescription: quickActions })],
        'src/a.ts',
      ).body,
      service.generateUpdateComment([hostile({ filePath: '/close' })]),
    ];
    for (const body of bodies) {
      for (const line of body.split('\n')) {
        expect(line).not.toMatch(/^\s*\//);
      }
    }
    expect(bodies[0]).toContain('See docs/setup for details');
  });

  it('a title breaks GitLab and GitHub references and drops bidirectional controls', () => {
    const { title } = service.generateSingleVulnerabilityIssue(
      hostile({
        name: 'Rule GH-5 $12 %3 \u202Eexe.txt',
        filePath: 'src/a.ts',
      }),
    );
    expect(title).not.toMatch(/\bGH-\d|[$%]\d/i);
    expect(title).not.toMatch(BIDI_CONTROLS);
  });

  it('a branch and a file path in code spans are written exactly, with no invisible character', () => {
    const body = service.generateSingleVulnerabilityIssue(
      hostile({
        branch: 'feature/@team-#12',
        filePath: 'src/@scope/#1.ts',
      }),
    ).body;
    expect(body).toContain('> 🌿 **Branch**: `feature/@team-#12`');
    expect(body).toContain('| **File** | `src/@scope/#1.ts` |');
    const codeLines = body
      .split('\n')
      .filter((line) => line.includes('feature/') || line.includes('src/@'));
    expect(codeLines).toHaveLength(2);
    for (const line of codeLines) {
      expect(line).not.toContain(ZERO_WIDTH_JOINER);
    }
  });

  it('single SCA finding: package, version and fixed version', () => {
    const { title, body } = service.generateSingleVulnerabilityIssue(
      hostile({ scannerType: 'sca', filePath: '' }),
    );
    expectInert(body);
    expect(title).not.toMatch(/@[A-Za-z0-9]|#\d|\n/);
  });

  it('group of one type: body and title', () => {
    const vulns = [hostile(), hostile({ vulnerabilityId: 'v-2' })];
    const { title, body } = service.generateVulnerabilityTypeIssue(
      vulns,
      vulns[0].name,
    );
    expectInert(body);
    expect(title).not.toMatch(/@[A-Za-z0-9]|#\d|\n/);
  });

  it('one file: body and title', () => {
    const vulns = [hostile(), hostile({ vulnerabilityId: 'v-2' })];
    const { title, body } = service.generateFileIssue(vulns, vulns[0].filePath);
    expectInert(body);
    expect(title).not.toMatch(/@[A-Za-z0-9]|#\d|\n/);
  });

  it('update comment', () => {
    expectInert(service.generateUpdateComment([hostile()]));
  });

  it('a link to CybeDefend cannot be closed early by its address', () => {
    const body = service.generateSingleVulnerabilityIssue(
      hostile({
        cybedefendUrl:
          'https://appsec.example.org/x) [Fix now](https://evil.example',
      }),
    ).body;
    expectInert(body);
  });

  it('an ordinary finding reads as before', () => {
    const { title, body } = service.generateSingleVulnerabilityIssue({
      vulnerabilityId: 'v-1',
      name: 'SQL injection',
      severity: 'high',
      scannerType: 'sast',
      filePath: 'src/db.ts',
      startLine: 12,
      branch: 'main',
      description: 'User input reaches a query.',
      cybedefendUrl: 'https://appsec.example.org/project/p-1/sast/v-1',
      cwe: ['CWE-89'],
      owaspTop10: [],
    } as VulnerabilityInfo);

    expect(title).toBe('🟠 [SAST] SQL injection in db.ts');
    expect(body).toContain('> 🌿 **Branch**: `main`');
    expect(body).toContain('| **File** | `src/db.ts` |');
    expect(body).toContain('User input reaches a query.');
    expect(body).toContain('- **CWE**: CWE-89');
  });
});
