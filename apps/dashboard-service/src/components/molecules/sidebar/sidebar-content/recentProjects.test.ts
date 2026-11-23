import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RECENT_PROJECTS_KEPT,
  RECENT_PROJECTS_KEY,
  isProjectId,
  pickRecentProjects,
  readRecentProjectIds,
  recordRecentProject,
} from './recentProjects';

/**
 * The « Recent projects » of the AppSec rail: ids only, in this browser,
 * resolved against the projects a page already loaded before any use.
 */
describe('recentProjects', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('reads nothing from an empty, malformed or foreign value', () => {
    expect(readRecentProjectIds()).toEqual([]);
    localStorage.setItem(RECENT_PROJECTS_KEY, '{not json');
    expect(readRecentProjectIds()).toEqual([]);
    localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify({ id: 'p-1' }));
    expect(readRecentProjectIds()).toEqual([]);
  });

  it('keeps only entries shaped like a project id, once each', () => {
    localStorage.setItem(
      RECENT_PROJECTS_KEY,
      JSON.stringify(['p-1', 42, '../etc/passwd', 'p-1', 'a'.repeat(65), 'p 2', null, 'p-2']),
    );
    expect(readRecentProjectIds()).toEqual(['p-1', 'p-2']);
  });

  it('records the project first, moves a repeat to the front and keeps a bounded list', () => {
    for (let i = 1; i <= RECENT_PROJECTS_KEPT + 2; i += 1) recordRecentProject(`p-${i}`);
    const ids = readRecentProjectIds();
    expect(ids).toHaveLength(RECENT_PROJECTS_KEPT);
    expect(ids[0]).toBe(`p-${RECENT_PROJECTS_KEPT + 2}`);
    expect(ids).not.toContain('p-1');
    recordRecentProject('p-4');
    expect(readRecentProjectIds()[0]).toBe('p-4');
    expect(readRecentProjectIds().filter((id) => id === 'p-4')).toHaveLength(1);
  });

  it('records nothing for a value that is not a project id', () => {
    recordRecentProject('');
    recordRecentProject('../x');
    recordRecentProject('7f3c2a10-1b2c-4d5e-8f90-a1b2c3d4e5f6');
    expect(readRecentProjectIds()).toEqual(['7f3c2a10-1b2c-4d5e-8f90-a1b2c3d4e5f6']);
    expect(isProjectId('p-1')).toBe(true);
    expect(isProjectId('p/1')).toBe(false);
    expect(isProjectId(1)).toBe(false);
  });

  it('survives a storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readRecentProjectIds()).toEqual([]);
    expect(() => recordRecentProject('p-1')).not.toThrow();
  });

  it('shows only the ids the loaded list knows, without the current project, three at most, in order', () => {
    const known = new Map(
      ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'].map((id) => [id, { id, name: `Project ${id}` }]),
    );
    const picked = pickRecentProjects(['p-5', 'p-9', 'p-4', 'p-3', 'p-2', 'p-1'], known, 'p-4');
    expect(picked.map((project) => project.id)).toEqual(['p-5', 'p-3', 'p-2']);
    expect(pickRecentProjects(['p-9'], known)).toEqual([]);
    expect(pickRecentProjects([], known)).toEqual([]);
  });
});
