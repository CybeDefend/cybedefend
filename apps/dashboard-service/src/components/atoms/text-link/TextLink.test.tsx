import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import TextLink from './TextLink';

const inRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('TextLink', () => {
  it('renders a router Link for `to`', () => {
    inRouter(<TextLink to="/projects/1">Open</TextLink>);
    const link = screen.getByRole('link', { name: 'Open' });
    expect(link).toHaveAttribute('href', '/projects/1');
  });

  it('renders an <a> for `href`, adding rel on target=_blank', () => {
    render(<TextLink href="https://docs.example.com" target="_blank">Docs</TextLink>);
    const link = screen.getByRole('link', { name: 'Docs' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', 'https://docs.example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('keeps a given rel and adds none without _blank', () => {
    const { rerender } = render(<TextLink href="/a" rel="nofollow">A</TextLink>);
    expect(screen.getByRole('link')).toHaveAttribute('rel', 'nofollow');
    rerender(<TextLink href="/a">A</TextLink>);
    expect(screen.getByRole('link')).not.toHaveAttribute('rel');
  });

  it('adds the safe rel to a router Link opened in a new tab too', () => {
    inRouter(<TextLink to="/x" target="_blank">X</TextLink>);
    expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders a <button type="button"> for onClick', () => {
    const onClick = vi.fn();
    render(<TextLink onClick={onClick}>Retry</TextLink>);
    const button = screen.getByRole('button', { name: 'Retry' });
    expect(button).toHaveAttribute('type', 'button');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['accent', ['text-secondary', 'dark:text-secondary-light', 'font-medium']],
    ['danger', ['text-red-600', 'dark:text-red-400']],
    ['inherit', ['text-current']],
  ] as const)('gives the %s tone its colours', (tone, classes) => {
    render(<TextLink tone={tone} onClick={() => {}}>T</TextLink>);
    expect(screen.getByRole('button')).toHaveClass(...classes);
  });

  it('defaults to accent with an underline on hover; underline="always" keeps it', () => {
    const { rerender } = render(<TextLink href="/a">A</TextLink>);
    const link = screen.getByRole('link');
    expect(link).toHaveClass('text-secondary', 'hover:underline', 'focus-visible:ring-2', 'focus-visible:ring-secondary/50');
    expect(link).not.toHaveClass('underline');
    rerender(<TextLink href="/a" underline="always">A</TextLink>);
    expect(screen.getByRole('link')).toHaveClass('underline');
  });

  it('forwards attributes, className and ref', () => {
    const ref = React.createRef<HTMLAnchorElement>();
    render(<TextLink ref={ref} href="/a" className="ml-1" aria-describedby="hint" data-testid="l">A</TextLink>);
    const link = screen.getByTestId('l');
    expect(link).toHaveClass('ml-1');
    expect(link).toHaveAttribute('aria-describedby', 'hint');
    expect(ref.current).toBe(link);
  });
});
