import { RootState } from "@/server/store";
import React, { useEffect, useState } from "react";
import { useAuthorization, useRebac } from "react-rebac";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";
import { useOnboardingProgress } from "@/server/hooks/useOnboardingProgress";
import { useEditionEntitlements } from "@/edition/entitlements";

import { useIntegrationsOverview } from "@/server/hooks/useIntegrationsOverview";
import { generateGitlabInstallUrl } from "@/server/services/integrations/gitlabIntegrationsService";
import { integrationNotConfiguredOf } from "@/server/services/integrations/integrationNotConfigured";
import IntegrationNotConfiguredMessage from "@/components/molecules/integration-not-configured/IntegrationNotConfiguredMessage";
import { getGithubAppUrl } from "@/config/runtimeConfig";
import { openGithubAppInstall } from "@/pages/integrations-page/shared/githubAppInstall";

import SettingsOrganizationIntegrationTemplate from "./SettingsOrganizationIntegrationTemplate";

const ProjectIntegrationPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { complete } = useOnboardingProgress();

  const selectedOrganization = useSelector(
    (state: RootState) => state.organization.selectedOrganization
  );
  // manage_integration is granted through writable_any (Permify): an active
  // product of another space keeps the integrations open over a read-only AppSec.
  const writesBlocked = !useEditionEntitlements().writableAny;
  const user = useSelector((state: RootState) => state.user);
  const isProfileLoaded = user.isProfileLoaded;

  const { userEntities } = useRebac();
  const areUserEntitiesLoaded = userEntities && userEntities.length > 0;

  const isAuthorized = useAuthorization(
    selectedOrganization?.id || "",
    "organization",
    ["creator", "administrator", "manager", "member"]
  );
  // Permify grants manage_integration to these roles only: a plain member
  // gets no « Reconnecter » / « Déconnecter » the gateway would refuse.
  const canManageIntegrations = useAuthorization(
    selectedOrganization?.id || "",
    "organization",
    ["creator", "administrator", "manager"]
  );

  const [wrapperLoading, setWrapperLoading] = useState(true);

  // Use the consolidated integrations overview hook (single API call). Jira,
  // Linear and Slack install state are now part of the same payload, so the
  // standalone /jira/installation + /slack/installation calls are gone.
  const {
    isGithubLinked,
    isGitlabLinked,
    isJiraLinked,
    isLinearLinked,
    isSlackLinked,
    isGitlabReconnectRequired,
    githubInstallationOwnerId,
    gitlabInstallationOwnerId,
    getRegistryCountByType,
    refetch: refetchIntegrations,
    isLoading: isLoadingIntegrations,
  } = useIntegrationsOverview(selectedOrganization?.id);

  useEffect(() => {
    if (isProfileLoaded && areUserEntitiesLoaded) {
      if (!isAuthorized) {
        toast.error(t('errors.authorization.notAuthorized'));
        navigate("/");
      }

      if (isAuthorized && selectedOrganization) {
        setWrapperLoading(false);
      }
    }
  }, [
    isAuthorized,
    selectedOrganization,
    navigate,
    isProfileLoaded,
    areUserEntitiesLoaded,
    t,
  ]);

  // Mark integration_linked if any integration is already connected
  useEffect(() => {
    if (isGithubLinked || isGitlabLinked) {
      complete('integration_linked');
    }
  }, [isGithubLinked, isGitlabLinked]);

  const startGitlabInstall = async () => {
    if (!selectedOrganization?.id) return;

    try {
      const data = await generateGitlabInstallUrl(selectedOrganization.id);
      window.location.href = data.installUrl;
    } catch (error) {
      console.error("Error generating GitLab install URL:", error);
      const notConfigured = integrationNotConfiguredOf(error);
      toast.error(
        notConfigured
          ? <IntegrationNotConfiguredMessage provider={notConfigured} />
          : t('pages.settingsIntegration.gitlabInstallError')
      );
    }
  };

  const handleGitlabClick = async () => {
    // If an installation exists and is owned by another user, block installing
    if (
      isGitlabLinked &&
      gitlabInstallationOwnerId &&
      user?.id &&
      gitlabInstallationOwnerId !== user.id
    ) {
      toast.info(t('pages.settingsIntegration.alreadyInstalledByAnother'));
      return;
    }

    await startGitlabInstall();
  };

  const handleGithubClick = () => {
    // If an installation exists and is owned by another user, block installing
    if (
      isGithubLinked &&
      githubInstallationOwnerId &&
      user?.id &&
      githubInstallationOwnerId !== user.id
    ) {
      toast.info(t('pages.settingsIntegration.alreadyInstalledByAnother'));
      return;
    }
    const url = getGithubAppUrl();
    if (url && selectedOrganization?.id) {
      openGithubAppInstall(selectedOrganization.id, url).catch((error) => {
        console.error('Error starting the GitHub App installation:', error);
        toast.error(t('pages.integration.github.integration.error'));
      });
    } else {
      // No GitHub App address: GitHub is not set up on this instance.
      toast.error(<IntegrationNotConfiguredMessage provider="github" />);
    }
  };

  return (
    <SettingsOrganizationIntegrationTemplate
      wrapperLoading={wrapperLoading}
      isGithubLinked={isGithubLinked}
      isGitlabLinked={isGitlabLinked}
      isJiraLinked={isJiraLinked}
      isLinearLinked={isLinearLinked}
      isSlackLinked={isSlackLinked}
      isLoadingIntegrations={isLoadingIntegrations}
      onGitlabClick={handleGitlabClick}
      onGithubClick={handleGithubClick}
      isGitlabReconnectRequired={isGitlabReconnectRequired}
      // The modal shows « Reconnecter » only to the installer or on a broken
      // connection, so it skips the « installed by another member » check.
      onGitlabReconnect={startGitlabInstall}
      canManageGitlab={canManageIntegrations}
      githubInstallOwnedByCurrentUser={
        !!(githubInstallationOwnerId && user?.id && githubInstallationOwnerId === user.id)
      }
      gitlabInstallOwnedByCurrentUser={
        !!(gitlabInstallationOwnerId && user?.id && gitlabInstallationOwnerId === user.id)
      }
      getRegistryCredentialCount={getRegistryCountByType}
      onCredentialsChange={refetchIntegrations}
      writesBlocked={writesBlocked}
      organizationId={selectedOrganization?.id}
    />
  );
};

export default ProjectIntegrationPage;
