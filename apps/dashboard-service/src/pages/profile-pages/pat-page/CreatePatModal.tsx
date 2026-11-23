import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../../../components/atoms/button/Button';
import Input from '../../../components/atoms/input/Input';
import Modal from '../../../components/atoms/modal/Modal';
import Select from '../../../components/atoms/select/Select';

interface CreatePatModalProps {
  onClose: () => void;
  onCreate: (name: string, expiresAt: number) => void;
}

const CreatePatModal: React.FC<CreatePatModalProps> = ({ onClose, onCreate }) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [expirationDuration, setExpirationDuration] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const selectDropdownRef = useRef<HTMLDivElement | null>(null);

  const expirationOptions = [
    { value: '7', label: t('components.modal.createPat.days7') },
    { value: '30', label: t('components.modal.createPat.days30') },
    { value: '90', label: t('components.modal.createPat.months3') },
    { value: '181', label: t('components.modal.createPat.months6') },
    { value: '365', label: t('components.modal.createPat.year1') },
    { value: '0', label: t('components.modal.createPat.never') },
  ];

  const computeExpiresAt = (days: string): number => {
    const d = parseInt(days, 10);
    if (!d || d === 0) return 0;
    return Date.now() + d * 24 * 60 * 60 * 1000;
  };

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) {
      newErrors.name = t('components.modal.createPat.errors.nameRequired');
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    onCreate(name.trim(), computeExpiresAt(expirationDuration));
  };

  return (
    <Modal
      title={t('components.modal.createPat.title')}
      onClose={onClose}
      additionalRefs={[selectDropdownRef]}
      footerButtons={
        <>
          <Button variant="white" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="secondary" onClick={handleSubmit}>
            {t('common.create')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label={t('components.modal.createPat.nameLabel')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('components.modal.createPat.namePlaceholder')}
          error={errors.name}
        />
        <Select
          dropdownRef={selectDropdownRef}
          label={t('components.modal.createPat.expirationLabel')}
          options={expirationOptions}
          value={expirationDuration}
          onChange={setExpirationDuration}
          placeholder={t('components.modal.createPat.selectExpiration')}
        />
      </div>
    </Modal>
  );
};

export default CreatePatModal;
