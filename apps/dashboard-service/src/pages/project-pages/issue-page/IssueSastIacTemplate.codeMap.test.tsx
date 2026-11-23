import { beforeAll } from 'vitest';
import { readySlots } from '@/edition/slots';
beforeAll(() => readySlots(), 30_000);
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import IssueSastIacTemplate from './IssueSastIacTemplate';
import type {
  SastVulnerabilityResult,
  IacVulnerabilityResult,
  SecretVulnerabilityResult,
  ExploitabilityVerdict,
} from '@/server/interfaces/Vulnerability';

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
const panelProps = vi.fn();
vi.mock('../../../ee/codemap/pages/issue-page/FindingCodeMapPanel', () => ({
  default: (props: any) => {
    panelProps(props);
    return (
      <div data-testid="finding-code-map-panel" data-path={props.filePath} data-line={props.line} data-embedded={String(!!props.embedded)}>
        <button type="button" data-testid="simulate-unavailable" onClick={props.onUnavailable} />
      </div>
    );
  },
}));
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


const sast = (over: Record<string, unknown> = {}) =>
  ({ ...baseVuln, path: 'src/articles/articles.service.ts', vulnerableStartLine: 48, ...over }) as any;

describe('IssueSastIacTemplate — « Code map » tab of a SAST finding', () => {
  beforeEach(() => panelProps.mockReset());

  it.each([
    ['an IaC finding', { vulnerabilityType: 'iac' }],
    ['a secret', { vulnerabilityType: 'secret' }],
    ['a SAST finding without a line', { vulnerableStartLine: undefined }],
    ['a SAST finding without a path', { path: '' }],
  ])('is not offered on %s', (_label, over) => {
    render(<IssueSastIacTemplate {...baseProps} vulnerability={sast(over)} />);
    expect(screen.queryByText('pages.issuePage.tabs.codeMap')).toBeNull();
  });

  it('a finding without a map, opened on that tab (the drawer\'s next finding), goes back to the details', () => {
    const setActiveTab = vi.fn();
    render(
      <IssueSastIacTemplate {...baseProps} vulnerability={sast({ vulnerabilityType: 'iac' })} activeTab="codeMap" setActiveTab={setActiveTab} />,
    );
    expect(setActiveTab).toHaveBeenCalledWith('details');
    expect(screen.queryByTestId('finding-code-map-panel')).toBeNull();
  });
});
