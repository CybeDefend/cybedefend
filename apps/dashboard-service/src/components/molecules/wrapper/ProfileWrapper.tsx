import React, { useEffect, useState } from "react";
import SettingsTabs from "../../../components/molecules/sidebar/custom-tabs/CustomTabs";
import ProfileHeader from "../profile-header/ProfileHeader";
import { Skeleton } from "../../../components/atoms/skeleton/Skeleton";
import { useTranslation } from "react-i18next";
import { PAGE_TITLE_CLASSES } from "@/components/molecules/kit/ui";
import { cn } from "@/utils/function/utils";
import { useProduct } from "@/utils/product";
import {
  SPACE_PAGE_SURFACE,
  SPACE_SETTINGS_BODY,
  SPACE_SETTINGS_HEAD,
  SettingsTabNodes,
  SpaceSettingsHeaderSkeleton,
  SpaceSettingsTabs,
  settingsSkinOf,
  useSettingsTabEntries,
  type SettingsTabEntry,
} from "./SettingsWrapper";
import { SettingsTabsContext } from "./SettingsTab";

/*
 * The zinc skin: the « My account » pages open
 * on the space's flat page, the person as a 22 px title beside a small round
 * picture, the email muted under it, then the same sliding text tabs as the
 * organisation settings. The Platform keeps the component below, untouched.
 */

/** The core profile tabs, with their order among the registrations of `settings.profile.tabs` (the security area registers the account's security tab, 20). */
const PROFILE_CORE_TABS = [
  { value: "general", to: "/profile", labelKey: "components.profileWrapper.tabs.general", order: 10 },
  { value: "pat", to: "/profile/personal-access-tokens", labelKey: "components.profileWrapper.tabs.pat", order: 30 },
] as const;

/**
 * The person's picture, 40 px and round, as decoration (the name beside it is
 * the page's title): plain `<img>`, no `crossOrigin` (the identity provider
 * sends no CORS header). Initials on a zinc disc when there is no picture or it
 * cannot be loaded; a new picture deserves a fresh attempt.
 */
const SpaceProfilePicture: React.FC<{ picture?: string; initials: string }> = ({ picture, initials }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [picture]);

  if (picture && !failed) {
    return (
      <img
        src={picture}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-zinc-200 dark:ring-white/[0.07]"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[13px] font-medium text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300"
    >
      {initials}
    </span>
  );
};

interface SpaceProfileLayoutProps {
  user: ProfileTemplateWrapperProps["user"];
  loading?: boolean;
  tabs: readonly SettingsTabEntry[];
  selectedTab: string;
  children: React.ReactNode;
}

const SpaceProfileLayout: React.FC<SpaceProfileLayoutProps> = ({ user, loading, tabs, selectedTab, children }) => {
  const { t } = useTranslation();
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  // Without a name the email is the title, and is not said a second time under it.
  const name = fullName || user.email;
  const initials = ([user.firstName?.[0], user.lastName?.[0]].filter(Boolean).join("") || user.email?.[0] || "")
    .toUpperCase();

  return (
    <div className={SPACE_PAGE_SURFACE}>
      <div className={SPACE_SETTINGS_HEAD}>
        {loading ? (
          <SpaceSettingsHeaderSkeleton testId="profile-header-loading" avatar />
        ) : (
          <div className="mb-5 flex min-w-0 items-center gap-4">
            <SpaceProfilePicture picture={user.picture} initials={initials} />
            <div className="min-w-0">
              <h1 className={cn(PAGE_TITLE_CLASSES, "truncate")}>{name}</h1>
              {fullName ? (
                <p className="mt-0.5 truncate text-[13px] leading-5 text-zinc-500 dark:text-zinc-400">{user.email}</p>
              ) : null}
            </div>
          </div>
        )}
        <SpaceSettingsTabs current={selectedTab} ariaLabel={t("navigation.profile")}>
          <SettingsTabNodes tabs={tabs} />
        </SpaceSettingsTabs>
      </div>
      <div className={SPACE_SETTINGS_BODY}>{children}</div>
    </div>
  );
};

interface ProfileTemplateWrapperProps {
  user: {
    firstName: string;
    lastName: string;
    email: string;
    picture: string;
  };
  selectedTab: string;
  children: React.ReactNode;
  loading?: boolean;
}

const ProfileTemplateWrapper: React.FC<ProfileTemplateWrapperProps> = ({
  user,
  selectedTab,
  children,
  loading,
}) => {
  const { t } = useTranslation();
  const product = useProduct();
  const skin = settingsSkinOf(product);

  // Closed areas register their tabs on `settings.profile.tabs` (the security area's, 20); in a community build there are none.
  const tabs = useSettingsTabEntries(
    "settings.profile.tabs",
    PROFILE_CORE_TABS.map((tab) => ({ value: tab.value, label: t(tab.labelKey), to: tab.to, order: tab.order })),
    selectedTab,
    { product },
  );

  if (skin === "zinc") {
    return (
      <SettingsTabsContext.Provider value={{ skin, current: selectedTab, layoutId: "vd-profile-tabs" }}>
        <SpaceProfileLayout user={user} loading={loading} tabs={tabs} selectedTab={selectedTab}>
          {children}
        </SpaceProfileLayout>
      </SettingsTabsContext.Provider>
    );
  }

  return (
    <div>
      { }
      {loading ? (
        <div className="p-6 bg-white dark:bg-as-surface border-b border-zinc-200 dark:border-as-line">
          <div className="flex items-center space-x-4 mb-4">
            { }
            <Skeleton type="avatar" height="50px" width="50px" />
            { }
            <div className="flex-1 space-y-2">
              <Skeleton type="text" rows={1} width="25%" />
              <Skeleton type="text" rows={1} width="35%" />
            </div>
          </div>
        </div>
      ) : (
        <ProfileHeader
          title={`${user.firstName} ${user.lastName}`}
          subtitle={user.email}
          imageUrl={user.picture}
        />
      )}

      { }
      <SettingsTabsContext.Provider value={{ skin, current: selectedTab, layoutId: "vd-profile-tabs" }}>
        <SettingsTabs tabs={[]}>
          <SettingsTabNodes tabs={tabs} />
        </SettingsTabs>
      </SettingsTabsContext.Provider>

      { }
      <div className="p-4 sm:p-6">{children}</div>
    </div>
  );
};

export default ProfileTemplateWrapper;
