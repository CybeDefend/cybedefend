import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
vi.mock('../api/gatewayAPI', () => ({
  default: { post: (...a: unknown[]) => post(...a) },
}));

import scanService from './scanService';

type Start = (options?: { branch?: string }) => Promise<unknown>;

// The API refuses a container scan whose branch the project's
// linked repository does not have, and picks the project's reference branch
// (else the repository's default branch) when none is sent. The dashboard
// used to send `main` when no branch was selected, so a project whose
// repository has no `main` had its own scans refused.
const starts: Array<[string, Start]> = [
  ['public', (o) => scanService.startPublicContainerScan('p-1', 'app:1.0', o)],
];

describe('scanService container scans — the branch they send', () => {
  beforeEach(() => {
    post.mockReset().mockResolvedValue({ data: { success: true, scanId: 's-1' } });
  });

  it.each(starts)('%s: sends no branch when none is selected, never main', async (_name, start) => {
    await start({});
    const body = post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.branch).toBeUndefined();
  });

  it.each(starts)('%s: sends the selected branch', async (_name, start) => {
    await start({ branch: 'develop' });
    const body = post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.branch).toBe('develop');
  });
});

describe('scanService — the core starts no registry scan', () => {
  it('holds the public image scan only: registry scans are the closed extension\'s', () => {
    const containerStarts = Object.keys(scanService).filter((name) => /ContainerScan$/.test(name));
    expect(containerStarts).toEqual(['startPublicContainerScan']);
  });
});
