import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { useSearchParams, Link } from "react-router-dom";

import { cn } from "@/utils/function/utils";
import { PageContainer } from "@/components/molecules/page-container";
import Card from "@/components/atoms/card/Card";
import SearchBox from "@/components/atoms/search-box/SearchBox";
import Loader from "@/components/atoms/loader/Loader";
import UpgradePlanOverlay from "@/components/molecules/upgrade-plan-overlay/UpgradePlanOverlay";
import IssueIntegrationInfoModal from "@/components/molecules/modal/IssueIntegrationInfoModal";
import NotFoundElement from "@/components/molecules/not-found-element/NotFoundElement";
import SettingsWrapper from "@/components/molecules/wrapper/SettingsWrapper";
import SidebarMenu from "@/components/molecules/sidebar/sidebar-menu/SidebarMenu";
import { categories, integrations as coreIntegrations, isMonochromeDarkLogo } from "@/utils/data/integrationData";
import { Integration } from "@/server/interfaces/Project";
import OnboardingStep from "@/components/molecules/on-boarding/OnboardingStep";
import GitlabIntegrationModal from "@/components/molecules/modal/gitlab-integration-modal/GitlabIntegrationModal";
import SlackIntegrationModal from "@/components/molecules/modal/slack-integration-modal/SlackIntegrationModal";
import JiraIntegrationModal from "@/components/molecules/modal/jira-integration-modal/JiraIntegrationModal";
import LinearIntegrationModal from "@/components/molecules/modal/linear-integration-modal/LinearIntegrationModal";
import CursorInstallModal from "@/components/molecules/modal/CursorInstallModal";
import CommunityMcpModal from "@/components/molecules/modal/CommunityMcpModal";
import useDisabledFeatures from "@/server/hooks/useDisabledFeatures";
import { Cog } from '@/components/atoms/icon/icons';
import { spaceMark } from '@/utils/spaceMark';
import { PRODUCT_SPACES } from '@/utils/product';
import { ACTIVE_EXTENSIONS } from "@/edition/active";
import { EDITION } from '@/edition/edition';
import { upsellLink } from '@/edition/upsell/upsellLink';

/**
 * A container registry is connected so that a scanner pulls its images; the
 * Community Edition runs no scanner (container results come as a SARIF
 * import), so its registries, like Comp AI, are cloud-only cards
 * (below) and a `?openRegistry=` link opens no dialog.
 */
const REGISTRIES_CONNECTABLE = EDITION !== 'community';

/**
 * The Community Edition's cards that lead outside the instance:
 * - « Cybe MCP » opens the instance's own MCP dialog (its `mcp` profile), not
 *   the cloud's docs;
 * - « GitHub Actions » leads to the action that uploads SARIF;
 * - « CLI » keeps its repository link and carries one line (`communityNote`):
 *   its public README documents scans and results, no import, and it signs
 *   in through the cloud's PAT token exchange (`/oidc/token`), which this
 *   edition does not serve. The line says so and points to the import API.
 */
const COMMUNITY = EDITION === 'community';
const COMMUNITY_ACTIONS_LINK = 'https://github.com/CybeDefend/cybedefend-scanners';

/**
 * A card the Community Edition shows but cannot connect: greyed, « Available
 * on Cloud only », and its one control is the link to the cloud, tagged with
 * `cloudOnlySlot` (one upsell slot per surface). It opens no dialog.
 */
type CatalogCard = Integration & { cloudOnlySlot?: string; communityNoteKey?: string };
const REGISTRIES_UPSELL_SLOT_ID = 'integrations-registries';
const COMPAI_UPSELL_SLOT_ID = 'integrations-compai';
const CLOUD_ONLY_PATH = '/pricing';
const cloudOnlySlotOf = (integration: Integration): string | undefined => {
  if (integration.category === 'Container registries') return REGISTRIES_UPSELL_SLOT_ID;
  if (integration.name === 'Comp AI') return COMPAI_UPSELL_SLOT_ID;
  return undefined;
};

