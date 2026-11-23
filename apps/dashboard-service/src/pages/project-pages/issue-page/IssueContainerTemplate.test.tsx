import { beforeAll } from 'vitest';
import { readySlots } from '@/edition/slots';
beforeAll(() => readySlots(), 30_000);
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import IssueContainerTemplate from './IssueContainerTemplate';
import type { ContainerVulnerabilityResult } from '@/server/interfaces/Vulnerability';
import type { IssueTracking } from '@/server/hooks/useIssueTracking';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      (opts?.defaultValue as string) ?? key,
  }),
}));

const navigateSpy = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateSpy,
  useInRouterContext: () => true,
}));

vi.mock('@/ee/chat/server/hooks/useAskCybe', () => ({
  useAskCybe: () => vi.fn(),
  default: () => vi.fn(),
}));

vi.mock('@/ee/chat/components/atoms/cybe-selection-tooltip/CybeSelectionTooltip', () => ({
  CybeSelectionTooltip: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@/components/molecules/scoring/ScoringExploitabilityTab', () => ({
  default: () => <div data-testid="scoring-tab" />,
}));

vi.mock('@/components/molecules/issue/history-timeline/HistoryTimeline', () => ({
  default: () => <div data-testid="history-timeline" />,
}));

vi.mock(
  '@/components/molecules/modal/update-vulnerability-modal/UpdateVulnerabilityModal',
  () => ({ default: () => null }),
);

vi.mock('@/server/api/gatewayAPI', () => ({ default: {} }));

const baseVuln: ContainerVulnerabilityResult = {
  id: 'det-1',
  projectId: 'proj-1',
  createdAt: '2026-06-10T09:26:25.000Z',
  updateAt: '2026-06-10T09:26:25.000Z',
  currentState: 'to_verify',
  currentSeverity: 'CRITICAL',
  currentPriority: 'urgent',
  historyItems: [],
  vulnerabilityType: 'container',
  vulnCountByType: { sast: 0, iac: 0, sca: 0 },
  vulnerabilityIdentifier: 'CVE-2026-8376',
  vulnerability: {
    vulnerabilityId: 'CVE-2026-8376',
    title: 'Perl heap overflow',
    description: 'A heap overflow in perl-base.',
    pkgName: 'perl-base',
    installedVersion: '5.32.1',
    fixedVersion: '',
    severity: 'critical',
    target: '965057220262.dkr.ecr.us-east-1.amazonaws.com/cybedefend-test:v1.0.15 (debian 11.3)',
    class: 'os-pkgs',
    type: '',
    cweIds: ['CWE-787'],
    references: ['https://example.test/advisory'],
  },
  package: {
    id: 'pkg-1',
    name: 'perl-base',
    version: '5.32.1',
    arch: 'amd64',
    srcName: 'perl',
  },
};

const noop = () => {};
const renderTemplate = (vuln: ContainerVulnerabilityResult, error?: string) =>
  render(
    <IssueContainerTemplate
      vulnerability={vuln}
      showModal={false}
      onCloseModal={noop}
      handleUpdateVulnerability={noop}
      handleOpenModal={noop}
      error={error}
      projectId="proj-1"
    />,
  );

