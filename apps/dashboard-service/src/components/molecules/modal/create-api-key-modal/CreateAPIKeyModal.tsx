import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../../atoms/button/Button";
import Input from "../../../atoms/input/Input";
import Modal from "../../../atoms/modal/Modal";
import TagInput from "../../../atoms/tag-input/TagInput";
import Select from "../../../atoms/select/Select";
import { isValidIpOrCidr } from "../../../../utils/function/utils";

interface CreateAPIKeyModalProps {
  onClose: () => void;
  onCreate: (
    name: string,
    description: string,
    expirationDate: string | null,
    authorizedIps: string[]
  ) => void;
}

const CreateAPIKeyModal: React.FC<CreateAPIKeyModalProps> = ({
  onClose,
  onCreate,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [expirationDuration, setExpirationDuration] = useState("");
  const [expirationDate, setExpirationDate] = useState<string | null>(null);
  const [authorizedIps, setAuthorizedIps] = useState<string[]>([]);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const expirationOptions = [
    { value: "7", label: t('components.modal.createApiKey.days7') },
    { value: "30", label: t('components.modal.createApiKey.days30') },
    { value: "90", label: t('components.modal.createApiKey.months3') },
    { value: "181", label: t('components.modal.createApiKey.months6') },
  ];

  const selectDropdownRef = useRef<HTMLDivElement | null>(null);

  const computeExpirationDate = (durationValue: string) => {
    const days = parseInt(durationValue, 10);
    const now = new Date();
    now.setDate(now.getDate() + days);
    return now.toISOString().split("T")[0];
  };

  const handleExpirationChange = (value: string) => {
    setExpirationDuration(value);
    setExpirationDate(computeExpirationDate(value));
  };

  const handleSubmit = () => {
    const newErrors: { [key: string]: string } = {};

    if (!name) newErrors.name = t('components.modal.createApiKey.errors.nameRequired');
    if (!description) newErrors.description = t('components.modal.createApiKey.errors.descriptionRequired');
    if (!expirationDuration)
      newErrors.expirationDuration = t('components.modal.createApiKey.errors.expirationRequired');
    const invalidIps = authorizedIps.filter((ip) => !isValidIpOrCidr(ip));
    if (invalidIps.length > 0) {
      newErrors.authorizedIps = `${t('components.modal.createApiKey.errors.invalidIps')}${invalidIps.join(", ")}`;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onCreate(name, description, expirationDate, authorizedIps);
    onClose();
  };

  return (
    <Modal
      title={t('components.modal.createApiKey.title')}
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
          label={t('common.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('components.modal.createApiKey.nameInput')}
          error={errors.name}
        />
        <Input
          label={t('common.description')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('components.modal.createApiKey.descriptionInput')}
          error={errors.description}
        />
        <Select
          label={t('components.modal.createApiKey.expirationDuration')}
          value={expirationDuration}
          options={expirationOptions}
          placeholder={t('components.modal.createApiKey.selectDuration')}
          onChange={handleExpirationChange}
          width="w-full"
          dropdownRef={selectDropdownRef}
        />
        {errors.expirationDuration && (
          <p className="text-sm text-red-600">{errors.expirationDuration}</p>
        )}
        <TagInput
          label={t('components.modal.createApiKey.authorizedIps')}
          placeholder={t('components.modal.createApiKey.enterIp')}
          value={authorizedIps}
          onChange={setAuthorizedIps}
          error={errors.authorizedIps}
        />
      </div>
    </Modal>
  );
};

export default CreateAPIKeyModal;
