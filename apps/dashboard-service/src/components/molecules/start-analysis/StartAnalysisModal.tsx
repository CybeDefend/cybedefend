import React from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@/components/atoms/button/Button';
import FileInput from '@/components/atoms/file-input/FileInput';
import Input from '@/components/atoms/input/Input';
import Modal from '@/components/atoms/modal/Modal';
import BranchSelectorAtom, { BranchSelectorAsyncProps } from '@/components/atoms/branch-selector/BranchSelector';
import { Skeleton } from '@/components/atoms/skeleton/Skeleton';
import type { Branch } from '@/server/interfaces/Branch';
import type { StartAnalysisErrors } from '@/server/hooks/useStartAnalysis';

/**
 * What the dialog asks before an analysis starts.
 *  - `branch-picker`: a linked repository, the user picks the branch (results pages);
 *  - `loading`: the branch list is not known yet, nothing can be submitted;
 *  - `upload`: no repository, the user uploads an archive and names its branch;
 *  - `confirm`: a linked repository analysed on its last commit, nothing to choose.
 */
export type StartAnalysisModalContent = 'branch-picker' | 'loading' | 'upload' | 'confirm';

interface StartAnalysisModalProps {
  content: StartAnalysisModalContent;
  onClose: () => void;
  onSubmit: () => void;
  errors: StartAnalysisErrors;
  setSelectedFile: (file: File | null) => void;
  manualBranchName?: string;
  onManualBranchNameChange?: (name: string) => void;
  branches?: Branch[];
  selectedBranch?: string;
  defaultBranch?: string;
  onBranchChange?: (branch: string) => void;
  loadingBranches?: boolean;
  /** `branches` is one page of a backend list: the picker searches and pages it. */
  branchSearch?: BranchSelectorAsyncProps;
  /** Defaults to « Start a new scan ». */
  title?: string;
  /** Defaults to « Start ». */
  submitLabel?: string;
  /** Shown above the form: what the user must know before confirming. */
  notice?: React.ReactNode;
  /** A start is out: the submit button is locked. */
  submitting?: boolean;
}

/**
 * The dialog that starts an analysis, shared by the AppSec results pages
 * (through `AnalyseWrapper`) and by the other product spaces. Its state lives in
 * `useStartAnalysis`.
 */
const StartAnalysisModal: React.FC<StartAnalysisModalProps> = ({
  content,
  onClose,
  onSubmit,
  errors,
  setSelectedFile,
  manualBranchName,
  onManualBranchNameChange,
  branches,
  selectedBranch,
  defaultBranch,
  onBranchChange,
  loadingBranches,
  branchSearch,
  title,
  submitLabel,
  notice,
  submitting = false,
}) => {
  const { t } = useTranslation();

  return (
    <Modal
      title={title ?? t('components.analyseWrapper.startNewScan')}
      width="max-w-md"
      customMaxWidth="400px"
      onClose={onClose}
      animationDirection="none"
      footerButtons={
        <>
          <Button variant="white" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="secondary"
            onClick={onSubmit}
            disabled={content === 'loading' || submitting}
          >
            {submitLabel ?? t('components.analyseWrapper.start')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {notice}
        {content === 'loading' ? (
          <div className="space-y-3" data-testid="scan-modal-branches-loading">
            <Skeleton type="line" width="160px" />
            <Skeleton type="block" height="40px" width="100%" rounded="xl" />
          </div>
        ) : content === 'branch-picker' ? (
          <>
            <div className="space-y-3">
              <BranchSelectorAtom
                label={t('components.analyseWrapper.selectBranchToScan')}
                branches={branches ?? []}
                selectedBranch={selectedBranch || defaultBranch || ''}
                defaultBranch={defaultBranch}
                onChange={onBranchChange}
                loading={loadingBranches}
                async={branchSearch}
                showBadges={true}
                width="w-full"
                placeholder={t('components.analyseWrapper.selectBranch')}
              />
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {t('components.analyseWrapper.branchScanDescription')}
            </p>
          </>
        ) : content === 'upload' ? (
          <>
            <FileInput
              label={t('components.analyseWrapper.uploadZipFile')}
              accept=".zip"
              onChange={(file) => {
                setSelectedFile(file);
              }}
              error={errors.file}
            />
            {/* The branch the uploaded code is filed under. */}
            <div className="mt-4">
              <Input
                id="start-analysis-branch-name"
                label={t('components.analyseWrapper.branchNameLabel')}
                value={manualBranchName || ''}
                onChange={(event) => onManualBranchNameChange?.(event.target.value)}
                placeholder={t('components.analyseWrapper.branchNamePlaceholder')}
                error={errors.branchName}
                hint={t('components.analyseWrapper.branchNameDescription')}
              />
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-4">
              {t('components.analyseWrapper.uploadDescription')}
            </p>
          </>
        ) : null}
      </div>
    </Modal>
  );
};

export default StartAnalysisModal;
