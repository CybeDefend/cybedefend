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
import { getSlackClientId } from "@/config/runtimeConfig";
import {
  getSlackInstallation,
  disconnectSlack,
  createSlackOAuthState,
  SlackInstallation,
} from "@/server/services/integrations/slackIntegrationsService";

interface SlackIntegrationModalProps {
  onClose: () => void;
}

const SLACK_REDIRECT_URI = `${window.location.origin}/integrations/slack/callback`;
const SLACK_SCOPES = "chat:write,channels:read,groups:read";

const SlackIntegrationModal: React.FC<SlackIntegrationModalProps> = ({
  onClose,
}) => {
  const { t } = useTranslation();
  const organization = useSelector(
    (state: RootState) => state.organization
  );
  const organizationId = organization.selectedOrganization?.id || "";

  const [installation, setInstallation] = useState<SlackInstallation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const fetchInstallation = () => {
    if (!organizationId) return;
    setIsLoading(true);
    getSlackInstallation(organizationId)
      .then((data) => {
        // 200 + isConfigured=false means "no integration", which is a normal
        // answer, not an error. A rejection below is now a genuine failure.
        setInstallation(data.isConfigured ? data : null);
      })
      .catch((err) => {
        console.error("Failed to fetch Slack installation:", err);
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
      if (event.data?.type === "slack-oauth-success") {
        toast.success(t("components.slackIntegration.installSuccess"));
        fetchInstallation();
      } else if (event.data?.type === "slack-oauth-error") {
        toast.error(t("components.slackIntegration.installError"));
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [organizationId]);

  const handleConnect = async () => {
    // Opened synchronously in the click: a window.open after an await is
    // blocked by popup blockers. It is pointed at Slack once the gateway has
    // issued the single-use state the callback must send back.
    const popup = window.open("", "_blank", "width=600,height=700");
    if (!popup) {
      toast.error(t("components.slackIntegration.installError"));
      return;
    }
    try {
      const state = await createSlackOAuthState(organizationId);
      popup.location.href = `https://slack.com/oauth/v2/authorize?client_id=${getSlackClientId()}&scope=${SLACK_SCOPES}&redirect_uri=${encodeURIComponent(SLACK_REDIRECT_URI)}&state=${encodeURIComponent(state)}`;
    } catch (err) {
      console.error("Failed to start the Slack installation:", err);
      popup.close();
      toast.error(t("components.slackIntegration.installError"));
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await disconnectSlack(organizationId);
      setInstallation(null);
      toast.success(t("components.slackIntegration.disconnectSuccess"));
    } catch {
      toast.error(t("components.slackIntegration.disconnectError"));
    } finally {
      setIsDisconnecting(false);
      setShowDisconnectConfirm(false);
    }
  };

  return (
    <>
      <Modal
        title={t("components.slackIntegration.title")}
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
                  src="/image/integrations/slack.png"
                  alt="Slack"
                  className="w-8 h-8"
                />
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {installation.teamName}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t("components.slackIntegration.connectedSince", {
                      date: new Date(installation.createdAt).toLocaleDateString(),
                    })}
                  </p>
                </div>
                {/* « Connected » in green: the word carries the status (no dot). */}
                <span className={cn("ml-auto", AS_STATUS_WORD, AS_WORD_TONE.good)}>
                  {t("components.slackIntegration.connected")}
                </span>
              </div>

              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                {t("components.slackIntegration.connectedDescription")}
              </p>

              <Button
                variant="destructive"
                onClick={() => setShowDisconnectConfirm(true)}
                disabled={isDisconnecting}
              >
                {t("components.slackIntegration.disconnect")}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <img
                  src="/image/integrations/slack.png"
                  alt="Slack"
                  className="w-10 h-10"
                />
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t("components.slackIntegration.notConnected")}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t("components.slackIntegration.notConnectedDescription")}
                  </p>
                </div>
              </div>

              <Button variant="primary" onClick={handleConnect}>
                {t("components.slackIntegration.connectButton")}
              </Button>
            </div>
          )}
        </div>
      </Modal>

      {showDisconnectConfirm && (
        <ConfirmationModal
          text={t("components.slackIntegration.disconnectConfirmMessage")}
          onConfirm={handleDisconnect}
          onCancel={() => setShowDisconnectConfirm(false)}
          isLoading={isDisconnecting}
        />
      )}
    </>
  );
};

export default SlackIntegrationModal;
