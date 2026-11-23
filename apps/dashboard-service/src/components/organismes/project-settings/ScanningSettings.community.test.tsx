import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The « AutoFix merge request » setting drives Cybe AutoFix, which the
 * Community Edition does not ship: it is a registration of the closed
 * extension (its cloud behaviour is pinned next to it). The component reads
 * `EDITION` once at load, so each case re-imports it under its edition.
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
vi.mock('react-rebac', () => ({ useAuthorization: () => true }));
vi.mock('react-redux', () => ({
  useSelector: (select: (state: unknown) => unknown) =>
    select({ organization: { selectedOrganization: { id: 'org-1' } } }),
}));
vi.mock('@/components/molecules/modal/sast-configuration-modal/ConfigurationScanModal', () => ({
  default: () => null,
}));

const load = async (edition: string) => {
  ed.edition = edition;
  vi.resetModules();
  return (await import('./ScanningSettings')).default;
};

const props = (linked: { github?: boolean; gitlab?: boolean }) => ({
  analysisFrequency: 'never',
  onAnalysisFrequencyChange: vi.fn(),
  aiMergeRequestEnabled: false,
  onAiMergeRequestToggle: vi.fn(),
  improvingResultsEnabled: true,
  onCybeAnalysisToggle: vi.fn(),
  scanTypes: { sast: true, dast: false, sca: true, container: false, api: false, iac: true, secret: true, aibom: false },
  configurationSast: { fastScan: false, severities: [] },
  configurationIac: { severities: [] },
  configurationSca: {
    isDevDependenciesEnabled: false,
    isTransitiveDependenciesEnabled: false,
    isReachabilityPriorityEnabled: true,
    isReachabilityStatusEnabled: true,
    severities: [],
  },
  configurationContainer: { severities: [] },
  configurationSecret: { severities: [] },
  onScanTypeToggle: vi.fn(),
  onConfigureSast: vi.fn(),
  onConfigureSca: vi.fn(),
  onConfigureIac: vi.fn(),
  onConfigureContainer: vi.fn(),
  onConfigureSecret: vi.fn(),
  isProjectLinkedToGithub: !!linked.github,
  isProjectLinkedToGitlab: !!linked.gitlab,
});

const renderIn = async (edition: string, linked: { github?: boolean; gitlab?: boolean }, scansRun = false) => {
  ed.scansRun = scansRun;
  const ScanningSettings = await load(edition);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(<MemoryRouter><ScanningSettings {...(props(linked) as any)} /></MemoryRouter>);
};

describe('ScanningSettings — the AutoFix merge request per edition', () => {
  it('the Community Edition offers no AutoFix merge request, even for a project linked to GitHub', async () => {
    await renderIn('community', { github: true });
    expect(screen.queryByTestId('ai-setting-aiMergeRequest')).not.toBeInTheDocument();
  });

  it('the Community Edition offers no AutoFix merge request for a project linked to GitLab', async () => {
    await renderIn('community', { gitlab: true });
    expect(screen.queryByTestId('ai-setting-aiMergeRequest')).not.toBeInTheDocument();
  });
});

/**
 * AI-BOM and the EU AI Act report are closed: the Community Edition
 * neither runs nor imports an AI-BOM, so the Scanning tab does not list it.
 */
describe('ScanningSettings — the AI-BOM analysis per edition', () => {
  it('the Community Edition lists no AI-BOM analysis', async () => {
    await renderIn('community', {});
    expect(screen.queryByText('AI-BOM & EU AI Act compliance')).not.toBeInTheDocument();
    expect(screen.getByText('Secret Detection')).toBeInTheDocument();
  });

  it('the cloud lists the AI-BOM analysis', async () => {
    await renderIn('cloud', {});
    expect(screen.getByText('AI-BOM & EU AI Act compliance')).toBeInTheDocument();
  });
});

/**
 * Licence management is the cloud's: the SCA row offers no
 * « License Classifications » button in the Community Edition.
 */
describe('ScanningSettings — the licence classifications per edition', () => {
  it('the Community Edition offers no licence classifications button', async () => {
    await renderIn('community', {});
    expect(screen.queryByText('License Classifications')).not.toBeInTheDocument();
  });

  it('the cloud offers the licence classifications button', async () => {
    await renderIn('cloud', {});
    expect(screen.getByText('License Classifications')).toBeInTheDocument();
  });
});

describe('ScanningSettings — a Community instance with a cluster', () => {
  it('lists no AI-BOM analysis', async () => {
    await renderIn('community', {}, true);
    expect(screen.queryByText('AI-BOM & EU AI Act compliance')).not.toBeInTheDocument();
    expect(screen.getByText('Secret Detection')).toBeInTheDocument();
  });

  it('offers no AutoFix merge request, even for a project linked to GitHub', async () => {
    await renderIn('community', { github: true }, true);
    expect(screen.queryByTestId('ai-setting-aiMergeRequest')).not.toBeInTheDocument();
  });
});

/**
 * An import-only Community instance tells the administrator how to run scans
 * here: text only, no link.
 */
const HINT =
  'This instance imports results only. To run scans here, connect a Kubernetes cluster: see « Run scans on a Kubernetes cluster » in deploy/community/README.md.';

describe('ScanningSettings — the cluster hint', () => {
  it('is shown in the Community Edition without a cluster, as text only', async () => {
    await renderIn('community', {});
    const hint = screen.getByTestId('cluster-scans-hint');
    expect(hint).toHaveTextContent(HINT);
    expect(hint.querySelector('a')).toBeNull();
  });

  it('is not shown in the Community Edition with a cluster', async () => {
    await renderIn('community', {}, true);
    expect(screen.queryByTestId('cluster-scans-hint')).not.toBeInTheDocument();
  });

  it('is not shown in the cloud', async () => {
    await renderIn('cloud', {}, true);
    expect(screen.queryByTestId('cluster-scans-hint')).not.toBeInTheDocument();
  });
});
