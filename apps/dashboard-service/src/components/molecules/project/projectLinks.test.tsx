import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import type { AnalysisType, ProjectAnalysis } from '@/server/interfaces/Project';
import ProjectRow from './ProjectRow';
import AnalysisRow from './AnalysisRow';
import AnalysisPill from './AnalysisPill';
import ProjectDetailSidePanel from './ProjectDetailSidePanel';

// Resolve keys against the real `en` locale so links can be found by their label.
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

/*
  The project list of the AppSec home links every project and every analysis
  to its AppSec page. AppSec lives under /appsec: a link to /project/... would
  only reach the page through the redirect of the former URLs.
*/

const issuesCount = { critical: 0, high: 0, medium: 0, low: 0 };
const analysis = (type: string): AnalysisType => ({ type, lastScan: null, source: 'manual', issuesCount });
const project: ProjectAnalysis = {
  projectId: 'p1',
  teamId: 't1',
  teamName: 'Team',
  name: 'Demo',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  issuesCount,
  cyberRiskLevel: 'none',
  analyses: [analysis('sast'), analysis('container')],
  lastScanSourceType: 'manual',
  isScanning: false,
};

const store = configureStore({ reducer: () => ({ organization: { selectedOrganization: { id: 'org-1' } } }) });

const LocationProbe: React.FC = () => {
  const { pathname } = useLocation();
  return <div data-testid="location">{pathname}</div>;
};

const renderInRouter = (ui: React.ReactElement) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/appsec']}>
        {ui}
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );

const inTable = (row: React.ReactElement) => (
  <table>
    <tbody>{row}</tbody>
  </table>
);

/** The href every cell link of a `LinkRow` carries. */
const rowHrefs = (container: HTMLElement) =>
  Array.from(new Set(Array.from(container.querySelectorAll('a[data-link-wrapper]')).map((a) => a.getAttribute('href'))));

describe('ProjectRow', () => {
  it('links its quick actions to the AppSec pages of the project', () => {
    renderInRouter(inTable(<ProjectRow project={project} to="/appsec/project/p1/sast" onInfoClick={vi.fn()} />));
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/appsec/project/p1');
    expect(screen.getByRole('link', { name: 'View Reports' })).toHaveAttribute('href', '/appsec/project/p1/reports');
    expect(screen.getByRole('link', { name: 'Compliance' })).toHaveAttribute('href', '/appsec/project/p1/compliance');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/appsec/project/p1/settings');
  });
});

describe('AnalysisRow', () => {
  it('links an analysis to its AppSec results page', () => {
    const { container } = renderInRouter(
      inTable(<AnalysisRow analysis={analysis('iac')} projectId="p1" lastScanSourceType="manual" />),
    );
    expect(rowHrefs(container)).toEqual(['/appsec/project/p1/iac']);
  });

  it('links an analysis of an unknown type to the AppSec home, never to the root', () => {
    const { container } = renderInRouter(
      inTable(<AnalysisRow analysis={analysis('unknown')} projectId="p1" lastScanSourceType="manual" />),
    );
    expect(rowHrefs(container)).toEqual(['/appsec']);
  });
});

describe('AnalysisPill', () => {
  it('opens the AppSec results page of its analysis', () => {
    renderInRouter(<AnalysisPill analysis={analysis('secret')} projectId="p1" lastScanSourceType="manual" />);
    fireEvent.click(screen.getByRole('link'));
    expect(screen.getByTestId('location')).toHaveTextContent('/appsec/project/p1/secret');
  });

  it('opens the AppSec home for an analysis of an unknown type, never the root', () => {
    renderInRouter(<AnalysisPill analysis={analysis('unknown')} projectId="p1" lastScanSourceType="manual" />);
    fireEvent.click(screen.getByRole('link'));
    expect(screen.getByTestId('location').textContent).toBe('/appsec');
  });
});

describe('ProjectDetailSidePanel', () => {
  it('links each analysis card to its AppSec results page', () => {
    renderInRouter(<ProjectDetailSidePanel project={project} onClose={vi.fn()} />);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/appsec/project/p1/sast', '/appsec/project/p1/container']);
  });

  it('links an analysis card of an unknown type to the AppSec project page', () => {
    renderInRouter(
      <ProjectDetailSidePanel project={{ ...project, analyses: [analysis('unknown')] }} onClose={vi.fn()} />,
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', '/appsec/project/p1');
  });
});
