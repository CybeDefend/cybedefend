import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ScoringSourceFilter from './ScoringSourceFilter';
import { scoringSourceToQueryParam } from '@/utils/data/resultsVulnData';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => { /* no-op */ } },
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'components.resultsTable.scoringSource': 'Scoring Source',
        'components.resultsTable.scoringSourceAll': 'All',
        'components.resultsTable.scoringSourceStatic': 'Static',
        'components.resultsTable.scoringSourceAgent': 'AI Agent',
      };
      return map[key] || key;
    },
  }),
}));

describe('ScoringSourceFilter', () => {
  it('renders the three selector options', () => {
    render(<ScoringSourceFilter value="all" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Static' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'AI Agent' })).toBeInTheDocument();
  });

  it('marks the current value as checked', () => {
    render(<ScoringSourceFilter value="agent" onChange={vi.fn()} />);
    const active = screen.getByRole('radio', { name: 'AI Agent' }) as HTMLInputElement;
    expect(active.checked).toBe(true);
    const inactive = screen.getByRole('radio', { name: 'Static' }) as HTMLInputElement;
    expect(inactive.checked).toBe(false);
  });

  it('invokes onChange with the selected value on click', () => {
    const onChange = vi.fn();
    render(<ScoringSourceFilter value="all" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Static' }));
    expect(onChange).toHaveBeenCalledWith('static');
  });

  it('applies an active highlight on the selected option', () => {
    const { container } = render(
      <ScoringSourceFilter value="static" onChange={vi.fn()} />,
    );
    const activeLabel = container.querySelector('[data-active="true"]');
    expect(activeLabel?.textContent).toBe('Static');
  });

  it('exposes a group label from the scoringSource i18n key', () => {
    render(<ScoringSourceFilter value="all" onChange={vi.fn()} />);
    expect(screen.getByText('Scoring Source')).toBeInTheDocument();
  });
});

describe('scoringSourceToQueryParam', () => {
  it('returns undefined when the filter is "all"', () => {
    expect(scoringSourceToQueryParam('all')).toBeUndefined();
  });

  it('returns undefined when the filter is null', () => {
    expect(scoringSourceToQueryParam(null)).toBeUndefined();
  });

  it('returns undefined when the filter is undefined', () => {
    expect(scoringSourceToQueryParam(undefined)).toBeUndefined();
  });

  it('returns "static" when the filter is static', () => {
    expect(scoringSourceToQueryParam('static')).toBe('static');
  });

  it('returns "agent" when the filter is agent', () => {
    expect(scoringSourceToQueryParam('agent')).toBe('agent');
  });
});
