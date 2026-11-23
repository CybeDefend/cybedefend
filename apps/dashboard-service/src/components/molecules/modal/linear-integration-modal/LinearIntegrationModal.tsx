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
  getLinearInstallation,
  getLinearOAuthUrl,
  disconnectLinear,
  linearRefusalKey,
  linearRefusalOf,
  LINEAR_REFUSALS,
  LinearInstallation,
  LinearRefusal,
} from "@/server/services/integrations/linearIntegrationsService";
import { integrationNotConfiguredOf } from "@/server/services/integrations/integrationNotConfigured";
import IntegrationNotConfiguredMessage from "@/components/molecules/integration-not-configured/IntegrationNotConfiguredMessage";

interface LinearIntegrationModalProps {
  onClose: () => void;
}

/** Read by the callback page, which compares it with the `state` Linear hands back. */
const LINEAR_STATE_KEY = "linear_oauth_state";

/**
 * The refusal a window message carries: its `code`, only when that is one of
 * the closed list. A message is data from another window (the popup), so
 * anything else is dropped and the generic sentence is shown.
 */
const refusalOfMessage = (code: unknown): LinearRefusal | null =>
  typeof code === "string" && (LINEAR_REFUSALS as readonly string[]).includes(code)
    ? (code as LinearRefusal)
    : null;

const LinearIntegrationModal: React.FC<LinearIntegrationModalProps> = ({
  onClose,
}) => {
  const { t } = useTranslation();
  const organization = useSelector(
    (state: RootState) => state.organization
  );
  const organizationId = organization.selectedOrganization?.id || "";

  const [installation, setInstallation] = useState<LinearInstallation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const fetchInstallation = () => {
    if (!organizationId) return;
    setIsLoading(true);
    getLinearInstallation(organizationId)
      .then((data) => {
        // 200 + isConfigured=false means "no integration", which is a normal
        // answer, not an error. A rejection below is a genuine failure.
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
      if (event.data?.type === "linear-oauth-success") {
        toast.success(t("components.linearIntegration.installSuccess"));
        fetchInstallation();
      } else if (event.data?.type === "linear-oauth-error") {
        // A refusal of the closed list says why (« this workspace is already
        // connected to another organization »); the server's own text never
        // reaches the screen.
        const refusal = refusalOfMessage(event.data?.code);
        toast.error(
          refusal
            ? t(linearRefusalKey(refusal))
            : t("components.linearIntegration.installError")
        );
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [organizationId]);

  const handleConnect = async () => {
    try {
      const { installUrl } = await getLinearOAuthUrl(organizationId);
      // Extract state from the server-generated URL for client-side validation
      const urlObj = new URL(installUrl);
      const state = urlObj.searchParams.get("state") || "";
      sessionStorage.setItem(LINEAR_STATE_KEY, state);
      window.open(installUrl, "_blank", "width=600,height=700");
    } catch (error) {
      const notConfigured = integrationNotConfiguredOf(error);
      const refusal = linearRefusalOf(error);
      toast.error(
        notConfigured
          ? <IntegrationNotConfiguredMessage provider={notConfigured} />
          : refusal
            ? t(linearRefusalKey(refusal))
            : t("components.linearIntegration.installError")
      );
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await disconnectLinear(organizationId);
      setInstallation(null);
      toast.success(t("components.linearIntegration.disconnectSuccess"));
    } catch (error) {
      const refusal = linearRefusalOf(error);
      toast.error(
        refusal
          ? t(linearRefusalKey(refusal))
          : t("components.linearIntegration.disconnectError")
      );
    } finally {
      setIsDisconnecting(false);
      setShowDisconnectConfirm(false);
    }
  };

  const needsReconnect = installation?.needsReconnect === true;

  return (
    <>
      <Modal
        title={t("components.linearIntegration.title")}
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
                  src="/image/integrations/linear.svg"
                  alt="Linear"
                  className="w-8 h-8"
                />
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {installation.workspaceName}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t("components.linearIntegration.connectedSince", {
                      date: new Date(installation.createdAt).toLocaleDateString(),
                    })}
                  </p>
                </div>
                {/* The word carries the status (no dot): « Connected » in green, « Reconnection required » in amber. */}
                <span
                  className={cn(
                    "ml-auto",
                    AS_STATUS_WORD,
                    needsReconnect ? AS_WORD_TONE.warning : AS_WORD_TONE.good
                  )}
                >
                  {t(
                    needsReconnect
                      ? "components.linearIntegration.reconnectRequired"
                      : "components.linearIntegration.connected"
                  )}
                </span>
              </div>

              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                {t(
                  needsReconnect
                    ? "components.linearIntegration.reconnectDescription"
                    : "components.linearIntegration.connectedDescription"
                )}
              </p>

              <div className="flex flex-wrap gap-2">
                {needsReconnect && (
                  <Button
                    variant="primary"
                    onClick={handleConnect}
                    disabled={isDisconnecting}
                  >
                    {t("components.linearIntegration.reconnectButton")}
                  </Button>
                )}
                <Button
                  variant="destructive"
                  onClick={() => setShowDisconnectConfirm(true)}
                  disabled={isDisconnecting}
                >
                  {t("components.linearIntegration.disconnect")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <img
                  src="/image/integrations/linear.svg"
                  alt="Linear"
                  className="w-10 h-10"
                />
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t("components.linearIntegration.notConnected")}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t("components.linearIntegration.notConnectedDescription")}
                  </p>
                </div>
              </div>

              <Button variant="primary" onClick={handleConnect}>
                {t("components.linearIntegration.connectButton")}
              </Button>
            </div>
          )}
        </div>
      </Modal>

      {showDisconnectConfirm && (
        <ConfirmationModal
          title={t("components.linearIntegration.disconnectConfirmTitle")}
          text={t("components.linearIntegration.disconnectConfirmMessage")}
          onConfirm={handleDisconnect}
          onCancel={() => setShowDisconnectConfirm(false)}
          isLoading={isDisconnecting}
        />
      )}
    </>
  );
};

export default LinearIntegrationModal;
