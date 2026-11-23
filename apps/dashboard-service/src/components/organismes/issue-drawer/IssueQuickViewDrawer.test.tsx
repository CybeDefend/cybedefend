import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import IssueQuickViewDrawer from './IssueQuickViewDrawer';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
// The « Ask Cybe » button is a `finding.actions` registration of the active
// edition (the chat's, in a private build): render the slot host as a probe.
vi.mock('@/edition/slots', () => ({
  Slot: ({ name, context }: any) => (
    <div
      data-testid={`slot-${name}`}
      data-project-id={context?.projectId ?? ''}
      data-finding-id={context?.findingId ?? ''}
      data-vulnerability-type={context?.vulnerabilityType ?? ''}
    />
  ),
}));
vi.mock('framer-motion', () => ({
  motion: {
    aside: ({ children, initial, animate, exit, transition, ...p }: any) => (
      <aside {...p}>{children}</aside>
    ),
    div: ({ children, initial, animate, exit, transition, ...p }: any) => (
      <div {...p}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
  useReducedMotion: () => false,
}));
const detailProps = vi.fn();
vi.mock('@/pages/project-pages/issue-page/IssueDetailView', () => ({
  default: (p: any) => {
    detailProps(p);
    return <div data-testid="issue-detail-view">detail:{p.issueId}</div>;
  },
}));

const baseProps = {
  projectId: 'p-1',
  type: 'sast' as const,
  issueId: 'v-2',
  onClose: vi.fn(),
  onPrev: vi.fn(),
  onNext: vi.fn(),
  canPrev: true,
  canNext: true,
  positionText: '5 / 275',
};

const renderDrawer = (props = {}) =>
  render(
    <MemoryRouter>
      <IssueQuickViewDrawer {...baseProps} {...props} />
    </MemoryRouter>,
  );

const getAside = () => document.querySelector('aside') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  (window as any).innerWidth = 1024;
});

describe('IssueQuickViewDrawer', () => {
  it('renders nothing when issueId is null', () => {
    renderDrawer({ issueId: null });
    expect(document.querySelector('aside')).toBeNull();
  });

  it('renders the embedded full detail view for the issue', () => {
    renderDrawer();
    expect(screen.getByTestId('issue-detail-view')).toBeInTheDocument();
    expect(detailProps.mock.calls[0][0]).toMatchObject({
      projectId: 'p-1', type: 'sast', issueId: 'v-2', embedded: true,
    });
  });

  it('forwards the latest scan date to the detail view', () => {
    renderDrawer({ lastScanAt: '2026-09-18T09:30:00Z' });
    expect(detailProps).toHaveBeenCalledWith(
      expect.objectContaining({ lastScanAt: '2026-09-18T09:30:00Z' }),
    );
  });

  it('shows the global position label provided by the host', () => {
    renderDrawer();
    expect(screen.getByText('5 / 275')).toBeInTheDocument();
  });

  it('calls onPrev / onNext from the buttons', () => {
    renderDrawer();
    fireEvent.click(screen.getByLabelText('components.issueDrawer.previous'));
    expect(baseProps.onPrev).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('components.issueDrawer.next'));
    expect(baseProps.onNext).toHaveBeenCalledTimes(1);
  });

  it('disables prev/next per canPrev/canNext', () => {
    renderDrawer({ canPrev: false, canNext: true });
    expect(screen.getByLabelText('components.issueDrawer.previous')).toBeDisabled();
    expect(screen.getByLabelText('components.issueDrawer.next')).not.toBeDisabled();
  });

  it('navigates with arrow keys (respecting canPrev/canNext)', () => {
    renderDrawer({ canPrev: false });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(baseProps.onPrev).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(baseProps.onNext).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and on the close button', () => {
    renderDrawer();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('components.issueDrawer.close'));
    expect(baseProps.onClose).toHaveBeenCalledTimes(2);
  });

  it('closes when the scrim over the page is clicked, not when the sheet is', () => {
    renderDrawer();
    fireEvent.click(getAside());
    expect(baseProps.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('issue-quick-view-scrim'));
    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('hosts the finding.actions slot with the open finding in its context (« Ask Cybe »)', () => {
    renderDrawer();
    const slot = screen.getByTestId('slot-finding.actions');
    expect(slot.getAttribute('data-project-id')).toBe('p-1');
    expect(slot.getAttribute('data-finding-id')).toBe('v-2');
    expect(slot.getAttribute('data-vulnerability-type')).toBe('sast');
  });

  describe('fullscreen', () => {
    it('toggles full width and label', () => {
      renderDrawer();
      fireEvent.click(screen.getByLabelText('components.issueDrawer.fullscreen'));
      expect(getAside().style.width).toBe('100vw');
      fireEvent.click(screen.getByLabelText('components.issueDrawer.exitFullscreen'));
      expect(getAside().style.width).not.toBe('100vw');
    });

    it('Escape exits fullscreen before closing', () => {
      renderDrawer();
      fireEvent.click(screen.getByLabelText('components.issueDrawer.fullscreen'));
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(baseProps.onClose).not.toHaveBeenCalled();
      expect(getAside().style.width).not.toBe('100vw');
    });
  });

  describe('drag-to-resize', () => {
    it('widens the drawer as the handle is dragged left and persists it', () => {
      renderDrawer();
      const handle = screen.getByLabelText('components.issueDrawer.resize');
      act(() => {
        fireEvent.mouseDown(handle, { clientX: 384 });
        fireEvent.mouseMove(window, { clientX: 300 });
        fireEvent.mouseUp(window);
      });
      expect(getAside().style.width).toBe('724px');
      expect(Number(localStorage.getItem('issueQuickViewWidth'))).toBe(724);
    });

    it('clamps to the minimum width', () => {
      renderDrawer();
      const handle = screen.getByLabelText('components.issueDrawer.resize');
      act(() => {
        fireEvent.mouseDown(handle, { clientX: 900 });
        fireEvent.mouseMove(window, { clientX: 1000 });
        fireEvent.mouseUp(window);
      });
      expect(parseInt(getAside().style.width, 10)).toBeGreaterThanOrEqual(420);
    });
  });
});
