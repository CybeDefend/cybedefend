import { AnimatePresence, motion } from "framer-motion";
import { destinationIcon } from '@/components/atoms/icon/destinationIcons';
import React, { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { Link, useLocation } from "react-router-dom";
import { Logo } from "../../../atoms/logo/Logo";
import OrganizationSelectorModal from "../../modal/organization-selector-modal/OrganizationSelectorModal";
import { BottomSidebar } from "../bottom-sidebar/BottomSidebar";
import { AuthorizedContent } from "react-rebac";
import { useTranslation } from "react-i18next";
import useTheme from "../../../../server/hooks/useTheme";
import useDisabledFeatures from "../../../../server/hooks/useDisabledFeatures";
import { cn } from "@/utils/function/utils";
import { OnboardingProgress } from "@/components/molecules/onboarding-progress/OnboardingProgress";
import { useOverflowing } from "@/utils/hooks/useOverflowing";
import { useMinWidth } from "@/utils/hooks/useMinWidth";
import { ChevronDown, Cog, Lock, Rocket, Sitemap, UserGear, Users } from '@/components/atoms/icon/icons';
import { ACTIVE_EXTENSIONS } from '@/edition/active';
import { EDITION } from '@/edition/edition';
import CloudSidebarCard from '@/edition/upsell/CloudSidebarCard';
import { useCloudCardDismissed } from '@/edition/upsell/cloudCardDismissal';
import { getRolePermissions } from '@/utils/data/rolePermissions';
import { APPSEC_PROJECTS_PATH, appsecPath, productHome, useProduct } from "@/utils/product";
import { useSlotEntries, type SlotContext } from "@/edition/slots";
import { AS_FOCUS_RAIL } from "@/components/atoms/appsec/styles";
import { useBreadcrumbProjectName } from "../../breadcrumbs/BreadcrumbProjectContext";
import { useKnownProjects } from "@/server/services/railSnapshot";
import RailAvatar from "./RailAvatar";
import RailProjectSection from "./RailProjectSection";
import RailRecentProjects from "./RailRecentProjects";
import { appsecProjectIdFromPath } from "./projectRail";
import { RAIL_BLACK, RAIL_EYEBROW, RAIL_HAZE, RAIL_LOGO_FIT, RAIL_LOGO_ROOM, RAIL_LOGO_SLOT, RAIL_RAISED, RAIL_ROW_IDLE, railLogoSlotStyle } from "./railStyles";
import { pickRecentProjects, readRecentProjectIds, recordRecentProject } from "./recentProjects";
import { useRailFit } from "./useRailFit";
import { useHoldsLink } from "./useHoldsLink";

/** The AppSec pages the rail leads to, each built by the URL contract. */
const APPSEC_HOME = productHome("appsec");
const APPSEC_OVERVIEW = appsecPath("/organization/overview");
const APPSEC_REPORTS = appsecPath("/reports");
/** The Platform's « Usage & billing » page of an edition that bills: an entry of the settings menu, which it marks active. */
const APPSEC_BILLING = appsecPath("/billing");

/** True on `page`, written with or without a trailing slash: the router serves both. */
export const isOn = (pathname: string, page: string): boolean =>
  pathname === page || pathname === `${page}/`;

/*
 * The AppSec rail: the navy and the violet wash are
 * kept, the rows take the zinc kit's metrics (32 px, 13 px, a 16 px glyph
 * slot, no tile), 44 px below md. The active row keeps `from-secondary/20`.
 * A row is at least 32 px rather than exactly: « Vue d'ensemble de
 * l'Organisation » does not fit one line of the 260 px rail and wraps, as it
 * always did, instead of losing its last word.
 */
const AS_RAIL_ROW = cn(
  "group relative flex min-h-8 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium leading-5 transition-colors duration-[120ms] max-md:min-h-11",
  AS_FOCUS_RAIL,
);
const AS_RAIL_ACTIVE = "bg-gradient-to-r from-secondary/20 to-transparent text-white";
/** An idle row: zinc-300, white on a 6 % white fill under the pointer (`railStyles`). */
const AS_RAIL_IDLE = RAIL_ROW_IDLE;
/** The 16 px slot the glyph sits in, where the tile used to be. */
const AS_RAIL_SLOT = "flex h-4 w-4 shrink-0 items-center justify-center transition-colors duration-[120ms]";
/**
 * The glyph of the current entry (a navigation row, the settings foot, a row
 * of its menu), in the accent, the one shade the rail's bars use. On
 * the rail — dark in both themes, `data-surface="dark"` — the token is already
 * its dark-surface shade, meant for graphics, so it carries no `dark:`
 * companion (the guard's allowance for this file counts it, once, here).
 */
const AS_RAIL_ICON_ACTIVE = "text-secondary";
/** The eyebrow of a section, shared with the rail's other sections (`railStyles`). */
const AS_RAIL_GROUP = RAIL_EYEBROW;

interface NavItemProps {
  icon?: any;
  /** Optional custom React node rendered in place of the FontAwesome icon. */
  customIcon?: React.ReactNode;
  label: string;
  href: string;
  isActive: boolean;
  badge?: string;
  isNew?: boolean;
  /** When true the item is visually locked (Developer plan gate). */
  isLocked?: boolean;
}

/** A row of the rail's navigation; the registrations of `app.sidebar.items` draw theirs with it. */
export const NavItem: React.FC<NavItemProps> = ({ icon, customIcon, label, href, isActive, badge, isNew, isLocked }) => {
  const { t } = useTranslation();

  if (isLocked) {
    return (
      <Link
        to={href}
        className={cn(AS_RAIL_ROW, "opacity-50 hover:opacity-70", isActive ? AS_RAIL_ACTIVE : AS_RAIL_IDLE)}
        title={t('billing.upgrade_to_pro')}
      >
        <div className={cn(AS_RAIL_SLOT, "text-zinc-500")}>
          {customIcon ? customIcon : React.createElement(icon, { className: "w-3.5 h-3.5" })}
        </div>
        <span className="min-w-0 flex-1 text-zinc-400">{label}</span>
        <Lock className="w-3.5 h-3.5 text-zinc-500"  />
      </Link>
    );
  }

  return (
    <Link
      to={href}
      className={cn(AS_RAIL_ROW, isActive ? AS_RAIL_ACTIVE : AS_RAIL_IDLE)}
    >
      {/* Active indicator */}
      {isActive && (
        <motion.div
          layoutId="nav-indicator"
          className="absolute left-0 inset-y-0 my-auto h-4 w-0.5 rounded-full bg-secondary"
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
        />
      )}

      <div
        className={cn(AS_RAIL_SLOT, isActive ? AS_RAIL_ICON_ACTIVE : "text-zinc-500 group-hover:text-zinc-300")}
      >
        {customIcon ? customIcon : React.createElement(icon, { className: "w-3.5 h-3.5" })}
      </div>

      <span className="min-w-0 flex-1">{label}</span>

      {badge && (
        <span className="rounded-md bg-secondary/20 px-1.5 py-px font-mono text-xs tabular-nums text-secondary-light">
          {badge}
        </span>
      )}

      {isNew && (
        <span className="shrink-0 text-[11px] font-medium leading-4 text-zinc-400">
          {t('navigation.sidebar.new')}
        </span>
      )}
    </Link>
  );
};

interface SettingsMenuProps {
  isOpen: boolean;
  onClose: () => void;
  selectedOrganization: any;
  /**
   * When the org's subscription is suspended every settings page except
   * billing is a dead end — the guard in App.tsx bounces them.
   */
  isSuspended?: boolean;
  /** The organisation `billing` permission, read through `getRolePermissions`. */
  canManageBilling: boolean;
  /** The entries the closed areas add after the organisation's own (`app.sidebar.items`, orders 400 to 499). */
  extraEntries?: (onClose: () => void) => React.ReactNode;
}

interface SettingsMenuItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
  /** Gated through Permify's react-rebac on these relations. */
  relationships?: string[];
  /**
   * Gated on the organisation `billing` permission instead; with
   * `relationships` as well, shown to a `billing` holder and otherwise to
   * those relations.
   */
  billing?: boolean;
}

