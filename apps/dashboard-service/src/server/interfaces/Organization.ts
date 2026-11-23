import { Team } from "./Team";
import type { Product } from "../../utils/product";

/**
 * One marketing touch (first or last), as the org-create payload carries it.
 * The closed analytics tree reads and writes it; the core only types the
 * payload field, so the shape lives here, not in a closed module.
 */
export interface Touch {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  term?: string | null;
  clickId?: string | null;
  clickIdType?: string | null;
  landingPath?: string | null;
  referrer?: string | null;
  at?: string | null;
}

/** Marketing attribution (first-touch and last-touch), org-create payload. */
export interface AttributionPayload {
  first: Touch;
  last: Touch;
}

/** `inactive`: never activated, no row in billing. */
export type ProductActivationStatus = 'active' | 'deactivated' | 'inactive';

/**
 * One product of an organisation, as the profile reports it (billing's
 * `GetProductsForOrganizations`). Read through the selectors of
 * `store/selectors.ts`, which compare both fields against the closed lists.
 */
export interface OrganizationProductState {
  product: Product;
  status: ProductActivationStatus;
  /** AppSec only: the reverse trial was started once and never starts again. */
  trialUsed?: boolean;
}

export interface ProfileOrganization {
  id: string;
  name: string;
  description: string;
  myTeams: Team[];
  myRole: string;
  country: string;
  industry: string;
  isActive: boolean;
  /** The AppSec subscription: null until AppSec is activated once. */
  subscription: Subscription | null;
  /**
   * Both products when billing answered. Empty or absent means unknown
   * (billing unavailable), never « no product ».
   */
  products?: OrganizationProductState[];
  /**
   * The products the current user holds in this organisation (per-member
   * products), product ids, as the API sends them. It
   * counts only with `myProductsKnown`: read both through `memberHasProduct`,
   * never directly.
   */
  myProducts?: string[];
  /**
   * True once global-management computed `myProducts`: an empty list then
   * means « no product ». Absent or false (an older gateway or
   * global-management) means unknown, whatever the list says.
   */
  myProductsKnown?: boolean;
  /**
   * The organisation's per-member products switch. False: every member holds
   * both products and takes an AppSec seat, and a member's products cannot be
   * changed. Absent (an older gateway or global-management): unknown. Read it
   * through `memberProductsSwitchedOff` (utils/memberProducts.ts).
   */
  memberProducts?: boolean;
}

export interface OrganizationUpdateRoleResponseDto {
  success: boolean;
  message: string;
}

export interface OrganizationDeleteMemberResponseDto {
  success: boolean;
  message: string;
}

export interface OrganizationCreationRequestDto {
  name: string;
  // Billing profile — no longer collected at signup. A reverse trial creates
  // no Stripe Subscription, so these are gathered at upgrade time instead.
  // Still typed here: the upgrade flow sends them, and the gateway keeps
  // validating any value that IS supplied.
  industry?: Industry;
  country?: string; // ISO 3166-1 alpha-2
  customerType?: CustomerType;
  // For individual customer type
  firstName?: string;
  lastName?: string;
  // For company customer type
  companyName?: string;
  vatNumber?: string; // optional
  // Billing address (optional)
  billingAddressLine1?: string;
  billingAddressLine2?: string;
  billingCity?: string;
  billingPostalCode?: string;
  billingRegion?: string;
  // Marketing attribution (optional)
  attribution?: AttributionPayload;
  hdyhau?: string;
  /** Self-serve plan the visitor showed intent for on the pricing page. */
  intendedPlan?: string;
  /** Lead id from an invite link (`?lead=`), uuid v4 (cloud only). */
  leadId?: string;
}

export interface OrganizationCreationResponseDto {
  success: boolean;
  message: string;
  organizationId: string;
  name: string;
  description: string;
  email: string;
}

export interface OrganizationInviteResponseDto {
  id: string;
  token: string;
  email: string;
  status: string;
  organizationId: string;
  organizationName: string;
  organizationRole: string;
  expiresAt: string; 
}

export interface GetOrganizationInvitationsResponseDto {
  organizationId: string;
  invitations: OrganizationInviteResponseDto[];
}

/**
 * Represents a team assignment with specific role for organization invitation
 */
export interface TeamAssignment {
  teamId: string;
  role: 'team_manager' | 'analyst_developer' | 'developer' | 'read_only';
}

