import gatewayAPI from "../api/gatewayAPI";
import { UpdateUserProfileResponseDto } from "../interfaces/User";
import store from "../store";
import { addOnboardingStep } from "../store/userSlice";

export const fetchMyProfile = async () => {
  try {
    const response = await gatewayAPI.get("/user/profile");
    return response.data;
  } catch (error) {
    throw error;
  }
};

export const completeOnboardingStep = async (
  stepId: string
): Promise<UpdateUserProfileResponseDto> => {
  // Update Redux store immediately (optimistic) so the UI reflects the change
  store.dispatch(addOnboardingStep(stepId));
  // Persist to backend
  const payload = {
    onboardingProgress: JSON.stringify([stepId]),
  };
  const response = await gatewayAPI.patch('/user/profile', payload);
  return response.data;
};

export interface UpdateUserProfileOnboardingOptions {
  /** solo_dev | tech_lead | security_pro | unspecified */
  onboardingPersona?: string;
  /**
   * Multi-select: array of vibecoding | team_security | compliance |
   * unspecified. Sent as an array — the gateway DTO joins it to the CSV
   * string persisted on the backend; the dashboard never joins client-side.
   */
  onboardingUsage?: string[];
}

export const updateUserProfile = async (
  notification?: boolean | null,
  isOnboardingCompleted?: boolean,
  onboarding?: UpdateUserProfileOnboardingOptions
): Promise<UpdateUserProfileResponseDto> => {
  try {
    const payload: any = {};
    if (notification !== null && notification !== undefined) {
      payload.notification = notification;
    }
    if (isOnboardingCompleted !== undefined) {
      payload.isOnboardingCompleted = isOnboardingCompleted;
    }
    if (onboarding?.onboardingPersona !== undefined) {
      payload.onboardingPersona = onboarding.onboardingPersona;
    }
    if (onboarding?.onboardingUsage !== undefined) {
      payload.onboardingUsage = onboarding.onboardingUsage;
    }
    const response = await gatewayAPI.patch(`/user/profile`, payload);

    return response.data;
  } catch (error: any) {
    throw error;
  }
};
