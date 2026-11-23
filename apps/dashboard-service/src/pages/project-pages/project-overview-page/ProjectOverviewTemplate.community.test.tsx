import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { GetProjectOverviewResponse } from '@/server/interfaces/Vulnerability';

/**
 * The overview's header action per edition: the Community Edition runs no
 * scanner (results come by import), so the action reads « Import
 * results » and leads to the code analysis page, where the import dialog is.
 * The cloud keeps « Start Scan ». The template reads `EDITION` once at load,
 * so each case re-imports it.
 */
const ed = vi.hoisted(() => ({ edition: 'community' as string, scansRun: false }));
vi.mock('@/edition/community/instanceCapabilities', () => ({
  // As the real hook: true outside the Community Edition.
  useScansRun: () => ed.edition !== 'community' || ed.scansRun,
}));
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));
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

const renderOverviewIn = async (edition: string, scansRun = false) => {
  ed.edition = edition;
  ed.scansRun = scansRun;
  vi.resetModules();
  const ProjectOverviewTemplate = (await import('./ProjectOverviewTemplate')).default;
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
    </MemoryRouter>,
  );
};

describe('ProjectOverviewTemplate — the header action per edition', () => {
  it('the Community Edition offers to import results, not to start a scan', async () => {
    await renderOverviewIn('community');
    expect(screen.queryByRole('link', { name: 'Start Scan' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Import results' })).toHaveAttribute('href', '/appsec/project/p1/sast');
  });

  it('a Community instance that runs scans on a cluster offers to start a scan, as the cloud', async () => {
    await renderOverviewIn('community', true);
    expect(screen.queryByRole('link', { name: 'Import results' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start Scan' })).toHaveAttribute('href', '/appsec/project/p1/sast');
  });

  it('the cloud offers to start a scan', async () => {
    await renderOverviewIn('cloud');
    expect(screen.getByRole('link', { name: 'Start Scan' })).toHaveAttribute('href', '/appsec/project/p1/sast');
  });
});
