import { beforeAll } from 'vitest';
import { readySlots } from '@/edition/slots';
beforeAll(() => readySlots(), 30_000);
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import IssueSastIacTemplate from './IssueSastIacTemplate';
import type {
  SastVulnerabilityResult,
  IacVulnerabilityResult,
  SecretVulnerabilityResult,
  ExploitabilityVerdict,
} from '@/server/interfaces/Vulnerability';
import { Bug, Code, Edit, ExclamationTriangle, FileAlt, History, InfoCircle, Link, ShieldAlt, Sitemap, Star, Wrench } from '@/components/atoms/icon/icons';

vi.mock('@/utils/function/utils', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  convertDate: () => '2026-01-01',
  getPriorityLabel: (p: string) => p,
  getStatusLabel: (s: string) => s,
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
vi.mock('@/components/molecules/scoring/ScoringExploitabilityTab', () => ({
  default: () => <div data-testid="scoring-tab" />,
}));
vi.mock('@/components/molecules/scoring/CvssScoreCard', () => ({
  default: ({ vulnerability }: any) => {
    if (vulnerability.cvss4BaseScore != null) {
      return <div>CVSS 4.0 Score</div>;
    }
    if (vulnerability.vulnerability?.cvss3) {
      return <div>CVSS 3.1 Score</div>;
    }
    return null;
  },
}));
vi.mock('@/components/atoms/badge/SeverityBadge', () => ({ default: () => null }));
vi.mock('@/components/atoms/button/BackButton', () => ({ default: () => null }));
vi.mock('@/components/atoms/button/Button', () => ({
  // A bare <button> forwarding what the copy action relies on, so it
  // can be found and clicked; the other Button call sites render inertly.
  default: ({ children, icon, onClick, title, 'data-testid': testId }: {
    children?: React.ReactNode;
    icon?: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    title?: string;
    'data-testid'?: string;
  }) => (
    <button type="button" onClick={onClick} title={title} data-testid={testId}>
      {icon}
      {children}
    </button>
  ),
}));
vi.mock('@/components/atoms/card/Card', () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock('@/ee/chat/components/atoms/cybe-selection-tooltip/CybeSelectionTooltip', () => ({
  CybeSelectionTooltip: ({ children }: any) => <>{children}</>,
}));
vi.mock('@/ee/chat/server/hooks/useAskCybe', () => ({
  useAskCybe: () => vi.fn(),
  default: () => vi.fn(),
}));
vi.mock('@/components/molecules/modal/update-vulnerability-modal/UpdateVulnerabilityModal', () => ({ default: () => null }));
vi.mock('@/components/molecules/issue/code-snippet/CodeSnippet', () => ({ default: () => null }));
vi.mock('@/components/molecules/issue/dataflow/DataFlow', () => ({ default: () => null }));
vi.mock('@/components/molecules/issue/history-timeline/HistoryTimeline', () => ({ default: () => null }));
vi.mock('@/components/molecules/issue/code-example-viewer/CodeExampleViewer', () => ({ default: () => null }));
vi.mock('@/ee/autofix/components/molecules/issue/autofix-display/AutofixDisplay', () => ({ default: () => null }));
vi.mock('@/ee/ai/components/molecules/issue/agent-analysis-indicator/AgentAnalysisIndicator', () => ({ default: () => null }));
vi.mock('@/ee/autofix/components/molecules/issue/autofix-button/AutoFixButton', () => ({ default: () => null }));
vi.mock('@/components/molecules/chat/AiChatWidget', () => ({ default: () => null }));
vi.mock('@/components/molecules/ticket-tracker/TicketTracker', () => ({ default: () => null }));
vi.mock('react-markdown', () => ({ default: ({ children }: any) => <>{children}</> }));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('react-toastify', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));
const triggerReanalysis = vi.fn();
vi.mock('@/ee/ai/server/hooks/useReanalysisPolling', () => ({
  useReanalysisPolling: () => ({ isReanalyzing: false, triggerReanalysis }),
}));
const cvss3 = { baseScore: '7.5', vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N' };

const baseVuln: SastVulnerabilityResult = {
  id: 'v-1', projectId: 'p-1', createdAt: '2026-01-01', updateAt: '2026-01-01',
  currentState: 'to_verify', currentSeverity: 'HIGH', currentPriority: 'important',
  historyItems: [], vulnerabilityType: 'sast', vulnCountByType: { sast: 1, iac: 0, sca: 0 },
  vulnerability: {
    id: 'vuln-1', cwe: ['CWE-89'], name: 'SQL Injection', shortDescription: 'SQLi',
    description: 'desc', howToPrevent: 'use params', owaspTop10: null,
    severity: 'HIGH', language: 'typescript', cvss3,
  } as any,
  dataFlowItems: [],
  cvss4BaseScore: 8.7,
  cvss4EnvironmentalScore: 9.1,
  cvss4Vector: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N',
} as any;

const baseProps = {
  vulnerability: baseVuln,
  showModal: false,
  onCloseModal: vi.fn(),
  handleUpdateVulnerability: vi.fn(),
  handleOpenModal: vi.fn(),
  activeTab: 'details' as const,
  setActiveTab: vi.fn(),
  isAiMergeRequestEnabled: false,
  projectId: 'p-1',
  onRefreshVulnerability: vi.fn(),
  onAutofixSuccess: vi.fn(),
};

describe('IssueSastIacTemplate — CVSS card in details tab', () => {
  it('shows CVSS 4.0 Score when cvss4BaseScore is present', () => {
    render(<IssueSastIacTemplate {...baseProps} />);
    expect(screen.getByText(/CVSS 4\.0 Score/i)).toBeInTheDocument();
  });

  it('does NOT show CVSS 3.1 Score title when cvss4 is present', () => {
    render(<IssueSastIacTemplate {...baseProps} />);
    expect(screen.queryByText(/CVSS 3\.1 Score/i)).not.toBeInTheDocument();
  });

  it('shows CVSS 3.1 Score fallback when cvss4 is absent', () => {
    const noCvss4 = { ...baseVuln, cvss4BaseScore: null, cvss4Vector: null, cvss4EnvironmentalScore: null };
    render(<IssueSastIacTemplate {...baseProps} vulnerability={noCvss4} />);
    expect(screen.getByText(/CVSS 3\.1 Score/i)).toBeInTheDocument();
  });
});

describe('IssueSastIacTemplate — exploitability metadata tile', () => {
  it('renders the Exploitability tile with the verdict label', () => {
    const withVerdict = { ...baseVuln, exploitabilityVerdict: 'proven' as ExploitabilityVerdict };
    render(<IssueSastIacTemplate {...baseProps} vulnerability={withVerdict} />);
    expect(screen.getByText('components.resultsTable.exploitability')).toBeInTheDocument();
    expect(screen.getByText('components.resultsTable.exploitabilityProven')).toBeInTheDocument();
  });

  it('renders "Not Evaluated" when exploitabilityVerdict is null', () => {
    const unevaluated = { ...baseVuln, exploitabilityVerdict: null };
    render(<IssueSastIacTemplate {...baseProps} vulnerability={unevaluated} />);
    expect(screen.getByText('components.resultsTable.exploitabilityNotEvaluated')).toBeInTheDocument();
  });
});

describe('IssueSastIacTemplate — embedded (drawer) mode', () => {
  it('keeps the full-page background by default', () => {
    const { container } = render(<IssueSastIacTemplate {...baseProps} />);
    expect((container.firstChild as HTMLElement).className).toMatch(/min-h-screen/);
  });

  it('drops the full-page chrome when embedded', () => {
    const { container } = render(<IssueSastIacTemplate {...baseProps} embedded />);
    expect((container.firstChild as HTMLElement).className).not.toMatch(/min-h-screen/);
  });
});

/*
  A finding is neutralised by `cybedefend-ignore[<code>]: <reason>`
  on the flagged line or the line above, and the catalogue code is the only id
  accepted between the brackets. The detail shows that code and hands out the
  directive ready to paste, in the comment syntax of the finding's file.
*/
describe('IssueSastIacTemplate — rule code and ignore directive', () => {
  const writeText = vi.fn();
  const iacFinding: IacVulnerabilityResult = {
    ...baseVuln,
    vulnerabilityType: 'iac',
    path: 'infra/modules/bucket/main.tf',
    vulnerability: { ...baseVuln.vulnerability, code: 'CD-IAC-0123' },
  };

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    toastSuccess.mockReset();
    toastError.mockReset();
    Object.assign(navigator, { clipboard: { writeText } });
  });

  it('shows the rule code of the finding', () => {
    render(<IssueSastIacTemplate {...baseProps} vulnerability={iacFinding} />);
    expect(screen.getByTestId('rule-code')).toHaveTextContent('CD-IAC-0123');
  });

  it('shows it in the drawer (embedded) layout too', () => {
    render(<IssueSastIacTemplate {...baseProps} vulnerability={iacFinding} embedded />);
    expect(screen.getByTestId('rule-code')).toHaveTextContent('CD-IAC-0123');
  });

  it('copies the directive in the comment syntax of the .tf file', async () => {
    render(<IssueSastIacTemplate {...baseProps} vulnerability={iacFinding} />);

    fireEvent.click(screen.getByTestId('copy-ignore-directive-button'));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('# cybedefend-ignore[CD-IAC-0123]: <reason>'),
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('pages.issuePage.ruleCode.directiveCopied'),
    );
  });

  it('toasts an error when the clipboard refuses the write', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    render(<IssueSastIacTemplate {...baseProps} vulnerability={iacFinding} />);

    fireEvent.click(screen.getByTestId('copy-ignore-directive-button'));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('pages.issuePage.ruleCode.copyFailed'),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('shows neither the code nor the button on a secret finding', () => {
    const secretFinding: SecretVulnerabilityResult = {
      ...iacFinding,
      vulnerabilityType: 'secret',
      path: 'config/.env',
      hasEncryptedSecret: false,
    };
    render(<IssueSastIacTemplate {...baseProps} vulnerability={secretFinding} />);
    expect(screen.queryByTestId('rule-code')).not.toBeInTheDocument();
    expect(screen.queryByTestId('copy-ignore-directive-button')).not.toBeInTheDocument();
  });

  it('shows neither when the catalogue rule has no code', () => {
    render(<IssueSastIacTemplate {...baseProps} vulnerability={baseVuln} />);
    expect(screen.queryByTestId('rule-code')).not.toBeInTheDocument();
    expect(screen.queryByTestId('copy-ignore-directive-button')).not.toBeInTheDocument();
  });
});

