import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ResultsContainerImagesTable from './ResultsContainerImagesTable';
import { ContainerImage } from '@/server/interfaces/Packages';

// The flat image list must flag an image whose base OS is
// end-of-life, even (especially) when it shows 0 vulnerabilities.

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const emptyCounts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };

const image = (id: string, osEosl: boolean): ContainerImage => ({
  id,
  projectId: 'p-1',
  artifactName: `registry.example/acme/vault:${id}`,
  osFamily: 'alpine',
  osName: '3.18.12',
  osEosl,
  branch: 'main',
  createdAt: '2026-09-10T11:01:00.000Z',
  updatedAt: '2026-09-10T11:02:00.000Z',
  vulnCounts: emptyCounts,
});

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

const BADGE = 'OS end of life: detection incomplete';

describe('ResultsContainerImagesTable — EOL base OS', () => {
  it('shows nothing extra for an image on a supported OS', () => {
    render(<ResultsContainerImagesTable {...baseProps} images={[image('v2.85.0', false)]} />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(BADGE)).toBeNull();
  });
});
