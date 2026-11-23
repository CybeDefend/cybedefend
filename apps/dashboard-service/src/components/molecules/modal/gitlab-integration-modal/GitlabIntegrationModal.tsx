import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import { AS_STATUS_WORD } from "@/components/atoms/appsec/recipes";
import { AS_WORD_TONE } from "@/components/atoms/appsec/styles";
import Button from "@/components/atoms/button/Button";
import Modal from "@/components/atoms/modal/Modal";
import ConfirmationModal from "@/components/molecules/modal/confirmation-modal/ConfirmationModal";
import { disconnectGitlab } from "@/server/services/integrations/gitlabIntegrationsService";
import { cn } from "@/utils/function/utils";

interface GitlabIntegrationModalProps {
  organizationId: string;
  /** The connection was made by the member looking at it. */
  installedByCurrentUser: boolean;
  /** GitLab refused the connection's refresh token. */
  reconnectRequired: boolean;
  /**
   * The member holds `manage_integration` on the organization (creator,
   * administrator or manager). Without it the gateway refuses both actions,
   * so neither is offered.
   */
  canManage: boolean;
  /** Starts GitLab's OAuth again (leaves the page). */
  onReconnect: () => void;
  /** The connection is gone: the caller refreshes what it shows. */
  onDisconnected: () => void;
  onClose: () => void;
}

/**
 * The connected GitLab card's modal: its state, « Reconnecter »
 * and « Déconnecter ». The state comes from the integrations overview the
 * page already holds; the modal reads nothing itself.
 */
const GitlabIntegrationModal: React.FC<GitlabIntegrationModalProps> = ({
  organizationId,
  installedByCurrentUser,
  reconnectRequired,
  canManage,
  onReconnect,
  onDisconnected,
  onClose,
}) => {
  const { t } = useTranslation();
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Among the members who manage integrations (`canManage`), any may repair
  // a broken connection; a healthy one is replaced only by the member who
  // made it.
  const canReconnect = installedByCurrentUser || reconnectRequired;

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    let disconnected = false;
    try {
      await disconnectGitlab(organizationId);
      disconnected = true;
      toast.success(t("components.gitlabIntegration.disconnectSuccess"));
    } catch {
      toast.error(t("components.gitlabIntegration.disconnectError"));
    }
    setIsDisconnecting(false);
    setShowDisconnectConfirm(false);
    if (disconnected) onDisconnected();
  };

  return (
    <>
      <Modal
        title={t("components.gitlabIntegration.title")}
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
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <img
              src="/image/integrations/gitlab.png"
              alt="GitLab"
              className="w-8 h-8"
            />
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                GitLab
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t(
                  installedByCurrentUser
                    ? "components.gitlabIntegration.installedByYou"
                    : "components.gitlabIntegration.installedByAnother"
                )}
              </p>
            </div>
            <span
              className={cn(
                "ml-auto",
                AS_STATUS_WORD,
                reconnectRequired ? AS_WORD_TONE.warning : AS_WORD_TONE.good
              )}
            >
              {t(
                reconnectRequired
                  ? "components.gitlabIntegration.reconnectRequired"
                  : "components.gitlabIntegration.connected"
              )}
            </span>
          </div>

          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {t(
              reconnectRequired
                ? "components.gitlabIntegration.reconnectRequiredDescription"
                : "components.gitlabIntegration.connectedDescription"
            )}
          </p>

          {canManage ? (
            <div className="flex flex-wrap gap-2">
              {canReconnect && (
                <Button
                  variant="primary"
                  onClick={onReconnect}
                  disabled={isDisconnecting}
                >
                  {t("components.gitlabIntegration.reconnect")}
                </Button>
              )}
              <Button
                variant="destructive"
                onClick={() => setShowDisconnectConfirm(true)}
                disabled={isDisconnecting}
              >
                {t("components.gitlabIntegration.disconnect")}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {t("components.gitlabIntegration.manageRequiresAdmin")}
            </p>
          )}
        </div>
      </Modal>

      {showDisconnectConfirm && (
        <ConfirmationModal
          title={t("components.gitlabIntegration.disconnectConfirmTitle")}
          message={
            <div className="space-y-2">
              <p>{t("components.gitlabIntegration.disconnectConfirmLinks")}</p>
              <p>{t("components.gitlabIntegration.disconnectConfirmPushScans")}</p>
              <p>{t("components.gitlabIntegration.disconnectConfirmHistoryKept")}</p>
            </div>
          }
          confirmLabel={t("components.gitlabIntegration.disconnectConfirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={handleDisconnect}
          onCancel={() => setShowDisconnectConfirm(false)}
          isLoading={isDisconnecting}
        />
      )}
    </>
  );
};

export default GitlabIntegrationModal;