const forEdition = (integration: Integration): CatalogCard | null => {
  if (!COMMUNITY) return integration;
  if (integration.name === 'CLI') return { ...integration, communityNoteKey: 'pages.settingsIntegration.communityCli.line' };
  const cloudOnlySlot = cloudOnlySlotOf(integration);
  if (cloudOnlySlot) return { ...integration, link: undefined, cloudOnlySlot };
  if (integration.name === 'GitHub Actions') return { ...integration, link: COMMUNITY_ACTIONS_LINK };
  if (integration.name === 'Cybe MCP') return { ...integration, link: undefined };
  return integration;
};

/** The catalogue: the core's cards, then those each product space adds. */
const integrations: CatalogCard[] = [
  ...coreIntegrations,
  ...PRODUCT_SPACES.flatMap((space) => space.integrationCards ?? []),
]
  .map(forEdition)
  .filter((integration): integration is CatalogCard => integration !== null);

import { AS_CHIP, AS_PANEL_TITLE, AS_SECTION_TITLE } from '@/components/atoms/appsec/styles';
import { AS_TAG, AS_STATUS_WORD, AS_STATUS_DOT, NOTICE_DOT } from '@/components/atoms/appsec/recipes';
import { WORD_TONE } from '@/components/molecules/card/kpi/wordTone';
/** The badge of a card another product space wires: that space's mark and its words. */
const PoweredByBadge: React.FC<{ space: string; labelKey?: string }> = ({ space, labelKey }) => {
  const { t } = useTranslation();
  const Mark = spaceMark(space);
  return (
    <span className={cn(AS_CHIP, "mt-1 bg-white ring-1 ring-inset ring-secondary/25 dark:bg-secondary-light/10 dark:ring-0 text-secondary dark:text-secondary-light")}>
      <Mark className="h-3 w-3" />
      {labelKey ? t(labelKey) : null}
    </span>
  );
};

interface SettingsOrganizationIntegrationTemplateProps {
  wrapperLoading: boolean;
  isGithubLinked: boolean;
  isGitlabLinked: boolean;
  isJiraLinked: boolean;
  isLinearLinked: boolean;
  isSlackLinked: boolean;
  isLoadingIntegrations?: boolean;
  onGitlabClick: () => void;
  onGithubClick: () => void;
  githubInstallOwnedByCurrentUser?: boolean;
  gitlabInstallOwnedByCurrentUser?: boolean;
  /** GitLab refused the connection's refresh token. */
  isGitlabReconnectRequired?: boolean;
  /** Starts GitLab's OAuth again, without the « installed by another member » check. */
  onGitlabReconnect?: () => void;
  /** The member may reconnect or disconnect GitLab (`manage_integration`). */
  canManageGitlab?: boolean;
  getRegistryCredentialCount?: (type: string) => number;
  onCredentialsChange?: () => void;
  writesBlocked?: boolean;
  organizationId?: string;
}

  // The `?openRegistry=` values that name a registry the cards can open.
  const OPEN_REGISTRY_TYPES = [
    'gitlab',
    'dockerhub',
    'gcr',
    'github',
    'ecr',
    'acr',
    'quay',
    'harbor',
    'jfrog',
    'scaleway',
  ] as const;

// Map integration names to registry type keys
const REGISTRY_TYPE_MAP: { [key: string]: string } = {
  "GitLab Registry": "gitlab",
  "Docker Hub": "dockerhub",
  "GCR": "gcr",
  "GitHub Container Registry": "github",
  "ECR": "ecr",
  "ACR": "acr",
  "Quay": "quay",
  "Harbor": "harbor",
  "JFrog Artifactory": "jfrog",
  "Scaleway": "scaleway",
};

const SettingsOrganizationIntegrationTemplate: React.FC<
  SettingsOrganizationIntegrationTemplateProps
