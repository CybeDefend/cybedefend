import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// These cases describe the cloud's behaviour; the Community Edition's is pinned
// by ProjectOverviewTemplate.community.test.tsx.
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  EDITION: 'cloud',
}));
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { GetProjectOverviewResponse } from '@/server/interfaces/Vulnerability';
import ProjectOverviewTemplate from './ProjectOverviewTemplate';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

// What is under test is where the overview leads; the charts and the project
// header are reduced to the controls that lead somewhere.
vi.mock('@/components/molecules/wrapper/ProjectTemplateWrapper', () => ({
  default: ({ actions, children }: { actions?: React.ReactNode; children: React.ReactNode }) => (
    <div>
      {actions}
      {children}
    </div>
  ),
}));
// The severity and state blocks of the posture briefing replaced
// SeverityOverview and StateOverview; they hand the page the same callbacks.
vi.mock('@/components/molecules/project-overview/posture/SeverityStack', () => ({
  default: ({ onSeverityClick }: { onSeverityClick: (severity: string) => void }) => (
    <button type="button" onClick={() => onSeverityClick('CRITICAL')}>
      critical
    </button>
  ),
}));
vi.mock('@/components/molecules/project-overview/posture/StateRows', () => ({
  default: ({ onStateClick }: { onStateClick: (state: string) => void }) => (
    <button type="button" onClick={() => onStateClick('to_verify')}>
      to verify
    </button>
  ),
}));
vi.mock('@/components/molecules/project-overview/posture/OpenTrend', () => ({ default: () => null }));
vi.mock('@/components/molecules/branch-selector', () => ({ BranchSelector: () => null }));

const overviewData: GetProjectOverviewResponse = {
  totalBySeverity: [{ severity: 'CRITICAL', count: 1 }],
  totalByState: [{ state: 'to_verify', count: 1 }],
  totalByAnalysisType: [{ analysisType: 'SAST', count: 1 }],
  vulnerabilitiesOverTime: [],
};

const LocationProbe: React.FC = () => {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname + search}</div>;
};

const renderOverview = () =>
  render(
    <MemoryRouter initialEntries={['/appsec/project/p1']}>
      <ProjectOverviewTemplate
        projectId="p1"
        projectTitle="Demo"
        teamName="Team"
        overviewData={overviewData}
        loading={false}
        branches={[]}
        selectedBranch={null}
        onBranchChange={vi.fn()}
        onRefresh={vi.fn()}
      />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );

describe('ProjectOverviewTemplate — where the AppSec overview leads', () => {
  it('sends « Start scan » to the AppSec code analysis page', () => {
    renderOverview();
    expect(screen.getByRole('link', { name: 'Start Scan' })).toHaveAttribute('href', '/appsec/project/p1/sast');
  });

  it('opens the AppSec code analysis filtered on the severity clicked', () => {
    renderOverview();
    fireEvent.click(screen.getByRole('button', { name: 'critical' }));
    expect(screen.getByTestId('location').textContent).toBe('/appsec/project/p1/sast?severity=critical');
  });

  it('opens the AppSec code analysis filtered on the state clicked', () => {
    renderOverview();
    fireEvent.click(screen.getByRole('button', { name: 'to verify' }));
    expect(screen.getByTestId('location').textContent).toBe('/appsec/project/p1/sast?status=to_verify');
  });

  it('sends a scanner of « Where they are » to its AppSec results tab', () => {
    renderOverview();
    expect(screen.getByRole('link', { name: /^SAST/ })).toHaveAttribute('href', '/appsec/project/p1/sast');
  });

  it('sends the next step to the same filtered list as the severity it names', () => {
    renderOverview();
    expect(screen.getByRole('link', { name: 'Open the list' })).toHaveAttribute(
      'href',
      '/appsec/project/p1/sast?severity=critical',
    );
  });
});
