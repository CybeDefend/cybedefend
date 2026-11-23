import LoaderHome from "@/components/atoms/loader/LoaderHome";
import { installGithubIntegration } from "@/server/services/integrations/githubIntegrationsService";
import { integrationNotConfiguredOf } from "@/server/services/integrations/integrationNotConfigured";
import IntegrationNotConfiguredMessage from "@/components/molecules/integration-not-configured/IntegrationNotConfiguredMessage";
import { RootState } from "@/server/store";
import React, { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { projectIntegrationPath } from "./shared/integrationPaths";
import { integrationReturnPath, takeIntegrationReturn } from "./shared/integrationReturn";

export const IntegrationGithubPage: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const organization = useSelector((state: RootState) => state.organization);
  const appState = useSelector((state: RootState) => state.app);
  const selectedOrganization = organization.selectedOrganization;
  const organizationId = selectedOrganization?.id || "";

  // Prevent multiple executions
  const hasProcessedRef = useRef(false);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    // Wait for app initialization to complete and data to be stable
    if (!appState.isAppInitialized || !appState.isDataStable) {
      return;
    }

    // Prevent multiple executions
    if (hasProcessedRef.current || isProcessing) {
      return;
    }

    const searchParams = new URLSearchParams(location.search);
    const code = searchParams.get("code");
    const installationId = searchParams.get("installation_id");
    const state = searchParams.get("state");

    // A connection started from the create-project wizard goes back to it, in
    // the product it left, whatever the answer. Read once: the marker is removed.
    hasProcessedRef.current = true;
    const backTo = takeIntegrationReturn("github");
    const wizard = backTo ? integrationReturnPath(backTo, "github") : null;
    const onboarding = wizard ?? projectIntegrationPath("github");

    // Clean URL immediately to prevent re-execution on navigation
    window.history.replaceState({}, document.title, window.location.pathname);

    // If code or installationId are missing, we can't proceed
    if (!code || !installationId || !organizationId || organizationId.trim() === "") {
      console.error("Missing code, installationId, or organizationId");
      toast.error(t('pages.integration.github.integration.error'));
      navigate(onboarding);
      return;
    }

    // Only an installation started from this dashboard carries the state the
    // gateway issued: without it, no call is made.
    if (!state) {
      console.error("Missing installation state");
      toast.error(t('pages.integration.github.integration.missingState'));
      navigate(onboarding);
      return;
    }

    const installationIdNumber = parseInt(installationId, 10);
    if (isNaN(installationIdNumber)) {
      console.error("Invalid installation ID");
      toast.error(t('pages.integration.github.integration.error'));
      navigate(onboarding);
      return;
    }

    const payload = {
      code: code,
      installationId: installationIdNumber,
      state
    };

    // Mark as processing to prevent race conditions
    setIsProcessing(true);

    const finalizeIntegration = async () => {
      try {
        await installGithubIntegration(organizationId, payload);
        toast.success(t('pages.integration.github.integration.success'));
        navigate(onboarding);
      } catch (error) {
        console.error("Error finalizing GitHub integration:", error);
        const notConfigured = integrationNotConfiguredOf(error);
        toast.error(
          notConfigured
            ? <IntegrationNotConfiguredMessage provider={notConfigured} />
            : t('pages.integration.github.integration.error')
        );
        navigate(wizard ?? "/organization/settings/integrations");
      } finally {
        setIsProcessing(false);
      }
    };

    finalizeIntegration();
  }, [appState.isAppInitialized, appState.isDataStable, organizationId, location.search, navigate, t, isProcessing]);

  return (
    <div className="flex items-center justify-center h-screen">
      <LoaderHome title={t('pages.integration.github.integration.finalizing')} />
    </div>
  );
};
