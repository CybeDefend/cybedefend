import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SideSheet from './SideSheet';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const Host: React.FC<{ footer?: React.ReactNode; onClose?: () => void; children?: React.ReactNode }> = ({
  footer,
  onClose,
  children,
}) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open the rule
      </button>
      <SideSheet
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="Require authentication"
        description="Broken Access Control"
        footer={footer}
        data-testid="sheet"
      >
        {children ?? <button type="button">Inside</button>}
      </SideSheet>
    </>
  );
};

const openSheet = () => {
  const opener = screen.getByRole('button', { name: 'Open the rule' });
  opener.focus();
  fireEvent.click(opener);
  return opener;
};

describe('SideSheet', () => {
  it('renders nothing while closed', () => {
    render(<Host />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a modal dialog named by its title, with its description and its footer', () => {
    render(<Host footer={<button type="button">Delete</button>} />);
    openSheet();
    const dialog = screen.getByRole('dialog', { name: 'Require authentication' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Broken Access Control');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    openSheet();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('leaves an Escape a layer above it already handled (a menu, a confirmation)', () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    openSheet();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    event.preventDefault();
    act(() => {
      window.dispatchEvent(event);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves an Escape pressed in another dialog opened over it (an event drawer) to that dialog', () => {
    const onClose = vi.fn();
    render(
      <>
        <Host onClose={onClose} />
        <div role="dialog" aria-label="Diff scan">
          <button type="button">Inside the other dialog</button>
        </div>
      </>,
    );
    openSheet();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Inside the other dialog' }), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves an Escape typed in a field to the field', () => {
    const onClose = vi.fn();
    render(
      <Host onClose={onClose}>
        <input aria-label="Search" />
      </Host>,
    );
    openSheet();
    fireEvent.keyDown(screen.getByLabelText('Search'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on a click on the scrim and on its close button', () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    openSheet();
    fireEvent.click(screen.getByTestId('side-sheet-scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
    openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('takes the focus when it opens and hands it back to the opener when it closes', async () => {
    render(<Host />);
    const opener = openSheet();
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('lets a body that draws its own heading keep the title for assistive tech only', () => {
    render(
      <SideSheet open onClose={vi.fn()} title="payments-api" hideTitle>
        <h2>payments-api</h2>
      </SideSheet>,
    );
    const dialog = screen.getByRole('dialog', { name: 'payments-api' });
    expect(dialog.querySelector('header')).toBeNull();
    expect(screen.getAllByRole('heading', { name: 'payments-api' })).toHaveLength(2);
    expect(screen.getAllByRole('heading', { name: 'payments-api' })[0]).toHaveClass('sr-only');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('holds the page still while it is open', async () => {
    render(<Host />);
    openSheet();
    expect(document.body.style.position).toBe('fixed');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.body.style.position).toBe('');
  });
});
