import LoaderHome from "@/components/atoms/loader/LoaderHome";
import {
  installLinearIntegration,
  linearRefusalOf,
} from "@/server/services/integrations/linearIntegrationsService";
import { RootState } from "@/server/store";
import React, { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";

// Registered at Linear as the OAuth redirect URI: this path never moves.
const LINEAR_REDIRECT_URI = `${window.location.origin}/integrations/linear/callback`;
const INTEGRATIONS_PAGE = "/organization/settings/integrations";

export const IntegrationLinearCallbackPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const organization = useSelector((state: RootState) => state.organization);
  const appState = useSelector((state: RootState) => state.app);
  const organizationId = organization.selectedOrganization?.id || "";

  const hasProcessedRef = useRef(false);
  const [isProcessing, setIsProcessing] = useState(false);

  /**
   * Tells the window that opened this popup how it went, then closes; without
   * an opener (the page was opened directly) it goes back to the integrations
   * page. A refusal of the closed list travels as its code so the opener can
   * show the fixed sentence; the server's text never does.
   */
  const finish = (result: "success" | "error", refusalCode?: string) => {
    if (window.opener) {
      window.opener.postMessage(
        refusalCode
          ? { type: `linear-oauth-${result}`, code: refusalCode }
          : { type: `linear-oauth-${result}` },
        window.location.origin
      );
      window.close();
    } else {
      navigate(INTEGRATIONS_PAGE);
    }
  };

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
    const savedState = sessionStorage.getItem("linear_oauth_state");
    sessionStorage.removeItem("linear_oauth_state");

    window.history.replaceState({}, document.title, window.location.pathname);

    if (!state || state !== savedState) {
      // CSRF detected — state mismatch
      finish("error");
      return;
    }

    if (!code || !organizationId || organizationId.trim() === "") {
      finish("error");
      return;
    }

    hasProcessedRef.current = true;
    setIsProcessing(true);

    installLinearIntegration(organizationId, {
      code,
      redirectUri: LINEAR_REDIRECT_URI,
      state,
    })
      .then(() => finish("success"))
      .catch((error) => finish("error", linearRefusalOf(error) ?? undefined))
      .finally(() => {
        setIsProcessing(false);
      });
  }, [appState.isAppInitialized, appState.isDataStable, organizationId]);

  return <LoaderHome />;
};

export default IntegrationLinearCallbackPage;
