import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CollapsibleCard from './CollapsibleCard';

const toggle = () => screen.getByRole('button', { name: /Injection/ });

describe('CollapsibleCard', () => {
  it('starts expanded and points aria-controls at the content region', () => {
    render(
      <CollapsibleCard title="Injection">
        <p>rule list</p>
      </CollapsibleCard>,
    );

    const button = toggle();
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const regionId = button.getAttribute('aria-controls');
    expect(regionId).toBeTruthy();
    const region = document.getElementById(regionId as string);
    expect(region).not.toBeNull();
    expect(region).toHaveTextContent('rule list');
  });

  it('collapses and expands on click, removing the content when collapsed', () => {
    render(
      <CollapsibleCard title="Injection">
        <p>rule list</p>
      </CollapsibleCard>,
    );

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('rule list')).toBeNull();

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('rule list')).toBeInTheDocument();
  });

  it('honours defaultExpanded={false}', () => {
    render(
      <CollapsibleCard title="Injection" defaultExpanded={false}>
        <p>rule list</p>
      </CollapsibleCard>,
    );

    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('rule list')).toBeNull();
  });

  it('rotates the chevron with the state', () => {
    render(
      <CollapsibleCard title="Injection" defaultExpanded={false}>
        <p>rule list</p>
      </CollapsibleCard>,
    );

    const chevron = screen.getByTestId('collapsible-card-chevron');
    expect(chevron).toHaveClass('-rotate-90');
    fireEvent.click(toggle());
    expect(screen.getByTestId('collapsible-card-chevron')).not.toHaveClass('-rotate-90');
  });

  it('shows description and count', () => {
    render(
      <CollapsibleCard title="Injection" description="SQL, command, LDAP" count={7}>
        <p>rule list</p>
      </CollapsibleCard>,
    );

    expect(screen.getByText('SQL, command, LDAP')).toBeInTheDocument();
    expect(screen.getByTestId('collapsible-card-count')).toHaveTextContent('7');
  });

  it('keeps control and actions outside the toggle button', () => {
    const onControl = vi.fn();
    render(
      <CollapsibleCard
        title="Injection"
        control={
          <button type="button" onClick={onControl}>
            Deny
          </button>
        }
        actions={<button type="button">Delete</button>}
      >
        <p>rule list</p>
      </CollapsibleCard>,
    );

    const button = toggle();
    const control = screen.getByRole('button', { name: 'Deny' });
    const action = screen.getByRole('button', { name: 'Delete' });
    expect(button.contains(control)).toBe(false);
    expect(button.contains(action)).toBe(false);
    expect(control.closest('button')).toBe(control);

    fireEvent.click(control);
    expect(onControl).toHaveBeenCalledTimes(1);
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('works in controlled mode', () => {
    const onExpandedChange = vi.fn();
    const { rerender } = render(
      <CollapsibleCard title="Injection" expanded={false} onExpandedChange={onExpandedChange}>
        <p>rule list</p>
      </CollapsibleCard>,
    );

    fireEvent.click(toggle());
    expect(onExpandedChange).toHaveBeenCalledWith(true);
    // The parent did not accept the change: the card stays collapsed.
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('rule list')).toBeNull();

    rerender(
      <CollapsibleCard title="Injection" expanded onExpandedChange={onExpandedChange}>
        <p>rule list</p>
      </CollapsibleCard>,
    );
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle());
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
  });

  it('round-trips through a controlling parent', () => {
    const Parent = () => {
      const [open, setOpen] = useState(false);
      return (
        <CollapsibleCard title="Injection" expanded={open} onExpandedChange={setOpen}>
          <p>rule list</p>
        </CollapsibleCard>
      );
    };
    render(<Parent />);

    fireEvent.click(toggle());
    expect(screen.getByText('rule list')).toBeInTheDocument();
  });

  it('notifies onExpandedChange in uncontrolled mode too', () => {
    const onExpandedChange = vi.fn();
    render(
      <CollapsibleCard title="Injection" onExpandedChange={onExpandedChange}>
        <p>rule list</p>
      </CollapsibleCard>,
    );

    fireEvent.click(toggle());
    expect(onExpandedChange).toHaveBeenCalledWith(false);
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('forwards data-testid and className', () => {
    render(
      <CollapsibleCard title="Injection" data-testid="cat-injection" className="mb-2">
        <p>rule list</p>
      </CollapsibleCard>,
    );

    expect(screen.getByTestId('cat-injection')).toHaveClass('mb-2');
  });

  describe('on a narrow row', () => {
    it('wraps the controls under the title instead of crushing the title', () => {
      render(
        <CollapsibleCard
          title="Interdictions spécifiques à l’équipe plateforme"
          control={<span data-testid="picker">picker</span>}
          actions={<span>add</span>}
        />,
      );
      const header = screen.getByTestId('collapsible-card-header');
      expect(header.className).toContain('flex-wrap');
      // The title keeps a floor, so the controls go to the next line before it shrinks to a letter.
      const titleColumn = header.firstElementChild as HTMLElement;
      expect(titleColumn.className).toMatch(/min-w-\[[0-9.]+rem\]/);
    });

    it('gives a cut title its full text on hover', () => {
      render(<CollapsibleCard title="Authentication and session management" />);
      expect(screen.getByText('Authentication and session management')).toHaveAttribute(
        'title',
        'Authentication and session management',
      );
    });
  });
});
