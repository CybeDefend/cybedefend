import React, { useId, useLayoutEffect, useRef } from "react";
import ProfileHeader from "../profile-header/ProfileHeader";
import OrganizationIdDisplay from "../organization-id-display/OrganizationIdDisplay";
import CustomTabs from "../sidebar/custom-tabs/CustomTabs";
import { useSelector } from "react-redux";
import { RootState } from "../../../server/store";
import { Skeleton } from "../../atoms/skeleton/Skeleton";
import { useTranslation } from "react-i18next";
import { useAuthorization } from "react-rebac";
import { toast } from "react-toastify";
import { useCopyToClipboard } from "@/components/atoms/copy-button/useCopyToClipboard";
import {
  Button as VdButton,
  PAGE_TITLE_CLASSES,
  Skeleton as VdSkeleton,
  TABS_TRACK,
} from "@/components/molecules/kit/ui";
import { cn } from "@/utils/function/utils";
import { spaceOf, useProduct } from "@/utils/product";
import { useSlotEntries, type SlotName } from "@/edition/slots";
import { SettingsTab, SettingsTabsContext, type SettingsTabSkin } from "./SettingsTab";

/*
 * The zinc skin. The settings and profile pages
 * are common to every product space: in a zinc space they open on the space's
 * flat page, a 22 px title with a muted meta line, and text tabs whose 1.5 px
 * underline slides from one settings page to the next. The Platform keeps the
 * component below, untouched.
 */

/** A tab of a settings or profile row, as its host lists it before rendering: a core tab, or a slot registration. */
export interface SettingsTabEntry {
  key: string;
  order: number;
  node: React.ReactNode;
}

interface SpaceSettingsTabsProps {
  /** The tabs, each a `SettingsTab` (core or registered). */
  children: React.ReactNode;
  /** The tab of the page on screen: what brings it into view. */
  current: string;
  /** Names the navigation. */
  ariaLabel: string;
}

/** Room left between a tab brought into view and the edge of its row. */
const TAB_SCROLL_ROOM = 16;

/**
 * Text tabs over a hairline, the current one in ink on a 1.5 px underline,
 * the others zinc-500. Links (the tabs are pages), `aria-current="page"` on
 * the current one. On a phone the row scrolls sideways inside its own box;
 * the padding around the scroller keeps the focus ring from being clipped.
 * The current tab is brought into view in that row before the first paint
 * (the billing account sits past a phone's edge), moving the row only, never the
 * page; framer measures the underline after this, so it glides to where the
 * tab is seen.
 */
export const SpaceSettingsTabs: React.FC<SpaceSettingsTabsProps> = ({ children, current, ariaLabel }) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const count = React.Children.count(children);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const tab = scroller?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!scroller || !tab) return;
    const row = scroller.getBoundingClientRect();
    const box = tab.getBoundingClientRect();
    if (box.right > row.right) scroller.scrollLeft += box.right - row.right + TAB_SCROLL_ROOM;
    else if (box.left < row.left) scroller.scrollLeft -= row.left - box.left + TAB_SCROLL_ROOM;
  }, [current, count]);

  return (
    <div ref={scrollerRef} className="-m-1 overflow-x-auto overflow-y-hidden p-1 scrollbar-hide">
      <nav aria-label={ariaLabel} className={cn(TABS_TRACK, "w-full min-w-max")}>
        {children}
      </nav>
    </div>
  );
};

/** The skin of the settings and profile pages in a space: the zinc kit's, or the Platform's. */
export const settingsSkinOf = (product: Parameters<typeof spaceOf>[0]): SettingsTabSkin =>
  spaceOf(product).skin === "zinc" ? "zinc" : "appsec";

/**
 * The tabs of a settings or profile row: the core tabs, then the registrations
 * of its slot, placed by order (a core tab first on a tie).
 */
export function useSettingsTabEntries(
  slot: SlotName,
  core: ReadonlyArray<{ value: string; label: string; to: string; order: number }>,
  selectedTab: string,
  context: { organizationId?: string; product: string },
): SettingsTabEntry[] {
  const entries = useSlotEntries(slot);
  return [
    ...core.map((tab) => ({
      key: `core:${tab.value}`,
      order: tab.order,
      node: <SettingsTab value={tab.value} label={tab.label} to={tab.to} active={tab.value === selectedTab} />,
    })),
    ...entries.map((entry) => ({ key: `slot:${entry.id}`, order: entry.order, node: entry.render(context) })),
  ].sort((a, b) => a.order - b.order);
}

