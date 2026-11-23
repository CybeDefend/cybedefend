import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * The SCA AutoFix section is the cloud's (`finding.sca.remediation`): with no
 * registration (the Community Edition) an SCA finding carrying AutoFix records
 * shows no AutoFix section, and the rest of its page as before.
 */
vi.mock('@/edition/active', async (importOriginal) => {
  const { EMPTY_EXTENSIONS } = await import('@/edition/extensions');
  return {
    ...(await importOriginal<typeof import('@/edition/active')>()),
    activeSlots: () => [],
    activeExtensions: () => EMPTY_EXTENSIONS,
    ACTIVE_SLOTS: [],
    ACTIVE_EXTENSIONS: EMPTY_EXTENSIONS,
  };
});
/**
 * A SARIF import carries no dependency analysis and no dependency path, so the
 * Community Edition renders neither the reachability row nor the dependency
 * tree. The template reads `EDITION` once at load: the cases below
 * re-import it under each edition.
 */
const ed = vi.hoisted(() => ({ edition: 'community' as string }));
// Each edition case re-imports its module tree after vi.resetModules(), slow under a parallel run.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));
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

import IssueScaTemplate from './IssueScaTemplate';

const record = {
  id: 'af-1',
  branch: '',
  prUrl: '',
  status: 'direct_update',
  reason: '',
  commitMessage: '',
  prTitle: '',
  prBody: '',
  diff: '',
  createdAt: '2026-07-26T10:00:00Z',
  updatedAt: '2026-07-26T10:00:00Z',
  cveId: 'CVE-2026-1234',
  vulnerablePackage: 'lodash',
  vulnerableVersion: '4.17.20',
  recommendedParentPackage: '',
  recommendedCurrentVersion: '4.17.20',
  recommendedProposedVersion: '4.17.21',
  recommendedUpdateType: 'patch',
  installCommand: 'npm i lodash@4.17.21',
  hasFixAvailable: true,
};

const vulnerability: any = {
  id: 'sca-1', projectId: 'p-1', createdAt: '2026-01-01', updateAt: '2026-01-01',
  currentState: 'to_verify', currentSeverity: 'HIGH', currentPriority: 'important',
  historyItems: [], vulnerabilityType: 'sca',
  exploitabilityVerdict: 'theoretical',
  vulnerability: { id: 'v-1', cve: 'CVE-2026-1234', cwe: [], name: 'SCA', shortDescription: '', severity: 'HIGH' },
  package: { packageName: 'lodash', packageVersion: '4.17.20' },
  hasAutofix: true,
  scaAutofixRecords: [record],
};

const props: any = {
  vulnerability,
  showModal: false,
  onCloseModal: vi.fn(),
  handleUpdateVulnerability: vi.fn(),
  handleOpenModal: vi.fn(),
  projectId: 'p-1',
};

describe('IssueScaTemplate in the Community Edition', () => {
  it('a finding with AutoFix records shows no AutoFix section', () => {
    render(<IssueScaTemplate {...props} />);
    expect(screen.queryByText(/pages\.issuePage\.sca\.autofix\.analyzedAt/)).not.toBeInTheDocument();
    expect(screen.queryByText('pages.issuePage.sca.autofix.title')).not.toBeInTheDocument();
    expect(screen.queryByText('npm i lodash@4.17.21')).not.toBeInTheDocument();
    // The advisory and the package are still shown.
    expect(screen.getAllByText('CVE-2026-1234').length).toBeGreaterThan(0);
  });

  it('the same finding embedded in the drawer shows no AutoFix section either', () => {
    render(<IssueScaTemplate {...props} embedded />);
    expect(screen.queryByTestId('autofix-version-compare')).not.toBeInTheDocument();
  });
});

const scannerFinding: any = {
  ...vulnerability,
  hasAutofix: false,
  scaAutofixRecords: [],
  package: {
    packageName: 'lodash',
    packageVersion: '4.17.20',
    reachability: 'used',
    path: ['lodash@4.17.20', 'express@4.18.0', 'my-app@1.0.0'],
  },
};

const loadTemplate = async (edition: string) => {
  ed.edition = edition;
  vi.resetModules();
  return (await import('./IssueScaTemplate')).default;
};

describe('IssueScaTemplate scanner-only pieces, by edition', () => {
  it('community: no reachability row and no dependency tree, even with a package path', async () => {
    const Template = await loadTemplate('community');
    render(<Template {...props} vulnerability={scannerFinding} />);
    expect(screen.queryByText('pages.issuePage.sca.reachability.title')).not.toBeInTheDocument();
    expect(screen.queryByText('pages.issuePage.dependencyPathDescription')).not.toBeInTheDocument();
    expect(screen.getAllByText('CVE-2026-1234').length).toBeGreaterThan(0);
  });

  it('cloud: the reachability row and the dependency tree are shown', async () => {
    const Template = await loadTemplate('cloud');
    render(<Template {...props} vulnerability={scannerFinding} />);
    expect(screen.getByText('pages.issuePage.sca.reachability.title')).toBeInTheDocument();
    expect(screen.getByText('pages.issuePage.dependencyPathDescription')).toBeInTheDocument();
  });

  it('community: no exploitable path card, even with import locations', async () => {
    const Template = await loadTemplate('community');
    render(<Template {...props} vulnerability={{ ...scannerFinding, package: { ...scannerFinding.package, importLocations: [{ file: 'src/a.ts', line: 3 }] } }} />);
    expect(screen.queryByText('pages.issuePage.sca.exploitablePath.title')).not.toBeInTheDocument();
  });

  it('cloud: the exploitable path card is shown', async () => {
    const Template = await loadTemplate('cloud');
    render(<Template {...props} vulnerability={scannerFinding} />);
    expect(screen.getByText('pages.issuePage.sca.exploitablePath.title')).toBeInTheDocument();
  });
});
