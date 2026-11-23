import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../../atoms/button/Button";
import Modal from "../../../atoms/modal/Modal";
import ConfirmationModal from "../confirmation-modal/ConfirmationModal"; 

interface ManageAPIKeyModalProps {
  ApiKeyName: string;
  ApiKeyExpired: boolean;
  onRegenerate: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const ManageAPIKeyModal: React.FC<ManageAPIKeyModalProps> = ({
  ApiKeyName,
  ApiKeyExpired,
  onRegenerate,
  onDelete,
  onClose,
}) => {
  const { t } = useTranslation();
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  
  const handleDeleteClick = () => {
    setIsConfirmingDelete(true);
  };

  const handleConfirmDelete = () => {
    onDelete();
    setIsConfirmingDelete(false);
    onClose();
  };

  const handleCancelDelete = () => {
    setIsConfirmingDelete(false);
  };

  return (
    <>
      {!isConfirmingDelete ? (
        <Modal
          title={`${t('components.modal.manageApiKey.title')} ${ApiKeyName}`}
          onClose={onClose}
          animationDirection="none"
          footerButtons={
            <>
                {!ApiKeyExpired && (
                <Button variant="white" onClick={onRegenerate}>
                  {t('components.modal.manageApiKey.regenerateKey')}
                </Button>
                )}
              <Button variant="secondary" onClick={handleDeleteClick}>
                {t('components.modal.manageApiKey.deleteKey')}
              </Button>
            </>
          }
        >
          <p className="dark:text-gray-300">
            {t('components.modal.manageApiKey.managementDescription')} <strong>{ApiKeyName}</strong>?
            {t('components.modal.manageApiKey.managementInstructions')}
          </p>
        </Modal>
      ) : (
        <ConfirmationModal
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
          animationDirection="none"
          text={t('components.modal.manageApiKey.confirmDeleteKey')}
        />
      )}
    </>
  );
};

export default ManageAPIKeyModal;
