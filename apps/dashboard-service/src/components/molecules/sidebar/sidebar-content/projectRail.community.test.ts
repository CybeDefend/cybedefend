import { describe, expect, it, vi } from 'vitest';

/**
 * The « Current project » rows of the rail per edition: the code map is closed
 * and its page exists only in the cloud's route table, so the
 * Community Edition's rail does not link to it. The module reads `EDITION`
 * once at load, so each case re-imports it.
 */
const ed = vi.hoisted(() => ({ edition: 'community' as string }));
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));

const keysIn = async (edition: string) => {
  ed.edition = edition;
  vi.resetModules();
  const { projectSectionLinks } = await import('./projectRail');
  return projectSectionLinks('proj-1').map((link) => link.key);
};

describe('projectSectionLinks per edition', () => {
  it('the Community Edition has no code map row', async () => {
    expect(await keysIn('community')).toEqual(['overview', 'vulnerabilities', 'reports', 'compliance', 'settings']);
  }, 30_000);

  it('the cloud keeps the code map row', async () => {
    expect(await keysIn('cloud')).toEqual(['overview', 'vulnerabilities', 'code-graph', 'reports', 'compliance', 'settings']);
  }, 30_000);
});
