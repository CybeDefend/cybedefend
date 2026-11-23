import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

/**
 * The configuration dialogs of the Scanning tab, per edition.
 * - The « Cybe analysis Category » picker chooses what the Cybe analysis looks at:
 *   the Community Edition has no Cybe analysis, so it neither shows the
 *   picker nor requires a category before saving, whatever the project's
 *   analysis flag says (it defaults to on).
 * - Reachability comes from the cloud's SCA scanner; a SARIF import carries
 *   none, so its two switches are the
 *   cloud's only.
 * The dialog reads `EDITION` once at load, so each case re-imports it.
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

const load = async (edition: string, scansRun = false) => {
  ed.edition = edition;
  ed.scansRun = scansRun;
  vi.resetModules();
  return (await import('./ConfigurationScanModal')).default;
};

const CATEGORY_TITLE = 'Cybe analysis Category';

describe('ConfigurationScanModal — the analysis categories per edition', () => {
  it('the Community Edition shows no analysis category on the SAST dialog, even with the flag on', async () => {
    const Modal = await load('community');
    const onSubmit = vi.fn();
    render(
      <Modal isOpen onClose={vi.fn()} isSast improvingResultsEnabled initialConfig={{ fastScan: false, severities: ['high'] }} onSubmit={onSubmit} />,
    );
    expect(screen.queryByText(CATEGORY_TITLE)).not.toBeInTheDocument();
    // Saving needs no category and sends none.
    fireEvent.click(screen.getByText('Update Configuration'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('agentCategories');
  });

  it('the Community Edition shows no analysis category on the IaC dialog', async () => {
    const Modal = await load('community');
    render(
      <Modal isOpen onClose={vi.fn()} isSast={false} isIac improvingResultsEnabled initialConfig={{ severities: [] }} onSubmit={vi.fn()} />,
    );
    expect(screen.queryByText(CATEGORY_TITLE)).not.toBeInTheDocument();
  });

  it('the cloud shows the analysis categories on the SAST dialog', async () => {
    const Modal = await load('cloud');
    render(
      <Modal isOpen onClose={vi.fn()} isSast improvingResultsEnabled initialConfig={{ fastScan: false, severities: [] }} onSubmit={vi.fn()} />,
    );
    expect(screen.getByText(CATEGORY_TITLE)).toBeInTheDocument();
  });
});

describe('ConfigurationScanModal — reachability per edition', () => {
  const scaConfig = {
    severities: ['critical'],
    isDevDependenciesEnabled: false,
    isTransitiveDependenciesEnabled: false,
    isReachabilityPriorityEnabled: true,
    isReachabilityStatusEnabled: true,
  };

  it('the Community Edition shows no reachability switch on the SCA dialog', async () => {
    const Modal = await load('community');
    render(<Modal isOpen onClose={vi.fn()} isSast={false} isSca initialConfig={scaConfig} onSubmit={vi.fn()} />);
    expect(screen.queryByText('Reachability Priority Adjustment')).not.toBeInTheDocument();
    expect(screen.queryByText('Reachability Auto-Ignore')).not.toBeInTheDocument();
  });

  it('the cloud shows both reachability switches on the SCA dialog', async () => {
    const Modal = await load('cloud');
    render(<Modal isOpen onClose={vi.fn()} isSast={false} isSca initialConfig={scaConfig} onSubmit={vi.fn()} />);
    expect(screen.getByText('Reachability Priority Adjustment')).toBeInTheDocument();
    expect(screen.getByText('Reachability Auto-Ignore')).toBeInTheDocument();
  });
});

/**
 * The Community scanners ignore the fast scan mode and the SCA development and
 * transitive dependencies switches (trivy-fs reads what the lockfiles hold), so
 * the Community Edition hides them, with or without a cluster.
 */
describe('ConfigurationScanModal — fast scan, development and transitive dependencies per edition', () => {
  const scaConfig = {
    severities: ['critical'],
    isDevDependenciesEnabled: false,
    isTransitiveDependenciesEnabled: false,
    isReachabilityPriorityEnabled: true,
    isReachabilityStatusEnabled: true,
  };

  it.each([false, true])('the Community Edition (cluster: %s) hides them', async (scansRun) => {
    const Modal = await load('community', scansRun);
    const { unmount } = render(<Modal isOpen onClose={vi.fn()} isSast={false} isSca initialConfig={scaConfig} onSubmit={vi.fn()} />);
    expect(screen.queryByText('Development Dependencies')).not.toBeInTheDocument();
    expect(screen.queryByText('Transitive Dependencies')).not.toBeInTheDocument();
    unmount();
    render(<Modal isOpen onClose={vi.fn()} isSast initialConfig={{ fastScan: false, severities: [] }} onSubmit={vi.fn()} />);
    // No fast-scan toggle exists today: this guards against one being added later without its Community gate.
    expect(screen.queryByText('Fast Scan Mode')).not.toBeInTheDocument();
  });

  it('the cloud shows the development and transitive dependencies switches', async () => {
    const Modal = await load('cloud', true);
    render(<Modal isOpen onClose={vi.fn()} isSast={false} isSca initialConfig={scaConfig} onSubmit={vi.fn()} />);
    expect(screen.getByText('Development Dependencies')).toBeInTheDocument();
    expect(screen.getByText('Transitive Dependencies')).toBeInTheDocument();
  });
});
