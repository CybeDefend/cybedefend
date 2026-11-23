// ============================================================================
// DeletePolicyModal - Confirmation modal for deleting a policy
// ============================================================================

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Policy } from '@/server/interfaces/Policy';
import Modal from '@/components/atoms/modal/Modal';
import Button from '@/components/atoms/button/Button';
import { AlertTriangle } from '@/components/atoms/icon/icons';

import { AS_WELL } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';
interface DeletePolicyModalProps {
  policy: Policy;
  onClose: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
}

const DeletePolicyModal: React.FC<DeletePolicyModalProps> = ({
  policy,
  onClose,
  onConfirm,
  isLoading = false,
}) => {
  const { t } = useTranslation();

  return (
    <Modal
      title={t('pages.policies.deletePolicy')}
      size="sm"
      onClose={onClose}
      footerButtons={
        <>
          <Button variant="white" onClick={onClose} disabled={isLoading}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} loading={isLoading}>
            {t('common.delete')}
          </Button>
        </>
      }
    >
      <div className="text-center py-4">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center">
          <AlertTriangle
            className="h-6 w-6 text-red-600 dark:text-red-400"
           />
        </div>

        <h3 className="text-base font-medium text-zinc-900 dark:text-zinc-100 mb-1">
          {t('pages.policies.messages.deleteConfirmTitle')}
        </h3>

        <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-4">
          {t('pages.policies.messages.deleteConfirm')}
        </p>

        <div className={cn(AS_WELL, "p-3 text-left")}>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {policy.name}
          </p>
          {policy.description && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              {policy.description}
            </p>
          )}
          <p className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400 mt-2">
            {policy.config.rules?.length || 0} {t('pages.policies.rules.title').toLowerCase()},{' '}
            {policy.config.exclusions?.length || 0} {t('pages.policies.exclusions.title').toLowerCase()}
          </p>
        </div>
      </div>
    </Modal>
  );
};

export default DeletePolicyModal;