describe('IssueContainerTemplate — redesigned page', () => {
  it('shows the persisted CVSS v3 score in the header badge (no more N/A)', () => {
    renderTemplate({ ...baseVuln, cvssScore: 9.8, scoringSource: 'static' });
    expect(screen.getByText('9.8')).toBeInTheDocument();
    expect(screen.getByText(/CVSS/)).toBeInTheDocument();
  });

  it('prefers the CVSS 4.0 environmental score in the header badge', () => {
    renderTemplate({
      ...baseVuln,
      cvssScore: 9.8,
      cvss4BaseScore: 9.3,
      cvss4EnvironmentalScore: 10,
      cvss4Vector: 'CVSS:4.0/AV:N',
      scoringSource: 'static',
    });
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('renders tabs and switches to scoring and history', () => {
    renderTemplate({ ...baseVuln, cvssScore: 9.8 });

    // Details tab is active by default.
    expect(screen.getByText('pages.issuePage.fixInformation')).toBeInTheDocument();
    expect(screen.queryByTestId('scoring-tab')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('pages.issuePage.scoring.tabTitle'));
    expect(screen.getByTestId('scoring-tab')).toBeInTheDocument();

    // History tab shows the empty state when there is no history.
    fireEvent.click(screen.getByText('pages.issuePage.tabs.history'));
    expect(
      screen.getByText('pages.issuePage.tabs.noHistoryTitle'),
    ).toBeInTheDocument();
  });

  it('shows the exploitability tile when a verdict is present', () => {
    renderTemplate({
      ...baseVuln,
      cvssScore: 9.8,
      exploitabilityVerdict: 'proven',
    });
    expect(
      screen.getByText('components.resultsTable.exploitability'),
    ).toBeInTheDocument();
  });

  it('shows the target image with package architecture', () => {
    renderTemplate({ ...baseVuln, cvssScore: 9.8 });
    expect(
      screen.getByText(/cybedefend-test:v1\.0\.15/),
    ).toBeInTheDocument();
    expect(screen.getByText(/amd64/)).toBeInTheDocument();
  });

  it('uses an i18n key for the error state title', () => {
    renderTemplate(baseVuln, 'boom');
    expect(
      screen.getByText('pages.issuePage.noVulnerabilityTitle'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Error')).not.toBeInTheDocument();
  });
});

// The detail offers a ticket in each tool whose project settings
// allow the finding's branch; a tool limited to other branches is not offered.
describe('IssueContainerTemplate — ticket tracking', () => {
  const tracking: IssueTracking = {
    organizationId: 'org-1',
    ticketsByVulnerability: new Map(),
    jira: { configured: true, projectKey: 'KAN', allowedBranches: ['main'] },
    linear: { connected: true, configured: false, allowedBranches: [] },
    anyConfigured: true,
    refresh: vi.fn().mockResolvedValue(undefined),
  };

  it("the issue detail hides a tool whose allowed branches exclude the finding's branch", () => {
    render(
      <IssueContainerTemplate
        vulnerability={{ ...baseVuln, branch: 'feature/x' } as ContainerVulnerabilityResult}
        showModal={false}
        onCloseModal={noop}
        handleUpdateVulnerability={noop}
        handleOpenModal={noop}
        projectId="proj-1"
        issueTracking={tracking}
      />,
    );

    expect(screen.getByAltText('Linear')).toBeInTheDocument();
    expect(screen.queryByAltText('Jira')).toBeNull();
  });

  it('offers both tools on a branch they both allow', () => {
    render(
      <IssueContainerTemplate
        vulnerability={{ ...baseVuln, branch: 'main' } as ContainerVulnerabilityResult}
        showModal={false}
        onCloseModal={noop}
        handleUpdateVulnerability={noop}
        handleOpenModal={noop}
        projectId="proj-1"
        issueTracking={tracking}
      />,
    );

    expect(screen.getByAltText('Linear')).toBeInTheDocument();
    expect(screen.getByAltText('Jira')).toBeInTheDocument();
  });
});

describe('IssueContainerTemplate — the description is untrusted markdown', () => {
  it('renders no remote image and opens a link in a new tab, without a referrer', () => {
    renderTemplate({
      ...baseVuln,
      vulnerability: {
        ...baseVuln.vulnerability,
        description: 'Read [the advisory](https://example.test/advisory). ![](https://tracker.example.test/p.png)',
      },
    } as ContainerVulnerabilityResult);
    expect(document.querySelector('img[src^="https://tracker.example.test"]')).toBeNull();
    const link = screen.getByRole('link', { name: 'the advisory' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });
});
