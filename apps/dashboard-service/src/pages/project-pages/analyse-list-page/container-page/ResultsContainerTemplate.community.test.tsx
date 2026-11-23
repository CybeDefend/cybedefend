import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ContainerImage } from '@/server/interfaces/Packages';

/**
 * A SARIF container import sends no OS, so the Community Edition never renders
 * the selected image's end-of-life banner; the cloud renders it as today. The
 * tables are stubs: only the banner above them is under test. Each describe
 * re-imports the template under its edition, since it reads `EDITION` at load.
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
vi.mock('@/components/organismes/table/container-table/ResultsContainerTable', () => ({ ResultsContainerTable: () => null }));
vi.mock('@/components/organismes/table/grouped-container-table/GroupedResultsContainerTable', () => ({
  GroupedResultsContainerTable: () => null,
}));
vi.mock('@/components/organismes/table/container-table/ResultsContainerPackagesTable', () => ({ default: () => null }));
vi.mock('@/components/organismes/issue-drawer/IssueQuickViewHost', () => ({ default: () => null }));

const BANNER_TITLE = /end of life/i;

const selectedImage: ContainerImage = {
  id: 'img-1',
  projectId: 'p-1',
  artifactName: 'registry.example/acme/vault:v2.84.0',
  osFamily: 'alpine',
  osName: '3.18.12',
  osEosl: true,
  branch: 'main',
  createdAt: '2026-09-10T11:01:00.000Z',
  updatedAt: '2026-09-10T11:02:00.000Z',
  vulnCounts: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
};

const noop = () => undefined;
const props: any = {
  projectId: 'p-1',
  selectedImage,
  onBackToImages: noop,
  view: 'vulnerabilities',
  setView: noop,
  onSearchQueryChange: noop,
  selectedClassType: [],
  onClassTypeChange: noop,
  pageSizeOptions: [10, 20],
  scanInfo: null,
  vulnViewMode: 'detailed',
  onVulnViewModeChange: noop,
  groupedVulnerabilities: [],
  totalGroups: 0,
  groupedLoading: false,
  groupedCurrentPage: 1,
  groupedTotalPages: 1,
  onGroupedPageChange: noop,
  vulnerabilities: [],
  totalVulnerabilities: 0,
  vulnLoading: false,
  vulnCurrentPage: 1,
  vulnTotalPages: 1,
  vulnPageSize: 10,
  onVulnPageChange: noop,
  onVulnPageSizeChange: noop,
  selectedSeverity: [],
  selectedStatus: [],
  selectedPriority: [],
  selectedOrder: 'currentSeverity',
  selectedOrderDirection: 'desc',
  onSeverityChange: noop,
  onStatusChange: noop,
  onPriorityChange: noop,
  onOrderChange: noop,
  onOrderDirectionChange: noop,
  packages: [],
  totalPackages: 0,
  pkgLoading: false,
  pkgCurrentPage: 1,
  pkgTotalPages: 1,
  pkgPageSize: 10,
  onPkgPageChange: noop,
  onPkgPageSizeChange: noop,
};

const load = async (edition: string) => {
  ed.edition = edition;
  vi.resetModules();
  return (await import('./ResultsContainerTemplate')).default;
};

describe('ResultsContainerTemplate in the Community Edition', () => {
  let Template: Awaited<ReturnType<typeof load>>;
  beforeEach(async () => {
    Template = await load('community');
  });

  it('community: an image whose OS is end-of-life shows no end-of-life banner', () => {
    render(<Template {...props} />);
    expect(screen.getByText(selectedImage.artifactName)).toBeInTheDocument();
    expect(screen.queryByText(BANNER_TITLE)).toBeNull();
  });
});

describe('ResultsContainerTemplate in the cloud', () => {
  let Template: Awaited<ReturnType<typeof load>>;
  beforeEach(async () => {
    Template = await load('cloud');
  });

  it('cloud: the end-of-life banner is shown', () => {
    render(<Template {...props} />);
    expect(screen.getAllByText(BANNER_TITLE).length).toBeGreaterThan(0);
  });
});
