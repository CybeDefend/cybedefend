import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@/components/atoms/button/Button';
import FileInput from '@/components/atoms/file-input/FileInput';
import Input from '@/components/atoms/input/Input';
import Modal from '@/components/atoms/modal/Modal';
import SegmentedControl from '@/components/atoms/segmented-control';
import {
  IMPORT_EXTENSIONS,
  IMPORT_TYPES,
  importFileProblem,
  importResults,
  type ImportType,
} from '@/server/services/importService';
import ImportCommandHint from './ImportCommandHint';
import { importRefusalKey, importRefusalOfUpload, retryAfterSeconds, type ImportRefusal } from './importErrors';
import { IMPORT_IMAGE_MAX_LENGTH, isImportImage } from './importImage';
import { isUuid } from '@/utils/uuid';

interface ImportResultsDialogProps {
  projectId: string;
  /** The page's own type: the SCA page opens on sca, the Container page on container. */
  defaultType: ImportType;
  /** The selected branch, prefilled. */
  defaultBranch?: string;
  onClose: () => void;
  /** After the 202: the page's scan tracker follows this scan. */
  onImported: (scanId: string) => void;
}

const BRANCH_MAX_LENGTH = 255;
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;
/** Used when an IMPORT_BUSY answer carries no readable `Retry-After`. */
const DEFAULT_RETRY_SECONDS = 15;

interface FieldErrors {
  file?: string;
  image?: string;
  branch?: string;
  commit?: string;
}

/**
 * The SARIF import dialog of the Community Edition. The
 * client checks the size, the extension, the branch, the commit and the image
 * before any request; the gateway stays the authority. A refusal is shown as
 * the fixed sentence of its code, never as the server's text.
 */
const ImportResultsDialog: React.FC<ImportResultsDialogProps> = ({
  projectId,
  defaultType,
  defaultBranch = '',
  onClose,
  onImported,
}) => {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState<ImportType>(defaultType);
  const [image, setImage] = useState('');
  const [branch, setBranch] = useState(defaultBranch);
  const [commit, setCommit] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [refusal, setRefusal] = useState<{ code: ImportRefusal; seconds: number } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const submitting = progress !== null;

  const isContainer = type === 'container';

  const changeType = (next: ImportType) => {
    setType(next);
    // The image belongs to a container import only: it is never sent with another type.
    if (next !== 'container') setImage('');
    setErrors((prev) => ({ ...prev, image: undefined }));
  };

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (!file) next.file = t('components.importResults.file.errors.missing');
    else {
      const problem = importFileProblem(file);
      if (problem) next.file = t(`components.importResults.file.errors.${problem}`);
    }
    if (isContainer) {
      if (image === '') next.image = t('components.importResults.image.errors.missing');
      else if (!isImportImage(image)) next.image = t('components.importResults.image.errors.invalid');
    }
    const trimmedBranch = branch.trim();
    if (trimmedBranch === '') next.branch = t('components.importResults.branch.errors.missing');
    else if (trimmedBranch.length > BRANCH_MAX_LENGTH) next.branch = t('components.importResults.branch.errors.tooLong');
    if (commit.trim() !== '' && !COMMIT_PATTERN.test(commit.trim())) {
      next.commit = t('components.importResults.commit.errors.invalid');
    }
    return next;
  };

  // The id of the project the API answered for: none while it loads.
  const projectLoaded = isUuid(projectId);

  const handleSubmit = async () => {
    if (submitting || !projectLoaded) return;
    const next = validate();
    setErrors(next);
    setRefusal(null);
    if (Object.values(next).some(Boolean) || !file) return;

    setProgress(0);
    try {
      const { scanId } = await importResults(
        {
          projectId,
          file,
          type,
          branch: branch.trim(),
          ...(commit.trim() ? { commit: commit.trim() } : {}),
          ...(isContainer ? { image } : {}),
        },
        setProgress,
      );
      setProgress(null);
      onImported(scanId);
      onClose();
    } catch (error) {
      setProgress(null);
      setRefusal({
        code: importRefusalOfUpload(error),
        seconds: retryAfterSeconds(error) ?? DEFAULT_RETRY_SECONDS,
      });
    }
  };

  const typeOptions = IMPORT_TYPES.map((value) => ({
    value,
    label: t(`components.importResults.types.${value}`),
  }));
  const typeNote = type === 'sca' || type === 'container' ? t(`components.importResults.typeNote.${type}`) : null;

  return (
    <Modal
      title={t('components.importResults.title')}
      description={t('components.importResults.description')}
      size="lg"
      onClose={onClose}
      // An upload in progress is not abandoned by a stray key or click.
      closeOnOverlayClick={!submitting}
      closeOnEscape={!submitting}
      showCloseButton={!submitting}
      animationDirection="none"
      footerButtons={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t('components.importResults.cancel')}
          </Button>
          <Button variant="secondary" onClick={handleSubmit} loading={submitting} disabled={!projectLoaded}>
            {t('components.importResults.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FileInput
          id="import-results-file"
          label={t('components.importResults.file.label')}
          accept={[...IMPORT_EXTENSIONS, '.gz'].join(',')}
          zipOnly={false}
          className="max-w-none"
          onChange={(picked) => {
            setFile(picked);
            setErrors((prev) => ({ ...prev, file: undefined }));
          }}
          error={errors.file}
        />

        <div>
          <p className="block text-[13px] font-medium mb-1.5 text-zinc-700 dark:text-zinc-300">
            {t('components.importResults.type.label')}
          </p>
          <SegmentedControl
            options={typeOptions}
            value={type}
            onChange={changeType}
            ariaLabel={t('components.importResults.type.label')}
            testIdPrefix="import-type"
            size="md"
            disabled={submitting}
            className="flex-wrap"
          />
          {typeNote && <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{typeNote}</p>}
        </div>

        {isContainer && (
          <Input
            id="import-results-image"
            label={t('components.importResults.image.label')}
            placeholder={t('components.importResults.image.placeholder')}
            hint={t('components.importResults.image.hint')}
            value={image}
            maxLength={IMPORT_IMAGE_MAX_LENGTH}
            required
            onChange={(event) => {
              setImage(event.target.value);
              setErrors((prev) => ({ ...prev, image: undefined }));
            }}
            error={errors.image}
            disabled={submitting}
          />
        )}

        <Input
          id="import-results-branch"
          label={t('components.importResults.branch.label')}
          placeholder={t('components.importResults.branch.placeholder')}
          value={branch}
          required
          onChange={(event) => {
            setBranch(event.target.value);
            setErrors((prev) => ({ ...prev, branch: undefined }));
          }}
          error={errors.branch}
          disabled={submitting}
        />

        <Input
          id="import-results-commit"
          label={t('components.importResults.commit.label')}
          placeholder={t('components.importResults.commit.placeholder')}
          value={commit}
          onChange={(event) => {
            setCommit(event.target.value);
            setErrors((prev) => ({ ...prev, commit: undefined }));
          }}
          error={errors.commit}
          disabled={submitting}
        />

        {progress !== null && (
          <p className="text-xs text-zinc-600 dark:text-zinc-400" aria-live="polite">
            {t('components.importResults.uploading', { percent: Math.round(progress * 100) })}
          </p>
        )}

        {refusal && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {t(importRefusalKey(refusal.code), { seconds: refusal.seconds })}
          </p>
        )}

        <ImportCommandHint projectId={projectId} type={type} branch={branch.trim()} image={isContainer ? image : undefined} />
      </div>
    </Modal>
  );
};

export default ImportResultsDialog;
