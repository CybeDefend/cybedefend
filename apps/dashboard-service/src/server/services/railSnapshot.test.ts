import { beforeEach, describe, expect, it, vi } from 'vitest';

import { noteProjectList, readKnownProjects, resetRailSnapshot, subscribeRailSnapshot } from './railSnapshot';

const project = (id: string, extra: Record<string, unknown> = {}) => ({
  projectId: id,
  name: `Project ${id}`,
  teamName: 'Platform',
  cyberRiskLevel: 'high' as const,
  ...extra,
});

/**
 * What the pages of an organisation already read, kept for the rail: the
 * rail shows it or nothing, and never asks the API itself.
 */
describe('railSnapshot', () => {
  beforeEach(() => resetRailSnapshot());

  it('knows no project until a list was read, then accumulates the pages of one organisation', () => {
    expect(readKnownProjects('org-1').size).toBe(0);
    noteProjectList('org-1', [project('p-1'), project('p-2')]);
    noteProjectList('org-1', [project('p-3', { cyberRiskLevel: 'bogus' }), project('p-1', { name: 'Renamed' })]);
    const known = readKnownProjects('org-1');
    expect([...known.keys()]).toEqual(['p-1', 'p-2', 'p-3']);
    expect(known.get('p-1')).toEqual({ id: 'p-1', name: 'Renamed', teamName: 'Platform', riskLevel: 'high' });
    // A risk level the dashboard does not know reads as none.
    expect(known.get('p-3')?.riskLevel).toBe('none');
    expect(readKnownProjects('org-2').size).toBe(0);
    expect(readKnownProjects('').size).toBe(0);
    expect(readKnownProjects(undefined).size).toBe(0);
  });

  it('skips an entry without an id and a note without an organisation', () => {
    noteProjectList('org-1', [project(''), { ...project('p-1'), projectId: undefined as unknown as string }]);
    noteProjectList('', [project('p-2')]);
    expect(readKnownProjects('org-1').size).toBe(0);
    expect(readKnownProjects('').size).toBe(0);
  });

  it('tells its readers when something was noted, and keeps the map object until then', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRailSnapshot(listener);
    noteProjectList('org-1', [project('p-1')]);
    const first = readKnownProjects('org-1');
    expect(readKnownProjects('org-1')).toBe(first);
    noteProjectList('org-1', [project('p-2')]);
    expect(readKnownProjects('org-1')).not.toBe(first);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    noteProjectList('org-1', [project('p-3')]);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
