

import { supportUrl } from '@/edition/support';
import React, { useState } from 'react';

import IconButton from '../../../atoms/icon-button/IconButton';
import { AuthorizedContent } from 'react-rebac';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { RootState } from '../../../../server/store';
import ThemeToggleButton from '../../../atoms/theme-toggle-button/ThemeToggleButton';
import { useTranslation } from 'react-i18next';
import { getRegionConfig, RegionKey } from '../../../../utils/function/region';
import { useAppVersion } from '../../../../server/hooks/useAppVersion';
import { Book, ChevronDown, Code, Discord, Github, Headset, History, QuestionCircle } from '@/components/atoms/icon/icons';
import type { IconProps } from '@/components/atoms/icon/icons';
import { upsellLink } from '@/edition/upsell/upsellLink';
import { EDITION } from '@/edition/edition';
import { cn } from '@/utils/function/utils';
import { AS_FOCUS_RAIL, AS_TOUCH } from '@/components/atoms/appsec/styles';
import { roleLabelKey } from '@/utils/roleLabel';
import RailAvatar from '../sidebar-content/RailAvatar';

/**
 * The glyph of a help entry: a quiet zinc mark on the title's line, no tile (the
 * rail is black with a touch of violet).
 */
const HELP_GLYPH = 'flex h-5 w-4 shrink-0 items-center justify-center text-zinc-500 transition-colors duration-[120ms] group-hover:text-zinc-300';

/** One entry of the help menu: a glyph, a title, a line. */
/**
 * Whether the gateway named its version: it answers « Unknown » when it cannot
 * tell (`fetchAppVersion` too, on a failed call).
 */
const isKnownVersion = (version: string | undefined): boolean =>
  !!version && version.trim().toLowerCase() !== 'unknown';

const HELP_ITEM = cn(
  'group flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors duration-[120ms] hover:bg-white/[0.05]',
  AS_FOCUS_RAIL
);

/** The Open Source community's Discord (public invite). */
export const COMMUNITY_DISCORD_URL = 'https://discord.gg/UPzm4n6SAJ';
/** The public Open Source repository: issues and pull requests. */
export const COMMUNITY_GITHUB_URL = 'https://github.com/CybeDefend/cybedefend';
/** The slot id of the Community Help menu's Support entry, which tags its link (`utm_campaign`). */
export const HELP_SUPPORT_SLOT_ID = 'help-support';

/**
 * An entry of the Community Help menu that leaves the app: a link opening in a new tab, whose
 * name says so. The cloud's entries stay buttons, as they were.
 */
const HelpLink: React.FC<{
  href: string;
  icon: React.ComponentType<IconProps>;
  title: string;
  description: string;
  newTab: string;
  onOpen: () => void;
}> = ({ href, icon: Icon, title, description, newTab, onOpen }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" onClick={onOpen} className={HELP_ITEM}>
    <div className={HELP_GLYPH}>
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
    </div>
    <div>
      <div className="text-[13px] font-medium text-zinc-100">{title}</div>
      <div className="text-xs text-zinc-400">{description}</div>
      <span className="sr-only"> {newTab}</span>
    </div>
  </a>
);

interface BottomSidebarProps {
  isDarkMode: boolean;
  toggleTheme: () => void;
}

