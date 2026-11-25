import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import UploadFilterSummaryNotice, { shortenMiddle } from './UploadFilterSummaryNotice';
import type { UploadFilterSummaryDto } from '@/server/interfaces/Scan';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const summary = (over: Partial<UploadFilterSummaryDto> = {}): UploadFilterSummaryDto => ({
  scannerConfiguration: 0,
  excludedPath: 0,
  excludedType: 0,
  unsafeName: 0,
  gitMetadata: 0,
  excludedFolders: [],
  ...over,
});

/** The folder line, read as the user sees it. */
const folderLine = () => screen.getByText(/^Excluded folders:/).textContent;

describe('UploadFilterSummaryNotice', () => {
  it('renders nothing when the scan has no summary', () => {
    const { container } = render(<UploadFilterSummaryNotice summary={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the gRPC layer hands an unset summary as null', () => {
    const { container } = render(<UploadFilterSummaryNotice summary={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when nothing was left out', () => {
    const { container } = render(<UploadFilterSummaryNotice summary={summary()} />);
    expect(container).toBeEmptyDOMElement();
  });

  // A `.git` folder always carries hook samples: they are no file of the
  // repository's tree, and would show the notice on almost every upload.
  it('renders nothing when only git metadata was left out', () => {
    const { container } = render(<UploadFilterSummaryNotice summary={summary({ gitMetadata: 13 })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says how many files were not scanned and why, naming the excluded folders', () => {
    render(
      <UploadFilterSummaryNotice
        summary={summary({
          excludedPath: 5,
          excludedType: 2,
          scannerConfiguration: 1,
          gitMetadata: 13,
          excludedFolders: [
            { name: 'build', count: 3 },
            { name: 'web/dist', count: 1 },
          ],
        })}
      />,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    // Git metadata is not counted as files not scanned.
    expect(screen.getByText('8 files of the upload were not scanned.')).toBeInTheDocument();
    expect(screen.getByText(/^5 in excluded folders/)).toBeInTheDocument();
    expect(folderLine()).toBe('Excluded folders: build (3), web/dist (1).');
    expect(screen.getByText(/^2 of a file type no scanner reads/)).toBeInTheDocument();
    expect(screen.getByText(/^1 scanner configuration file not used/)).toBeInTheDocument();
    expect(screen.queryByText(/git/i)).toBeNull();
  });

  it('counts the files with an unsafe name, and leaves git metadata out of the total', () => {
    render(<UploadFilterSummaryNotice summary={summary({ unsafeName: 1, gitMetadata: 2 })} />);
    expect(screen.getByText('1 file of the upload was not scanned.')).toBeInTheDocument();
    expect(screen.getByText(/^1 file with an unsafe name/)).toBeInTheDocument();
    expect(screen.queryByText(/excluded folders/)).toBeNull();
    expect(screen.queryByText(/file type/)).toBeNull();
    expect(screen.queryByText(/scanner configuration/)).toBeNull();
  });

  it('lists no folder line when the files were left out by name only', () => {
    render(<UploadFilterSummaryNotice summary={summary({ excludedPath: 2 })} />);
    expect(screen.queryByText(/^Excluded folders:/)).toBeNull();
  });

  it('names the five largest folders and says how many more there are', () => {
    const excludedFolders = Array.from({ length: 20 }, (_, i) => ({ name: `pkg${i}/dist`, count: 20 - i }));
    render(<UploadFilterSummaryNotice summary={summary({ excludedPath: 210, excludedFolders })} />);
    expect(folderLine()).toBe(
      'Excluded folders: pkg0/dist (20), pkg1/dist (19), pkg2/dist (18), pkg3/dist (17), pkg4/dist (16), and 15 more.',
    );
  });

  it('shortens a long name in the middle, and puts the full name in no attribute', () => {
    const long = `${'a'.repeat(120)}/middle/${'z'.repeat(70)}/node_modules`;
    const { container } = render(
      <UploadFilterSummaryNotice summary={summary({ excludedPath: 1, excludedFolders: [{ name: long, count: 1 }] })} />,
    );
    const shown = container.querySelector('bdi')?.textContent ?? '';
    expect([...shown].length).toBeLessThanOrEqual(48);
    expect(shown.startsWith('aaaa')).toBe(true);
    expect(shown.endsWith('/node_modules')).toBe(true);
    expect(shown).toContain('…');
    expect(container.innerHTML).not.toContain(long);
    for (const element of Array.from(container.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        expect(attribute.value).not.toContain('a'.repeat(30));
      }
    }
  });

  it('shows a name made of markup as text', () => {
    const name = '<img src=x onerror=alert(1)>/node_modules';
    const { container } = render(
      <UploadFilterSummaryNotice summary={summary({ excludedPath: 1, excludedFolders: [{ name, count: 1 }] })} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('bdi')?.textContent).toBe(shortenMiddle(name));
  });

  it('isolates each name so a right-to-left override cannot reorder the counts', () => {
    const name = '‮evil/build';
    const { container } = render(
      <UploadFilterSummaryNotice
        summary={summary({
          excludedPath: 4,
          excludedFolders: [
            { name, count: 3 },
            { name: 'dist', count: 1 },
          ],
        })}
      />,
    );
    const names = Array.from(container.querySelectorAll('bdi'));
    expect(names.map((b) => b.textContent)).toEqual([name, 'dist']);
    // Every count sits outside the isolated names.
    for (const bdi of names) expect(bdi.textContent).not.toMatch(/\(\d+\)/);
    expect(folderLine()).toBe(`Excluded folders: ${name} (3), dist (1).`);
  });
});

describe('shortenMiddle', () => {
  it('keeps a short name as it is', () => {
    expect(shortenMiddle('web/build')).toBe('web/build');
  });

  it('never cuts a character in two', () => {
    const shortened = shortenMiddle('😀'.repeat(100));
    expect([...shortened].every((c) => c === '😀' || c === '…')).toBe(true);
  });
});
