import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Input from './Input';

describe('Input — rows', () => {
  it('keeps the fixed height of the textarea when no rows are given', () => {
    render(<Input id="f" textarea aria-label="Notes" />);

    const field = screen.getByLabelText('Notes');
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).toHaveClass('h-32', 'resize-none');
  });

  it('hands the height to the caller when rows are given', () => {
    render(<Input id="f" textarea rows={6} aria-label="Notes" />);

    const field = screen.getByLabelText('Notes');
    expect(field).toHaveAttribute('rows', '6');
    expect(field).not.toHaveClass('h-32');
    expect(field).toHaveClass('resize-none');
  });
});

describe('Input — hint', () => {
  it('renders a hint under the field and wires it with aria-describedby', () => {
    render(<Input id="name" label="Name" hint="Shown to your team" />);

    const hint = screen.getByText('Shown to your team');
    expect(hint).toHaveAttribute('id', 'name-hint');
    expect(hint).toHaveClass('mt-1', 'text-xs', 'text-gray-500', 'dark:text-gray-400');
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-describedby', 'name-hint');
  });

  it('lists both the hint and the error when there is an error', () => {
    render(<Input id="name" label="Name" hint="Shown to your team" error="Required" />);

    const describedBy = screen.getByLabelText('Name').getAttribute('aria-describedby')?.split(' ');
    expect(describedBy).toEqual(expect.arrayContaining(['name-hint', 'name-error']));
    expect(describedBy).toHaveLength(2);
  });

  it('wires the hint on the textarea form too', () => {
    render(<Input id="msg" textarea aria-label="Message" hint="Markdown accepted" />);

    expect(screen.getByLabelText('Message')).toHaveAttribute('aria-describedby', 'msg-hint');
  });

  it('keeps the error-only wiring unchanged and adds nothing without a hint', () => {
    const { rerender } = render(<Input id="n" label="Name" error="Required" />);
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-describedby', 'n-error');

    rerender(<Input id="n" label="Name" />);
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-describedby');
  });
});
