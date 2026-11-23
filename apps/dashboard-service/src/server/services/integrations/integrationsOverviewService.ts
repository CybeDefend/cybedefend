import gatewayAPI from "../../api/gatewayAPI";
import { IntegrationsOverviewResponse } from "../../interfaces/IntegrationsOverview";

/**
 * Fetch consolidated integrations overview for an organization.
 * Returns GitHub installation, GitLab installation, and container registry stats in one call.
 * @param organizationId - The organization ID
 * @returns Consolidated integrations overview
 */
export const getIntegrationsOverview = async (
  organizationId: string
): Promise<IntegrationsOverviewResponse> => {
  try {
    const response = await gatewayAPI.get<IntegrationsOverviewResponse>(
      `/organization/${organizationId}/integrations/overview`
    );
    if ([200, 201, 202].includes(response.status)) {
      return response.data;
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  } catch (error: any) {
    throw error;
  }
};
