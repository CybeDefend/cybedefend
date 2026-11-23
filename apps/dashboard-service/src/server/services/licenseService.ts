import gatewayAPI from "../api/gatewayAPI";

export interface LicenseClassificationItem {
  spdxId: string;
  name: string;
  defaultCategory: string;
  currentCategory: string;
  isOverridden: boolean;
  isCustom: boolean;
}

export interface LicenseClassificationsResponse {
  licenses: LicenseClassificationItem[];
}

export const fetchLicenseClassifications = async (
  organizationId: string,
): Promise<LicenseClassificationsResponse> => {
  const response = await gatewayAPI.get(
    `/organization/${organizationId}/licenses/classifications`,
  );
  return response.data;
};

export const updateLicenseClassifications = async (
  organizationId: string,
  overrides: Array<{ spdxId: string; category: string }>,
): Promise<{ success: boolean; updatedCount: number }> => {
  const response = await gatewayAPI.put(
    `/organization/${organizationId}/licenses/classifications`,
    { overrides },
  );
  return response.data;
};

export const resetLicenseClassifications = async (
  organizationId: string,
): Promise<{ success: boolean }> => {
  const response = await gatewayAPI.delete(
    `/organization/${organizationId}/licenses/classifications`,
  );
  return response.data;
};

export const deleteLicenseOverride = async (
  organizationId: string,
  spdxId: string,
): Promise<{ success: boolean }> => {
  const response = await gatewayAPI.delete(
    `/organization/${organizationId}/licenses/classifications/${encodeURIComponent(spdxId)}`,
  );
  return response.data;
};
