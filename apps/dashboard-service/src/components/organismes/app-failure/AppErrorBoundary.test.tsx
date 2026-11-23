import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';

import { AppErrorBoundary } from './AppErrorBoundary';

/**
 * The root boundary around <App/> (src/index.tsx). Without it a render crash
 * left a blank page. It shows the crash page of the failure family, logs the
 * error to the console only, and never prints the error's text: it can carry
 * a server's words, a token, a path.
 */
const SECRET = 'token=cd_live_000 at /internal/path';

const Crashes = () => {
  throw new Error(SECRET);
};

describe('AppErrorBoundary', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  // jsdom reports the error React re-throws in development; it is caught here.
  const swallow = (event: ErrorEvent) => event.preventDefault();

  beforeEach(() => {
    // React logs the caught error too; keep the run quiet and read what we log.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    window.addEventListener('error', swallow);
  });

  afterEach(() => {
    consoleError.mockRestore();
    window.removeEventListener('error', swallow);
  });

  it('renders what it wraps while nothing throws', () => {
    render(
      <AppErrorBoundary>
        <p>the app</p>
      </AppErrorBoundary>,
    );

    expect(screen.getByText('the app')).toBeInTheDocument();
    expect(screen.queryByTestId('app-failure')).toBeNull();
  });

  it('shows the crash page when a child throws, without the error text, and logs it to the console', () => {
    render(
      <AppErrorBoundary>
        <Crashes />
      </AppErrorBoundary>,
    );

    expect(screen.getByTestId('app-failure')).toHaveAttribute('data-variant', 'crash');
    expect(screen.getByRole('heading', { level: 1, name: 'This page stopped unexpectedly' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('cd_live_000');
    expect(document.body.textContent).not.toContain('/internal/path');
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[AppErrorBoundary]'),
      expect.objectContaining({ message: SECRET }),
      expect.anything(),
    );
  });

  it('hands its buttons to the actions it is given', () => {
    const onRetry = vi.fn();
    const onSignIn = vi.fn();
    render(
      <AppErrorBoundary onRetry={onRetry} onSignIn={onSignIn}>
        <Crashes />
      </AppErrorBoundary>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onSignIn).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
