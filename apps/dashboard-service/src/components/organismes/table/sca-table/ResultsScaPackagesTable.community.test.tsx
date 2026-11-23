import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScaDetectedPackage } from '@/server/interfaces/Packages';

/**
 * A SARIF import carries no dependency analysis, so the Community Edition's
 * packages table renders no reachability badge; name, version and file stay.
 * The cloud renders the badge as today. The table reads `EDITION` once at
 * load, so each case re-imports it under its edition.
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
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import { translate as t } from '@/test/i18n-mock';

const pkg = {
  id: 'pkg-1',
  projectId: 'p-1',
  packageName: 'lodash',
  packageVersion: '4.17.20',
  fileName: 'package.json',
  ecosystem: 'npm',
  isTransitive: false,
  isDev: false,
  path: [],
  dependencyInfoAvailable: true,
  reachability: 'used',
} as unknown as ScaDetectedPackage;

const props = {
  projectId: 'p-1',
  packages: [pkg],
  totalPackages: 1,
  currentPage: 1,
  totalPages: 1,
  pageSize: 10,
  pageSizeOptions: [10, 20],
  onPageChange: vi.fn(),
  onPageSizeChange: vi.fn(),
  selectedPackageType: [],
  onPackageTypeChange: vi.fn(),
  onSearchQueryChange: vi.fn(),
  loading: false,
  error: null,
  refresh: vi.fn(),
  includeDevAndTest: true,
};

const renderUnder = async (edition: string) => {
  ed.edition = edition;
  vi.resetModules();
  const Table = (await import('./ResultsScaPackagesTable')).default;
  return render(
    <MemoryRouter>
      <Table {...props} />
    </MemoryRouter>,
  );
};

const REACHABILITY_USED = () => t('pages.issuePage.sca.reachability.used');

describe('ResultsScaPackagesTable in the Community Edition', () => {
  it('community: no reachability badge; name, version and file still shown', async () => {
    await renderUnder('community');
    expect(screen.queryByLabelText(REACHABILITY_USED())).not.toBeInTheDocument();
    expect(screen.getByText('lodash')).toBeInTheDocument();
    expect(screen.getByText('4.17.20')).toBeInTheDocument();
    expect(screen.getByText('package.json')).toBeInTheDocument();
  });
});

describe('ResultsScaPackagesTable in the cloud', () => {
  it('cloud: the reachability badge is shown', async () => {
    await renderUnder('cloud');
    expect(screen.getByLabelText(REACHABILITY_USED())).toBeInTheDocument();
  });
});
