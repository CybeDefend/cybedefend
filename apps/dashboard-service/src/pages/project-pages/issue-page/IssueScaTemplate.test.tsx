import { beforeAll } from 'vitest';
import { readySlots } from '@/edition/slots';
beforeAll(() => readySlots(), 30_000);
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import IssueScaTemplate from './IssueScaTemplate';

vi.mock('@/utils/function/utils', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  convertDate: () => '2026-01-01',
  getPriorityLabel: (p: string) => p,
  getStatusLabel: (s: string) => s,
  getCvssBorderColor: () => '',
  getCvssTextColor: () => '',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useInRouterContext: () => true }));

vi.mock('framer-motion', () => ({
  motion: { div: ({ children, ...p }: any) => <div {...p}>{children}</div> },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/ee/chat/server/hooks/useAskCybe', () => ({
  useAskCybe: () => vi.fn(),
  default: () => vi.fn(),
}));

// Heavy/irrelevant children: stub out so the test focuses on the meta grid.
vi.mock('@/components/molecules/scoring/ScoringExploitabilityTab', () => ({ default: () => null }));
vi.mock('@/components/molecules/scoring/CvssScoreCard', () => ({ default: () => null }));
vi.mock('@/components/atoms/badge/SeverityBadge', () => ({ default: () => null }));
vi.mock('@/components/atoms/badge/PackageTypeBadge', () => ({ default: () => null }));
vi.mock('@/components/atoms/button/BackButton', () => ({ default: () => null }));
vi.mock('@/components/atoms/button/Button', () => ({ default: () => null }));
vi.mock('@/components/atoms/card/Card', () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock('@/components/molecules/modal/update-vulnerability-modal/UpdateVulnerabilityModal', () => ({ default: () => null }));
vi.mock('@/components/molecules/issue/code-snippet/CodeSnippet', () => ({ default: () => null }));
vi.mock('@/components/molecules/issue/history-timeline/HistoryTimeline', () => ({ default: () => null }));
vi.mock('@/ee/autofix/components/molecules/issue/autofix-display/AutofixDisplay', () => ({ default: () => null }));
vi.mock('@/ee/ai/components/molecules/issue/agent-analysis-indicator/AgentAnalysisIndicator', () => ({ default: () => null }));
vi.mock('@/ee/autofix/components/molecules/issue/autofix-button/AutoFixButton', () => ({ default: () => null }));
vi.mock('@/components/molecules/chat/AiChatWidget', () => ({ default: () => null }));
vi.mock('@/components/molecules/ticket-tracker/TicketTracker', () => ({ default: () => null }));
vi.mock('react-markdown', () => ({ default: ({ children }: any) => <>{children}</> }));

const baseScaVuln: any = {
  id: 'sca-1', projectId: 'p-1', createdAt: '2026-01-01', updateAt: '2026-01-01',
  currentState: 'to_verify', currentSeverity: 'HIGH', currentPriority: 'important',
  historyItems: [], vulnerabilityType: 'sca',
  exploitabilityVerdict: 'theoretical',
  vulnerability: { id: 'v-1', cwe: [], name: 'SCA', shortDescription: '', severity: 'HIGH' },
  package: { name: 'lodash', version: '4.17.20' },
};

const baseProps: any = {
  vulnerability: baseScaVuln,
  showModal: false,
  onCloseModal: vi.fn(),
  handleUpdateVulnerability: vi.fn(),
  handleOpenModal: vi.fn(),
  activeTab: 'details',
  setActiveTab: vi.fn(),
  projectId: 'p-1',
  onRefreshVulnerability: vi.fn(),
};

describe('IssueScaTemplate — exploitability metadata tile', () => {
  it('renders the Exploitability tile with the verdict label', () => {
    render(<IssueScaTemplate {...baseProps} />);
    expect(screen.getByText('components.resultsTable.exploitability')).toBeInTheDocument();
    expect(screen.getByText('components.resultsTable.exploitabilityTheoretical')).toBeInTheDocument();
  });
});

describe('IssueScaTemplate — CVSS badge prefers v4 over v3', () => {
  const v3Severity = { id: 's-v3', type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H' };

  it('shows CVSS_V4 label with v4 base score when only v4 base is present', () => {
    const v4Vuln = {
      ...baseScaVuln,
      cvssScore: 8.8,
      cvss4BaseScore: 8.7,
      cvss4EnvironmentalScore: null,
      vulnerability: { ...baseScaVuln.vulnerability, severities: [v3Severity] },
    };
    render(<IssueScaTemplate {...baseProps} vulnerability={v4Vuln} />);
    expect(screen.getAllByText('CVSS_V4').length).toBeGreaterThan(0);
    expect(screen.getAllByText('8.7').length).toBeGreaterThan(0);
    expect(screen.queryByText('CVSS_V3')).toBeNull();
  });

  it('prefers cvss4 environmental over cvss4 base', () => {
    const v4Vuln = {
      ...baseScaVuln,
      cvssScore: 8.8,
      cvss4BaseScore: 8.7,
      cvss4EnvironmentalScore: 9.0,
      vulnerability: { ...baseScaVuln.vulnerability, severities: [v3Severity] },
    };
    render(<IssueScaTemplate {...baseProps} vulnerability={v4Vuln} />);
    expect(screen.getAllByText('CVSS_V4').length).toBeGreaterThan(0);
    expect(screen.getAllByText('9').length).toBeGreaterThan(0);
    expect(screen.queryByText('8.7')).toBeNull();
  });

  it('falls back to CVSS_V3 + cvssScore when cvss4 fields are absent', () => {
    const v3Only = {
      ...baseScaVuln,
      cvssScore: 8.8,
      cvss4BaseScore: null,
      cvss4EnvironmentalScore: null,
      vulnerability: { ...baseScaVuln.vulnerability, severities: [v3Severity] },
    };
    render(<IssueScaTemplate {...baseProps} vulnerability={v3Only} />);
    expect(screen.getAllByText('CVSS_V3').length).toBeGreaterThan(0);
    expect(screen.getAllByText('8.8').length).toBeGreaterThan(0);
    expect(screen.queryByText('CVSS_V4')).toBeNull();
  });

  it('renders no CVSS badge when no CVSS info is available', () => {
    const noCvss = {
      ...baseScaVuln,
      cvssScore: 0,
      cvss4BaseScore: null,
      cvss4EnvironmentalScore: null,
      vulnerability: { ...baseScaVuln.vulnerability, severities: [] },
    };
    render(<IssueScaTemplate {...baseProps} vulnerability={noCvss} />);
    expect(screen.queryByText('CVSS_V3')).toBeNull();
    expect(screen.queryByText('CVSS_V4')).toBeNull();
  });

  it('pickLatestCvss prefers CVSS_V4 over CVSS_V3 when both are in severities (v4 only in severity array)', () => {
    // Simulates the case where cvss4 fields are null but the OSV severities array
    // contains both v3 and v4 entries. The legacy picker should select v4.
    const v4InSeverities = {
      ...baseScaVuln,
      cvssScore: 8.8,
      cvss4BaseScore: null,
      cvss4EnvironmentalScore: null,
      vulnerability: {
        ...baseScaVuln.vulnerability,
        severities: [
          v3Severity,
          { id: 's-v4', type: 'CVSS_V4', score: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N' },
        ],
      },
    };
    render(<IssueScaTemplate {...baseProps} vulnerability={v4InSeverities} />);
    expect(screen.getAllByText('CVSS_V4').length).toBeGreaterThan(0);
    expect(screen.queryByText('CVSS_V3')).toBeNull();
  });
});

describe('IssueScaTemplate — embedded header meta chips (package manager, CWE, aliases)', () => {
  const metaVuln: any = {
    ...baseScaVuln,
    package: { name: 'litellm', version: '1.83.0', ecosystem: 'PyPI' },
    vulnerability: {
      ...baseScaVuln.vulnerability,
      cwes: [{ id: 'c1', cweId: 'CWE-639' }],
      aliases: [{ id: 'a1', alias: 'GHSA-aaaa-bbbb-cccc' }],
    },
  };

  it('renders the package manager (ecosystem) chip in the header when embedded', () => {
    render(<IssueScaTemplate {...baseProps} vulnerability={metaVuln} embedded />);
    const header = screen.getByTestId('sca-header-meta');
    expect(within(header).getByText('PyPI')).toBeInTheDocument();
  });

  it('renders CWE and alias chips in the header when embedded', () => {
    render(<IssueScaTemplate {...baseProps} vulnerability={metaVuln} embedded />);
    const header = screen.getByTestId('sca-header-meta');
    expect(within(header).getByText('CWE-639')).toBeInTheDocument();
    expect(within(header).getByText('GHSA-aaaa-bbbb-cccc')).toBeInTheDocument();
  });

  it('links each header CWE chip to its MITRE definition', () => {
    render(<IssueScaTemplate {...baseProps} vulnerability={metaVuln} embedded />);
    const header = screen.getByTestId('sca-header-meta');
    const cweLink = within(header).getByText('CWE-639').closest('a');
    expect(cweLink).toHaveAttribute('href', 'https://cwe.mitre.org/data/definitions/639.html');
  });

  it('does NOT render the header meta chips in full-page (non-embedded) mode', () => {
    render(<IssueScaTemplate {...baseProps} vulnerability={metaVuln} />);
    expect(screen.queryByTestId('sca-header-meta')).toBeNull();
  });

  it('omits the header meta block entirely when there is no ecosystem, CWE or alias', () => {
    const bare: any = {
      ...baseScaVuln,
      package: { name: 'litellm', version: '1.83.0' },
      vulnerability: { ...baseScaVuln.vulnerability, cwes: [], aliases: [] },
    };
    render(<IssueScaTemplate {...baseProps} vulnerability={bare} embedded />);
    expect(screen.queryByTestId('sca-header-meta')).toBeNull();
  });
});

describe('IssueScaTemplate — embedded header stacks actions below the CVSS badge', () => {
  const withCvss: any = {
    ...baseScaVuln,
    cvssScore: 8.8,
    cvss4BaseScore: 8.7,
    cvss4EnvironmentalScore: null,
    vulnerability: { ...baseScaVuln.vulnerability, severities: [] },
  };

  it('wraps the CVSS badge + actions in a vertical (flex-col) cluster when embedded', () => {
    const { container } = render(<IssueScaTemplate {...baseProps} vulnerability={withCvss} embedded />);
    const cluster = container.querySelector('.items-end');
    expect(cluster).not.toBeNull();
    // The CVSS badge lives inside the same column cluster as the actions.
    expect(within(cluster as HTMLElement).getAllByText('CVSS').length).toBeGreaterThan(0);
  });

  it('keeps the CVSS badge + actions on a single row in full-page (non-embedded) mode', () => {
    const { container } = render(<IssueScaTemplate {...baseProps} vulnerability={withCvss} />);
    expect(container.querySelector('.items-end')).toBeNull();
  });
});
