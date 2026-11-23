import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * A finding of the Community Edition says, in a muted line, what CybeDefend
 * Cloud and Enterprise add: Cybe Analysis and its fewer false
 * positives, and the managed rules (names, descriptions, deduplication,
 * automatic resolution). It shows on
 * the page of every finding type an import fills, once per page, and never in
 * the cloud, whose issue pages show the analysis itself.
 */
const mocks = vi.hoisted(() => ({ edition: 'community' as string }));

vi.mock('@/edition/edition', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/edition/edition')>();
  return {
    ...actual,
    get EDITION() {
      return mocks.edition;
    },
  };
});
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useInRouterContext: () => true }));
vi.mock('framer-motion', () => ({
  motion: { div: ({ children, ...p }: any) => <div {...p}>{children}</div> },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));
vi.mock('react-markdown', () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/molecules/scoring/ScoringExploitabilityTab', () => ({ default: () => null }));
vi.mock('@/components/molecules/scoring/CvssScoreCard', () => ({ default: () => null }));
vi.mock('@/components/molecules/issue/code-snippet/CodeSnippet', () => ({ default: () => null }));
vi.mock('@/components/molecules/issue/code-example-viewer/CodeExampleViewer', () => ({ default: () => null }));
vi.mock('@/components/molecules/issue/dataflow/DataFlow', () => ({ default: () => null }));
vi.mock('@/components/molecules/issue/history-timeline/HistoryTimeline', () => ({ default: () => null }));
vi.mock('@/components/molecules/issue/secret-reveal-card/SecretRevealCard', () => ({ default: () => null }));
vi.mock('@/components/molecules/modal/update-vulnerability-modal/UpdateVulnerabilityModal', () => ({
  default: () => null,
}));
vi.mock('@/components/molecules/ticket-tracker/TicketTracker', () => ({ default: () => null }));

import IssueSastIacTemplate from '@/pages/project-pages/issue-page/IssueSastIacTemplate';
import IssueScaTemplate from '@/pages/project-pages/issue-page/IssueScaTemplate';
import IssueContainerTemplate from '@/pages/project-pages/issue-page/IssueContainerTemplate';
import { Slot } from '@/edition/slots';
import { activeSlots } from '@/edition/active';
import { upsellLink } from './upsellLink';

afterEach(() => {
  cleanup();
  mocks.edition = 'community';
});

const SENTENCE =
  'CybeDefend Cloud and Enterprise add Cybe Analysis, which cuts false positives, and 5,000+ managed rules with clear vulnerability names and descriptions, automatic deduplication and automatic resolution.';

const common = {
  id: 'v-1',
  projectId: 'p-1',
  createdAt: '2026-01-01',
  updateAt: '2026-01-01',
  currentState: 'to_verify',
  currentSeverity: 'HIGH',
  currentPriority: 'important',
  historyItems: [],
  vulnCountByType: { sast: 1, iac: 0, sca: 0 },
};

const codeFinding = (type: string) =>
  ({
    ...common,
    vulnerabilityType: type,
    path: 'src/app.ts',
    vulnerableStartLine: 3,
    vulnerability: {
      id: 'vuln-1',
      cwe: ['CWE-89'],
      name: 'SQL Injection',
      shortDescription: 'SQLi',
      description: 'User input reaches a SQL query.',
      howToPrevent: 'use params',
      owaspTop10: null,
      severity: 'HIGH',
      language: 'typescript',
    },
  }) as any;

const scaFinding = {
  ...common,
  vulnerabilityType: 'sca',
  vulnerability: { id: 'v-1', cwe: [], name: 'SCA', shortDescription: '', severity: 'HIGH' },
  package: { name: 'lodash', version: '4.17.20' },
} as any;

const containerFinding = {
  ...common,
  vulnerabilityType: 'container',
  vulnerabilityIdentifier: 'CVE-2026-8376',
  vulnerability: {
    vulnerabilityId: 'CVE-2026-8376',
    title: 'Perl heap overflow',
    description: 'A heap overflow in perl-base.',
    pkgName: 'perl-base',
    installedVersion: '5.32.1',
    fixedVersion: '',
    severity: 'critical',
    target: 'registry.example/app:1.0 (debian 11.3)',
    class: 'os-pkgs',
    type: '',
    cweIds: ['CWE-787'],
    references: [],
  },
  package: { id: 'pkg-1', name: 'perl-base', version: '5.32.1', arch: 'amd64', srcName: 'perl' },
} as any;

const pageProps = {
  showModal: false,
  onCloseModal: vi.fn(),
  handleUpdateVulnerability: vi.fn(),
  handleOpenModal: vi.fn(),
  projectId: 'p-1',
};

/** The issue page of a finding of `type`, as IssueDetailView picks it. */
function renderIssuePage(type: string, activeTab = 'details', setActiveTab = vi.fn()) {
  if (type === 'sca') return render(<IssueScaTemplate {...(pageProps as any)} vulnerability={scaFinding} />);
  if (type === 'container')
    return render(<IssueContainerTemplate {...(pageProps as any)} vulnerability={containerFinding} />);
  return render(
    <IssueSastIacTemplate
      {...(pageProps as any)}
      vulnerability={codeFinding(type)}
      activeTab={activeTab as any}
      setActiveTab={setActiveTab}
      onRefreshVulnerability={vi.fn()}
    />,
  );
}

describe('AiAnalysisUpsellPanel', () => {
  it.each(['sast', 'iac', 'secret', 'cicd', 'sca', 'container'])(
    'a muted panel reads the Cloud and Enterprise line with a link to the pricing on a %s finding in community',
    (type) => {
      renderIssuePage(type);
      // Once per page, whatever the number of hosts the page holds.
      const sentence = screen.getByText(SENTENCE);
      const panel = sentence.closest('[data-upsell="upsell-ai-analysis"]') as HTMLElement;
      expect(panel).not.toBeNull();
      expect(panel.className).toContain('text-zinc-500');
      expect(panel.className).toContain('dark:text-zinc-450');
      // Muted: no accent fill, no accent text.
      expect(panel.outerHTML).not.toMatch(/bg-secondary|text-secondary/);
      const link = panel.querySelector('a') as HTMLAnchorElement;
      expect(link).toHaveAttribute('href', upsellLink('upsell-ai-analysis', '/pricing'));
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')?.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
    },
  );

  it('a deep link to a tab no Community registration draws still opens the details', () => {
    const setActiveTab = vi.fn();
    renderIssuePage('sast', 'codeMap', setActiveTab);
    expect(setActiveTab).toHaveBeenCalledWith('details');
  });

  it('absent in the cloud', () => {
    mocks.edition = 'cloud';
    expect(activeSlots().some((registration) => registration.id === 'upsell-ai-analysis')).toBe(false);
    render(<Slot name="finding.panels" context={{ vulnerabilityType: 'sca', host: 'issue-overview' }} />);
    expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();
  });
});
