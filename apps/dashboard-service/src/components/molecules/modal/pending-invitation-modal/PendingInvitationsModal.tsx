import Button from "@/components/atoms/button/Button";
import Modal from "@/components/atoms/modal/Modal";
import { OrganizationInviteResponseDto } from "@/server/interfaces/Organization";
import React from "react";
import { useTranslation } from "react-i18next";

import { AS_DIVIDE, AS_THEAD, AS_TH, AS_TR, AS_TD, AS_TD_STRONG } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';
interface PendingInvitationsModalProps {
  invitations: OrganizationInviteResponseDto[];
  onClose: () => void;
  onCancelInvitation: (invitationId: string) => void;
  loading?: boolean;
  error?: string | null;
}

const PendingInvitationsModal: React.FC<PendingInvitationsModalProps> = ({
  invitations,
  onClose,
  onCancelInvitation,
  loading = false,
  error = null,
}) => {
  const { t } = useTranslation();

  return (
    <Modal
      title={t('components.modal.pendingInvitations.title')}
      onClose={onClose}
      width="max-w-3xl"
      footerButtons={
        <Button variant="white" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      {loading ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{t('common.loading_resource', { resource: 'invitations' })}</p>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : invitations.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{t('components.modal.pendingInvitations.noPendingInvitations')}</p>
      ) : (
        <table className={cn("min-w-full mt-4", AS_DIVIDE)}>
          <thead className={AS_THEAD}>
            <tr>
              <th className={AS_TH}>
                {t('components.modal.pendingInvitations.email')}
              </th>
              <th className={AS_TH}>
                {t('components.modal.pendingInvitations.role')}
              </th>
              <th className={AS_TH}>
                {t('components.modal.pendingInvitations.expiresAt')}
              </th>
              <th className={cn(AS_TH, "text-right")}>
                {t('common.action')}
              </th>
            </tr>
          </thead>
          <tbody className={AS_DIVIDE}>
            {invitations.map((inv) => (
              <tr
                key={inv.id}
                className={AS_TR}
              >
                <td className={cn(AS_TD, AS_TD_STRONG)}>
                  {inv.email}
                </td>
                <td className={AS_TD}>
                  {inv.organizationRole}
                </td>
                <td className={cn(AS_TD, "font-mono text-xs tabular-nums")}>
                  {new Date(inv.expiresAt).toLocaleString()}
                </td>
                <td className={cn(AS_TD, "py-1.5 text-right")}>
                  <Button variant="white" onClick={() => onCancelInvitation(inv.id)}>
                    {t('common.cancel')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
};

export default PendingInvitationsModal;
