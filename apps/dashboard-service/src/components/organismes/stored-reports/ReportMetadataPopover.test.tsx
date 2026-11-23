import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ReportMetadataPopover from './ReportMetadataPopover';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // Echo the leaf key so assertions are stable, ignore interpolation.
    useTranslation: () => ({ t: (k: string) => k.split('.').pop() ?? k }),
  };
});

const baseItem = (over: Record<string, unknown> = {}) => ({
  reportId: 'rep-123',
  format: 'pdf',
  status: 'ready',
  filename: 'owasp.pdf',
  createdAtMs: Date.UTC(2026, 5, 18),
  expiresAtMs: 0,
  ...over,
});

describe('ReportMetadataPopover', () => {
  it('is closed by default and opens on click, revealing the metadata', () => {
    render(
      <ReportMetadataPopover
        item={baseItem({ kind: 'owasp', branch: 'main' }) as any}
        scopeMeta={{ projectTitle: 'my-proj', teamName: 'team-a' }}
      />,
    );

    // Closed → no dialog yet.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button'));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // Type uppercased, branch, and the report id are all shown.
    expect(dialog).toHaveTextContent('OWASP');
    expect(dialog).toHaveTextContent('main');
    expect(dialog).toHaveTextContent('rep-123');
    // No expiry (expiresAtMs=0) → neverExpires label.
    expect(dialog).toHaveTextContent('neverExpires');
  });

  it('gives the icon-only info button a robust accessible name via aria-label', () => {
    // The button's only child is an icon, so it must carry an explicit
    // aria-label (title alone is a low-priority, unreliable a11y name source).
    render(<ReportMetadataPopover item={baseItem({ kind: 'owasp' }) as any} />);

    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'title');
  });

  it('labels an aggregated organization report with its scope + org name', () => {
    render(
      <ReportMetadataPopover
        item={
          baseItem({ reportType: 'owasp', scopeType: 'organization' }) as any
        }
        scopeMeta={{ organizationName: 'BaBa-dev' }}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog')).toHaveTextContent('BaBa-dev');
  });
});
