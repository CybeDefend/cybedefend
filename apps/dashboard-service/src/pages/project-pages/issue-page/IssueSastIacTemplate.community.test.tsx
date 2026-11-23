import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * In a community build the issue page's slots are empty (`ACTIVE_SLOTS = []`):
 * a SAST finding that carries an agent verdict shows none of the closed tree's
 * pieces — no « Cybe Analysis » indicator, no stale-analysis banner, no « Code
 * map » tab, no AutoFix control — while the description, the data flow and the
 * history stay the core's.
 */

vi.mock('@/edition/active', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/edition/active')>();
  return { ...actual, activeSlots: () => [], ACTIVE_SLOTS: [] };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useInRouterContext: () => true }));
vi.mock('framer-motion', () => ({
  motion: { div: ({ children, ...p }: any) => <div {...p}>{children}</div> },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));
vi.mock('react-markdown', () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock('@/components/molecules/scoring/ScoringExploitabilityTab', () => ({ default: () => null }));
vi.mock('@/components/molecules/scoring/CvssScoreCard', () => ({ default: () => null }));
vi.mock('@/components/molecules/issue/code-snippet/CodeSnippet', () => ({ default: () => null }));
vi.mock('@/components/molecules/issue/code-example-viewer/CodeExampleViewer', () => ({ default: () => null }));
vi.mock('@/components/molecules/issue/dataflow/DataFlow', () => ({
  default: () => <div data-testid="data-flow" />,
}));
vi.mock('@/components/molecules/issue/history-timeline/HistoryTimeline', () => ({
  default: () => <div data-testid="history-timeline" />,
}));
vi.mock('@/components/molecules/modal/update-vulnerability-modal/UpdateVulnerabilityModal', () => ({ default: () => null }));
vi.mock('@/components/molecules/ticket-tracker/TicketTracker', () => ({ default: () => null }));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import IssueSastIacTemplate from './IssueSastIacTemplate';

const AGENT = { id: 'agent', email: 'agent@system', firstName: 'Cybe', lastName: 'Agent' };

const finding = {
  id: 'v-1', projectId: 'p-1', createdAt: '2026-01-01', updateAt: '2026-01-01',
  currentState: 'to_verify', currentSeverity: 'HIGH', currentPriority: 'important',
  vulnerabilityType: 'sast', vulnCountByType: { sast: 1, iac: 0, sca: 0 },
  path: 'src/articles/articles.service.ts', vulnerableStartLine: 48,
  vulnerability: {
    id: 'vuln-1', cwe: ['CWE-89'], name: 'SQL Injection', shortDescription: 'SQLi',
    description: 'User input reaches a SQL query unescaped.', howToPrevent: 'use params', owaspTop10: null,
    severity: 'HIGH', language: 'typescript',
  },
  // An agent verdict, analysed before the latest scan: the cloud shows its
  // indicator and its stale-analysis banner.
  exploitabilityVerdict: 'exploitable',
  exploitabilitySource: 'agent',
  exploitabilityUpdatedAt: '2026-09-12T10:51:00Z',
  exploitabilityStale: false,
  scoringSource: 'agent',
  historyItems: [
    { id: 'h-1', type: 'status', value: 'status changed', date: '2026-09-12T10:51:00Z', user: AGENT },
  ],
  dataFlowItems: [{ id: 'df-1', path: 'src/a.ts', line: 3, code: 'x' }],
} as any;

const baseProps = {
  vulnerability: finding,
  showModal: false,
  onCloseModal: vi.fn(),
  handleUpdateVulnerability: vi.fn(),
  handleOpenModal: vi.fn(),
  setActiveTab: vi.fn(),
  isAiMergeRequestEnabled: true,
  isGithubLinked: true,
  projectId: 'p-1',
  onRefreshVulnerability: vi.fn(),
  onAutofixSuccess: vi.fn(),
  lastScanAt: '2026-09-18T09:30:00Z',
};

const tabLabels = () =>
  Array.from(document.querySelectorAll('nav[aria-label="Tabs"] button')).map((b) => b.textContent);

describe('IssueSastIacTemplate — community build', () => {
  it('shows no Cybe Analysis indicator, no stale banner, no code map tab, no AutoFix control', () => {
    render(<IssueSastIacTemplate {...baseProps} activeTab="details" />);
    expect(screen.queryByText(/Agent Cybe/)).toBeNull();
    expect(screen.queryByText(/pages\.issuePage\.agent\./)).toBeNull();
    expect(screen.queryByText('pages.issuePage.tabs.codeMap')).toBeNull();
    expect(screen.queryByText(/autofix/i)).toBeNull();
    expect(tabLabels()).toEqual([
      'pages.issuePage.tabs.detailsAndFix',
      'pages.issuePage.scoring.tabTitle',
      'pages.issuePage.tabs.history',
    ]);
  });

  it('still shows the description and the data flow', () => {
    render(<IssueSastIacTemplate {...baseProps} activeTab="details" />);
    expect(screen.getByText(finding.vulnerability.description)).toBeInTheDocument();
    expect(screen.getByTestId('data-flow')).toBeInTheDocument();
  });

  it('still shows the history', () => {
    render(<IssueSastIacTemplate {...baseProps} activeTab="history" />);
    expect(screen.getByTestId('history-timeline')).toBeInTheDocument();
  });

  it('opened on the code map tab (a deep link), goes back to the details', () => {
    const setActiveTab = vi.fn();
    render(<IssueSastIacTemplate {...baseProps} activeTab="codeMap" setActiveTab={setActiveTab} />);
    expect(setActiveTab).toHaveBeenCalledWith('details');
  });
});