export const BottomSidebar: React.FC<BottomSidebarProps> = ({
  isDarkMode,
  toggleTheme,
}) => {
  const [isHelpMenuOpen, setIsHelpMenuOpen] = useState(false);
  const { t } = useTranslation();

  const selectedOrganization = useSelector(
    (state: RootState) => state.organization.selectedOrganization
  );
  // The account row: who is signed
  // in, and as what, in this organisation. Read from the profile the store
  // holds; the row is left out until the profile names the account.
  const account = useSelector((state: RootState) => state.user);
  const accountName = `${account?.firstName ?? ''} ${account?.lastName ?? ''}`.trim();
  const accountRoleKey = roleLabelKey(selectedOrganization?.myRole);

  // The region, read from the environment variable
  const currentRegion = (import.meta.env.VITE_REGION === "eu" || import.meta.env.VITE_REGION === "us")
    ? import.meta.env.VITE_REGION as RegionKey
    : "eu"; // Fallback to EU if not defined or invalid
  const regionConfig = getRegionConfig(currentRegion);

  // The version information (loaded once)
  const versionInfo = useAppVersion();
  const isCommunity = EDITION === 'community';

  const handleHelpItemClick = (url: string) => {
    window.open(url, '_blank');
    setIsHelpMenuOpen(false);
  };

  if (!selectedOrganization) {
    return null;
  }

  return (
    <div className="mt-auto px-3 py-1.5 border-t border-white/[0.08]">
      <div className="flex items-center justify-between">
        {/* The Help menu */}
        <div className="relative">
          <button
            onClick={() => setIsHelpMenuOpen(!isHelpMenuOpen)}
            className={cn(
              'relative flex h-8 items-center gap-2 rounded-md px-2.5 text-[12px] font-medium text-zinc-400 transition-colors duration-[120ms] hover:bg-white/[0.06] hover:text-zinc-100',
              AS_FOCUS_RAIL,
              AS_TOUCH
            )}
          >
            <QuestionCircle
              className="h-4 w-4 text-zinc-500"
             />
            <span>{t('components.sidebar.help.title')}</span>
            <ChevronDown
              className={`h-3 w-3 transition-transform duration-200 ${isHelpMenuOpen ? 'rotate-180' : ''
                }`}
             />
          </button>

          {/* Custom dropdown menu */}
          {isHelpMenuOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-60 rounded-lg border border-white/[0.08] bg-[#1B1B20] p-1 shadow-[0_16px_40px_-8px_rgb(0_0_0/0.7)]">
              <div>
                <button
                  onClick={() => handleHelpItemClick('https://docs.cybedefend.com/')}
                  className={HELP_ITEM}
                >
                  <div className={HELP_GLYPH}>
                    <Book
                      className="h-3.5 w-3.5"
                     />
                  </div>
                  <div>
                    <div className="text-[13px] font-medium text-zinc-100">{t('components.sidebar.help.documentation.title')}</div>
                    <div className="text-xs text-zinc-400">{t('components.sidebar.help.documentation.description')}</div>
                  </div>
                </button>

                <button
                  onClick={() => handleHelpItemClick('https://cybedefend.featurebase.app/en/changelog')}
                  className={HELP_ITEM}
                >
                  <div className={HELP_GLYPH}>
                    <History
                      className="h-3.5 w-3.5"
                     />
                  </div>
                  <div>
                    <div className="text-[13px] font-medium text-zinc-100">{t('components.sidebar.help.changelog.title')}</div>
                    <div className="text-xs text-zinc-400">{t('components.sidebar.help.changelog.description')}</div>
                  </div>
                </button>

                {isCommunity ? (
                  <>
                    {/* Open Source: its community, its
                        repository, and support, which comes with the cloud. */}
                    <HelpLink
                      href={COMMUNITY_DISCORD_URL}
                      icon={Discord}
                      title={t('components.sidebar.help.community.discord.title')}
                      description={t('components.sidebar.help.community.discord.description')}
                      newTab={t('components.sidebar.help.community.opensInNewTab')}
                      onOpen={() => setIsHelpMenuOpen(false)}
                    />
                    <HelpLink
                      href={COMMUNITY_GITHUB_URL}
                      icon={Github}
                      title={t('components.sidebar.help.community.contribute.title')}
                      description={t('components.sidebar.help.community.contribute.description')}
                      newTab={t('components.sidebar.help.community.opensInNewTab')}
                      onOpen={() => setIsHelpMenuOpen(false)}
                    />
                    <HelpLink
                      href={upsellLink(HELP_SUPPORT_SLOT_ID, '/pricing')}
                      icon={Headset}
                      title={t('components.sidebar.help.community.support.title')}
                      description={t('components.sidebar.help.community.support.description')}
                      newTab={t('components.sidebar.help.community.opensInNewTab')}
                      onOpen={() => setIsHelpMenuOpen(false)}
                    />
                  </>
                ) : (
                  <button
                    onClick={() => handleHelpItemClick(supportUrl())}
                    className={HELP_ITEM}
                  >
                    <div className={HELP_GLYPH}>
                      <Headset
                        className="h-3.5 w-3.5"
                       />
                    </div>
                    <div>
                      <div className="text-[13px] font-medium text-zinc-100">{t('components.sidebar.help.support.title')}</div>
                      <div className="text-xs text-zinc-400">{t('components.sidebar.help.support.description')}</div>
                    </div>
                  </button>
                )}

                {/* Separator and version */}
                <div className="border-t border-white/[0.08] mt-1 pt-1">
                  {isCommunity ? (
                    <>
                      {/* The Community Edition is self-hosted: no region, and
                          no commit (the gateway does not know one). Its name,
                          then the version when the gateway knows it. */}
                      <div className="px-2 py-1.5">
                        <div
                          data-testid="help-edition-badge"
                          className="flex h-8 items-center justify-center gap-2 rounded-md bg-white/[0.04] px-3"
                        >
                          <Code aria-hidden="true" className="h-3.5 w-3.5 text-zinc-500" />
                          <span className="text-[13px] font-medium text-zinc-100">{t('components.sidebar.help.edition.openSource')}</span>
                        </div>
                      </div>
                      {versionInfo && isKnownVersion(versionInfo.version) && (
                        <div className="px-2 pb-1.5">
                          <div className="font-mono text-xs tabular-nums text-zinc-400 text-center">
                            <div className="font-medium">v{versionInfo.version}</div>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                  {/* Region badge */}
                  <div className="px-2 py-1.5">
                    <div className="flex h-8 items-center justify-center gap-2 rounded-md bg-white/[0.04] px-3">
                      <span className="text-sm">{currentRegion === "eu" ? "🇪🇺" : "🇺🇸"}</span>
                      <span className="text-[13px] font-medium text-zinc-100">{regionConfig.label}</span>
                    </div>
                  </div>

                  {/* Version de l'API */}
                  <div className="px-2 pb-1.5">
                    {versionInfo ? (
                      <div className="font-mono text-xs tabular-nums text-zinc-400 text-center">
                        <div className="font-medium">v{versionInfo.version}</div>
                        <div className="text-[11px]">
                          {versionInfo.commit}
                        </div>
                      </div>
                    ) : (
                      <div className="font-mono text-xs tabular-nums text-zinc-400 text-center">
                        {t('common.loading')}
                      </div>
                    )}
                  </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Overlay that closes the menu */}
          {isHelpMenuOpen && (
            <div
              className="fixed inset-0 z-[-1]"
              onClick={() => setIsHelpMenuOpen(false)}
            />
          )}
        </div>

        {/* Theme button. Its glyph takes the button's zinc (the atom paints
            the moon in the accent): in the rail only the current entry and
            the product's mark carry colour. */}
        <div className="flex items-center [&_svg]:!text-current">
          <ThemeToggleButton
            isDarkMode={isDarkMode}
            onToggle={toggleTheme}
            ariaLabel={t(isDarkMode ? 'common.switchToLightTheme' : 'common.switchToDarkTheme')}
          />
        </div>
      </div>

      {/* The account, on one line: the picture or initials, the name, the
          role in this organisation. It only says who is signed in — the
          account menu, and everything it does, stays in the header. */}
      {accountName && (
        <div
          data-testid="rail-account"
          className="mt-1 flex min-h-7 items-center gap-2.5 border-t border-white/[0.08] px-2.5 pt-1.5"
        >
          <span className="sr-only">{t('components.sidebar.account')}</span>
          <RailAvatar src={account?.picture} name={accountName} />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-5 text-zinc-100" title={accountName}>
            {accountName}
          </span>
          {accountRoleKey && (
            <span className="shrink-0 text-[11px] leading-4 text-zinc-400">{t(accountRoleKey)}</span>
          )}
        </div>
      )}
    </div>
  );
};
