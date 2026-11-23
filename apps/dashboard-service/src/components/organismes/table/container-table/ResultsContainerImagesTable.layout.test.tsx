import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ResultsContainerImagesTable from './ResultsContainerImagesTable';
import { ContainerImage } from '@/server/interfaces/Packages';

// The image name cell grows (long ECR references wrap onto two lines, the
// EOL badge adds a third). Branch and last-scan must stay centered on the
// row instead of hugging the top edge.

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const image: ContainerImage = {
  id: 'img-1',
  projectId: 'p-1',
  artifactName: '965057220262.dkr.ecr.us-east-1.amazonaws.com/cybedefend-test:alpine-3.18-eol',
  osFamily: 'alpine',
  osName: '3.18.12',
  osEosl: true,
  branch: 'main',
  createdAt: '2026-09-10T11:01:00.000Z',
  updatedAt: '2026-09-10T11:02:00.000Z',
  vulnCounts: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
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

describe('ResultsContainerImagesTable — row layout', () => {
  it('centers the branch and last-scan cells vertically', () => {
    render(<ResultsContainerImagesTable {...baseProps} images={[image]} />);

    const branchCell = screen.getByText('main').closest('td')!;
    const lastScanCell = screen.getByText(/Sep 10, 2026/).closest('td')!;

    for (const cell of [branchCell, lastScanCell]) {
      expect(cell.className).toContain('align-middle');
      expect(cell.className).not.toContain('align-top');
    }
  });
});
