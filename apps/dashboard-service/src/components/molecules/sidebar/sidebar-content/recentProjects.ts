/**
 * The projects opened in this browser, for the « Recent projects » of the
 * AppSec rail.
 *
 * Only ids are kept, in `localStorage`, most recent first. What is read back
 * is user-controlled: an entry is kept only when it has the shape of a
 * project id, and no name, team or risk level is ever taken from here.
 * `pickRecentProjects` resolves each id against the projects a page of the
 * organisation already loaded (`railSnapshot`); an id that list does not know
 * is not shown, so the rail never names a project it has not read.
 */
export const RECENT_PROJECTS_KEY = 'cybedefend.recentProjects';
/** Kept: a few more than shown, so the projects of another organisation do not push this one's out at once. */
export const RECENT_PROJECTS_KEPT = 6;
/** Shown by the rail. */
export const RECENT_PROJECTS_SHOWN = 3;

const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** True for a value shaped like a project id: a uuid, or the short ids of the test fixtures. */
export const isProjectId = (value: unknown): value is string =>
  typeof value === 'string' && PROJECT_ID.test(value);

/** The ids remembered, most recent first; nothing when the storage is empty, foreign or unavailable. */
export function readRecentProjectIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_PROJECTS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids: string[] = [];
    for (const entry of parsed) {
      if (isProjectId(entry) && !ids.includes(entry)) ids.push(entry);
      if (ids.length === RECENT_PROJECTS_KEPT) break;
    }
    return ids;
  } catch {
    return [];
  }
}

/** Remembers a project as the most recent one. A value that is not a project id is not written. */
export function recordRecentProject(projectId: string): void {
  if (!isProjectId(projectId)) return;
  const ids = [projectId, ...readRecentProjectIds().filter((id) => id !== projectId)].slice(0, RECENT_PROJECTS_KEPT);
  try {
    localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable (private window, blocked site data): nothing is remembered.
  }
}

/**
 * The recent projects to show: the remembered ids the loaded list knows,
 * without the project of the current page, `limit` at most, in the order
 * they were opened.
 */
export function pickRecentProjects<T extends { id: string }>(
  ids: readonly string[],
  known: ReadonlyMap<string, T>,
  exclude?: string | null,
  limit: number = RECENT_PROJECTS_SHOWN,
): T[] {
  const picked: T[] = [];
  for (const id of ids) {
    if (id === exclude) continue;
    const project = known.get(id);
    if (!project) continue;
    picked.push(project);
    if (picked.length >= limit) break;
  }
  return picked;
}