describe('IssueSastIacTemplate — analysis older than the latest scan', () => {
  const NEWER_SCAN_TITLE = 'pages.issuePage.agent.staleAnalysis.newerScanTitle';
  const CONTEXT_TITLE = 'pages.issuePage.agent.staleAnalysis.title';
  const agentAnalysed = (at: string) => ({
    ...baseVuln,
    exploitabilitySource: 'agent',
    exploitabilityUpdatedAt: at,
    exploitabilityStale: false,
  });

  it('shows nothing when the agent verdict is more recent than the last scan', () => {
    render(
      <IssueSastIacTemplate
        {...baseProps}
        vulnerability={agentAnalysed('2026-09-18T09:45:00Z')}
        lastScanAt="2026-09-18T09:30:00Z"
      />,
    );
    expect(screen.queryByText(NEWER_SCAN_TITLE)).toBeNull();
  });

  it('shows nothing when the last scan date is unknown', () => {
    render(
      <IssueSastIacTemplate
        {...baseProps}
        vulnerability={agentAnalysed('2026-09-12T10:51:00Z')}
        lastScanAt={null}
      />,
    );
    expect(screen.queryByText(NEWER_SCAN_TITLE)).toBeNull();
  });

  it('ignores a manual verdict — only an agent analysis can be stale', () => {
    render(
      <IssueSastIacTemplate
        {...baseProps}
        vulnerability={{ ...agentAnalysed('2026-09-12T10:51:00Z'), exploitabilitySource: 'manual' }}
        lastScanAt="2026-09-18T09:30:00Z"
      />,
    );
    expect(screen.queryByText(NEWER_SCAN_TITLE)).toBeNull();
  });

  it('never shows it on a secret finding (not reanalyzable)', () => {
    render(
      <IssueSastIacTemplate
        {...baseProps}
        vulnerability={{ ...agentAnalysed('2026-09-12T10:51:00Z'), vulnerabilityType: 'secret' } as any}
        lastScanAt="2026-09-18T09:30:00Z"
      />,
    );
    expect(screen.queryByText(NEWER_SCAN_TITLE)).toBeNull();
  });
});
