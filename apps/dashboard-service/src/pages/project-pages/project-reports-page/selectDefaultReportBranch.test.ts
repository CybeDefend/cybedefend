import { describe, it, expect } from 'vitest';
import { ProjectBranch } from '@/server/interfaces/Vulnerability';
import { selectDefaultReportBranch } from './selectDefaultReportBranch';

describe('selectDefaultReportBranch', () => {
  it('prefers the reference branch when the project declares one', () => {
    const branches: ProjectBranch[] = [
      { name: 'feature', isDefault: false },
      { name: 'main', isDefault: true },
    ];
    expect(selectDefaultReportBranch(branches, 'main')).toBe('main');
  });

  it('prefers the reference branch even when an archived branch comes first', () => {
    const branches: ProjectBranch[] = [
      { name: 'archived-old', isDefault: false, archived: true },
      { name: 'main', isDefault: true },
    ];
    expect(selectDefaultReportBranch(branches, 'main')).toBe('main');
  });

  it('falls back to the first active branch when there is no reference branch', () => {
    const branches: ProjectBranch[] = [
      { name: 'old', isDefault: false, archived: true },
      { name: 'feature', isDefault: false },
      { name: 'other', isDefault: false },
    ];
    expect(selectDefaultReportBranch(branches, null)).toBe('feature');
  });

  it('uses an archived branch only when no active branch exists', () => {
    const branches: ProjectBranch[] = [
      { name: 'old', isDefault: false, archived: true },
    ];
    expect(selectDefaultReportBranch(branches, null)).toBe('old');
  });

  it('returns null when the project has no named branches', () => {
    expect(selectDefaultReportBranch([], null)).toBeNull();
  });
});
