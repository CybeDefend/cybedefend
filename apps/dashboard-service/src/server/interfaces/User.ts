import { ProfileOrganization } from "./Organization";

/**
 * Cross-organisation project entry surfaced by ``GET /profile``.
 * Cached in Redux at session start so global-chat / project pickers
 * read it without re-querying the gateway on every page change.
 */
export interface ProfileAccessibleProject {
  projectId: string;
  projectName: string;
  organizationId: string;
  organizationName: string;
}

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  picture: string;
  notification: boolean;
  role: string;
  /**
   * The member's products in the organisation (per-member products),
   * product ids, on the members list. Absent from an older
   * gateway; read it through `heldProducts`.
   */
  products?: string[];
}

export interface PaginatedUser {
  users: User[];
  totalUsers: number;
  totalPages: number;
}

export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  picture: string;
  notification: boolean;
  isOnboardingCompleted: boolean;
  onboardingProgress: string[]; // NEW
  /**
   * Onboarding persona answers. The API returns '' when unset — the user
   * slice normalizes that to null. Values: solo_dev | tech_lead |
   * security_pro | unspecified (persona) and vibecoding | team_security |
   * compliance | unspecified (usage, multi-select).
   */
  onboardingPersona?: string | null;
  /**
   * Multi-valued usage answer. The wire format (GET/PATCH /user/profile) is
   * a CSV string, e.g. "vibecoding,compliance" or "" when unset — hence the
   * `string` arm here. Callers that already hold a parsed array (e.g. the
   * persona modal before dispatch) may pass `string[]` too. The Redux slice
   * (`UserState`, in `store/userSlice.ts`) normalizes either shape and
   * narrows its own field to `string[] | null` — every other consumer
   * should read from there, not from this wire-shaped type.
   */
  onboardingUsage?: string | string[] | null;
  createdAt: string;
  updatedAt: string;
  myOrganizations: ProfileOrganization[];
  /**
   * Optional — backwards compatible. The gateway started returning this
   * after follow-up so the dashboard can seed Redux once per
   * session and re-use it for the global-chat scope, project pickers,
   * etc. Older gateway versions just don't populate it; consumers
   * should treat ``undefined`` as "not yet loaded".
   */
  myAccessibleProjects?: ProfileAccessibleProject[];
}

export interface UpdateUserProfileResponseDto {
  message: string;  
  userId: string;
}