> = ({ wrapperLoading, isGithubLinked, isGitlabLinked, isJiraLinked, isLinearLinked, isSlackLinked, isLoadingIntegrations = false, onGitlabClick, onGithubClick, githubInstallOwnedByCurrentUser = true, gitlabInstallOwnedByCurrentUser = true, isGitlabReconnectRequired = false, onGitlabReconnect, canManageGitlab = false, getRegistryCredentialCount, onCredentialsChange, writesBlocked = false, organizationId }) => {
  const { t } = useTranslation();

  // Feature gating via subscription's featuresDisabled CSV
  const disabledFeatures = useDisabledFeatures();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedCategory, setSelectedCategory] = useState<string>(() => {
    const categoryParam = searchParams.get('category');
    return categoryParam || "all";
  });
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [issueModalType, setIssueModalType] = useState<"github" | "gitlab" | null>(null);

  // Clear the URL parameter after reading it to avoid keeping it in the URL
  // The registry credential modal, handed by the edition layer: cloud only
  //; the Community Edition greys the registry cards out and opens
  // no dialog.
  const [openRegistry, setOpenRegistry] = useState<string | null>(null);
  const [showSlackIntegrationModal, setShowSlackIntegrationModal] = useState(false);
  const [showJiraIntegrationModal, setShowJiraIntegrationModal] = useState(false);
  const [showLinearIntegrationModal, setShowLinearIntegrationModal] = useState(false);
  const [showGitlabIntegrationModal, setShowGitlabIntegrationModal] = useState(false);
  const [showCursorInstallModal, setShowCursorInstallModal] = useState(false);
  const [showCommunityMcpModal, setShowCommunityMcpModal] = useState(false);

  // Deep-link: ?openRegistry=<type> (e.g. from the "fix credentials" CTA on an
  // image-browse error) opens that registry's credential modal directly, then
  // the query params are cleared so a refresh doesn't re-open it.
  useEffect(() => {
    const openType = searchParams.get('openRegistry');
    if (
      REGISTRIES_CONNECTABLE &&
      openType !== null &&
      (OPEN_REGISTRY_TYPES as readonly string[]).includes(openType)
    ) {
      setOpenRegistry(openType);
    }
    if (searchParams.get('category') || openType) {
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMenuChange = (id: string) => {
    setSelectedCategory(id);
  };

  const onIntegrationsSearchChange = (term: string) => {
    setSearchTerm(term.toLowerCase());
  };

  const handleIssueIntegrationClick = (type: "github" | "gitlab") => {
    setIssueModalType(type);
  };

  const closeIssueModal = () => {
    setIssueModalType(null);
  };

  const translatedCategories = categories.map(category => {
    let translationKey = `integrations.categories.${category.id}`;
    if (category.id === 'all') {
      translationKey = 'components.settingsWrapper.tabs.allIntegrations';
    }
    return {
      ...category,
      label: t(translationKey)
    };
  });

  const filteredIntegrations = integrations.filter((integration) => {
    const matchesSearch = integration.name.toLowerCase().includes(searchTerm);
    const categoryId = categories.find(
      (cat) => cat.label === integration.category
    )?.id;
    const matchesCategory =
      selectedCategory === "all" || selectedCategory === categoryId;

    return matchesSearch && matchesCategory;
  });

  const integrationsByCategory = filteredIntegrations.reduce(
    (acc, integration) => {
      const categoryId = categories.find(cat => cat.label === integration.category)?.id;
      let translatedCategoryLabel = integration.category;
      if (categoryId) {
        let translationKey = `integrations.categories.${categoryId}`;
        if (categoryId === 'all') {
          translationKey = 'components.settingsWrapper.tabs.allIntegrations';
        }
        translatedCategoryLabel = t(translationKey);
      }

      if (!acc[translatedCategoryLabel]) {
        acc[translatedCategoryLabel] = [];
      }
      acc[translatedCategoryLabel].push(integration);
      return acc;
    },
    {} as { [key: string]: CatalogCard[] }
  );

  return (
    <SettingsWrapper selectedTab="integrations" loading={wrapperLoading}>
      <PageContainer background="transparent" padding="none">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <OnboardingStep
            title={t('pages.settingsIntegration.onboarding.title')}
            subtitle={t('pages.settingsIntegration.onboarding.subtitle')}
            stepId="integrationsSettings"
          >
            <div className="flex flex-col md:flex-row">
              <Card
                variant="ghost"
                padding="md"
                className={cn(
                  "w-full md:w-1/4 mb-8 md:mb-0",
                  "rounded-2xl",
                  "bg-white dark:bg-as-surface",
                  "border border-zinc-200 dark:border-as-line"
                )}
              >
                <h3 className={cn(AS_PANEL_TITLE, "mb-4")}>
                  {t('components.settingsWrapper.tabs.integrations')}
                </h3>
                <div className="mb-4">
                  <SearchBox
                    onSearch={onIntegrationsSearchChange}
                    placeholder={t('pages.settingsIntegration.searchPlaceholder')}
                  />
                </div>
                <SidebarMenu
                  items={translatedCategories}
                  selectedItemId={selectedCategory}
                  onChange={handleMenuChange}
                />
              </Card>

              <div className="w-full md:w-3/4 md:pl-8 p-4 sm:p-6">
                {Object.keys(integrationsByCategory).length === 0 ? (
                  <NotFoundElement
                    onShowAll={() => {
                      setSearchTerm("");
                    }}
                  />
                ) : (
                  Object.keys(integrationsByCategory).map((translatedCategoryName, catIndex) => (
                    <motion.div
                      key={translatedCategoryName}
                      className="mb-8"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: catIndex * 0.1 }}
                    >
                      <h3 className={cn(AS_SECTION_TITLE, "mb-4")}>
                        {translatedCategoryName}
                      </h3>

                      {/* As many columns as the panel holds at 16 rem each: three beside the AppSec rail, two in a narrower space's column, one on a phone. */}
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]">
                        {integrationsByCategory[translatedCategoryName].map((integration) => {
                          const cloudOnlySlot = integration.cloudOnlySlot;
                          const registryType = cloudOnlySlot ? undefined : REGISTRY_TYPE_MAP[integration.name];
                          const credentialCount = registryType && getRegistryCredentialCount
                            ? getRegistryCredentialCount(registryType)
                            : 0;

                          const cardContent = (
                            <Card
                              key={integration.name}
                              variant="default"
                              padding="none"
                              hoverable={integration.available && !cloudOnlySlot}
                              className={cn(
                                "relative group",
                                integration.available && !cloudOnlySlot && "cursor-pointer",
                                "rounded-2xl",
                                "bg-white dark:bg-as-surface",
                                "border border-zinc-200 dark:border-as-line"
                              )}
                            >
                              {/* One compact row per integration: logo, name, then its state on the right; the tiles were 130 px tall for a logo and a word. */}
                              <div
                                data-integration={integration.name}
                                data-cloud-only={cloudOnlySlot}
                                className="flex min-h-[64px] items-center gap-3 px-4 py-3"
                              >
                                <div className={cn("flex min-w-0 flex-1 items-center gap-3", !integration.available && "opacity-60")}>
                                  <img
                                    src={integration.imgSrc}
                                    alt={integration.name}
                                    className={cn(
                                      "h-8 w-8 shrink-0 object-contain",
                                      // A cloud-only card is greyed: its logo, not its words, which keep their contrast.
                                      cloudOnlySlot && "opacity-50 grayscale",
                                      // Monochrome black logos vanish on the dark
                                      // card — invert them to white in dark mode.
                                      isMonochromeDarkLogo(integration.imgSrc) && "dark:invert"
                                    )}
                                  />
                                  <div className="min-w-0">
                                    <p
                                      className={cn(
                                        "truncate text-sm font-medium",
                                        cloudOnlySlot
                                          ? "text-zinc-500 dark:text-zinc-400"
                                          : "text-zinc-900 dark:text-zinc-100",
                                      )}
                                    >
                                      {integration.name}
                                    </p>
                                    {cloudOnlySlot && (
                                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                                        {t('pages.settingsIntegration.cloudOnly.line')}
                                      </p>
                                    )}
                                    {integration.communityNoteKey && (
                                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                                        {t(integration.communityNoteKey)}
                                      </p>
                                    )}
                                    {/* Under the name, so the name keeps its words: the credentials of a registry, or the space that wires the agent. */}
                                    {registryType && credentialCount > 0 && (
                                      <span className={cn(AS_TAG, "mt-1 font-mono tabular-nums")}>
                                        {credentialCount} {t('pages.settingsIntegration.credentialCount', { count: credentialCount })}
                                      </span>
                                    )}
                                    {integration.available && integration.poweredBy && (
                                      <PoweredByBadge space={integration.poweredBy} labelKey={integration.poweredByLabelKey} />
                                    )}
                                    {integration.name === "GitHub" && isGithubLinked && !githubInstallOwnedByCurrentUser && (
                                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                                        {t('pages.settingsIntegration.installedByAnother')}
                                      </p>
                                    )}
                                    {integration.name === "GitLab" && isGitlabLinked && !gitlabInstallOwnedByCurrentUser && (
                                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                                        {t('pages.settingsIntegration.installedByAnother')}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  {/* Soon badge, the wiring space's badge for its agents, loader for GitHub/GitLab while loading */}
                                  {cloudOnlySlot ? (
                                    <a
                                      href={upsellLink(cloudOnlySlot, CLOUD_ONLY_PATH)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      aria-label={t('pages.settingsIntegration.cloudOnly.ctaLabel', { name: integration.name })}
                                      className="whitespace-nowrap text-xs font-medium text-secondary underline underline-offset-2 hover:no-underline dark:text-secondary-light"
                                    >
                                      {t('pages.settingsIntegration.cloudOnly.cta')}
                                    </a>
                                  ) : !integration.available ? (
                                    <span className={AS_TAG}>
                                      {t('pages.settingsIntegration.soon')}
                                    </span>
                                  ) : integration.poweredBy ? (
                                    null
                                  ) : (integration.name === "GitHub" || integration.name === "GitLab") && isLoadingIntegrations ? (
                                    <Loader size="xs" variant="secondary" />
                                  ) : integration.name === "GitLab" && isGitlabLinked && isGitlabReconnectRequired ? (
                                    <span className={cn(AS_STATUS_WORD, WORD_TONE.warning)}>
                                      {t('pages.settingsIntegration.reconnectRequiredStatus')}
                                    </span>
                                  ) : (integration.name === "GitHub" && isGithubLinked) ||
                                    (integration.name === "GitLab" && isGitlabLinked) ||
                                    (integration.name === "Jira" && isJiraLinked) ||
                                    (integration.name === "Linear" && isLinearLinked) ||
                                    (integration.name === "Slack" && isSlackLinked) ? (
                                    <span className={cn(AS_STATUS_WORD, WORD_TONE.good)}>
                                      {t('pages.settingsIntegration.linkedStatus')}
                                    </span>
                                  ) : (
                                    <Cog
                                      className="h-4 w-4 text-zinc-400 dark:text-zinc-500"
                                     />
                                  )}
                                </div>
                              </div>
                            </Card>
                          );

                          // The agents a space wires reuse IDE-plugin names (Cursor,
                          // Windsurf): route them before the name-keyed handlers below.
                          const content = integration.poweredBy && integration.link ? (
                            <Link key={integration.name} to={integration.link}>
                              {cardContent}
                            </Link>
                          ) : integration.name === "GitLab" ? (
                            <div
                              key={integration.name}
                              onClick={() => {
                                // Connected: the modal (reconnect, disconnect)
                                // opens for every member who sees this page;
                                // not connected: GitLab's OAuth.
                                if (isGitlabLinked) {
                                  setShowGitlabIntegrationModal(true);
                                } else {
                                  onGitlabClick();
                                }
                              }}
                              className="cursor-pointer"
                            >
                              {cardContent}
                            </div>
                          ) : integration.name === "GitHub" ? (
                            <div
                              key={integration.name}
                              onClick={() => {
                                if (!isGithubLinked || githubInstallOwnedByCurrentUser) {
                                  onGithubClick();
                                }
                              }}
                              className={(!githubInstallOwnedByCurrentUser && isGithubLinked) ? 'pointer-events-none opacity-75' : ''}
                            >
                              {cardContent}
                            </div>
                          ) : integration.name === "GitHub Issues" ? (
                            <div
                              key={integration.name}
                              onClick={() => handleIssueIntegrationClick("github")}
                              className="cursor-pointer"
                            >
                              {cardContent}
                            </div>
                          ) : integration.name === "GitLab Issues" ? (
                            <div
                              key={integration.name}
                              onClick={() => handleIssueIntegrationClick("gitlab")}
                              className="cursor-pointer"
                            >
                              {cardContent}
                            </div>
                          ) : integration.name === "GitLab Registry" ? (
                            <div
                              key={integration.name}
                              onClick={() => setOpenRegistry("gitlab")}
                            >
                              {cardContent}
                            </div>
                          ) : integration.name === "Docker Hub" ? (
                            <div
                              key={integration.name}
                              onClick={() => setOpenRegistry("dockerhub")}
                            >
                              {cardContent}
                            </div>
                          ) : integration.name === "GCR" ? (
                            <div
                              key={integration.name}
                              onClick={() => setOpenRegistry("gcr")}
                            >
                              {cardContent}
                            </div>
                          ) : integration.name === "GitHub Container Registry" ? (
                            <div
                              key={integration.name}
                              onClick={() => setOpenRegistry("github")}
                            >
                              {cardContent}
                            </div>
                          ) : integration.name === "ECR" ? (
                            <div
                              key={integration.name}
                              onClick={() => setOpenRegistry("ecr")}
                            >
                              {cardContent}
                            </div>
                          ) : integration.name === "ACR" ? (
                            <div
                              key={integration.name}
                              onClick={() => setOpenRegistry("acr")}
                            >
                              {cardContent}
                            </div>
                          ) : integration.name === "Quay" ? (
                            <div
                              key={integration.name}
                              onClick={() => setOpenRegistry("quay")}
                            >
                              {cardContent}
                            </div>
                          ) : integration.name === "Harbor" ? (
                            <div
                              key={integration.name}
                              onClick={() => setOpenRegistry("harbor")}
                            >
                              {cardContent}
                            </div>
                          ) : integration.name === "JFrog Artifactory" ? (
                            <div
                              key={integration.name}
                              onClick={() => setOpenRegistry("jfrog")}
                            >
                              {cardContent}
                            </div>
                          ) : integration.name === "Scaleway" ? (
                            <div
                              key={integration.name}
                              onClick={() => setOpenRegistry("scaleway")}
                            >
                              {cardContent}
                            </div>
                          ) : integration.name === "Slack" ? (
                            <div
                              key={integration.name}
                              onClick={() => setShowSlackIntegrationModal(true)}
                              className="cursor-pointer"
                            >
                              {cardContent}
                            </div>
                          ) : integration.name === "Jira" ? (
                            <div
                              key={integration.name}
                              onClick={() => setShowJiraIntegrationModal(true)}
                              className="cursor-pointer"
                            >
                              {cardContent}
                            </div>
                          ) : integration.name === "Linear" ? (
                            <div
                              key={integration.name}
                              onClick={() => setShowLinearIntegrationModal(true)}
                              className="cursor-pointer"
                            >
                              {cardContent}
                            </div>
                          ) : COMMUNITY && integration.name === "Cybe MCP" ? (
                            <div
                              key={integration.name}
                              onClick={() => setShowCommunityMcpModal(true)}
                              className="cursor-pointer"
                            >
                              {cardContent}
                            </div>
                          ) : integration.name === "Cursor" ? (
                            <div
                              key={integration.name}
                              onClick={() => setShowCursorInstallModal(true)}
                              className="cursor-pointer"
                            >
                              {cardContent}
                            </div>
                          ) : integration.link ? (
                            <Link key={integration.name} to={integration.link}>
                              {cardContent}
                            </Link>
                          ) : (
                            <div key={integration.name}>
                              {cardContent}
                            </div>
                          );

                          const isContainerRegistry = integration.category === 'Container registries';
                          const isIssueTracking = integration.category === 'Issue Tracking';
                          const isCybeDefendApi = integration.name === 'CybeDefend API';
                          const isGithubActions = integration.name === 'GitHub Actions';
                          const isPatGated = (isCybeDefendApi || isGithubActions) && disabledFeatures.has('pat');
                          const isSlackGated = integration.name === 'Slack' && disabledFeatures.has('slack');
                          const isGated =
                            (isContainerRegistry && disabledFeatures.has('container_registry')) ||
                            (isIssueTracking && (disabledFeatures.has('github_issues') || disabledFeatures.has('gitlab_issues'))) ||
                            isPatGated ||
                            isSlackGated;

                          // Coming soon, or cloud-only in the Community Edition: recognisable
                          // but inert, with no handler or upgrade overlay (a cloud-only card's
                          // one control is its link to the cloud).
                          if (!integration.available || cloudOnlySlot) {
                            return (
                              <div key={integration.name}>
                                {cardContent}
                              </div>
                            );
                          }

                          if (writesBlocked) {
                            return (
                              <UpgradePlanOverlay
                                key={integration.name}
                                title={t('billing.trial.widget.exhausted_title')}
                                subtitle={t('billing.read_only_integration_disabled')}
                              >
                                {cardContent}
                              </UpgradePlanOverlay>
                            );
                          }

                          if (isGated) {
                            return (
                              <UpgradePlanOverlay
                                key={integration.name}
                                subtitle={isIssueTracking
                                  ? t('billing.issue_tracking_locked')
                                  : isPatGated
                                  ? t('billing.feature_locked_pat')
                                  : isSlackGated
                                  ? t('billing.feature_locked_slack')
                                  : undefined
                                }
                              >
                                {cardContent}
                              </UpgradePlanOverlay>
                            );
                          }

                          return content;
                        })}
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </div>
          </OnboardingStep>
        </motion.div>
      </PageContainer>

      {/* Issue Integration Info Modal */}
      {issueModalType && (
        <IssueIntegrationInfoModal
          integrationType={issueModalType}
          onClose={closeIssueModal}
        />
      )}

      {/* Container registry credential modal, handed by the edition layer
          (cloud only): the Community Edition greys the cards and
          opens nothing. */}
      {openRegistry && ACTIVE_EXTENSIONS.containerRegistries && (
        <ACTIVE_EXTENSIONS.containerRegistries.CredentialModal
          type={openRegistry}
          onClose={() => {
            setOpenRegistry(null);
            onCredentialsChange?.();
          }}
        />
      )}

      {/* GitLab Integration Modal */}
      {showGitlabIntegrationModal && organizationId && (
        <GitlabIntegrationModal
          organizationId={organizationId}
          installedByCurrentUser={gitlabInstallOwnedByCurrentUser}
          reconnectRequired={isGitlabReconnectRequired}
          canManage={canManageGitlab}
          onReconnect={() => onGitlabReconnect?.()}
          onDisconnected={() => {
            setShowGitlabIntegrationModal(false);
            onCredentialsChange?.();
          }}
          onClose={() => setShowGitlabIntegrationModal(false)}
        />
      )}

      {/* Slack Integration Modal */}
      {showSlackIntegrationModal && (
        <SlackIntegrationModal
          onClose={() => {
            setShowSlackIntegrationModal(false);
            onCredentialsChange?.();
          }}
        />
      )}

      {/* Jira Integration Modal */}
      {showJiraIntegrationModal && (
        <JiraIntegrationModal
          onClose={() => {
            setShowJiraIntegrationModal(false);
            onCredentialsChange?.();
          }}
        />
      )}

      {/* Linear Integration Modal */}
      {showLinearIntegrationModal && (
        <LinearIntegrationModal
          onClose={() => {
            setShowLinearIntegrationModal(false);
            onCredentialsChange?.();
          }}
        />
      )}

      {/* Cursor Install Modal */}
      {showCursorInstallModal && (
        <CursorInstallModal onClose={() => setShowCursorInstallModal(false)} />
      )}
      {showCommunityMcpModal && (
        <CommunityMcpModal onClose={() => setShowCommunityMcpModal(false)} />
      )}
    </SettingsWrapper>
  );
};

export default SettingsOrganizationIntegrationTemplate;
