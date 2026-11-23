import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import LoaderScan from './LoaderScan';

const scan = {
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
  state: 'running',
};

/**
 * What the scan's AI agent is doing: a quiet line in the
 * loaders' family, the translated label as a word then the message, set apart
 * by space alone: no tinted pill, no dot, no separator, no pulse.
 */
describe('LoaderScan – the AI agent line', () => {
  it('names the agent through a translated label, beside its message', () => {
    render(<LoaderScan scanData={scan as never} vulnCount={0} showPulse={false} onClose={() => {}} agentMessage="Reading src/app.ts" />);
    const label = screen.getByText('components.loaderScan.agentLabel');
    const line = label.parentElement as HTMLElement;
    expect(line).toHaveTextContent('Reading src/app.ts');
    expect(line.textContent).not.toContain('AI agent:');
  });

  it('is a quiet line: no tinted pill, no dot, no separator, no pulse', () => {
    render(<LoaderScan scanData={scan as never} vulnCount={0} showPulse={false} onClose={() => {}} agentMessage="Reading src/app.ts" />);
    const line = screen.getByText('components.loaderScan.agentLabel').parentElement as HTMLElement;
    expect(line.className).not.toMatch(/bg-secondary\/|border-secondary/);
    expect(line.querySelector('.rounded-full')).toBeNull();
    expect(line.querySelector('.w-px')).toBeNull();
    expect(line.innerHTML).not.toMatch(/animate-/);
    expect(line.textContent).not.toMatch(/[·•—]/);
  });

  it('shows nothing when the agent says nothing', () => {
    render(<LoaderScan scanData={scan as never} vulnCount={0} showPulse={false} onClose={() => {}} />);
    expect(screen.queryByText('components.loaderScan.agentLabel')).toBeNull();
  });
});
