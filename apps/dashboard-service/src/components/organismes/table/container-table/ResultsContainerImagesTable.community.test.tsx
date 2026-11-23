import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ContainerImage } from '@/server/interfaces/Packages';

/**
 * A SARIF container import sends no OS (`os = { family: '', name: '' }`), so
 * the Community Edition never renders the end-of-life banner of an image; the
 * cloud renders it as today. Each describe re-imports the table under its
 * edition, since the table reads `EDITION` once at load.
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

const BADGE = 'OS end of life: detection incomplete';
const emptyCounts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };

const image: ContainerImage = {
  id: 'v2.84.0',
  projectId: 'p-1',
  artifactName: 'registry.example/acme/vault:v2.84.0',
  osFamily: 'alpine',
  osName: '3.18.12',
  osEosl: true,
  branch: 'main',
  createdAt: '2026-09-10T11:01:00.000Z',
  updatedAt: '2026-09-10T11:02:00.000Z',
  vulnCounts: emptyCounts,
};

const baseProps = {
  onImageSelect: vi.fn(),
  onDeleteClick: vi.fn(),
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
  return (await import('./ResultsContainerImagesTable')).default;
};

describe('ResultsContainerImagesTable in the Community Edition', () => {
  let Table: Awaited<ReturnType<typeof load>>;
  beforeEach(async () => {
    Table = await load('community');
  });

  it('community: an image whose OS is end-of-life shows no end-of-life banner', () => {
    render(<Table {...baseProps} images={[image]} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(BADGE)).toBeNull();
    expect(screen.getByText(/registry\.example\/acme\/vault/)).toBeInTheDocument();
  });
});

describe('ResultsContainerImagesTable in the cloud', () => {
  let Table: Awaited<ReturnType<typeof load>>;
  beforeEach(async () => {
    Table = await load('cloud');
  });

  it('cloud: the end-of-life banner is shown', () => {
    render(<Table {...baseProps} images={[image]} />);
    expect(screen.getByRole('alert')).toHaveTextContent(BADGE);
  });
});

/**
 * No image yet: the Community Edition runs no scanner, so the empty table asks
 * for an import of a container scan, not for a new scan.
 */
describe('ResultsContainerImagesTable with no image, per edition', () => {
  it('community: the empty table asks for an import', async () => {
    const Table = await load('community');
    render(<Table {...baseProps} totalImages={0} images={[]} />);
    expect(screen.getByText("Import a container scan's SARIF file to see its images here.")).toBeInTheDocument();
    expect(screen.queryByText('Start a new scan to see images here.')).toBeNull();
  });

  it('cloud: the empty table asks for a new scan', async () => {
    const Table = await load('cloud');
    render(<Table {...baseProps} totalImages={0} images={[]} />);
    expect(screen.getByText('Start a new scan to see images here.')).toBeInTheDocument();
  });
});
