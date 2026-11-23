import React from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@/components/atoms/button/Button';

interface ImportResultsButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

/**
 * « Import results »: the results pages' start action in the Community
 * Edition, where no scanner runs. It opens `ImportResultsDialog`.
 */
const ImportResultsButton: React.FC<ImportResultsButtonProps> = ({ onClick, disabled }) => {
  const { t } = useTranslation();
  return (
    <Button variant="secondary" onClick={onClick} disabled={disabled} data-testid="import-results-button">
      {t('components.importResults.button')}
    </Button>
  );
};

export default ImportResultsButton;
