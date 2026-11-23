import LoaderHome from "@/components/atoms/loader/LoaderHome";
import { installJiraIntegration } from "@/server/services/integrations/jiraIntegrationsService";
import { RootState } from "@/server/store";
import React, { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";

const JIRA_REDIRECT_URI = `${window.location.origin}/integrations/jira/callback`;

export const IntegrationJiraCallbackPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const organization = useSelector((state: RootState) => state.organization);
  const appState = useSelector((state: RootState) => state.app);
  const organizationId = organization.selectedOrganization?.id || "";

  const hasProcessedRef = useRef(false);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (!appState.isAppInitialized || !appState.isDataStable) {
      return;
    }

    if (hasProcessedRef.current || isProcessing) {
      return;
    }

    const searchParams = new URLSearchParams(location.search);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const savedState = sessionStorage.getItem("jira_oauth_state");
    sessionStorage.removeItem("jira_oauth_state");

    window.history.replaceState({}, document.title, window.location.pathname);

    if (!state || state !== savedState) {
      // CSRF detected — state mismatch
      if (window.opener) {
        window.opener.postMessage({ type: "jira-oauth-error" }, window.location.origin);
        window.close();
      } else {
        navigate("/organization/settings/integrations");
      }
      return;
    }

    if (!code || !organizationId || organizationId.trim() === "") {
      if (window.opener) {
        window.opener.postMessage({ type: "jira-oauth-error" }, window.location.origin);
        window.close();
      } else {
        navigate("/organization/settings/integrations");
      }
      return;
    }

    hasProcessedRef.current = true;
    setIsProcessing(true);

    installJiraIntegration(organizationId, {
      code,
      redirectUri: JIRA_REDIRECT_URI,
      state,
    })
      .then(() => {
        if (window.opener) {
          window.opener.postMessage({ type: "jira-oauth-success" }, window.location.origin);
          window.close();
        } else {
          navigate("/organization/settings/integrations");
        }
      })
      .catch(() => {
        if (window.opener) {
          window.opener.postMessage({ type: "jira-oauth-error" }, window.location.origin);
          window.close();
        } else {
          navigate("/organization/settings/integrations");
        }
      })
      .finally(() => {
        setIsProcessing(false);
      });
  }, [appState.isAppInitialized, appState.isDataStable, organizationId]);

  return <LoaderHome />;
};

export default IntegrationJiraCallbackPage;
