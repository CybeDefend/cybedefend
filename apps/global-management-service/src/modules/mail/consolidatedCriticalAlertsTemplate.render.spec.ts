import * as handlebars from 'handlebars';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * real Handlebars render of the daily critical template. The
 * MailService unit tests mock `compileTemplate`, so this is the only place the
 * `{{#*inline "dailyVulnRow"}}` partial, the `{{#if multiBranch}}` split and the
 * inline branch chip are actually exercised against the real .hbs file.
 */
const TPL_DIR = join(__dirname, 'templates', 'reports');
const PARTIALS_DIR = join(TPL_DIR, 'partials');

const LEAF = '&#127807;'; // 🌿

function render(context: Record<string, unknown>): string {
  const hb = handlebars.create();
  hb.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  hb.registerHelper('cvssColor', () => '#555');
  hb.registerHelper('severityColor', () => '757575');
  for (const f of readdirSync(PARTIALS_DIR)) {
    if (f.endsWith('.hbs')) {
      hb.registerPartial(
        f.replace('.hbs', ''),
        readFileSync(join(PARTIALS_DIR, f), 'utf8'),
      );
    }
  }
  const src = readFileSync(
    join(TPL_DIR, 'consolidatedCriticalAlertsTemplate.hbs'),
    'utf8',
  );
  return hb.compile(src)(context);
}

const baseCtx = (projects: unknown[]) => ({
  userName: 'Ann',
  todayDate: 'Thursday, July 16, 2026',
  totalCritical: 3,
  dashboardUrl: 'https://app.example.com/',
  notificationSettingsUrl: 'https://app.example.com/profile',
  currentYear: 2026,
  projects,
});

describe('consolidatedCriticalAlertsTemplate render', () => {
  it('single-branch project → inline branch chip in the header, flat vuln rows', () => {
    const html = render(
      baseCtx([
        {
          projectName: 'plateforme-backend',
          projectUrl:
            'https://app.example.com/project/p1?filter=critical&branch=main',
          criticalCount: 2,
          multiBranch: false,
          branch: 'main',
          vulnerabilities: [
            {
              severity: 'CRITICAL',
              title: 'PYSEC-2022-43162',
              packageName: 'redis',
              version: '6.2.0',
            },
            {
              severity: 'CRITICAL',
              title: 'GHSA-2wc2-fm75-p42x',
              packageName: 'soupsieve',
            },
          ],
          hasMore: false,
          remainingCount: 0,
        },
      ]),
    );

    // inline chip in the header
    expect(html).toContain(`${LEAF} main`);
    // flat rows rendered via the inline partial
    expect(html).toContain('PYSEC-2022-43162');
    expect(html).toContain('GHSA-2wc2-fm75-p42x');
    // no per-branch section header duplication for a single-branch project
    expect(html).not.toContain('more on this branch');
  });

  it('multi-branch project → one section per branch with headers and deep-links', () => {
    const html = render(
      baseCtx([
        {
          projectName: 'plateforme-backend',
          projectUrl: 'https://app.example.com/project/p1?filter=critical',
          criticalCount: 3,
          multiBranch: true,
          branches: [
            {
              branch: 'main',
              branchUrl:
                'https://app.example.com/project/p1?filter=critical&branch=main',
              criticalCount: 2,
              vulnerabilities: [
                { severity: 'CRITICAL', title: 'VULN-A' },
                { severity: 'CRITICAL', title: 'VULN-C' },
              ],
              hasMore: false,
              remainingCount: 0,
            },
            {
              branch: 'dev',
              branchUrl:
                'https://app.example.com/project/p1?filter=critical&branch=dev',
              criticalCount: 1,
              vulnerabilities: [{ severity: 'CRITICAL', title: 'VULN-B' }],
              hasMore: false,
              remainingCount: 0,
            },
          ],
        },
      ]),
    );

    // branch section headers with the leaf marker
    expect(html).toContain(`${LEAF} main`);
    expect(html).toContain(`${LEAF} dev`);
    // per-branch deep-links (Handlebars HTML-escapes & and = inside the href)
    expect(html).toMatch(/branch(=|&#x3D;)main/);
    expect(html).toMatch(/branch(=|&#x3D;)dev/);
    // vuln rows from both sections (inline partial worked inside {{#each branches}})
    expect(html).toContain('VULN-A');
    expect(html).toContain('VULN-B');
    expect(html).toContain('VULN-C');
  });

  it('renders "more on this branch" when a branch section is truncated', () => {
    const html = render(
      baseCtx([
        {
          projectName: 'p',
          projectUrl: 'https://app.example.com/project/p1?filter=critical',
          criticalCount: 13,
          multiBranch: true,
          branches: [
            {
              branch: 'main',
              branchUrl:
                'https://app.example.com/project/p1?filter=critical&branch=main',
              criticalCount: 12,
              vulnerabilities: [{ severity: 'CRITICAL', title: 'X' }],
              hasMore: true,
              remainingCount: 2,
            },
          ],
        },
      ]),
    );

    expect(html).toContain('more on this branch');
    expect(html).toContain('2 more on this branch');
  });
});
