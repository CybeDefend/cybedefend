import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import Callout, { type CalloutTone } from './Callout';

describe('Callout', () => {
  it('renders the title and the body', () => {
    render(<Callout title="Heads up">Something happened</Callout>);
    expect(screen.getByText('Heads up')).toHaveClass('font-medium');
    expect(screen.getByText('Something happened')).toBeInTheDocument();
  });

  it.each<[CalloutTone, RegExp]>([
    ['accent', /border-secondary\/20/],
    ['info', /border-blue-200/],
    ['warning', /border-amber-200/],
    ['error', /border-red-200/],
    ['neutral', /border-gray-200/],
  ])('gives the %s tone its colours, with a dark variant', (tone, border) => {
    render(<Callout tone={tone} data-testid="c">body</Callout>);
    const box = screen.getByTestId('c');
    expect(box.className).toMatch(border);
    expect(box.className).toMatch(/dark:bg-/);
    expect(box.className).toMatch(/dark:border-/);
  });

  it('keeps the accent text readable in the dark', () => {
    const { container } = render(<Callout tone="accent">body</Callout>);
    const icon = container.querySelector('svg');
    expect(icon?.getAttribute('class')).toMatch(/text-secondary(?![\w-])/);
    expect(icon?.getAttribute('class')).toMatch(/dark:text-secondary-light/);
  });

  it('defaults to the info tone and no live region', () => {
    render(<Callout data-testid="c">body</Callout>);
    const box = screen.getByTestId('c');
    expect(box.className).toMatch(/border-blue-200/);
    expect(box).not.toHaveAttribute('role');
  });

  it('announces an error as an alert by default', () => {
    render(<Callout tone="error" data-testid="c">Failed</Callout>);
    expect(screen.getByRole('alert')).toBe(screen.getByTestId('c'));
  });

  it('maps live="status" to role=status, and live="off" to no role', () => {
    const { rerender } = render(<Callout live="status" data-testid="c">body</Callout>);
    expect(screen.getByRole('status')).toBe(screen.getByTestId('c'));
    rerender(<Callout tone="error" live="off" data-testid="c">body</Callout>);
    expect(screen.getByTestId('c')).not.toHaveAttribute('role');
    rerender(<Callout tone="warning" live="alert" data-testid="c">body</Callout>);
    expect(screen.getByRole('alert')).toBe(screen.getByTestId('c'));
  });

  it('shows a default icon, a custom one, or none with icon={false}', () => {
    const { container, rerender } = render(<Callout>body</Callout>);
    expect(container.querySelector('svg')).not.toBeNull();
    rerender(<Callout icon={<span data-testid="custom-icon" />}>body</Callout>);
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
    rerender(<Callout icon={false}>body</Callout>);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders the actions slot under the body', () => {
    render(
      <Callout actions={<a href="/x">Do it</a>}>
        <p>body</p>
      </Callout>,
    );
    const action = screen.getByRole('link', { name: 'Do it' });
    const body = screen.getByText('body');
    expect(body.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has no dismiss button without onDismiss', () => {
    render(<Callout>body</Callout>);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a dismiss button with the default label and calls onDismiss', () => {
    const onDismiss = vi.fn();
    render(<Callout onDismiss={onDismiss}>body</Callout>);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('uses a given dismiss label', () => {
    render(<Callout onDismiss={() => {}} dismissLabel="Hide this notice">body</Callout>);
    expect(screen.getByRole('button', { name: 'Hide this notice' })).toBeInTheDocument();
  });

  it('sizes sm and md', () => {
    const { rerender } = render(<Callout data-testid="c">body</Callout>);
    expect(screen.getByTestId('c')).toHaveClass('p-4', 'text-sm');
    rerender(<Callout size="sm" data-testid="c">body</Callout>);
    expect(screen.getByTestId('c')).toHaveClass('p-3', 'text-xs');
  });

  it('forwards div attributes, className and ref', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<Callout ref={ref} data-testid="c" data-product="appsec" className="mt-2" id="note">body</Callout>);
    const box = screen.getByTestId('c');
    expect(box).toHaveAttribute('data-product', 'appsec');
    expect(box).toHaveAttribute('id', 'note');
    expect(box).toHaveClass('mt-2', 'rounded-lg', 'border');
    expect(ref.current).toBe(box);
  });
});

describe('Callout — dismiss test id', () => {
  it('puts dismissTestId on the dismiss button, not on the box', () => {
    render(
      <Callout onDismiss={() => {}} dismissLabel="Close" dismissTestId="coach-dismiss" data-testid="box">
        body
      </Callout>,
    );
    expect(screen.getByTestId('coach-dismiss')).toBe(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByTestId('box')).not.toBe(screen.getByTestId('coach-dismiss'));
  });
});
