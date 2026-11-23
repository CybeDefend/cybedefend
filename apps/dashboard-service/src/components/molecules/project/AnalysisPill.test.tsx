import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import type { AnalysisType } from '@/server/interfaces/Project';
import AnalysisPill from './AnalysisPill';

// The interface language is switchable per test; the keys resolve against `en`.
const language = vi.hoisted(() => ({ current: 'en' }));
vi.mock('react-i18next', async () => {
  const { translate } = await import('@/test/i18n-mock');
  return {
    useTranslation: () => ({
      t: translate,
      i18n: { language: language.current, changeLanguage: () => Promise.resolve() },
    }),
    initReactI18next: { type: '3rdParty', init: () => {} },
  };
});

// The plan locks come from the edition's entitlements (neutral in the
// Community Edition): each test names the features it locks, whatever the
// edition the suite runs in.
const locked = vi.hoisted(() => ({ features: new Set<string>() }));
vi.mock('@/server/hooks/useDisabledFeatures', () => ({
  useDisabledFeatures: () => locked.features,
}));

const issuesCount = { critical: 1, high: 2, medium: 0, low: 0 };
const analysis = (type: string, lastScan: string | null = null): AnalysisType => ({
  type,
  lastScan,
  source: 'manual',
  issuesCount,
});

const storeWith = (featuresDisabled = '') =>
  configureStore({
    reducer: () => ({
      organization: { selectedOrganization: { id: 'org-1', subscription: { featuresDisabled } } },
    }),
  });

const renderPill = (pill: AnalysisType, featuresDisabled = '') => {
  locked.features = new Set(featuresDisabled.split(',').filter(Boolean));
  return render(
    <Provider store={storeWith(featuresDisabled)}>
      <MemoryRouter>
        <AnalysisPill analysis={pill} projectId="p1" lastScanSourceType="manual" />
      </MemoryRouter>
    </Provider>,
  );
};

afterEach(() => {
  language.current = 'en';
});

describe('AnalysisPill', () => {
  it('is a real link to the AppSec results page of its analysis, so it opens in a new tab', () => {
    renderPill(analysis('sast'));
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/appsec/project/p1/sast');
    expect(link).toHaveTextContent('SAST');
    expect(link).toHaveTextContent('3 issues');
    expect(link).not.toHaveTextContent('·');
  });

  it('links an analysis of an unknown type to the AppSec home', () => {
    renderPill(analysis('unknown'));
    expect(screen.getByRole('link')).toHaveAttribute('href', '/appsec');
  });

  it('keeps a locked container pill a link, with the locked explanation', () => {
    renderPill(analysis('container'), 'container_scanning');
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/appsec/project/p1/container');
    expect(link).toHaveAttribute('title', 'Container Scanning requires a Pro plan or above');
  });

  it('says when the analysis last ran, in the interface language', () => {
    language.current = 'fr';
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    renderPill(analysis('sast', twoDaysAgo));
    expect(screen.getByText('il y a 2 jours')).toBeInTheDocument();
  });

  it('says an analysis that never ran was never scanned', () => {
    renderPill(analysis('sast'));
    expect(screen.getByText('Never Scanned')).toBeInTheDocument();
  });
});
