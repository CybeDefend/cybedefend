import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ResultsContainerGroupedImagesTable from './ResultsContainerGroupedImagesTable';
import { GroupedContainerImage } from '@/server/interfaces/Packages';

// In the grouped view the alert must be visible on the collapsed
// repository row (one EOL tag is enough) and on the offending tag once
// expanded.

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const REPOSITORY = 'registry.example/acme/vault';
const emptyCounts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };

const tagRow = (id: string, tag: string, osEosl: boolean) => ({
  id,
  tag,
  digest: '',
  osEosl,
  scanId: `scan-${id}`,
  createdAt: '2026-09-10T11:01:00.000Z',
  updatedAt: '2026-09-10T11:02:00.000Z',
  vulnCounts: emptyCounts,
});

const groupWith = (tags: ReturnType<typeof tagRow>[]): GroupedContainerImage => ({
  repositoryName: REPOSITORY,
  projectId: 'p-1',
  osFamily: 'alpine',
  osName: '3.18.12',
  osEosl: tags.some(t => t.osEosl),
  branch: 'main',
  tagCount: tags.length,
  tags,
  aggregatedVulnCounts: emptyCounts,
  latestScanAt: '2026-09-10T11:02:00.000Z',
});

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

describe('ResultsContainerGroupedImagesTable — EOL base OS', () => {
  it('shows nothing extra when every tag runs a supported OS', () => {
    render(
      <ResultsContainerGroupedImagesTable
        {...baseProps}
        groupedImages={[groupWith([tagRow('b', 'v2.85.0', false)])]}
      />,
    );
    fireEvent.click(screen.getByText(REPOSITORY));

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