/** Renders the tabs a host listed, each under its key. */
export const SettingsTabNodes: React.FC<{ tabs: readonly SettingsTabEntry[] }> = ({ tabs }) => (
  <>
    {tabs.map((tab) => (
      <React.Fragment key={tab.key}>{tab.node}</React.Fragment>
    ))}
  </>
);

/** The page surface of a zinc space: transparent, so the page token and the shell's atmosphere show through. */
export const SPACE_PAGE_SURFACE = "relative min-h-full bg-transparent";

/** The header's place while it loads: a title bar and a meta bar, nothing to read (the kit's Skeleton). */
export const SpaceSettingsHeaderSkeleton: React.FC<{ testId: string; avatar?: boolean }> = ({ testId, avatar }) => (
  <div data-testid={testId} aria-hidden="true" className="mb-5 flex items-center gap-4">
    {avatar ? <VdSkeleton shape="circle" className="h-10 w-10 shrink-0" /> : null}
    <div className="min-w-0 flex-1 space-y-2.5">
      <VdSkeleton shape="block" className="h-6 w-56 max-w-full rounded-md" />
      <VdSkeleton className="w-80 max-w-full" />
    </div>
  </div>
);

/** The settings and profile pages at the width of every page of a zinc space: the shell's column, the page's 24 px gutter from md. */
export const SPACE_SETTINGS_HEAD = "w-full md:px-6 md:pt-6";
export const SPACE_SETTINGS_BODY = "w-full pb-10 pt-6 md:px-6";

/**
 * The core settings tabs, with their order among the
 * registrations of `settings.organization.tabs` (the billing account, 40, and
 * the closed spaces' own, from 50).
 */
const SETTINGS_CORE_TABS = [
  { value: "organization", to: "/organization/settings", labelKey: "components.settingsWrapper.tabs.organization", order: 10 },
  { value: "teams", to: "/organization/settings/teams", labelKey: "components.settingsWrapper.tabs.teams", order: 20 },
  { value: "integrations", to: "/organization/settings/integrations", labelKey: "components.settingsWrapper.tabs.integrations", order: 30 },
] as const;

/** The organisation roles, by their name in the roles locale. */
const ORGANIZATION_ROLE_TITLES: Record<string, string> = {
  creator: "roles.explanations.creator.title",
  administrator: "roles.explanations.administrator.title",
  manager: "roles.explanations.manager.title",
  billing_manager: "roles.explanations.billing_manager.title",
  member: "roles.explanations.member.title",
};

interface SpaceOrganization {
  id: string;
  name: string;
  description?: string;
  myRole?: string;
}

const META_VALUE = "text-zinc-700 dark:text-zinc-300";
/**
 * A hairline secondary action, 24 px so the meta line keeps its height; the
 * `after` layer widens what a thumb can hit to 44 px tall (10 px above and
 * below) and 8 px on each side.
 */
const COPY_ACTION = cn(
  "-my-1 h-6 rounded-md border border-zinc-200 bg-transparent px-1.5 text-xs dark:border-vd-line-strong dark:bg-transparent",
  "after:absolute after:-inset-x-2 after:-inset-y-2.5"
);

/**
 * The organisation as the page's statement: its name (the page's `h1`), its
 * description, then one muted line with the viewer's role as a word and the
 * organisation id in mono, followed by a quiet « Copy » action the id
 * describes. The id stays selectable in one click for a browser that refuses
 * the clipboard.
 */