/**
 * Enhanced organization invite request with optional team assignments
 */
export interface OrganizationInviteRequest {
  email: string;
  role: string;
  teamAssignments?: TeamAssignment[];
  /** The products the invitation gives (per-member products); absent: every active product the inviter may give. */
  products?: Product[];
}

/**
 * State interface for managing team selection in UI components
 */
export interface TeamSelectionState {
  teamId: string;
  teamName: string;
  selectedRole: string;
}

/**
 * Team role options for UI dropdowns
 */
export type TeamRoleOption = {
  value: 'team_manager' | 'analyst_developer' | 'developer' | 'read_only';
  label: string;
};

export interface OrganizationCancelRequestDto {
  organizationId: string;
  invitationId: string;
}

// Industry options as per backend DTO
export type Industry =
  | 'software'
  | 'finance'
  | 'healthcare'
  | 'education'
  | 'manufacturing'
  | 'retail'
  | 'government'
  | 'energy'
  | 'telecom'
  | 'freelance'
  | 'other';

export type CustomerType = 'individual' | 'company';

export interface Subscription {
  /** The plan keys the billing extension may send. */
  plan: 'developer' | 'team' | 'scale' | 'enterprise' | 'pro' | 'pro_v3' | 'team_v3';
  seats: number;
  resetAt: string;
  createdAt: string;
  updatedAt: string;
  trialEndsAt: string;
  currentPeriodEnd: string;
  status: 'active' | 'canceled' | 'past_due' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'paused' | 'trialing';
  /** CSV of disabled feature names (e.g. "policies,reports,container_scanning") */
  featuresDisabled?: string;
  // ─── Reverse-trial fields ────────────────────────────────────────
  /** True when org is on the auto-started reverse trial */
  isTrial?: boolean;
  /** Total trial scans available for the org */
  trialScansLimit?: number;
  /** Number of scans the org has already used during the trial */
  trialScansUsed?: number;
  /** Total trial Cybe (AI) requests available for the org */
  trialCybeLimit?: number;
  /** Number of Cybe requests already consumed during the trial */
  trialCybeUsed?: number;
  /** True when both quotas are exhausted (read-only mode) */
  writesBlocked?: boolean;
  /** Monthly Cybe quota for paid plans (null on trial/legacy plans) */
  cybeMonthlyQuota?: number | null;
  /** Quantity of the `extra_users` addon currently active */
  addonExtraUsersQuantity?: number | null;
  /** Quantity of the `extra_repos` addon currently active */
  addonExtraReposQuantity?: number | null;
  /** Quantity of the `extra_cybe` addon currently active (replaces legacy `cybe_pack`) */
  addonExtraCybeQuantity?: number | null;
  /** Current billing cycle — "month" | "year". Absent on trial/legacy subscriptions. */
  billingCycle?: 'month' | 'year';
  /** Cloud billing: seats bought beyond the plan's included ones, when the profile carries it. */
  extraSeatsQuantity?: number | null;
  /** Cloud billing: the seats the organisation may fill, as billing counts them, when the profile carries it. */
  seatAllowance?: number | null;
  /** Cloud billing: project packs bought, when the profile carries it. */
  projectPacksQuantity?: number | null;
}

export interface TrialRequestDto {
  plan: 'developer' | 'pro';
  seats: number;
  billingInterval: 'month' | 'year';
}

export interface TrialResponseDto {
  success: boolean;
  message: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

export interface BillingPortalResponseDto {
  success: boolean;
  url: string;
  message: string;
}

/** What the organization does with a MALICIOUS MCP verdict: `warn` alerts, `block` refuses. */
export type OrganizationMcpPolicyMode = 'warn' | 'block';

export const ORGANIZATION_MCP_POLICY_MODES: readonly OrganizationMcpPolicyMode[] = ['warn', 'block'];

export function isOrganizationMcpPolicyMode(value: unknown): value is OrganizationMcpPolicyMode {
  return value === 'warn' || value === 'block';
}

/**
 * The MCP policy of an organization, applied server-side to every verification
 * the agents' MCP proxy asks for. `PUT` is a replacement: both fields travel together.
 */
export interface OrganizationMcpPolicy {
  mode: OrganizationMcpPolicyMode;
  /** Refuse an OAuth authorization server that does not implement RFC 9207. */
  strictIssuer: boolean;
}
