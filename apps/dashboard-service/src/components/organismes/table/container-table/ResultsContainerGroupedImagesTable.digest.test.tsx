import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ResultsContainerGroupedImagesTable from './ResultsContainerGroupedImagesTable';
import { GroupedContainerImage } from '@/server/interfaces/Packages';

// An image scanned BY DIGEST has no tag. The table used to rebuild
// `${repositoryName}:${tag}`, which turned a digest row into `repo:latest`:
// a different (or non-existent) manifest, and two digests of one repository
// became two identical "latest" rows. The reference must be rebuilt with '@'.

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const REPOSITORY = 'rg.fr-par.scw.cloud/acme/frontend';
const DIGEST_A =
    'sha256:1f4d0d0d5a1e4b6c8f9a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70';
const DIGEST_B =
    'sha256:0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9';

const emptyCounts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };

const tagRow = (id: string, tag: string, digest: string) => ({
    id,
    tag,
    digest,
    osEosl: false,
    scanId: `scan-${id}`,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-15T00:00:00.000Z',
    vulnCounts: emptyCounts,
});

const groupWith = (
    tags: ReturnType<typeof tagRow>[],
): GroupedContainerImage => ({
    repositoryName: REPOSITORY,
    projectId: 'p-1',
    osFamily: 'debian',
    osName: 'Debian 12',
    osEosl: false,
    branch: 'main',
    tagCount: tags.length,
    tags,
    aggregatedVulnCounts: emptyCounts,
    latestScanAt: '2024-01-15T00:00:00.000Z',
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

/** Expands the repository row so the per-tag rows are mounted. */
const expand = () => {
    fireEvent.click(screen.getByText(REPOSITORY));
};

describe('ResultsContainerGroupedImagesTable — by-digest rows', () => {
    it('selects a digest row with an @-addressed artifactName, never :latest', () => {
        const onImageSelect = vi.fn();
        render(
            <ResultsContainerGroupedImagesTable
                {...baseProps}
                onImageSelect={onImageSelect}
                groupedImages={[groupWith([tagRow('img-a', '', DIGEST_A)])]}
            />,
        );

        expand();
        fireEvent.click(screen.getByTitle(DIGEST_A));

        expect(onImageSelect).toHaveBeenCalledTimes(1);
        const selected = onImageSelect.mock.calls[0][0];
        expect(selected.artifactName).toBe(`${REPOSITORY}@${DIGEST_A}`);
        expect(selected.artifactName).not.toContain(':latest');
    });

    it('passes the @-addressed artifactName to the delete handler too', () => {
        const onDeleteClick = vi.fn();
        render(
            <ResultsContainerGroupedImagesTable
                {...baseProps}
                onDeleteClick={onDeleteClick}
                groupedImages={[groupWith([tagRow('img-a', '', DIGEST_A)])]}
            />,
        );

        expand();
        fireEvent.click(screen.getByTitle('Delete'));

        expect(onDeleteClick).toHaveBeenCalledTimes(1);
        expect(onDeleteClick.mock.calls[0][0].artifactName).toBe(
            `${REPOSITORY}@${DIGEST_A}`,
        );
    });

    it('keeps two digests of the same repository distinguishable', () => {
        const onImageSelect = vi.fn();
        render(
            <ResultsContainerGroupedImagesTable
                {...baseProps}
                onImageSelect={onImageSelect}
                groupedImages={[
                    groupWith([
                        tagRow('img-a', '', DIGEST_A),
                        tagRow('img-b', '', DIGEST_B),
                    ]),
                ]}
            />,
        );

        expand();

        // Neither row may be labelled with a fabricated 'latest': the two rows
        // must read differently, otherwise they are indistinguishable on screen.
        expect(screen.queryByText('latest')).toBeNull();
        const labelA = screen.getByTitle(DIGEST_A).textContent;
        const labelB = screen.getByTitle(DIGEST_B).textContent;
        expect(labelA).not.toBe(labelB);

        fireEvent.click(screen.getByTitle(DIGEST_A));
        fireEvent.click(screen.getByTitle(DIGEST_B));

        const references = onImageSelect.mock.calls.map(
            ([image]) => image.artifactName,
        );
        expect(references).toEqual([
            `${REPOSITORY}@${DIGEST_A}`,
            `${REPOSITORY}@${DIGEST_B}`,
        ]);
        expect(new Set(references).size).toBe(2);
    });

    it('still builds a :tag reference for a normally tagged row', () => {
        const onImageSelect = vi.fn();
        render(
            <ResultsContainerGroupedImagesTable
                {...baseProps}
                onImageSelect={onImageSelect}
                groupedImages={[groupWith([tagRow('img-t', 'v1.0.0', '')])]}
            />,
        );

        expand();
        const row = screen.getByText('v1.0.0');
        fireEvent.click(within(row.closest('tr')!).getByText('v1.0.0'));

        expect(onImageSelect.mock.calls[0][0].artifactName).toBe(
            `${REPOSITORY}:v1.0.0`,
        );
    });
});
