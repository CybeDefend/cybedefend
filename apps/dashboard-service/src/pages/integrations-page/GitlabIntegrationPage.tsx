import LoaderHome from "@/components/atoms/loader/LoaderHome";
import { installGitlabIntegration } from "@/server/services/integrations/gitlabIntegrationsService";
import { RootState } from "@/server/store";
import React, { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { projectIntegrationPath } from "./shared/integrationPaths";
import { integrationReturnPath, takeIntegrationReturn } from "./shared/integrationReturn";

export const GitlabIntegrationPage: React.FC = () => {
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
        const state = searchParams.get("state");

        // A connection started from the create-project wizard goes back to it, in
        // the product it left, whatever the answer. Read once: the marker is removed.
        hasProcessedRef.current = true;
        const backTo = takeIntegrationReturn("gitlab");
        const destination = backTo ? integrationReturnPath(backTo, "gitlab") : projectIntegrationPath("gitlab");

        // Clean URL immediately to prevent re-execution on navigation
        window.history.replaceState({}, document.title, window.location.pathname);

        // If code or state are missing, we can't proceed
        if (!code || !state || !organizationId || organizationId.trim() === "") {
            console.error("Missing code, state, or organizationId");
            toast.error(t('pages.integration.gitlab.integration.error'));
            navigate(destination);
            return;
        }

        const payload = {
            code: code,
            state: state
        };

        // Mark as processing to prevent race conditions
        setIsProcessing(true);

        const finalizeIntegration = async () => {
            try {
                await installGitlabIntegration(organizationId, payload);
                toast.success(t('pages.integration.gitlab.integration.success'));
                navigate(destination);
            } catch (error) {
                console.error("Error finalizing GitLab integration:", error);
                toast.error(t('pages.integration.gitlab.integration.error'));
                navigate(destination);
            } finally {
                setIsProcessing(false);
            }
        };

        finalizeIntegration();
    }, [appState.isAppInitialized, appState.isDataStable, organizationId, location.search, navigate, t, isProcessing]);

    return (
        <div className="flex items-center justify-center h-screen">
            <LoaderHome title={t('pages.integration.gitlab.integration.finalizing')} />
        </div>
    );
};
