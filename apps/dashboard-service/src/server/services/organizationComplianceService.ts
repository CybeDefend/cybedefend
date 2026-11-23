// ============================================================================
// Organization Compliance Service
// ============================================================================

import gatewayAPI from '../api/gatewayAPI';
import {
  GetComplianceOverviewParams,
  OrganizationComplianceOverviewResponse,
} from '../interfaces/OrganizationCompliance';

/**
 * Fetch organization compliance overview with statistics, projects, and trends
 */
export const fetchOrganizationComplianceOverview = async (
  params: GetComplianceOverviewParams
): Promise<OrganizationComplianceOverviewResponse> => {
  const { organizationId, ...queryParams } = params;

  // Build query parameters, filtering out undefined values
  const filteredParams: Record<string, string | number> = {};
  
  if (queryParams.page) filteredParams.page = queryParams.page;
  if (queryParams.pageSize) filteredParams.pageSize = queryParams.pageSize;
  if (queryParams.startDate) filteredParams.startDate = queryParams.startDate;
  if (queryParams.endDate) filteredParams.endDate = queryParams.endDate;
  if (queryParams.complianceStatus) filteredParams.complianceStatus = queryParams.complianceStatus;
  if (queryParams.search) filteredParams.search = queryParams.search;
  if (queryParams.sortBy) filteredParams.sortBy = queryParams.sortBy;
  if (queryParams.sortOrder) filteredParams.sortOrder = queryParams.sortOrder;
  if (queryParams.timeframe) filteredParams.timeframe = queryParams.timeframe;

  const response = await gatewayAPI.get(
    `/organization/${organizationId}/compliance-overview`,
    { params: filteredParams }
  );
  
  return response.data;
};
