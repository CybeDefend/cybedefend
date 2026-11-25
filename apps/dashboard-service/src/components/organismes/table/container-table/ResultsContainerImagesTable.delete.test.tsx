import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ResultsContainerImagesTable from './ResultsContainerImagesTable';
import { ContainerImage } from '@/server/interfaces/Packages';
import { translate as t } from '@/test/i18n-mock';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const image: ContainerImage = {
  id: 'img-1',
  projectId: 'p-1',
  artifactName: 'ghcr.io/acme/api:v2',
  osFamily: 'alpine',
  osName: '3.20',
  osEosl: false,
  branch: 'main',
  createdAt: '2026-09-10T11:01:00.000Z',
  updatedAt: '2026-09-10T11:02:00.000Z',
  vulnCounts: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
};

const baseProps = {
  onImageSelect: vi.fn(),
  loading: false,
  totalImages: 1,
  currentPage: 1,
  totalPages: 1,
  pageSize: 20,
  onPageChange: vi.fn(),
  onPageSizeChange: vi.fn(),
  images: [image],
};

/** The page leaves the delete action out for a member who may not delete images. */
describe('ResultsContainerImagesTable — the delete action', () => {
  it('offers delete when the page hands an action', () => {
    render(<ResultsContainerImagesTable {...baseProps} onDeleteClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: t('common.delete') })).toBeInTheDocument();
  });

  it('offers no delete without one', () => {
    render(<ResultsContainerImagesTable {...baseProps} />);
    expect(screen.queryByRole('button', { name: t('common.delete') })).toBeNull();
  });
});
