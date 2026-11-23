import type { ComponentType, ReactNode } from 'react';
import type { AxiosError } from 'axios';
import type { Reducer } from '@reduxjs/toolkit';
import type { CreateProjectStep } from '@/components/molecules/modal/create-project-modal/createProjectSteps';
import type { ProjectGeneralSettingsProps } from '@/components/organismes/project-settings/GeneralSettings';
import type { IntegrationCard } from '@/utils/data/integrationData';
import type { AttributionPayload } from '@/server/interfaces/Organization';

/** What a container-scan start answers, as the container results page reads it. */
export interface ContainerScanStartAnswer {
  success?: boolean;
  scanId?: string;
}

/**
 * The Add Container Image modal's props, as the container results page holds
 * them: its public-image scan, and `runScan`, which closes the modal, shows
 * the page's scan loader and follows the scan the closed extension's `start`
 * call answers (no scan id, or a failure, closes the loader).
 */
export interface ContainerRegistriesAddImageModalProps {
  onClose: () => void;
  onAddImage: (image: string) => void;
  runScan: (image: string, start: () => Promise<ContainerScanStartAnswer | null | undefined>) => void;
  onConnectGitHub?: () => void;
  projectId?: string;
  /** The branch the page shows, which a scan is recorded on (none: the server decides). */
  branch?: string;
}

/**
 * The container registries' UI (cloud only): one credential modal for
 * the organisation's integrations page (switched by the `?openRegistry=`
 * value) and the Add Container Image modal of the container results page.
 * The Community Edition never connects a registry — its container results
 * enter as a SARIF import — so activeExtensions() answers none and both
 * pages render neither dialog.
 */
export interface ContainerRegistriesExtension {
  CredentialModal: ComponentType<{ type: string; onClose: () => void }>;
  AddImageModal: ComponentType<ContainerRegistriesAddImageModalProps>;
}

/** What the eager `import.meta.glob` of one language's locale fragments returns. */
export type LocaleModules = Record<string, unknown>;

export interface AccountMenuRowsProps {
  name: string;
  email: string;
  avatarSrc?: string | null;
  onClose: () => void;
  onLogout: () => void;
}

export interface ProductSpace {
  id: string; // 'appsec' is the core's own
  prefix: string; // '/appsec'
  order: number; // position in the switch, lower first
  labelKey: string; // i18n key of the space's name
  Frame?: ComponentType<{ currentPath: string; children: ReactNode }>; // replaces the AppSec chrome in Layout
  Mark?: ComponentType<{ className?: string }>; // the loader and failure-page mark
  /** The space's brand lockup (mark and name), in the failure page's header; the CybeDefend logo without one. */
  Lockup?: ComponentType<{ className?: string }>;
  /** The start-loader's status lines of this space; the core spaces carry their own. */
  loaderStatusKeys?: readonly string[];
  /**
   * The skin of the core pages the space shows (project tabs, page titles,
   * settings tabs): `zinc` draws them on the zinc kit; without it they keep
   * the Platform's own.
   */
  skin?: 'zinc';
  /**
   * The rows of the shell's account menu in this space, Logout last (it calls
   * `onLogout`); without it the Platform's menu.
   */
  AccountMenuRows?: ComponentType<AccountMenuRowsProps>;
  /** The onboarding usage answers whose account starts in this space when nothing else decides (`productFromUsage`). */
  landingUsage?: readonly string[];
  /**
   * `false`: the space's projects are not scanned for findings here. Its
   * project wizard ends on the basics (no security-context step), and its
   * project settings leave out what only drives a scan or scores its findings
   * (Scanning, Notifications, Issues, the application type, the reference
   * branch, the scan on every commit, the security context but its compliance
   * frameworks). Without it the space shows them all.
   */
  findingSettings?: false;
  /**
   * The wizard's steps once the project exists, in `order`: the wizard opened
   * in this space stays open on them. Without any, it closes on creation.
   */
  createProjectSteps?: readonly CreateProjectStep[];
  /** What the wizard says, before an import is sent, of the analysis an import starts. */
  CreateProjectImportNotice?: ComponentType;
  /** The General section of the project settings in this space; without it the core's. */
  ProjectGeneralSettings?: ComponentType<ProjectGeneralSettingsProps>;
  /**
   * The page holding the space's create-project wizard, which opens it on
   * `?newProject=<provider>` after a connection started from it; without it
   * the space's home.
   */
  newProjectPath?: string;
  /** The integration cards this space adds to the organisation's catalogue, after the core's. */
  integrationCards?: readonly IntegrationCard[];
  /** The URL segments of the space's own project tabs, each with its key under `navigation.breadcrumb.*`. */
  breadcrumbSegments?: Readonly<Record<string, string>>;
  /** The glyphs of the space's own project tabs, by tab key (`projectSectionIcon`). */
  sectionIcons?: Readonly<Record<string, ComponentType<{ className?: string }>>>;
}

