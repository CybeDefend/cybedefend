import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { GroupedContainerImage } from '@/server/interfaces/Packages';

/**
 * A SARIF container import sends no OS, so the Community Edition renders the
 * end-of-life banner neither on the repository row nor on a tag row; the cloud
 * renders both as today. Each describe re-imports the table under its edition.
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

const REPOSITORY = 'registry.example/acme/vault';
const BADGE = 'OS end of life: detection incomplete';
const emptyCounts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };

const group: GroupedContainerImage = {
  repositoryName: REPOSITORY,
  projectId: 'p-1',
  osFamily: 'alpine',
  osName: '3.18.12',
  osEosl: true,
  branch: 'main',
  tagCount: 1,
  tags: [
    {
      id: 'a',
      tag: 'v2.84.0',
      digest: '',
      osEosl: true,
      scanId: 'scan-a',
      createdAt: '2026-09-10T11:01:00.000Z',
      updatedAt: '2026-09-10T11:02:00.000Z',
      vulnCounts: emptyCounts,
    },
  ],
  aggregatedVulnCounts: emptyCounts,
  latestScanAt: '2026-09-10T11:02:00.000Z',
} as GroupedContainerImage;

const baseProps = {
  onImageSelect: vi.fn(),
  loading: false,
  totalImages: 1,
  currentPage: 1,
  totalPages: 1,
  pageSize: 20,
  onPageChange: vi.fn(),
  onPageSizeChange: vi.fn(),
};

const load = async (edition: string) => {
  ed.edition = edition;
  vi.resetModules();
  return (await import('./ResultsContainerGroupedImagesTable')).default;
};

describe('ResultsContainerGroupedImagesTable in the Community Edition', () => {
  let Table: Awaited<ReturnType<typeof load>>;
  beforeEach(async () => {
    Table = await load('community');
  });

  it('community: an image whose OS is end-of-life shows no end-of-life banner, on the image row or a tag row', () => {
    render(<Table {...baseProps} groupedImages={[group]} />);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByText(REPOSITORY));
    expect(screen.getByText('v2.84.0')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(BADGE)).toBeNull();
  });
});

describe('ResultsContainerGroupedImagesTable in the cloud', () => {
  let Table: Awaited<ReturnType<typeof load>>;
  beforeEach(async () => {
    Table = await load('cloud');
  });

  it('cloud: the end-of-life banner is shown on the image row and the tag row', () => {
    render(<Table {...baseProps} groupedImages={[group]} />);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    fireEvent.click(screen.getByText(REPOSITORY));
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });
});

/**
 * No image yet: the Community Edition runs no scanner, so the empty table asks
 * for an import of a container scan, not for a new scan.
 */
describe('ResultsContainerGroupedImagesTable with no image, per edition', () => {
  it('community: the empty table asks for an import', async () => {
    const Table = await load('community');
    render(<Table {...baseProps} totalImages={0} groupedImages={[]} />);
    expect(screen.getByText("Import a container scan's SARIF file to see its images here.")).toBeInTheDocument();
    expect(screen.queryByText('Start a new scan to see images here.')).toBeNull();
  });

  it('cloud: the empty table asks for a new scan', async () => {
    const Table = await load('cloud');
    render(<Table {...baseProps} totalImages={0} groupedImages={[]} />);
    expect(screen.getByText('Start a new scan to see images here.')).toBeInTheDocument();
  });
});
