import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FilterChipGroup from './FilterChipGroup';

const OPTIONS = [
  { value: 'CRITICAL', label: 'Critical', dotClassName: 'bg-critical-risk' },
  { value: 'HIGH', label: 'High' },
];

describe('FilterChipGroup', () => {
  it('announces which chips are on', () => {
    render(<FilterChipGroup label="Severity" options={OPTIONS} selected={['CRITICAL']} onToggle={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Critical' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'High' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports the value that was toggled', () => {
    const onToggle = vi.fn();
    render(<FilterChipGroup label="Severity" options={OPTIONS} selected={[]} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('button', { name: 'High' }));

    expect(onToggle).toHaveBeenCalledWith('HIGH');
  });

  it('treats an absent selection as nothing selected', () => {
    render(<FilterChipGroup label="Severity" options={OPTIONS} onToggle={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Critical' })).toHaveAttribute('aria-pressed', 'false');
  });
});
