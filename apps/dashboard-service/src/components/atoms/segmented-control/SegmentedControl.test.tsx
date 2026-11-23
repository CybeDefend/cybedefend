import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SegmentedControl, { type SegmentedOption } from './SegmentedControl';

type Sev = 'all' | 'critical' | 'high' | 'medium' | 'low';

const options: SegmentedOption<Sev>[] = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Critical', tone: 'critical' },
  { value: 'high', label: 'High', tone: 'high' },
  { value: 'medium', label: 'Medium', tone: 'medium' },
  { value: 'low', label: 'Low', tone: 'low' },
];

describe('SegmentedControl', () => {
  it('is a labelled group of buttons with aria-pressed on the selected option only', () => {
    render(<SegmentedControl options={options} value="high" onChange={() => {}} ariaLabel="Severity" />);

    const group = screen.getByRole('group', { name: 'Severity' });
    const buttons = Array.from(group.querySelectorAll('button'));
    expect(buttons).toHaveLength(5);
    buttons.forEach((b) => expect(b).toHaveAttribute('type', 'button'));

    expect(screen.getByRole('button', { name: 'High' })).toHaveAttribute('aria-pressed', 'true');
    for (const name of ['All', 'Critical', 'Medium', 'Low']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('calls onChange with the clicked value', () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={options} value="all" onChange={onChange} ariaLabel="Severity" />);

    fireEvent.click(screen.getByRole('button', { name: 'Medium' }));
    expect(onChange).toHaveBeenCalledWith('medium');
  });

  it('disables a single option', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B', disabled: true },
        ]}
        value="a"
        onChange={onChange}
        ariaLabel="Pick"
      />,
    );

    const b = screen.getByRole('button', { name: 'B' });
    expect(b).toBeDisabled();
    fireEvent.click(b);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'A' })).toBeEnabled();
  });

  it('disables the whole group', () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={options} value="all" onChange={onChange} ariaLabel="Severity" disabled />);

    screen.getAllByRole('button').forEach((b) => expect(b).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Low' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('derives test ids from the prefix unless an option has its own', () => {
    render(
      <SegmentedControl
        options={[
          { value: 'deny', label: 'Deny' },
          { value: 'warn', label: 'Warn', testId: 'custom-warn' },
        ]}
        value="deny"
        onChange={() => {}}
        ariaLabel="Action"
        testIdPrefix="guard-action"
      />,
    );

    expect(screen.getByTestId('guard-action-deny')).toHaveTextContent('Deny');
    expect(screen.getByTestId('custom-warn')).toHaveTextContent('Warn');
  });

  it('paints the active option with the accent by default', () => {
    render(<SegmentedControl options={options} value="all" onChange={() => {}} ariaLabel="Severity" />);

    const all = screen.getByRole('button', { name: 'All' });
    expect(all).toHaveClass('bg-secondary', 'text-white');
    expect(screen.getByRole('button', { name: 'Critical' })).not.toHaveClass('bg-critical-risk');
  });

  it.each([
    ['critical', 'Critical', 'bg-critical-risk'],
    ['high', 'High', 'bg-high-risk'],
    ['medium', 'Medium', 'bg-medium-risk'],
    ['low', 'Low', 'bg-low-risk'],
  ] as const)('paints the active %s option with its severity colour', (value, name, cls) => {
    render(<SegmentedControl options={options} value={value} onChange={() => {}} ariaLabel="Severity" />);

    const btn = screen.getByRole('button', { name });
    expect(btn).toHaveClass(cls);
    expect(btn).not.toHaveClass('bg-secondary');
  });

  it('paints success and warning tones', () => {
    const toned: SegmentedOption<'on' | 'warn'>[] = [
      { value: 'on', label: 'On', tone: 'success' },
      { value: 'warn', label: 'Warn', tone: 'warning' },
    ];
    const { rerender } = render(
      <SegmentedControl options={toned} value="on" onChange={() => {}} ariaLabel="State" />,
    );
    expect(screen.getByRole('button', { name: 'On' })).toHaveClass('bg-green-600', 'text-white');

    rerender(<SegmentedControl options={toned} value="warn" onChange={() => {}} ariaLabel="State" />);
    expect(screen.getByRole('button', { name: 'Warn' })).toHaveClass('bg-amber-500');
    expect(screen.getByRole('button', { name: 'On' })).not.toHaveClass('bg-green-600');
  });

  it('uses the accent focus ring, never blue', () => {
    render(<SegmentedControl options={options} value="all" onChange={() => {}} ariaLabel="Severity" />);

    screen.getAllByRole('button').forEach((b) => {
      expect(b).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-secondary/50');
      expect(b.className).not.toMatch(/blue/);
    });
  });

  it('renders option icons and applies the md size', () => {
    render(
      <SegmentedControl
        options={[{ value: 'a', label: 'A', icon: <span data-testid="icon-a" /> }]}
        value="a"
        onChange={() => {}}
        ariaLabel="Pick"
        size="md"
        className="ml-2"
      />,
    );

    expect(screen.getByTestId('icon-a')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'A' })).toHaveClass('text-sm');
    expect(screen.getByRole('group', { name: 'Pick' })).toHaveClass('ml-2');
  });
});

describe('SegmentedControl — neutral tone', () => {
  // « Off » and « Disabled » must not read as an active accent choice.
  it('fills the selected neutral option in grey, not in the accent', () => {
    render(
      <SegmentedControl
        options={[
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off', tone: 'neutral' },
        ]}
        value="off"
        onChange={() => {}}
        ariaLabel="State"
      />,
    );
    const off = screen.getByRole('button', { name: 'Off' });
    expect(off).toHaveAttribute('aria-pressed', 'true');
    expect(off).toHaveClass('bg-gray-500', 'text-white');
    expect(off.className).not.toMatch(/\bbg-secondary\b/);
  });
});
