import { Project } from "@/server/interfaces/Project";

/**
 * Lightweight in-app signal for "a project's settings just changed", used to
 * sync already-mounted components (e.g. ProjectIdActions, the header buttons
 * sitting right above the settings form) without a refetch round-trip. The
 * fetchProject cache is invalidated separately by updateProject; this event
 * only patches live UI.
 *
 * No pre-existing CustomEvent pattern existed in the dashboard (the
 * background-tasks flow is Redux/SSE based), so this is the canonical one —
 * reuse it for future project-settings signals instead of inventing siblings.
 */
export const PROJECT_UPDATED_EVENT = "cybe:project-updated";

export interface ProjectUpdatedDetail {
  projectId: string;
  /** Only the fields that actually changed. */
  changes: Partial<Project>;
}

export const dispatchProjectUpdated = (detail: ProjectUpdatedDetail): void => {
  window.dispatchEvent(new CustomEvent<ProjectUpdatedDetail>(PROJECT_UPDATED_EVENT, { detail }));
};
