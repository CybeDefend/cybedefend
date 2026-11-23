import { useSyncExternalStore } from 'react';

import type { ProjectAnalysis } from '../interfaces/Project';

/**
 * What the pages of an organisation already read, kept for the shell.
 *
 * The AppSec rail names the projects opened recently and the project of the
 * page, and it never asks the API itself: `useOrganizationProjects` notes
 * here each page of the project list it loads (`noteProjectList`), and the
 * rail reads it with `useKnownProjects`. Nothing noted means nothing shown.
 *
 * In memory only, for this tab: a reload starts empty, and the next list
 * fills it again. Keyed by organisation, so a switch of organisation shows
 * nothing until that organisation's list has been read.
 *
 * Only what the rail shows is kept here. The organisation's statistics were
 * once noted too, for a posture block of the rail; that
 * block is gone (it repeated the home and made the rail scroll), so the rail holds
 * no figure of the main page.
 */
export type RiskLevel = ProjectAnalysis['cyberRiskLevel'];

export interface KnownProject {
  id: string;
  name: string;
  teamName: string;
  riskLevel: RiskLevel;
}

export type KnownProjects = ReadonlyMap<string, KnownProject>;

type ProjectListEntry = Pick<ProjectAnalysis, 'projectId' | 'name' | 'teamName'> & Partial<Pick<ProjectAnalysis, 'cyberRiskLevel'>>;

const RISK_LEVELS: readonly RiskLevel[] = ['none', 'low', 'medium', 'high', 'critical'];
const EMPTY_PROJECTS: KnownProjects = new Map();

const projectsByOrganization = new Map<string, KnownProjects>();
const listeners = new Set<() => void>();

const emit = (): void => {
  listeners.forEach((listener) => listener());
};

/** Subscribes to every note; returns the unsubscribe. (`useSyncExternalStore`'s shape.) */
export function subscribeRailSnapshot(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const asRiskLevel = (value: unknown): RiskLevel =>
  RISK_LEVELS.includes(value as RiskLevel) ? (value as RiskLevel) : 'none';

/** Notes a page of the organisation's project list. Pages accumulate; a project read again is updated. */
export function noteProjectList(organizationId: string, projects: ReadonlyArray<ProjectListEntry>): void {
  if (!organizationId) return;
  const next = new Map(projectsByOrganization.get(organizationId) ?? EMPTY_PROJECTS);
  for (const project of projects) {
    const id = project.projectId;
    if (typeof id !== 'string' || id === '') continue;
    next.set(id, {
      id,
      name: typeof project.name === 'string' ? project.name : '',
      teamName: typeof project.teamName === 'string' ? project.teamName : '',
      riskLevel: asRiskLevel(project.cyberRiskLevel),
    });
  }
  projectsByOrganization.set(organizationId, next);
  emit();
}

/** The projects read for an organisation, by id; an empty map when none was. */
export const readKnownProjects = (organizationId: string | null | undefined): KnownProjects =>
  (organizationId && projectsByOrganization.get(organizationId)) || EMPTY_PROJECTS;

/** For tests. */
export function resetRailSnapshot(): void {
  projectsByOrganization.clear();
  emit();
}

export function useKnownProjects(organizationId: string | null | undefined): KnownProjects {
  return useSyncExternalStore(
    subscribeRailSnapshot,
    () => readKnownProjects(organizationId),
    () => readKnownProjects(organizationId),
  );
}
