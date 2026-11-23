import type { Project } from 'src/entities/project.entity';

/**
 * The project settings an edition adds to the core's: the products a project
 * may be created from, and the settings of the closed features (their
 * columns at creation and update, their fields in the project answers). The
 * core reads and writes the AppSec scan settings only.
 */
export const PROJECT_SETTINGS_PORT = 'PROJECT_SETTINGS_PORT';

export interface ProjectSettingsPort {
  /** The products a project may be created from. Community: appsec only. */
  products(): readonly string[];
  /**
   * The columns the edition sets on a new project from its creation request,
   * merged after the core's defaults. Community: none.
   */
  creationColumns(request: Readonly<Record<string, unknown>>): Partial<Project>;
  /**
   * The columns the edition changes from an update request (a field absent
   * from the request is left as it is). Community: none.
   */
  updateColumns(request: Readonly<Record<string, unknown>>): Partial<Project>;
  /** The edition's fields of one project's full answer. Community: none. */
  answerFields(project: Project): Record<string, unknown>;
  /** The edition's fields of one row of the project list. Community: none. */
  listFields(project: Project): Record<string, unknown>;
  /**
   * The columns the readable-projects summary selects for the edition, as
   * [expression, alias] on the `project` alias. Community: none.
   */
  summarySelects(): ReadonlyArray<readonly [string, string]>;
  /** The edition's fields of one readable-projects summary row. Community: none. */
  summaryFields(
    row: Readonly<Record<string, unknown>>,
  ): Record<string, unknown>;
}
