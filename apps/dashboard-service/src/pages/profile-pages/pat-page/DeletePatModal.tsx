import React from 'react';
import { useTranslation } from 'react-i18next';
import ConfirmationModal from '../../../components/molecules/modal/confirmation-modal/ConfirmationModal';

interface DeletePatModalProps {
  tokenName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const DeletePatModal: React.FC<DeletePatModalProps> = ({
  tokenName,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();

  return (
    <ConfirmationModal
      onConfirm={onConfirm}
      onCancel={onCancel}
      animationDirection="none"
      text={`${t('components.modal.deletePat.confirm')}`}
    />
  );
};

export default DeletePatModal;
