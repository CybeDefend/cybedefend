import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import LoaderScan from './LoaderScan';

const scan = (state: string, extra: Record<string, unknown> = {}) =>
  ({
    id: 'scan-1',
    name: 'test-scan',
    language: [],
    projectId: 'proj-1',
    private: false,
    createAt: new Date(),
    updatedAt: new Date(),
    containers: [],
    progress: 40,
    step: '',
    state,
    ...extra,
  }) as never;

const BANNED = /animate-(ping|pulse|bounce|gradient|spin-slow)|bg-gradient|shadow-\[/;

/**
 * The scan loader in the loaders' family: a hairline arc
 * for activity, the steps as plain words (the current one in ink, the done
 * ones quieter, no filled circles, no dots), no ping, no pulse, no gradient,
 * no shadow. Its props and its logic do not change.
 */
describe('LoaderScan in the loaders family', () => {
  it.each([
    ['uploading', { scanData: null, isUploading: true, uploadProgress: 12 }],
    ['preparing', { scanData: scan('waiting_for_file') }],
    ['queued', { scanData: scan('queued') }],
    ['running', { scanData: scan('running') }],
    ['failed', { scanData: scan('failed') }],
    ['degraded', { scanData: scan('completed_degraded') }],
    ['cancelled', { scanData: scan('cancelled') }],
  ])('shows no ping, pulse, bounce, gradient or shadow while %s', (_name, props) => {
    const { container } = render(
      <LoaderScan scanData={null} vulnCount={2} showPulse onClose={() => {}} {...(props as Partial<React.ComponentProps<typeof LoaderScan>>)} />,
    );
    expect(container.innerHTML).not.toMatch(BANNED);
  });

  it('names the steps in words and marks the current one, without filled circles', () => {
    const { container } = render(<LoaderScan scanData={scan('running')} vulnCount={0} showPulse={false} onClose={() => {}} />);
    const current = screen.getByText('components.loaderScan.steps.scanning');
    expect(current.closest('[aria-current="step"]')).not.toBeNull();
    expect(screen.getByText('components.loaderScan.steps.filePreparation').closest('[aria-current]')).toBeNull();
    expect(container.querySelector('.rounded-full.h-12, .w-12.h-12')).toBeNull();
  });

  it('turns a hairline arc while the file is prepared and while the scan waits in the queue', () => {
    for (const state of ['waiting_for_file', 'queued']) {
      const { container, unmount } = render(<LoaderScan scanData={scan(state)} vulnCount={0} showPulse={false} onClose={() => {}} />);
      expect(container.querySelector('[data-arc]')).not.toBeNull();
      unmount();
    }
  });

  it('keeps the progress figure whole and the close control named', () => {
    render(<LoaderScan scanData={scan('running')} vulnCount={0} showPulse={false} onClose={() => {}} agentProgress={64} />);
    expect(screen.getByText('64%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'components.loaderScan.buttonDismiss' })).toBeInTheDocument();
  });

  it('says a scan finished with issues did finish, without reading the failure sentence', () => {
    render(<LoaderScan scanData={scan('completed_degraded', { errorMessage: 'trivy timed out' })} vulnCount={0} showPulse={false} onClose={() => {}} />);
    expect(screen.getByText('components.loaderScan.messageDegraded')).toBeInTheDocument();
    expect(screen.queryByText('components.loaderScan.scanErrors.generic')).toBeNull();
    expect(screen.getByText('trivy timed out')).toBeInTheDocument();
  });

  it('keeps the failure sentence for a failed scan', () => {
    render(<LoaderScan scanData={scan('failed')} vulnCount={0} showPulse={false} onClose={() => {}} />);
    expect(screen.getByText('components.loaderScan.scanErrors.generic')).toBeInTheDocument();
    expect(screen.queryByText('components.loaderScan.messageDegraded')).toBeNull();
  });

  it('offers the retry as the card primary action, red kept for the failure icon alone', () => {
    render(<LoaderScan scanData={scan('failed')} vulnCount={0} showPulse={false} onClose={() => {}} onRetry={() => {}} />);
    const retry = screen.getByRole('button', { name: 'components.loaderScan.buttonRetry' });
    expect(retry.className).not.toMatch(/red-/);
    expect(retry.className).toContain('bg-zinc-900');
    expect(retry.className).toContain('dark:bg-white');
  });
});
