import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Where a link meaning « the project list » leads, per edition: the cloud's AppSec home is the list, Community's is the
 * « Get started » page, so there the list is at its own URL.
 */
const ed = vi.hoisted(() => ({ edition: 'community' as 'community' | 'cloud' }));
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));

import { appsecProjectListPath } from './appsecProjectList';

afterEach(() => {
  ed.edition = 'community';
});

describe('appsecProjectListPath', () => {
  it('is /appsec/projects in Community', () => {
    expect(appsecProjectListPath()).toBe('/appsec/projects');
  });

  it('is the AppSec home in the cloud, as it always was', () => {
    ed.edition = 'cloud';
    expect(appsecProjectListPath()).toBe('/appsec');
  });
});