/** One row of the settings menu; the registrations of `app.sidebar.items` (orders 400 to 499) draw theirs with it. */
export const SettingsMenuRow: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
  onClose?: () => void;
}> = ({ icon: Icon, label, href, onClose }) => {
  const location = useLocation();
  return (
    <Link
      to={href}
      onClick={onClose}
      className={cn(
        "group relative flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium transition-colors duration-[120ms] max-md:h-11",
        AS_FOCUS_RAIL,
        location.pathname === href
          ? "bg-white/[0.08] text-white"
          : "text-zinc-300 hover:bg-white/[0.06] hover:text-white"
      )}
    >
      <div
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center transition-colors duration-[120ms]",
          location.pathname === href ? AS_RAIL_ICON_ACTIVE : "text-zinc-500 group-hover:text-zinc-300"
        )}
      >
        <Icon className="w-3.5 h-3.5"  />
      </div>
      {/* The current row: its wash and its violet glyph, no dot. */}
      <span className="truncate">{label}</span>
    </Link>
  );
};

const SettingsMenu: React.FC<SettingsMenuProps> = ({ isOpen, onClose, selectedOrganization, isSuspended = false, canManageBilling, extraEntries }) => {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  /*
   * The organisation's settings, then what the closed areas add (`extraEntries`:
   * a billing edition's money pages). An entry gated on
   * `billing` mirrors Permify's `permission billing = billing_manager or
   * creator or administrator` (schema.perm) through `getRolePermissions`: a
   * role list once hid billing from `billing_manager` and advertised it to
   * `manager`, who only earns a 403. While the org is suspended the menu is
   * narrowed to the added entries (its billing pages, the way out), so a
   * `billing_manager` must still find them.
   */
  const allSettingsItems: SettingsMenuItem[] = [
    {
      icon: Users,
      label: t("components.sidebar.organizationSettings"),
      href: "/organization/settings",
      relationships: ["creator", "administrator", "manager", "member"],
    },
    {
      icon: UserGear,
      label: t("components.sidebar.teamsSettings"),
      href: "/organization/settings/teams",
      relationships: ["creator", "administrator", "manager", "member"],
    },
    {
      icon: Sitemap,
      label: t("components.settingsWrapper.tabs.integrations"),
      href: "/organization/settings/integrations",
      relationships: ["creator", "administrator", "manager"],
    },
  ];

  // While suspended only the added entries (the billing pages a suspended
  // organisation keeps) stay.
  const settingsItems = allSettingsItems
    .filter((item) => !item.billing || canManageBilling || !!item.relationships)
    .filter(() => !isSuspended);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className={cn("absolute bottom-full left-0 right-0 mb-2 mx-3 overflow-hidden rounded-lg border border-white/[0.08] shadow-[0_16px_40px_-8px_rgb(0_0_0/0.7)] z-50", RAIL_RAISED)}
        >
          {/* Header */}
          <div className="flex h-9 items-center gap-2 px-3 border-b border-white/[0.08]">
            <Cog className="w-3.5 h-3.5 text-secondary"  />
            <span className="text-[11px] font-medium text-zinc-400">
              {t("navigation.settings")}
            </span>
          </div>

          {/* Settings List */}
          <div className="p-1 max-h-[280px] overflow-y-auto">
            {settingsItems.map((item) => {
              const row = <SettingsMenuRow icon={item.icon} label={item.label} href={item.href} onClose={onClose} />;
              // A `billing` holder needs no relation for an entry that also opens to `billing`.
              return item.relationships && !(item.billing && canManageBilling) ? (
                <AuthorizedContent
                  key={item.href}
                  entityId={selectedOrganization?.id}
                  entityType="organization"
                  relationship={item.relationships}
                >
                  {row}
                </AuthorizedContent>
              ) : (
                <React.Fragment key={item.href}>{row}</React.Fragment>
              );
            })}
            {extraEntries?.(onClose)}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export const SidebarContent: React.FC = () => {
  const { t } = useTranslation();
  const { isDarkMode, toggleTheme } = useTheme();

  const [isOrgModalOpen, setIsOrgModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const selectedOrganization = useSelector(
    (state: any) => state.organization.selectedOrganization
  );
  const disabledFeatures = useDisabledFeatures();
  const orgButtonRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const product = useProduct();
  const scrollerRef = useRef<HTMLDivElement>(null);
  // The fade at the foot of the list shows only while part of it is out of sight.
  const isNavOverflowing = useOverflowing(scrollerRef);

  /*
   * The AppSec rail's sections,
   * read from what the pages already loaded: the rail asks the API for
   * nothing, and repeats no figure of the main page (a posture block was
   * tried and removed: it repeated the home and made the rail scroll). The
   * current project is the one of the URL, named as the page published it
   * for the breadcrumb (else as the project list read it); the recent
   * projects are ids this browser remembers, shown only when the loaded
   * list knows them.
   */
  const appsecProjectId = product === "appsec" ? appsecProjectIdFromPath(location.pathname) : null;
  const publishedProjectName = useBreadcrumbProjectName();
  const knownProjects = useKnownProjects(selectedOrganization?.id);
  const [recentProjectIds, setRecentProjectIds] = useState<string[]>(readRecentProjectIds);
  useEffect(() => {
    if (!appsecProjectId) return;
    recordRecentProject(appsecProjectId);
    setRecentProjectIds(readRecentProjectIds());
  }, [appsecProjectId]);
  const recentProjects = pickRecentProjects(recentProjectIds, knownProjects, appsecProjectId);
  const currentProjectName: string | null =
    publishedProjectName ?? (appsecProjectId ? knownProjects.get(appsecProjectId)?.name : undefined) ?? null;

  // The organisation header block: the name, then what the closed areas add
  // under it (`app.sidebar.items`, orders 300 to 399: a billing edition's
  // plan line).
  const organizationName: string = selectedOrganization?.name || t("components.sidebar.selectOrganization");

  /**
   * While the org's subscription is suspended the guard in App.tsx bounces
   * every route except billing, the suspended page, the account pages and
   * logout. Leaving the rest of the rail visible would offer links that only
   * bounce back — the entries are hidden rather than disabled so the sidebar
   * shows what is actually reachable.
   *
   * What stays: the organization switcher (so the user can move to a healthy
   * org), the footer rail, and — for someone holding `billing` — the settings
   * menu narrowed to billing. `getRolePermissions` mirrors Permify; never
   * hardcode a role list here.
   */
  // The suspension is the AppSec subscription's: the guard bounces AppSec pages
  // only, so in another space (and on a common page shown in it) the rail
  // stays whole.
  const isSuspended: boolean =
    product === 'appsec' &&
    (ACTIVE_EXTENSIONS.billing?.isSubscriptionSuspended(selectedOrganization?.subscription) ?? false);
  const canManageBilling: boolean = getRolePermissions(
    'organization',
    selectedOrganization?.myRole || '',
  ).includes('billing');

  /*
   * What the closed areas add to the rail (`app.sidebar.items`), by band of
   * order: below 100 under the organisation (the product switch), 100 to 199
   * in the Security group before Reports, 200 to 299 under the rail's sections
   * (the plan's status), all of them hidden while suspended like the rest of
   * the navigation; 300 to 399 under the organisation's name, 400 to 499 in
   * the settings menu, 1000 to 1099 at the end of the navigation.
   */
  const sidebarItems = useSlotEntries("app.sidebar.items");
  const [defendGroup, setDefendGroup] = useState<HTMLDivElement | null>(null);
  const defendHasEntries = useHoldsLink(defendGroup);
  const sidebarContext: SlotContext = { organizationId: selectedOrganization?.id, product };
  const sidebarBand = (from: number, to: number, context: SlotContext = sidebarContext): React.ReactNode[] =>
    sidebarItems
      .filter((item) => item.order >= from && item.order < to)
      .map((item) => <React.Fragment key={item.id}>{item.render(context)}</React.Fragment>);

  /*
   * The desktop rail never scrolls: what the window cannot
   * hold is left out, Recent projects first (a row at a time), then the
   * current project, decided from heights the browser measured (`useRailFit`), so the
   * navigation, Settings, Help and the account row always show. The phone
   * drawer scrolls, as a drawer does, its bar hidden and the fade at its foot.
   */
  const isDesktopRail = useMinWidth(976);
  const isCommunity = EDITION === "community";
  const contentRef = useRef<HTMLDivElement>(null);
  // The Community rail's « CybeDefend Cloud » card: the first thing a short
  // window leaves out. The cloud's rail has none, and asks nothing about it.
  const cloudCardDismissed = useCloudCardDismissed();
  const railFit = useRailFit(scrollerRef, contentRef, {
    enabled: isDesktopRail && product === "appsec" && !isSuspended,
    wantProject: appsecProjectId !== null,
    recentCount: recentProjects.length,
    logoRoom: RAIL_LOGO_ROOM,
    ...(isCommunity && { wantCloudCard: !isSuspended && !cloudCardDismissed }),
  });
  const showCloudCard = isCommunity && railFit.cloudCard === true;
  const showCurrentProject = !isSuspended && product === "appsec" && appsecProjectId !== null && railFit.project;
  const shownRecentProjects = !isSuspended && product === "appsec" ? recentProjects.slice(0, railFit.recentRows) : [];
  const showRecentProjects = shownRecentProjects.length > 0;

  const handleCloseOrgModal = () => setIsOrgModalOpen(false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        orgButtonRef.current &&
        !orgButtonRef.current.contains(event.target as Node) &&
        !document.querySelector(".modal-content")?.contains(event.target as Node)
      ) {
        setIsOrgModalOpen(false);
      }
    };

    if (isOrgModalOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOrgModalOpen]);

  // Check if any settings page is active (excluding policies which is now in
  // main nav); the Platform's « Usage & billing » is an entry of its menu.
  const isSettingsActive =
    (location.pathname.startsWith("/organization/settings") &&
      !location.pathname.startsWith("/organization/settings/policies")) ||
    isOn(location.pathname, APPSEC_BILLING);

  return (
    <div className={cn("flex h-full flex-col", RAIL_BLACK, RAIL_HAZE)}>
      {/* Logo: the CybeDefend wordmark, leading to the home of the Platform. The
          logo slot is centred, the wordmark breathing with the window
          (`railLogoSlotStyle`). */}
      <div
        data-testid="rail-logo-slot"
        className={cn(RAIL_LOGO_SLOT, RAIL_LOGO_FIT)}
        style={railLogoSlotStyle(railFit.logoAir)}
      >
        <Logo />
      </div>

      {/* The organisation and the product: two controls that read differently. In AppSec the
          organisation comes first, as a header block — the avatar disc, the
          name, the plan beneath, a chevron — then, under a hairline and 12 px
          of air, the product under its « Product » eyebrow: the organisation
          is the broader context. The switch (a registration of `app.sidebar.items`) is hidden
          while suspended, like the rest of the navigation; the organisation
          stays, so the user can move to a healthy one. A space with its own
          frame has no rail: Layout renders its shell. */}
      <div className="px-3 pb-2">
        <button
          ref={orgButtonRef}
          onClick={() => setIsOrgModalOpen(!isOrgModalOpen)}
          className={cn("group relative flex min-h-10 w-full items-center gap-2.5 rounded-lg border border-white/[0.08] px-2 py-1 text-left transition-colors duration-[120ms] hover:bg-white/[0.06] max-md:min-h-11", isOrgModalOpen ? "bg-white/[0.06]" : "bg-white/[0.03]", AS_FOCUS_RAIL)}
        >
            <>
              {/* The 24 px disc: the organisation's initials (no picture is
                  held for an organisation). The label stays for assistive
                  technology: the block reads « Organization Acme Corp, Scale,
                  25 seats ». */}
              <RailAvatar name={organizationName} />
              <span className="min-w-0 flex-1">
                <span className="sr-only">{t('navigation.sidebar.organizationLabel')}</span>
                <span className="block truncate text-[12px] font-medium leading-4 text-white" title={organizationName}>
                  {organizationName}
                </span>
                {sidebarBand(300, 400)}
              </span>
              {/* A panel opens under the block: the chevron points down, and turns while it is open. */}
              <ChevronDown
                className={cn("h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform duration-150", isOrgModalOpen && "rotate-180")}
              />
            </>
        </button>
      </div>

      {!isSuspended && sidebarBand(0, 100)}

      <AnimatePresence>
        {isOrgModalOpen && (
          <OrganizationSelectorModal
            onClose={handleCloseOrgModal}
            triggerRef={orgButtonRef}
            surface="dark"
          />
        )}
      </AnimatePresence>

      {/* Navigation. The rail shows no scroll bar: on a desktop it fits (`useRailFit`), and where it must
          scroll — the phone drawer, a window shorter than the navigation — the
          fade at its foot, with the room it needs, says there is more. The
          content is one block, so the fit can measure it. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollerRef}
        className={cn("scrollbar-hide min-h-0 flex-1 overflow-y-auto px-3", isNavOverflowing ? "pb-6" : "pb-2", isCommunity && "flex flex-col")}
      >
      <div ref={contentRef} className={isCommunity ? "flex grow flex-col" : undefined}>
        {!isSuspended && (
        <nav className="space-y-0.5">
          {/* The two blocks used to be separated by a bare gradient rule, which
              marks a boundary without saying what changes across it. */}
          <p className={AS_RAIL_GROUP}>
            {t('navigation.sidebar.groupOverview')}
          </p>
          {/* In Community the home is « Get started »: it opens the section,
              current on the home alone, and the list has its own URL. The cloud's home is the list. */}
          {isCommunity && (
            <NavItem
              icon={Rocket}
              label={t("components.sidebar.getStarted")}
              href={APPSEC_HOME}
              isActive={isOn(location.pathname, APPSEC_HOME)}
            />
          )}
          <NavItem
            icon={destinationIcon(APPSEC_HOME)}
            label={t("components.sidebar.manageProjects")}
            href={isCommunity ? APPSEC_PROJECTS_PATH : APPSEC_HOME}
            isActive={isOn(location.pathname, isCommunity ? APPSEC_PROJECTS_PATH : APPSEC_HOME)}
          />

          <AuthorizedContent
            entityId={selectedOrganization?.id}
            entityType="organization"
            relationship={["creator", "administrator"]}
          >
            <NavItem
              icon={destinationIcon(APPSEC_OVERVIEW)}
              label={t("components.sidebar.organizationOverview")}
              href={APPSEC_OVERVIEW}
              isActive={isOn(location.pathname, APPSEC_OVERVIEW)}
            />
          </AuthorizedContent>

          {/* The Defend group shows only while it holds an entry:
              every entry is role-gated, and a member of an Open Source
              organisation, like a billing manager in the cloud, sees none of
              them. Each entry carries its own authorisation, the closed
              areas' included, so the group reads what it renders. */}
          <div ref={setDefendGroup} data-rail-group="defend" hidden={!defendHasEntries} className="space-y-0.5">
          <div className="py-1.5">
            <div className="h-px bg-white/[0.08]" />
          </div>
          <p className={AS_RAIL_GROUP}>
            {t('navigation.sidebar.groupSecurity')}
          </p>

          {/* Features: the closed areas' registrations (AutoFix first), then Reports. */}
          {sidebarBand(100, 200)}

          <AuthorizedContent
            entityId={selectedOrganization?.id}
            entityType="organization"
            relationship={["creator", "administrator"]}
          >
            <NavItem
              icon={destinationIcon(APPSEC_REPORTS)}
              label={t("components.sidebar.reports")}
              href={APPSEC_REPORTS}
              isActive={isOn(location.pathname, APPSEC_REPORTS)}
              isLocked={disabledFeatures.has('reports')}
            />
          </AuthorizedContent>

          <AuthorizedContent
            entityId={selectedOrganization?.id}
            entityType="organization"
            relationship={["creator", "administrator", "manager"]}
          >
            <NavItem
              icon={destinationIcon('/organization/settings/policies')}
              label={t("components.sidebar.policiesSettings")}
              href="/organization/settings/policies"
              isActive={location.pathname.startsWith("/organization/settings/policies")}
              isLocked={disabledFeatures.has('policies')}
            />
          </AuthorizedContent>
          </div>
        </nav>
        )}

        {/* The rail's sections,
            under the navigation and parted from it by the hairline Discover
            and Defend share: where you are, where you were. Each is absent
            rather than empty, none asks the API for anything, and each is
            left out of a desktop window too short to hold it (`railFit`). */}
        {(showCurrentProject || showRecentProjects) && (
          <div data-rail-section="divider" className="py-1.5">
            <div className="h-px bg-white/[0.08]" />
          </div>
        )}
        {showCurrentProject && appsecProjectId !== null && (
          <RailProjectSection projectId={appsecProjectId} pathname={location.pathname} name={currentProjectName} />
        )}
        {showRecentProjects && <RailRecentProjects projects={shownRecentProjects} />}

        {/* These follow the navigation instead of being pinned to the bottom of
            the rail: pinned, they left a large gap mid-sidebar that read as
            missing content.

            Both are hidden while suspended: the onboarding checklist drives the
            user to routes the guard bounces, and the trial meter describes
            quotas nobody can spend until the subscription is fixed.

            Close to the navigation: what does not fit scrolls with no visible
            bar. In the Community Edition, whose navigation is short, a spacer
            takes the free room and brings the Cloud card, then the
            checklist, to the foot of the scrollable area, right above
            Settings: where the cloud's long navigation puts the checklist.
            The spacer is free room, not content, for `useRailFit`. */}
        {isCommunity && <div data-rail-spacer="" aria-hidden="true" className="grow" />}
        {/* The rail's last entries (`app.sidebar.items`, orders 1000 to
            1099), right before the checklist there: none registered in the
            Community Edition today (the editions page is reached from Get
            started). */}
        {isCommunity && !isSuspended && sidebarBand(1000, 1100)}
        {/* The dismissible invitation to the cloud, right above the checklist. */}
        {showCloudCard && <CloudSidebarCard />}
        {!isSuspended && (
        <div className="mt-1 -mx-3">
          {/* What the closed areas show here (the plan's status: the
              reverse-trial widget, remaining scans and Cybe quotas). */}
          {sidebarBand(200, 300)}

          {/* Onboarding Progress — its steps are AppSec steps (create a project,
              run a scan…). The agents space has its own, in its shell. */}
          <OnboardingProgress />
        </div>
        )}

        {/* Elsewhere, the rail's last entries follow the checklist (none
            registered in the cloud today). */}
        {!isCommunity && !isSuspended && sidebarBand(1000, 1100)}
      </div>
      </div>
      <div
        aria-hidden="true"
        data-testid="sidebar-nav-fade"
        className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#060608] to-transparent transition-opacity duration-150 dark:from-as-surface", isNavOverflowing ? "opacity-100" : "opacity-0")}
      />
      </div>

      {/* Settings Button - Fixed at bottom. While suspended it survives only
          for someone who can actually act on billing; for everyone else every
          entry behind it is a dead end. */}
      {(!isSuspended || canManageBilling) && (
      <div className="px-3 py-1.5 border-t border-white/[0.08] relative">
        <AuthorizedContent
          entityId={selectedOrganization?.id}
          entityType="organization"
          // `billing_manager` holds `read` on the organization and is the role
          // that exists to manage billing, so it belongs here: without it the
          // settings button never rendered for them and billing was
          // unreachable from the rail entirely.
          relationship={[
            "creator",
            "administrator",
            "manager",
            "member",
            "billing_manager",
          ]}
        >
          <button
            onClick={() => setIsSettingsModalOpen(!isSettingsModalOpen)}
            className={cn(AS_RAIL_ROW, isSettingsActive || isSettingsModalOpen ? AS_RAIL_ACTIVE : AS_RAIL_IDLE)}
          >
            <>
            <div
              className={cn(AS_RAIL_SLOT, isSettingsActive || isSettingsModalOpen ? AS_RAIL_ICON_ACTIVE : "text-zinc-500")}
            >
              <Cog className={`w-3.5 h-3.5 transition-transform duration-200 ${isSettingsModalOpen ? "rotate-90" : ""}`}  />
            </div>
            <span className="text-[12px] font-medium">{t("navigation.settings")}</span>
            <div className="flex items-center gap-2 ml-auto">
              <ChevronDown
                className={`h-4 w-4 text-zinc-500 transition-transform duration-200 ${isSettingsModalOpen ? "rotate-180" : ""}`}
               />
            </div>
            </>
          </button>
        </AuthorizedContent>

        {/* Settings Menu - Positioned above the button */}
        <SettingsMenu
          isOpen={isSettingsModalOpen}
          onClose={() => setIsSettingsModalOpen(false)}
          selectedOrganization={selectedOrganization}
          isSuspended={isSuspended}
          canManageBilling={canManageBilling}
          extraEntries={(onClose) => sidebarBand(400, 500, { ...sidebarContext, onClose })}
        />
      </div>
      )}

      {/* Bottom Sidebar */}
      <BottomSidebar isDarkMode={isDarkMode} toggleTheme={toggleTheme} />
    </div>
  );
};
