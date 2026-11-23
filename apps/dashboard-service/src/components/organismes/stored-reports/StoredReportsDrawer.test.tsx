import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import StoredReportsDrawer from './StoredReportsDrawer';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k.split('.').pop() ?? k }),
}));

// The list body (rows, pagination, expiry-warning styling) is covered by
// StoredReportsList.test.tsx; stub it here to keep this drawer test focused.
vi.mock('./StoredReportsList', () => ({ default: () => <div>LIST</div> }));

const controller: any = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 10,
  loading: false,
  error: null,
  deletingId: null,
  setPage: vi.fn(),
  setPageSize: vi.fn(),
  refresh: vi.fn(),
  deleteReport: vi.fn(),
  downloadReport: vi.fn(),
};

const onClose = vi.fn();
const renderDrawer = () =>
  render(
    <StoredReportsDrawer open onClose={onClose} controller={controller} />,
  );
const panel = () => screen.getByTestId('stored-reports-drawer-panel');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  (window as any).innerWidth = 1024;
});

describe('StoredReportsDrawer — resize like the vuln drawer', () => {
  it('opens at the default width', () => {
    renderDrawer();
    expect(panel().style.width).toBe('720px');
  });

  describe('fullscreen', () => {
    it('toggles full width and back', () => {
      renderDrawer();
      fireEvent.click(screen.getByLabelText('expand'));
      expect(panel().style.width).toBe('100vw');
      fireEvent.click(screen.getByLabelText('collapse'));
      expect(panel().style.width).not.toBe('100vw');
    });

    it('Escape exits fullscreen before closing', () => {
      renderDrawer();
      fireEvent.click(screen.getByLabelText('expand'));
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
      expect(panel().style.width).not.toBe('100vw');
    });
  });

  describe('drag-to-resize', () => {
    it('widens the drawer as the handle is dragged left and persists it', () => {
      renderDrawer();
      const handle = screen.getByLabelText('resize');
      act(() => {
        fireEvent.mouseDown(handle, { clientX: 304 });
        fireEvent.mouseMove(window, { clientX: 300 });
        fireEvent.mouseUp(window);
      });
      // width = innerWidth(1024) - clientX(300) = 724
      expect(panel().style.width).toBe('724px');
      expect(Number(localStorage.getItem('storedReportsDrawerWidth'))).toBe(724);
    });

    it('clamps to the minimum width', () => {
      renderDrawer();
      const handle = screen.getByLabelText('resize');
      act(() => {
        fireEvent.mouseDown(handle, { clientX: 900 });
        fireEvent.mouseMove(window, { clientX: 1000 });
        fireEvent.mouseUp(window);
      });
      expect(parseInt(panel().style.width, 10)).toBeGreaterThanOrEqual(420);
    });
  });

  it('closes on the close button', () => {
    renderDrawer();
    fireEvent.click(screen.getByLabelText('close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
