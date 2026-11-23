import React from 'react';
import { AS_NOTICE, AS_NOTICE_DOT, NOTICE_DOT } from '@/components/atoms/appsec/recipes';
import { useTranslation } from 'react-i18next';
import Button from '../../../components/atoms/button/Button';
import Input from '../../../components/atoms/input/Input';
import Modal from '../../../components/atoms/modal/Modal';
import { WORD_TONE } from '@/components/molecules/card/kpi/wordTone';
import { sensitive } from '@/utils/privacy/sensitive';

interface DisplayPatModalProps {
  tokenValue: string;
  onClose: () => void;
  onCopy: (value: string) => void;
}

const DisplayPatModal: React.FC<DisplayPatModalProps> = ({
  tokenValue,
  onClose,
  onCopy,
}) => {
  const { t } = useTranslation();

  return (
    <Modal
      title={t('components.modal.displayPat.title')}
      onClose={onClose}
      animationDirection="none"
      footerButtons={
        <>
          <Button variant="white" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="secondary" onClick={() => onCopy(tokenValue)}>
            {t('common.copy')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className={AS_NOTICE}>
          <p className={WORD_TONE.warning}>
            {t('components.modal.displayPat.copySave')}
          </p>
        </div>

        <div {...sensitive('secret')}>
          <Input
            label={t('components.modal.displayPat.token')}
            value={tokenValue}
            readOnly={true}
            width="w-full"
          />
        </div>
      </div>
    </Modal>
  );
};

export default DisplayPatModal;
