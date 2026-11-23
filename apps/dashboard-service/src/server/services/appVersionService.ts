import gatewayAPI from "../api/gatewayAPI";

export interface AppVersionInfo {
  service: string;
  version: string;
  commit: string;
  environment: string;
  deploymentEnv: string;
}

export const fetchAppVersion = async (): Promise<AppVersionInfo> => {
  try {
    const response = await gatewayAPI.get<AppVersionInfo>("/");
    return response.data;
  } catch (error: any) {
    console.error("Failed to fetch app version:", error);
    // Return default values on error
    return {
      service: "Gateway Service",
      version: "Unknown",
      commit: "Unknown",
      environment: "Unknown",
      deploymentEnv: "Unknown",
    };
  }
};
