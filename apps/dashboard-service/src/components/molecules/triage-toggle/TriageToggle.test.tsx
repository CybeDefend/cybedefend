import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TriageToggle from './TriageToggle';
import en from '@/i18n/locales/en/components/resultsTable.json';
import fr from '@/i18n/locales/fr/components/resultsTable.json';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { changeLanguage: vi.fn() },
    }),
  };
});

describe('TriageToggle', () => {
  it('emits the inverse value when the user clicks the switch', () => {
    const onChange = vi.fn();
    render(<TriageToggle value={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('emits false when toggling off from on', () => {
    const onChange = vi.fn();
    render(<TriageToggle value={true} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

/**
 * The Triage toggle is purely a sort
 * helper. It must NOT promise to hide vulnerabilities, otherwise users who
 * intentionally surface "Not Exploitable" findings would lose them every time
 * they enable Triage. The tooltip wording is the user-facing contract — the
 * page-level handler must mirror it (no implicit filter mutation).
 */
describe('triageTooltip i18n contract', () => {
  it('does not advertise hiding Not Exploitable findings (en)', () => {
    const tooltip = en.components.resultsTable.triageTooltip;
    expect(tooltip).not.toMatch(/hide/i);
    expect(tooltip).not.toMatch(/not exploitable/i);
    expect(tooltip).toMatch(/sort/i);
    expect(tooltip).toMatch(/priority/i);
  });

  it('does not advertise hiding Not Exploitable findings (fr)', () => {
    const tooltip = fr.components.resultsTable.triageTooltip;
    expect(tooltip).not.toMatch(/masquer/i);
    expect(tooltip).not.toMatch(/cacher/i);
    expect(tooltip).not.toMatch(/non exploitable/i);
    expect(tooltip).toMatch(/trier|tri/i);
    expect(tooltip).toMatch(/priorit/i);
  });
});
