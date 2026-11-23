import React, { useState, useEffect } from "react";
import { AS_STATUS_WORD } from "@/components/atoms/appsec/recipes";
import { AS_WORD_TONE } from "@/components/atoms/appsec/styles";
import { cn } from "@/utils/function/utils";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import Button from "@/components/atoms/button/Button";
import Modal from "@/components/atoms/modal/Modal";
import { Skeleton } from "@/components/atoms/skeleton/Skeleton";
import { RootState } from "@/server/store";
import ConfirmationModal from "@/components/molecules/modal/confirmation-modal/ConfirmationModal";
import {
  getJiraInstallation,
  getJiraOAuthUrl,
  disconnectJira,
  JiraInstallation,
} from "@/server/services/integrations/jiraIntegrationsService";
import { integrationNotConfiguredOf } from "@/server/services/integrations/integrationNotConfigured";
import IntegrationNotConfiguredMessage from "@/components/molecules/integration-not-configured/IntegrationNotConfiguredMessage";

interface JiraIntegrationModalProps {
  onClose: () => void;
}

const JiraIntegrationModal: React.FC<JiraIntegrationModalProps> = ({
  onClose,
}) => {
  const { t } = useTranslation();
  const organization = useSelector(
    (state: RootState) => state.organization
  );
  const organizationId = organization.selectedOrganization?.id || "";

  const [installation, setInstallation] = useState<JiraInstallation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const fetchInstallation = () => {
    if (!organizationId) return;
    setIsLoading(true);
    getJiraInstallation(organizationId)
      .then((data) => {
        // 200 + isConfigured=false means "no integration", which is a normal
        // answer, not an error. A rejection below is now a genuine failure.
        setInstallation(data.isConfigured ? data : null);
      })
      .catch(() => {
        setInstallation(null);
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    fetchInstallation();
  }, [organizationId]);

  // Listen for OAuth popup completion
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "jira-oauth-success") {
        toast.success(t("components.jiraIntegration.installSuccess"));
        fetchInstallation();
      } else if (event.data?.type === "jira-oauth-error") {
        toast.error(t("components.jiraIntegration.installError"));
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [organizationId]);

  const handleConnect = async () => {
    try {
      const { installUrl } = await getJiraOAuthUrl(organizationId);
      // Extract state from the server-generated URL for client-side validation
      const urlObj = new URL(installUrl);
      const state = urlObj.searchParams.get("state") || "";
      sessionStorage.setItem("jira_oauth_state", state);
      window.open(installUrl, "_blank", "width=600,height=700");
    } catch (error) {
      const notConfigured = integrationNotConfiguredOf(error);
      toast.error(
        notConfigured
          ? <IntegrationNotConfiguredMessage provider={notConfigured} />
          : t("components.jiraIntegration.installError")
      );
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await disconnectJira(organizationId);
      setInstallation(null);
      toast.success(t("components.jiraIntegration.disconnectSuccess"));
    } catch {
      toast.error(t("components.jiraIntegration.disconnectError"));
    } finally {
      setIsDisconnecting(false);
      setShowDisconnectConfirm(false);
    }
  };

  return (
    <>
      <Modal
        title={t("components.jiraIntegration.title")}
        onClose={onClose}
        size="md"
        footerButtons={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t("common.close")}
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : installation ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <img
                  src="/image/integrations/jira.png"
                  alt="Jira"
                  className="w-8 h-8"
                />
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {installation.siteName}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t("components.jiraIntegration.connectedSince", {
                      date: new Date(installation.createdAt).toLocaleDateString(),
                    })}
                  </p>
                </div>
                {/* « Connected » in green: the word carries the status (no dot). */}
                <span className={cn("ml-auto", AS_STATUS_WORD, AS_WORD_TONE.good)}>
                  {t("components.jiraIntegration.connected")}
                </span>
              </div>

              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                {t("components.jiraIntegration.connectedDescription")}
              </p>

              <Button
                variant="destructive"
                onClick={() => setShowDisconnectConfirm(true)}
                disabled={isDisconnecting}
              >
                {t("components.jiraIntegration.disconnect")}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <img
                  src="/image/integrations/jira.png"
                  alt="Jira"
                  className="w-10 h-10"
                />
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t("components.jiraIntegration.notConnected")}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t("components.jiraIntegration.notConnectedDescription")}
                  </p>
                </div>
              </div>

              <Button variant="primary" onClick={handleConnect}>
                {t("components.jiraIntegration.connectButton")}
              </Button>
            </div>
          )}
        </div>
      </Modal>

      {showDisconnectConfirm && (
        <ConfirmationModal
          text={t("components.jiraIntegration.disconnectConfirmMessage")}
          onConfirm={handleDisconnect}
          onCancel={() => setShowDisconnectConfirm(false)}
          isLoading={isDisconnecting}
        />
      )}
    </>
  );
};

export default JiraIntegrationModal;
