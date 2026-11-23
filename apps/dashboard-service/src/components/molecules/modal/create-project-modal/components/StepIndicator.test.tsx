import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import StepIndicator from './StepIndicator';

/**
 * Seen at 320 px in French: three step titles on one row ran out
 * of the dialog. The row wraps, and a title breaks inside a long word.
 */
describe('StepIndicator on a phone', () => {
  it('wraps its steps and lets a title break', () => {
    render(<StepIndicator current={1} total={3} titles={['Informations générales', 'Dépôt', 'Contexte de sécurité']} />);
    const title = screen.getByText('Informations générales');
    expect(title).toHaveClass('min-w-0', '[overflow-wrap:anywhere]');
    const row = title.parentElement?.parentElement as HTMLElement;
    expect(row).toHaveClass('flex-wrap', 'gap-y-1');
  });
});
