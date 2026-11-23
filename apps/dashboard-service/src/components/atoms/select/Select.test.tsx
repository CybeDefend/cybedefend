import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import Select from './Select';

const options = [
  { label: 'Alpha', value: 'a' },
  { label: 'Beta', value: 'b' },
];

describe('Select — disabled', () => {
  it('disables its trigger and never opens', () => {
    const onChange = vi.fn();
    render(<Select options={options} onChange={onChange} disabled data-testid="sel" />);

    const trigger = screen.getByTestId('sel');
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveClass('opacity-50', 'cursor-not-allowed');

    fireEvent.click(trigger);
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('opens as before when it is not disabled', () => {
    render(<Select options={options} onChange={() => {}} data-testid="sel" />);

    const trigger = screen.getByTestId('sel');
    expect(trigger).not.toBeDisabled();
    expect(trigger).not.toHaveClass('cursor-not-allowed');
    fireEvent.click(trigger);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });
});

describe('Select — forwarded attributes', () => {
  it('forwards id, name, aria-label, aria-describedby and data-* to the trigger', () => {
    render(
      <Select
        id="sort"
        name="sort"
        aria-label="Sort by"
        aria-describedby="sort-hint"
        data-testid="sel"
        data-kind="sorter"
        options={options}
        onChange={() => {}}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Sort by' });
    expect(trigger).toHaveAttribute('id', 'sort');
    expect(trigger).toHaveAttribute('name', 'sort');
    expect(trigger).toHaveAttribute('aria-describedby', 'sort-hint');
    expect(trigger).toHaveAttribute('data-testid', 'sel');
    expect(trigger).toHaveAttribute('data-kind', 'sorter');
  });

  it('lists its own error after the caller description', () => {
    render(
      <Select
        id="sort"
        aria-describedby="sort-hint"
        error="Pick one"
        data-testid="sel"
        options={options}
        onChange={() => {}}
      />,
    );

    expect(screen.getByTestId('sel').getAttribute('aria-describedby')?.split(' ')).toEqual([
      'sort-hint',
      'sort-error',
    ]);
  });

  it('works for the multiple form too', () => {
    render(<Select multiple options={options} value={[]} onChange={() => {}} disabled data-testid="sel" />);

    expect(screen.getByTestId('sel')).toBeDisabled();
  });
});
