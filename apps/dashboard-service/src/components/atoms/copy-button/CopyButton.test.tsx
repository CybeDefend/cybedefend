import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'react-toastify';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CopyButton } from './CopyButton';

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

describe('CopyButton', () => {
  it('is an icon-only button named by its label', () => {
    render(<CopyButton text="abc" label="Copy the key" data-testid="copy" />);
    expect(screen.getByRole('button', { name: 'Copy the key' })).toBe(screen.getByTestId('copy'));
  });

  it('copies its text', async () => {
    render(<CopyButton text="abc" label="Copy the key" />);
    await userEvent.click(screen.getByRole('button'));
    expect(writeText).toHaveBeenCalledWith('abc');
  });

  it('switches its name while copied, with the built-in default', async () => {
    render(<CopyButton text="abc" label="Copy the key" />);
    await userEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('switches to the copied label it is given', async () => {
    render(<CopyButton text="abc" label="Copy the key" copiedLabel="Key copied" />);
    await userEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('button', { name: 'Key copied' })).toBeInTheDocument();
  });

  it('toasts the success message it is given', async () => {
    render(<CopyButton text="abc" label="Copy" successMessage="Copied!" errorMessage="Nope" />);
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Copied!'));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('toasts the error message it is given when the clipboard refuses', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    render(<CopyButton text="abc" label="Copy" successMessage="Copied!" errorMessage="Nope" />);
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Nope'));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('toasts nothing without messages', async () => {
    render(<CopyButton text="abc" label="Copy" />);
    await userEvent.click(screen.getByRole('button'));
    await screen.findByRole('button', { name: 'Copied' });
    writeText.mockRejectedValueOnce(new Error('denied'));
    await userEvent.click(screen.getByRole('button'));
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('takes the dark terminal classes on a dark surface', () => {
    render(<CopyButton text="abc" label="Copy" surface="dark" />);
    const classes = screen.getByRole('button').className.split(/\s+/);
    expect(classes).toContain('hover:bg-white/10');
    expect(classes).toContain('focus:ring-offset-gray-900');
  });

  it('shows a visible accent focus ring on a light surface', () => {
    render(<CopyButton text="abc" label="Copy" />);
    const classes = screen.getByRole('button').className.split(/\s+/);
    expect(classes).toContain('focus-visible:ring-2');
    expect(classes).toContain('focus-visible:ring-secondary/50');
  });

  it('forwards native attributes and its ref', () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<CopyButton ref={ref} text="abc" label="Copy" className="ml-2" disabled />);
    expect(ref.current).toBe(screen.getByRole('button'));
    expect(ref.current).toBeDisabled();
    expect(ref.current?.className).toContain('ml-2');
  });
});
