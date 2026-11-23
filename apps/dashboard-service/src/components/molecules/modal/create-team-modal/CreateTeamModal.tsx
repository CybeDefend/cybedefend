import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../../atoms/modal/Modal';
import Input from '../../../atoms/input/Input';
import Button from '../../../atoms/button/Button';

// The server stores a team's name and description in 255-character columns
// and refuses a NUL character: the form checks the same bounds.
const TEAM_TEXT_MAX_LENGTH = 255;

interface CreateTeamModalProps {
  onClose: () => void;
  onCreateTeam: (name: string, description: string) => void;
}

const CreateTeamModal: React.FC<CreateTeamModalProps> = ({ onClose, onCreateTeam }) => {
  const { t } = useTranslation();
  const [teamName, setTeamName] = useState('');
  const [teamDescription, setTeamDescription] = useState('');
  const [errors, setErrors] = useState<{ name?: string; description?: string }>({});

  const handleCreate = () => {
    const newErrors: { name?: string; description?: string } = {};

    if (!teamName.trim()) {
      newErrors.name = t('components.modal.createTeam.errors.nameRequired');
    } else if (teamName.length > TEAM_TEXT_MAX_LENGTH) {
      newErrors.name = t('components.modal.createTeam.errors.nameLength');
    } else if (teamName.includes('\u0000')) {
      newErrors.name = t('components.modal.createTeam.errors.nameInvalidCharacter');
    }

    if (!teamDescription.trim()) {
      newErrors.description = t('components.modal.createTeam.errors.descriptionRequired');
    } else if (teamDescription.length > TEAM_TEXT_MAX_LENGTH) {
      newErrors.description = t('components.modal.createTeam.errors.descriptionLength');
    } else if (teamDescription.includes('\u0000')) {
      newErrors.description = t('components.modal.createTeam.errors.descriptionInvalidCharacter');
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
    } else {
      onCreateTeam(teamName.trim(), teamDescription.trim());
      onClose();
    }
  };

  return (
    <Modal
      title={t('components.modal.createTeam.title')}
      onClose={onClose}
      footerButtons={
        <>
          <Button variant="white" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="secondary" onClick={handleCreate}>
            {t('common.create')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label={t('components.modal.createTeam.teamName')}
          placeholder={t('components.modal.createTeam.enterTeamName')}
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
          error={errors.name}
          required
          width="w-full"
        />
        <Input
          label={t('components.modal.createTeam.teamDescription')}
          placeholder={t('components.modal.createTeam.enterTeamDescription')}
          value={teamDescription}
          onChange={(e) => setTeamDescription(e.target.value)}
          error={errors.description}
          required
          width="w-full"
        />
      </div>
    </Modal>
  );
};

export default CreateTeamModal;