const SpaceOrganizationHeader: React.FC<{ organization: SpaceOrganization }> = ({ organization }) => {
  const { t } = useTranslation();
  const idElementId = useId();
  const { copied, copy } = useCopyToClipboard();
  const roleKey = organization.myRole ? ORGANIZATION_ROLE_TITLES[organization.myRole] : undefined;
  const role = roleKey ? t(roleKey) : organization.myRole;

  const copyId = async () => {
    if (await copy(organization.id)) toast.success(t("common.copiedToClipboard"));
  };

  return (
    <div className="mb-5 min-w-0">
      <h1 className={cn(PAGE_TITLE_CLASSES, "truncate")}>{organization.name}</h1>
      {organization.description ? (
        <p className="mt-1 max-w-3xl text-[13px] leading-5 text-zinc-500 dark:text-zinc-400">{organization.description}</p>
      ) : null}
      {/* The role, then the id on its own line: distinct facts on separate lines, no separator. */}
      <div
        data-testid="settings-header-meta"
        className="mt-2 flex flex-col items-start gap-1 text-xs text-zinc-500 dark:text-zinc-400"
      >
        {role ? (
          <span>
            {t("components.settingsWrapper.myRole")}{" "}
            <span className={META_VALUE}>{role}</span>
          </span>
        ) : null}
        <span className="inline-flex min-w-0 max-w-full items-center gap-1">
          <span id={idElementId} className="min-w-0 truncate font-mono select-all">
            {organization.id}
          </span>
          <VdButton
            variant="outline"
            size="sm"
            aria-describedby={idElementId}
            onClick={copyId}
            className={cn(COPY_ACTION, copied ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-500 dark:text-zinc-400")}
          >
            {copied ? t("components.copyButton.copied") : t("common.copy")}
          </VdButton>
        </span>
      </div>
    </div>
  );
};

interface SpaceSettingsLayoutProps {
  organization: SpaceOrganization | null | undefined;
  loading?: boolean;
  tabs: readonly SettingsTabEntry[];
  selectedTab: string;
  children: React.ReactNode;
}

const SpaceSettingsLayout: React.FC<SpaceSettingsLayoutProps> = ({
  organization,
  loading,
  tabs,
  selectedTab,
  children,
}) => {
  const { t } = useTranslation();
  return (
    <div className={SPACE_PAGE_SURFACE}>
      {/* The shell's content column and the 24 px page gutter of every page
          of the space from md: the same width and edges as its home or a
          project, no column of its own and no second gutter. */}
      <div className={SPACE_SETTINGS_HEAD}>
        {loading ? (
          <SpaceSettingsHeaderSkeleton testId="settings-header-loading" />
        ) : organization ? (
          <SpaceOrganizationHeader organization={organization} />
        ) : null}
        <SpaceSettingsTabs current={selectedTab} ariaLabel={t("navigation.settings")}>
          <SettingsTabNodes tabs={tabs} />
        </SpaceSettingsTabs>
      </div>
      <div className={SPACE_SETTINGS_BODY}>{children}</div>
    </div>
  );
};

interface SettingsWrapperProps {
  selectedTab: string;
  children: React.ReactNode;
  loading?: boolean;
}

const SettingsWrapper: React.FC<SettingsWrapperProps> = ({
  selectedTab,
  children,
  loading,
}) => {
  const { t } = useTranslation();
  const organization = useSelector(
    (state: RootState) => state.organization.selectedOrganization
  );

  // Integrations need manager access.
  const hasManagerAccess = useAuthorization(
    organization?.id ?? "",
    "organization",
    ["creator", "administrator", "manager"]
  );

  const product = useProduct();
  const skin = settingsSkinOf(product);

  // The billing account and each closed space's own settings are tabs their
  // areas register on `settings.organization.tabs`, each deciding who sees it.
  const tabs = useSettingsTabEntries(
    "settings.organization.tabs",
    SETTINGS_CORE_TABS.filter((tab) => tab.value !== "integrations" || hasManagerAccess).map((tab) => ({
      value: tab.value,
      label: t(tab.labelKey),
      to: tab.to,
      order: tab.order,
    })),
    selectedTab,
    { organizationId: organization?.id, product },
  );

  if (skin === "zinc") {
    return (
      <SettingsTabsContext.Provider value={{ skin, current: selectedTab, layoutId: "vd-settings-tabs" }}>
        <SpaceSettingsLayout
          organization={organization}
          loading={loading}
          tabs={tabs}
          selectedTab={selectedTab}
        >
          {children}
        </SpaceSettingsLayout>
      </SettingsTabsContext.Provider>
    );
  }

  return (
    <div>
      {loading ? (
        <div className="p-6 dark:bg-as-surface">
          <div className="flex items-center space-x-4 mb-4">
            <Skeleton type="avatar" height="50px" width="50px" />
            <div className="flex-1 space-y-2">
              <Skeleton type="text" rows={1} width="25%" />
              <Skeleton type="text" rows={1} width="35%" />
            </div>
          </div>
        </div>
      ) : (
        <>
          {organization && (
            <div className="bg-white dark:bg-as-surface border-b border-zinc-200 dark:border-as-line">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between px-4 sm:px-6 py-4 gap-4">
                <div className="flex-1 min-w-0">
                  <ProfileHeader
                    title={organization.name}
                    subtitle={organization.description}
                    secondarySubtitle={`${t('components.settingsWrapper.myRole')}: ${organization.myRole}`}
                  />
                </div>

                <div className="flex-shrink-0 w-full lg:w-auto lg:mt-2">
                  <OrganizationIdDisplay
                    organizationId={organization.id}
                    organizationName={organization.name}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <SettingsTabsContext.Provider value={{ skin, current: selectedTab, layoutId: "vd-settings-tabs" }}>
        <CustomTabs tabs={[]}>
          <SettingsTabNodes tabs={tabs} />
        </CustomTabs>
      </SettingsTabsContext.Provider>

      <div className="px-4 pt-4 sm:px-6">{children}</div>
    </div>
  );
};

export default SettingsWrapper;
