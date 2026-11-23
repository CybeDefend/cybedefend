import { describe, expect, it, vi } from 'vitest';

// These cases describe the cloud's behaviour; the Community Edition's is pinned
// by projectRail.community.test.ts.
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  EDITION: 'cloud',
}));

import { projectSectionIcon } from '@/components/atoms/icon/projectSectionIcons';
import { projectPath } from '@/utils/product';

import { activeProjectSection, appsecProjectIdFromPath, projectSectionLinks } from './projectRail';

const P = '7f3c2a10-1b2c-4d5e-8f90-a1b2c3d4e5f6';

/**
 * The « Current project » section of the AppSec rail: on a project page only,
 * its tabs built by the URL contract the project tab row uses.
 */
describe('projectRail', () => {
  it('reads the project id of an AppSec project page, and of nothing else', () => {
    expect(appsecProjectIdFromPath(`/appsec/project/${P}`)).toBe(P);
    expect(appsecProjectIdFromPath(`/appsec/project/${P}/`)).toBe(P);
    expect(appsecProjectIdFromPath(`/appsec/project/${P}/sast/issue/v-1`)).toBe(P);
    expect(appsecProjectIdFromPath('/appsec')).toBeNull();
    expect(appsecProjectIdFromPath('/appsec/autofix')).toBeNull();
    // The onboarding routes under /project/integration are not a project page.
    expect(appsecProjectIdFromPath('/appsec/project/integration/github')).toBeNull();
    // Another space's project renders its own shell; a former unprefixed URL is redirected first.
    expect(appsecProjectIdFromPath(`/other/project/${P}`)).toBeNull();
    expect(appsecProjectIdFromPath(`/project/${P}/sast`)).toBeNull();
    // An id that is not shaped like one is not used.
    expect(appsecProjectIdFromPath('/appsec/project/%2e%2e/settings')).toBeNull();
    expect(appsecProjectIdFromPath(`/appsec/project/${'a'.repeat(65)}`)).toBeNull();
  });

  it('builds the six tabs of the project tab row, in its order, with its URLs', () => {
    const links = projectSectionLinks(P);
    expect(links.map((link) => link.key)).toEqual(['overview', 'vulnerabilities', 'code-graph', 'reports', 'compliance', 'settings']);
    expect(links.map((link) => link.href)).toEqual([
      projectPath('appsec', P),
      projectPath('appsec', P, 'sast'),
      projectPath('appsec', P, 'code-graph'),
      projectPath('appsec', P, 'reports'),
      projectPath('appsec', P, 'compliance'),
      projectPath('appsec', P, 'settings'),
    ]);
    for (const link of links) {
      expect(link.labelKey).toMatch(/^components\.projectWrapper\.tabs\./);
      // The same glyph as the project tab row and the section's page header.
      expect(link.icon).toBe(projectSectionIcon(link.key));
    }
  });

  it('marks the tab of the page, as the project tab row does', () => {
    const base = projectPath('appsec', P);
    expect(activeProjectSection(base, P)).toBe('overview');
    expect(activeProjectSection(`${base}/`, P)).toBe('overview');
    for (const segment of ['sast', 'iac', 'cicd', 'secret', 'sca', 'container']) {
      expect(activeProjectSection(`${base}/${segment}`, P)).toBe('vulnerabilities');
    }
    // The closed tree's scanner tabs arrive as extra segments: with
    // one registered, its page marks « Vulnerabilities » too; without, it is none of them.
    expect(activeProjectSection(`${base}/ai-bom`, P, ['ai-bom'])).toBe('vulnerabilities');
    expect(activeProjectSection(`${base}/ai-bom`, P)).toBeNull();
    expect(activeProjectSection(`${base}/sast/issue/v-1`, P)).toBe('vulnerabilities');
    expect(activeProjectSection(`${base}/sca/license/MIT`, P)).toBe('vulnerabilities');
    expect(activeProjectSection(`${base}/code-graph`, P)).toBe('code-graph');
    expect(activeProjectSection(`${base}/reports`, P)).toBe('reports');
    expect(activeProjectSection(`${base}/compliance`, P)).toBe('compliance');
    expect(activeProjectSection(`${base}/settings`, P)).toBe('settings');
    expect(activeProjectSection(`${base}/something-else`, P)).toBeNull();
    expect(activeProjectSection('/appsec/project/other/settings', P)).toBeNull();
  });
});
