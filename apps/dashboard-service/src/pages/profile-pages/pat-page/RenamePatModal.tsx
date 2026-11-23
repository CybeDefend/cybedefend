import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../../../components/atoms/button/Button';
import Input from '../../../components/atoms/input/Input';
import Modal from '../../../components/atoms/modal/Modal';

interface RenamePatModalProps {
  currentName: string;
  onClose: () => void;
  onRename: (newName: string) => void;
}

const RenamePatModal: React.FC<RenamePatModalProps> = ({
  currentName,
  onClose,
  onRename,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState(currentName);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) {
      newErrors.name = t('components.modal.renamePat.errors.nameRequired');
    }
    if (name.trim() === currentName) {
      newErrors.name = t('components.modal.renamePat.errors.sameName');
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    onRename(name.trim());
  };

  return (
    <Modal
      title={t('components.modal.renamePat.title')}
      onClose={onClose}
      footerButtons={
        <>
          <Button variant="white" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="secondary" onClick={handleSubmit}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label={t('components.modal.renamePat.nameLabel')}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setErrors({});
          }}
          placeholder={t('components.modal.renamePat.namePlaceholder')}
          error={errors.name}
        />
      </div>
    </Modal>
  );
};

export default RenamePatModal;
