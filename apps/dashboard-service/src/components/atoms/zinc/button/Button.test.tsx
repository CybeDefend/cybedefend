import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Link } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import Button from './Button';

describe('Zinc Button', () => {
  it.each([
    ['ink', 'bg-zinc-900'],
    ['outline', 'border-zinc-200'],
    ['ghost', 'hover:bg-zinc-100'],
    ['danger', 'text-red-600'],
    ['link', 'underline'],
  ] as const)('renders the %s variant', (variant, cls) => {
    render(<Button variant={variant}>Go</Button>);
    const button = screen.getByRole('button', { name: 'Go' });
    expect(button).toHaveAttribute('data-variant', variant);
    expect(button).toHaveAttribute('type', 'button');
    expect(button.className).toContain(cls);
  });

  it('sizes sm at 28 px and md at 32 px', () => {
    render(
      <>
        <Button size="sm">Small</Button>
        <Button>Medium</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Small' }).className).toContain('h-7');
    expect(screen.getByRole('button', { name: 'Medium' }).className).toContain('h-8');
  });

  it('is busy and disabled while loading', () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('lends its look to a router link with asChild, keeping the icons inside', () => {
    render(
      <MemoryRouter>
        <Button asChild variant="ink" trailingIcon={<span data-testid="trail" />}>
          <Link to="/space/projects">Projects</Link>
        </Button>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Projects' });
    expect(link).toHaveAttribute('href', '/space/projects');
    expect(link.className).toContain('bg-zinc-900');
    expect(link).toContainElement(screen.getByTestId('trail'));
  });
});
