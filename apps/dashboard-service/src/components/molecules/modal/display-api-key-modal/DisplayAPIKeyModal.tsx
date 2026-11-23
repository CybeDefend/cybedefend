import React from "react";
import { useTranslation } from "react-i18next";
import Input from "../../../atoms/input/Input";
import Button from "../../../atoms/button/Button";
import Modal from "../../../atoms/modal/Modal";
import { copyText } from '@/utils/copyText';

interface DisplayAPIKeyModalProps {
  apiKey: string;
  onClose: () => void;
  onCopy: (key: string) => void;
}

const DisplayAPIKeyModal: React.FC<DisplayAPIKeyModalProps> = ({
  apiKey,
  onClose,
  onCopy,
}) => {
  const { t } = useTranslation();

  const handleCopy = () => {
    void copyText(apiKey);
    onCopy(apiKey); 
  };

  return (
    <Modal
      title={t('components.modal.displayApiKey.title')}
      onClose={onClose}
      animationDirection="none"
      footerButtons={
        <>
          <Button variant="white" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="secondary" onClick={handleCopy}>
            {t('common.copy')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {}
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('components.modal.displayApiKey.copySave')}
        </p>

        {}
        <Input
          label={t('components.modal.displayApiKey.apiKey')}
          value={apiKey}
          readOnly={true}
          width="w-full"
        />
      </div>
    </Modal>
  );
};

export default DisplayAPIKeyModal;