/** A subscription as the core reads it: its status alone. */
export interface SubscriptionStatusLike {
  status?: string;
}

/** An organisation as the onboarding pages hand it to the billing rule. */
export interface OnboardingOrganizationLike {
  subscription?: SubscriptionStatusLike | null;
  products?: ReadonlyArray<{ product: string; status: string }> | null;
  myRole?: string | null;
}

/** What a feature check answers (`useFeatureAccess`). */
export interface FeatureAccessAnswer {
  allowed: boolean;
  reason?: string;
  requiredPlan?: string;
}

/** The compact upgrade banner of a gated page in preview mode (`FeatureGate`). */
export interface FeatureUpgradeBannerProps {
  featureLabel?: string;
  /** The plan the billing answer named, which wins when it is a plan the edition knows. */
  billingPlan?: string;
  /** The page's own guess of the plan that unlocks the feature. */
  requiredPlan?: string;
}

/** The overlay over a card the organisation's plan does not include. */
export interface UpgradePlanOverlayProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  minHeight?: 'sm' | 'md' | 'lg';
}

/**
 * What the organisation's plan allows, as the core's pages ask: whether the
 * organisation is read-only, whether shared writes (a project, an invitation,
 * a team) are open, which features the plan leaves out, and whether it
 * reaches the plan a step names. Read with `useEditionEntitlements()`; the
 * Community Edition answers NEUTRAL_ENTITLEMENTS (nothing blocked or locked).
 */
export interface EditionEntitlements {
  writesBlocked: boolean;
  writableAny: boolean;
  disabledFeatures: ReadonlySet<string>;
  planIncludes(requiredPlan: string): boolean;
}

/**
 * The organisation's plan and subscription, as the core asks about them:
 * whether a subscription suspends the pages, where the onboarding sends an
 * existing organisation, which features the plan includes, its limits, and
 * the prompts that offer an upgrade. Without it (the Community Edition) no
 * subscription suspends anything, every feature is available and no limit
 * applies.
 */
export interface BillingExtension {
  /** True when the subscription blocks the organisation's pages (the shell then narrows its navigation). */
  isSubscriptionSuspended(subscription: SubscriptionStatusLike | null | undefined): boolean;
  /** Where the onboarding pages send a member of an existing organisation instead of the landing, or null. */
  onboardingRedirect(organization: OnboardingOrganizationLike): string | null;
  /** The entitlements of an organisation (the profile's), the products the edition knows given. */
  entitlementsOf(organization: unknown, knownProducts: readonly string[]): EditionEntitlements;
  /** Whether a feature is available on the organisation's plan. */
  checkFeatureAccess(organizationId: string, feature: string): Promise<FeatureAccessAnswer>;
  /** The organisation's entitlements (the plan's limits). */
  fetchEntitlements(organizationId: string): Promise<unknown>;
  /** The closed lists of reasons a plan change is refused with, each read as a translated sentence. */
  readonly planChangeReasons: { quantities: readonly string[]; transition: readonly string[] };
  UpgradeBanner: ComponentType<FeatureUpgradeBannerProps>;
  UpgradePlanOverlay: ComponentType<UpgradePlanOverlayProps>;
}

/** AppSec seats as billing counts them, against what the plan allows. */
export interface AppsecSeatsCount {
  inUse: number;
  allowance: number;
}

/** Where a member-products refusal happened: full AppSec seats leave a different way out in each. */
export type MemberProductsRefusalContext = 'invite' | 'products' | 'role';

