/**
 * The scan settings an edition derives from a project, beside the AppSec
 * scanners and settings the core reads itself.
 */
export const PROJECT_SCAN_SETTINGS_PORT = 'PROJECT_SCAN_SETTINGS_PORT';

export interface ProjectScanSettingsPort {
  /**
   * The scan types the edition runs for the project, after the core's
   * (sast, iac, sca, secret). Community: none.
   */
  extraScanTypes(project: Readonly<Record<string, unknown>>): string[];
  /** The edition's fields of the project's scan settings. Community: none. */
  settingsFields(
    project: Readonly<Record<string, unknown>>,
  ): Record<string, unknown>;
}
