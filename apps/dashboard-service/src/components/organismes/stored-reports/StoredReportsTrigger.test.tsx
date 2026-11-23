import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

// The drawer has its own tests; here only whether it is open matters.
vi.mock('./StoredReportsDrawer', () => ({
  default: ({ open, onClose }: any) =>
    open ? (
      <div>
        <span>DRAWER_OPEN</span>
        <button type="button" onClick={onClose}>
          CLOSE_DRAWER
        </button>
      </div>
    ) : null,
}));

let controller: any;
vi.mock('../../../server/hooks/useStoredReports', () => ({
  useStoredReports: () => controller,
}));

import StoredReportsTrigger from './StoredReportsTrigger';

const scope = { kind: 'organization' as const, organizationId: 'o1' };

describe('StoredReportsTrigger — a « View report » link on the page already shown', () => {
  beforeEach(() => {
    controller = { total: 0, refresh: vi.fn() };
  });

  it('opens the drawer on mount for a deep-linked report, without a second read of the list', () => {
    render(<StoredReportsTrigger scope={scope} highlightReportId="r1" highlightKey="k1" />);
    expect(screen.getByText('DRAWER_OPEN')).toBeInTheDocument();
    expect(controller.refresh).not.toHaveBeenCalled();
  });

  it('opens the drawer and reads the list again when a link names a report', () => {
    const { rerender } = render(<StoredReportsTrigger scope={scope} />);
    expect(screen.queryByText('DRAWER_OPEN')).toBeNull();

    rerender(<StoredReportsTrigger scope={scope} highlightReportId="r1" highlightKey="k1" />);

    expect(screen.getByText('DRAWER_OPEN')).toBeInTheDocument();
    expect(controller.refresh).toHaveBeenCalledTimes(1);
  });

  it('opens it again on a second click on the same link, after it was closed', () => {
    const { rerender } = render(
      <StoredReportsTrigger scope={scope} highlightReportId="r1" highlightKey="k1" />,
    );
    fireEvent.click(screen.getByText('CLOSE_DRAWER'));
    expect(screen.queryByText('DRAWER_OPEN')).toBeNull();

    rerender(<StoredReportsTrigger scope={scope} highlightReportId="r1" highlightKey="k2" />);

    expect(screen.getByText('DRAWER_OPEN')).toBeInTheDocument();
    expect(controller.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not open the drawer for a navigation that names no report', () => {
    const { rerender } = render(<StoredReportsTrigger scope={scope} highlightKey="k1" />);
    rerender(<StoredReportsTrigger scope={scope} highlightKey="k2" />);
    expect(screen.queryByText('DRAWER_OPEN')).toBeNull();
    expect(controller.refresh).not.toHaveBeenCalled();
  });
});
