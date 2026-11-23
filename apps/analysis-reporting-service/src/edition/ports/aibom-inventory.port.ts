/**
 * Extension token: the closed AI-BOM inventory that the
 * core ResultService reads for the AI-BOM tab count and clears on a project
 * delete. Only an ee module supplies it (the ee AibomModule);
 * when the token is absent — the Community Edition — the count is 0 and
 * the delete leaves no AI-BOM table to clear.
 */
export const AIBOM_INVENTORY = 'AIBOM_INVENTORY';

export interface AibomInventory {
  /** Merged AI components of a project (one branch when given). Never throws. */
  countMergedComponents(projectId: string, branch?: string): Promise<number>;
  /** Removes every AI component and compliance report of a project. */
  deleteAllForProject(projectId: string): Promise<void>;
}
