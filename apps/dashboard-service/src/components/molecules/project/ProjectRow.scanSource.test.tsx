import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import type { ProjectAnalysis, ScanSourceType } from '@/server/interfaces/Project';
import ProjectRow from './ProjectRow';
import AnalysisRow from './AnalysisRow';

// Resolve keys against the real `en` locale: a missing key shows as its path.
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

/*
  The Platform project list must name every scan source the backend stores:
  knowing only four of the six, it printed « components.scanSourceBadge.vscode »
  for a project last scanned from the VS Code extension.
*/

const issuesCount = { critical: 0, high: 0, medium: 0, low: 0 };
const project = (source: string): ProjectAnalysis => ({
  projectId: 'p1',
  teamId: 't1',
  teamName: 'Team',
  name: 'Demo',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  issuesCount,
  cyberRiskLevel: 'none',
  analyses: [{ type: 'sast', lastScan: null, source, issuesCount }],
  lastScanSourceType: source as ScanSourceType,
  isScanning: false,
});

const store = configureStore({ reducer: () => ({ organization: { selectedOrganization: { id: 'org-1' } } }) });
const renderRow = (row: React.ReactElement) =>
  render(
    <Provider store={store}>
      <MemoryRouter>
        <table>
          <tbody>{row}</tbody>
        </table>
      </MemoryRouter>
    </Provider>,
  );

describe('the last scan source of a project', () => {
  it.each([
    ['vscode', 'VS Code'],
    ['jetbrains', 'JetBrains'],
    ['github', 'GitHub'],
    ['bitbucket', 'Other source'],
  ])('names %s in the project list', (source, label) => {
    const { container } = renderRow(<ProjectRow project={project(source)} to="/appsec/project/p1" onInfoClick={vi.fn()} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/components\.scanSourceBadge/);
  });

  it.each([
    ['vscode', 'VS Code'],
    ['bitbucket', 'Other source'],
  ])('names %s in an analysis row', (source, label) => {
    const { container } = renderRow(
      <AnalysisRow
        analysis={{ type: 'sast', lastScan: null, source, issuesCount }}
        projectId="p1"
        lastScanSourceType={source as ScanSourceType}
      />,
    );
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\bbitbucket\b|components\./);
  });
});
