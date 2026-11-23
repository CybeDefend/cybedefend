import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();
vi.mock('../api/gatewayAPI', () => ({ default: { get: (...a: any[]) => get(...a) } }));

import { fetchProject } from './projectService';

describe('fetchProject maps detectedLanguages + codeGraphSupported', () => {
  beforeEach(() => { get.mockReset(); });

  it('passes detectedLanguages and codeGraphSupported through', async () => {
    get.mockResolvedValue({
      data: {
        projectId: 'p-9', name: 'x', teamId: 't', teamName: 'team',
        createdAt: '', updatedAt: '',
        detectedLanguages: ['Terraform'], codeGraphSupported: false,
      },
    });
    const p = await fetchProject('p-9');
    expect(p.detectedLanguages).toEqual(['Terraform']);
    expect(p.codeGraphSupported).toBe(false);
  });
});
