import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ScannerRanking from './ScannerRanking';
import { readySlots } from '@/edition/slots';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

// The closed tree's scanner token (the AI-BOM row of the ranking) registers
// when its slot registrations load: loaded before the first render.
beforeAll(() => readySlots());

const data = [
  { analysisType: 'SAST', count: 100 },
  { analysisType: 'IAC', count: 490 },
  { analysisType: 'SCA', count: 390 },
  { analysisType: 'CICD', count: 0 },
];

const renderRanking = (projectId?: string) =>
  render(
    <MemoryRouter>
      <ScannerRanking data={data} projectId={projectId} />
    </MemoryRouter>,
  );

describe('ScannerRanking', () => {
  it('ranks the scanners by open findings and leaves out the ones with none', () => {
    renderRanking();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('IaC'),
      expect.stringContaining('SCA'),
      expect.stringContaining('SAST'),
    ]);
    expect(screen.queryByText('CI/CD')).toBeNull();
    expect(rows[0]).toHaveTextContent('490');
    expect(rows[0]).toHaveTextContent('50%');
  });

  it('opens the AppSec results page of the scanner on a project page', () => {
    // What AnalysisTypeOverview's legend used to do on click, now a real link.
    renderRanking('p-1');
    expect(screen.getByRole('link', { name: /IaC/ })).toHaveAttribute('href', '/appsec/project/p-1/iac');
    expect(screen.getByRole('link', { name: /SAST/ })).toHaveAttribute('href', '/appsec/project/p-1/sast');
  });

  it('has no link on the organisation overview, which has no per-scanner page', () => {
    renderRanking();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('writes the total in the centre of the ring, and the pointed scanner while a row is pointed at', () => {
    renderRanking('p-1');
    const ring = screen.getByTestId('scanner-donut');
    expect(within(ring).getByText('980')).toBeInTheDocument();
    expect(within(ring).getByText('open')).toBeInTheDocument();
    fireEvent.mouseEnter(screen.getAllByRole('listitem')[1]);
    expect(within(ring).getByText('390')).toBeInTheDocument();
    expect(within(ring).getByText('SCA')).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getAllByRole('listitem')[1]);
    expect(within(ring).getByText('980')).toBeInTheDocument();
  });

  it('names every slice of the ring for assistive technology', () => {
    renderRanking();
    expect(screen.getByRole('img', { name: 'IaC 490, SCA 390, SAST 100' })).toBeInTheDocument();
  });
});
