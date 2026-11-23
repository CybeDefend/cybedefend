import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import ConfirmationModal from './ConfirmationModal';

describe('ConfirmationModal — today’s rendering', () => {
  it('keeps its title, its text and its Yes / No buttons by default', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmationModal onConfirm={onConfirm} onCancel={onCancel} text="Delete the key?" />);

    expect(screen.getByRole('heading', { name: 'Are you sure?' })).toBeInTheDocument();
    const body = screen.getByText('Delete the key?');
    expect(body.tagName).toBe('P');

    const yes = screen.getByRole('button', { name: 'Yes' });
    expect(yes).toHaveClass('bg-red-600');
    fireEvent.click(yes);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    const no = screen.getByRole('button', { name: 'No' });
    expect(no).toHaveClass('bg-white');
    fireEvent.click(no);
    expect(onCancel).toHaveBeenCalled();
  });

  it('still honours isLoading', () => {
    render(<ConfirmationModal onConfirm={() => {}} onCancel={() => {}} text="x" isLoading />);

    expect(screen.getByRole('button', { name: 'No' })).toBeDisabled();
    const confirm = screen.getAllByRole('button').find((b) => b.className.includes('bg-red-600'));
    expect(confirm).toBeDisabled();
  });
});

describe('ConfirmationModal — optional props', () => {
  it('takes a title, a rich message and its own labels', () => {
    render(
      <ConfirmationModal
        onConfirm={() => {}}
        onCancel={() => {}}
        title="Remove the rule"
        message={
          <span>
            The rule <strong>no-eval</strong> will stop applying.
          </span>
        }
        confirmLabel="Remove"
        cancelLabel="Keep"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Remove the rule' })).toBeInTheDocument();
    expect(screen.getByText('no-eval').tagName).toBe('STRONG');
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument();
  });

  it('confirms with the accent when the tone is default', () => {
    render(
      <ConfirmationModal onConfirm={() => {}} onCancel={() => {}} tone="default" confirmLabel="Publish" text="x" />,
    );

    const confirm = screen.getByRole('button', { name: 'Publish' });
    expect(confirm).toHaveClass('bg-secondary');
    expect(confirm).not.toHaveClass('bg-red-600');
  });

  it('confirms in red when the tone is danger', () => {
    render(<ConfirmationModal onConfirm={() => {}} onCancel={() => {}} tone="danger" confirmLabel="Delete" />);

    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('bg-red-600');
  });

  it('puts the confirm button in its loading state with loading', () => {
    const onConfirm = vi.fn();
    render(<ConfirmationModal onConfirm={onConfirm} onCancel={() => {}} loading cancelLabel="Keep" text="x" />);

    expect(screen.getByRole('button', { name: 'Keep' })).toBeDisabled();
    const confirm = screen.getAllByRole('button').find((b) => b.className.includes('bg-red-600'));
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm!);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
