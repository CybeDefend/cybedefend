import React from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../../../atoms/button/Button';
import Modal from '../../../atoms/modal/Modal';

export type ConfirmationModalTone = 'danger' | 'default';

interface ConfirmationModalProps {
  onConfirm: () => void;
  onCancel: () => void;
  animationDirection?: 'up' | 'down' | 'none';
  /** The question, as plain text. */
  text?: string;
  isLoading?: boolean;
  /** Replaces the generic « Are you sure? » title. */
  title?: string;
  /** A rich body (emphasis, a list…); takes precedence over `text`. */
  message?: React.ReactNode;
  /** Replaces « Yes ». */
  confirmLabel?: string;
  /** Replaces « No ». */
  cancelLabel?: string;
  /** `danger` confirms in red (the default), `default` in the product accent. */
  tone?: ConfirmationModalTone;
  /** Same as `isLoading`: the confirm button spins and both buttons are disabled. */
  loading?: boolean;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  onConfirm,
  onCancel,
  animationDirection = 'none',
  text,
  isLoading = false,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  loading = false,
}) => {
  const { t } = useTranslation();
  const busy = isLoading || loading;
  return (
    <Modal
      title={title ?? t('components.modal.confirmation.title')}
      onClose={onCancel}
      animationDirection={animationDirection}
      footerButtons={
        <>
          <Button variant={tone === 'danger' ? 'red' : 'secondary'} onClick={onConfirm} loading={busy}>
            {confirmLabel ?? t('common.yes')}
          </Button>
          <Button variant='white' onClick={onCancel} disabled={busy}>{cancelLabel ?? t('common.no')}
          </Button>
        </>
      }
    >
      {message !== undefined ? (
        <div className='text-sm text-zinc-700 dark:text-zinc-300'>{message}</div>
      ) : (
        <p className='text-sm text-zinc-700 dark:text-zinc-300'>{text}</p>
      )}   {' '}
    </Modal>
  );
};

export default ConfirmationModal;
