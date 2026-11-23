import LoaderHome from "@/components/atoms/loader/LoaderHome";
import { installSlackIntegration } from "@/server/services/integrations/slackIntegrationsService";
import { RootState } from "@/server/store";
import React, { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";

const SLACK_REDIRECT_URI = `${window.location.origin}/integrations/slack/callback`;

export const IntegrationSlackCallbackPage: React.FC = () => {
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

    window.history.replaceState({}, document.title, window.location.pathname);

    if (!code || !state || !organizationId || organizationId.trim() === "") {
      // If opened in a popup, close it; otherwise redirect
      if (window.opener) {
        window.opener.postMessage({ type: "slack-oauth-error" }, window.location.origin);
        window.close();
      } else {
        navigate("/organization/settings/integrations");
      }
      return;
    }

    hasProcessedRef.current = true;
    setIsProcessing(true);

    installSlackIntegration(organizationId, {
      code,
      redirectUri: SLACK_REDIRECT_URI,
      state,
    })
      .then(() => {
        if (window.opener) {
          window.opener.postMessage({ type: "slack-oauth-success" }, window.location.origin);
          window.close();
        } else {
          navigate("/organization/settings/integrations");
        }
      })
      .catch(() => {
        if (window.opener) {
          window.opener.postMessage({ type: "slack-oauth-error" }, window.location.origin);
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

export default IntegrationSlackCallbackPage;
