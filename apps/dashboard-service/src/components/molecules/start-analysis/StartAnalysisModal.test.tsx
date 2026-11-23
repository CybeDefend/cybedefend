import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StartAnalysisModal from './StartAnalysisModal';

// Resolves keys against the real `en` locale.
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

type Props = React.ComponentProps<typeof StartAnalysisModal>;

const renderModal = (props: Partial<Props> = {}) => {
  const handlers = {
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    setSelectedFile: vi.fn(),
    onManualBranchNameChange: vi.fn(),
    onBranchChange: vi.fn(),
  };
  render(
    <StartAnalysisModal
      content="upload"
      errors={{}}
      manualBranchName="main"
      {...handlers}
      {...props}
    />,
  );
  return handlers;
};

describe('StartAnalysisModal', () => {
  it('is the « Start a new scan » dialog, with Cancel and Start', () => {
    const handlers = renderModal();
    expect(screen.getByRole('dialog', { name: 'Start a new scan' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(handlers.onSubmit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  describe('archive upload', () => {
    it('asks for a .zip archive and for the branch it is filed under', () => {
      const handlers = renderModal({ manualBranchName: 'release' });

      expect(screen.getByLabelText('Upload a .zip file')).toHaveAttribute('accept', '.zip');
      const branch = screen.getByLabelText('Branch name');
      expect(branch).toHaveValue('release');
      expect(branch).toHaveAttribute('placeholder', 'e.g., main, master, develop...');
      // The help line is the field's description, read out with it.
      expect(branch).toHaveAccessibleDescription(
        'Specify the branch name for this code to help organize your scan results.',
      );
      expect(screen.getByText('Upload the source code of your project to begin the analysis.')).toBeInTheDocument();

      fireEvent.change(branch, { target: { value: 'develop' } });
      expect(handlers.onManualBranchNameChange).toHaveBeenCalledWith('develop');
    });

    it('hands the chosen archive over', () => {
      const handlers = renderModal();
      const archive = new File(['zip'], 'source.zip', { type: 'application/zip' });

      fireEvent.change(screen.getByLabelText('Upload a .zip file'), { target: { files: [archive] } });

      expect(handlers.setSelectedFile).toHaveBeenCalledWith(archive);
    });

    it('shows the errors next to their field', () => {
      renderModal({ errors: { file: 'Please upload a .zip', branchName: 'Branch name is required' } });
      expect(screen.getByText('Please upload a .zip')).toBeInTheDocument();
      expect(screen.getByText('Branch name is required')).toBeInTheDocument();
    });
  });

  describe('linked repository, on a results page', () => {
    it('offers the branch picker and says which commit is analysed', () => {
      renderModal({
        content: 'branch-picker',
        branches: [
          { name: 'main', isDefault: true, isProtected: false },
          { name: 'develop', isDefault: false, isProtected: false },
        ],
        selectedBranch: 'develop',
        defaultBranch: 'main',
      });

      // The heading of the picker is the label of the branch field itself.
      expect(screen.getByLabelText('Select branch to scan')).toHaveTextContent('develop');
      expect(screen.getByText('The scan will analyze the latest commit on this branch.')).toBeInTheDocument();
      expect(screen.queryByLabelText('Upload a .zip file')).toBeNull();
      expect(screen.queryByLabelText('Branch name')).toBeNull();
    });

    it('waits for the branch list instead of offering an upload', () => {
      renderModal({ content: 'loading' });

      expect(screen.getByTestId('scan-modal-branches-loading')).toBeInTheDocument();
      expect(screen.queryByLabelText('Upload a .zip file')).toBeNull();
      expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    });
  });

  describe('for a caller with its own words', () => {
    it('takes a title, a submit label and a notice shown above the form', () => {
      renderModal({
        title: 'Analyze the repository',
        submitLabel: 'Analyze',
        notice: <p>This consumes one analysis.</p>,
      });

      expect(screen.getByRole('dialog', { name: 'Analyze the repository' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Analyze' })).toBeInTheDocument();
      expect(screen.getByText('This consumes one analysis.')).toBeInTheDocument();
      expect(screen.getByLabelText('Upload a .zip file')).toBeInTheDocument();
    });

    it('only confirms when there is nothing to choose', () => {
      const handlers = renderModal({
        content: 'confirm',
        submitLabel: 'Analyze',
        notice: <p>This consumes one analysis.</p>,
      });

      expect(screen.getByText('This consumes one analysis.')).toBeInTheDocument();
      expect(screen.queryByLabelText('Upload a .zip file')).toBeNull();
      expect(screen.queryByLabelText('Branch name')).toBeNull();
      expect(screen.queryByText('Select branch to scan')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
      expect(handlers.onSubmit).toHaveBeenCalledTimes(1);
    });

    it('locks the submit button while a start is out', () => {
      const handlers = renderModal({ content: 'confirm', submitting: true });
      const submit = screen.getByRole('button', { name: 'Start' });

      expect(submit).toBeDisabled();
      fireEvent.click(submit);
      expect(handlers.onSubmit).not.toHaveBeenCalled();
    });
  });
});