/** The products part of the invitation and edit forms (`MemberProductsExtension.Field`). */
export interface MemberProductsFieldProps {
  /** Tells the boxes of two fields apart on one page. */
  idPrefix: string;
  /** The products offered, one box each, in display order. */
  offered: readonly string[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  /** The creator or an administrator: every box checked and locked. */
  locked: boolean;
  /** AppSec seats as billing counts them; null while unknown (never « full »). */
  appsecSeats: AppsecSeatsCount | null;
  /** The member already holds AppSec: taking it away frees a seat, so full seats do not lock it. */
  holdsAppsec?: boolean;
  /** A `billing` holder: full seats link to the Platform billing page. */
  canAddSeats: boolean;
  /** The organisation's per-member products switch is known to be off. */
  switchedOff?: boolean;
}

/**
 * Per-member products: each member, and each pending invitation, holds some
 * of the organisation's products, and AppSec takes a seat. The member screens
 * and the selectors read it here. Without it (one product, no seat) a member
 * holds no listed product, and nothing is refused for a product.
 */
export interface MemberProductsExtension {
  /** The closed list of refusals of the invitation, member-products and role routes. */
  readonly refusals: readonly string[];
  /** The products a list from the API names, in display order, once each. */
  heldProducts(list: unknown): string[];
  /** The creator and the administrators hold every product. */
  isAdministratorRole(role: string | null | undefined): boolean;
  /** Whether the member may use the product: true, false, or null (unknown). */
  memberHasProduct(organization: unknown, product: string): boolean | null;
  /** The organisation's per-member products switch is known to be off. */
  switchedOff(organization: unknown): boolean;
  /** The refusal code an HTTP error carries, or null. */
  refusalOf(error: unknown): string | null;
  /** The translation key of a refusal, in the context it happened in. */
  refusalKey(code: string, context: MemberProductsRefusalContext): string;
  /** No AppSec seat is left. Unknown seats are not full. */
  seatsFull(seats: AppsecSeatsCount | null | undefined): boolean;
  /** The AppSec seats as billing counts them, read only when `enabled`. */
  useAppsecSeats(organizationId: string, enabled: boolean): { seats: AppsecSeatsCount | null; refresh: () => void };
  /** Sets a member's products; a refusal rejects with the HTTP error, read through `refusalOf`. */
  updateProducts(organizationId: string, userId: string, products: readonly string[]): Promise<unknown>;
  Field: ComponentType<MemberProductsFieldProps>;
}

export interface ProductRouteGuardProps {
  product: string;
  billingPage?: boolean;
  children: ReactNode;
}

/** The ad-landing marker the closed tree captures at boot; the core reads only its presence and its locale. */
export interface AdSignupMarker {
  locale: string;
}

/** The one-shot marketing captures that ride the org-create payload. */
export interface OrgCreateExtras {
  attribution?: AttributionPayload;
  intendedPlan?: string;
  leadId?: string;
}

/**
 * The closed tree's sign-up captures (closed extension). Without it (the
 * Community Edition, where no boot hook ever ran a capture) no marker exists,
 * no extra rides the org-create payload and nothing else runs.
 */
export interface MarketingExtension {
  /** The ad-landing marker, when one was captured at boot. */
  readAdSignup(): AdSignupMarker | null;
  clearAdSignup(): void;
  /** The ad lead's one sequence for this page load; resolves at once without a marker. */
  ensureAdSignupLead(): Promise<void>;
  /** Asks for the « connect » e-mail; never throws. */
  sendConnectLink(locale: string): Promise<'sent' | 'cooldown' | 'failed'>;
  /** The captured org-create extras: merged attribution, intended plan, lead id. */
  readOrgCreateExtras(): OrgCreateExtras;
  /** Consume the one-shot captures once an organisation was created. */
  clearOrgCreateCaptures(): void;
  /** Link the analytics profile to the signed-in user. */
  identify(userId: string): void;
  /** The ad visitor's automatic organisation creation (the claim, the naming, the reload). */
  readonly adAutoCreate: {
    readonly leadWaitMaxMs: number;
    claimRemainingMs(): number;
    claim(): void;
    release(): void;
    nameFromEmail(email: string | null | undefined): string | null;
    reloadPage(): void;
  };
}

/**
 * The entry link's product space (`?source=`), captured at boot and kept for
 * the tab's session. Without it (the Community Edition) no link names a space,
 * and the landing rule decides without one.
 */
export interface EntrySourceExtension {
  /** Read `?source` from the current URL and keep it when it names a known space. */
  capture(): void;
  /** The kept entry source, or null. */
  read(): string | null;
  /** Drop it: an entry link decides one landing, never a later one. */
  clear(): void;
  /** `search` without its entry source, every other pair kept as it is. */
  without(search: string): string;
}

/**
 * A column a results table adds after its CVSS column (`useResultColumns`),
 * shown or hidden per project. Its visibility is kept under `storageKey`, so a
 * choice made before the column moved here survives.
 */
export interface ResultColumnExtension {
  id: string;
  /** The finding types whose table shows it (`sca`, …). */
  vulnerabilityTypes: readonly string[];
  /** The header's and the column-settings item's label. */
  labelKey: string;
  storageKey: (projectId: string) => string;
  defaultVisible: boolean;
  Cell: ComponentType<{ vulnerability: unknown }>;
}

/**
 * A view the SCA page adds to its own (vulnerabilities 10, packages 20,
 * licences 30): a tab that lists the vulnerabilities its flags ask the list
 * routes for, with its count, its banner and its row badge.
 */
export interface ScaViewExtension {
  id: string;
  labelKey: string;
  order: number;
  /** Merged into both list hooks' options, for every view: `active` is true while this view is shown. */
  requestFlags: (active: boolean) => Record<string, boolean>;
  /** Its count, read from the active list hook's result. */
  countOf: (list: { malwareCount?: number }) => number;
  /** The table drops its CVSS column and labels the id column « Advisory ». */
  noCvss: boolean;
  /** The tab button's classes beyond the segment's own, picked or not. */
  tabClassName?: (active: boolean) => string;
  TabCount: ComponentType<{ count: number }> | null;
  /** Shown above the list while the view is picked. */
  Banner: ComponentType<{ count: number }> | null;
  /** Shown on a row of both SCA tables, in every view (`layout`: a detailed row or a group). */
  RowBadge: ComponentType<{ vulnerability: unknown; layout?: 'row' | 'group' }> | null;
}

/**
 * Everything the closed tree adds to the core: locale fragments, product
 * spaces, the route guard, boot hooks, effects, reducers, API interceptors and
 * the auth provider. The core reads them through `active.ts`, which returns
 * EMPTY_EXTENSIONS in a community build, so a private build with
 * VITE_EDITION=community behaves like the exported tree.
 */
export interface EeExtensions {
  locales: { en: LocaleModules; fr: LocaleModules };
  products: readonly ProductSpace[];
  ProductRouteGuard: ComponentType<ProductRouteGuardProps> | null;
  boot: ReadonlyArray<() => void>; // run once by index.tsx before render
  AppEffects: ComponentType | null; // mounted once inside <App/>
  ShellEffects: ComponentType<{ product: string }> | null; // mounted once inside <Layout/>
  ShellQuestions: ComponentType | null; // the shell's onboarding questions (community: the core's unasked-profile recorder)
  reducers: Readonly<Record<string, Reducer>>; // added to the store at creation
  responseInterceptors: ReadonlyArray<(error: AxiosError) => boolean>; // true = handled; the error is still rejected
  AuthProvider: ComponentType<{ children: ReactNode }> | null; // wraps <App/> (cloud: the identity provider)
  billing: BillingExtension | null; // the plan and subscription (community: none)
  memberProducts: MemberProductsExtension | null; // per-member products and AppSec seats (community: none)
  marketing: MarketingExtension | null; // the ad-landing marker, attribution, lead and auto-create (community: none)
  entrySource: EntrySourceExtension | null; // the entry link's product space (community: none)
  publicApiUrl: string | null; // the public API the guides name (community: the instance's own `/api`)
  supportUrl?: string | null; // where « Contact support » goes (community: the public project's issues)
  resultColumns?: readonly ResultColumnExtension[]; // the results tables' extra columns (community: none)
  scaViews?: readonly ScaViewExtension[]; // the SCA page's extra views (community: none)
  containerRegistries?: ContainerRegistriesExtension | null; // the registry dialogs (community: none)
}

export const EMPTY_EXTENSIONS: EeExtensions = {
  locales: { en: {}, fr: {} },
  products: [],
  ProductRouteGuard: null,
  boot: [],
  AppEffects: null,
  ShellEffects: null,
  ShellQuestions: null,
  reducers: {},
  responseInterceptors: [],
  AuthProvider: null,
  billing: null,
  memberProducts: null,
  marketing: null,
  entrySource: null,
  publicApiUrl: null,
  supportUrl: null,
};
