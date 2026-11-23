import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import GitHistoryCoverageBanner from './GitHistoryCoverageBanner';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

describe('GitHistoryCoverageBanner', () => {
  it('renders nothing when the history is fully covered', () => {
    const { container } = render(
      <GitHistoryCoverageBanner coverage={{ complete: true, gaps: [] }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there is no coverage information', () => {
    const { container } = render(<GitHistoryCoverageBanner coverage={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the date of the oldest commit analysed', () => {
    render(
      <GitHistoryCoverageBanner
        coverage={{ complete: false, coveredSince: '2026-03-05T12:00:00Z', gaps: [] }}
      />,
    );
    expect(screen.getByText(/Large git history: commits analysed since .*2026/)).toBeInTheDocument();
    expect(screen.getByText(/Every new commit is analysed at each scan\./)).toBeInTheDocument();
  });

  it('says the history was not analysed when the last pass recorded none', () => {
    render(
      <GitHistoryCoverageBanner
        coverage={{ complete: false, gaps: [], lastPassOutcome: 'none' }}
      />,
    );
    expect(screen.getByText(/Git history not analysed \(too large or unavailable\)/)).toBeInTheDocument();
  });

  it('says the last history analysis failed', () => {
    render(
      <GitHistoryCoverageBanner
        coverage={{ complete: false, gaps: [], lastPassOutcome: 'failed' }}
      />,
    );
    expect(screen.getByText(/The last analysis of the git history failed/)).toBeInTheDocument();
  });

  it('a failed first pass never claims the history was too large', () => {
    render(
      <GitHistoryCoverageBanner
        coverage={{ complete: false, gaps: [], lastPassOutcome: 'failed' }}
      />,
    );
    expect(screen.queryByText(/too large/)).not.toBeInTheDocument();
  });

  it('renders nothing when coverage is incomplete without any outcome', () => {
    const { container } = render(
      <GitHistoryCoverageBanner coverage={{ complete: false, gaps: [] }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lists each gap', () => {
    render(
      <GitHistoryCoverageBanner
        coverage={{
          complete: false,
          coveredSince: '2026-03-05T12:00:00Z',
          gaps: [
            { fromSha: 'a1', toSha: 'b2', fromDate: '2026-04-01T12:00:00Z', toDate: '2026-04-20T12:00:00Z' },
            { fromSha: 'c3', toSha: 'd4', fromDate: '2026-06-01T12:00:00Z', toDate: '2026-06-09T12:00:00Z' },
          ],
        }}
      />,
    );
    expect(screen.getAllByText(/Some commits were not analysed, between/)).toHaveLength(2);
  });

  it('falls back to short shas when a gap has no dates', () => {
    render(
      <GitHistoryCoverageBanner
        coverage={{ complete: false, gaps: [{ fromSha: 'abcdef1234567', toSha: '7654321fedcba' }] }}
      />,
    );
    expect(screen.getByText(/between abcdef1 and 7654321/)).toBeInTheDocument();
  });
});
