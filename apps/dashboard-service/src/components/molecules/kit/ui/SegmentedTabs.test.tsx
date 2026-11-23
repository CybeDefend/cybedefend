import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import SegmentedTabs from './SegmentedTabs';
import { SegmentedTabs as FromIndex } from '.';

const PERIODS = [
  { value: '7', label: '7 days', testId: 'period-7' },
  { value: '30', label: '30 days', testId: 'period-30' },
  { value: '90', label: '90 days', testId: 'period-90' },
] as const;

const indicatorOf = (element: HTMLElement) => element.querySelector('[data-tabs-indicator]') as HTMLElement | null;

/**
 * "Tabs / segmented": a segmented control is a zinc track
 * with an ink selected pill; text tabs carry a 1.5 px underline that slides
 * (framer `layoutId`). Selected text ink, idle zinc-500. The accent only for a
 * selected tab's marker, and only when asked (it is one of a screen's two).
 */
describe('SegmentedTabs — segmented', () => {
  it('is a group of pressed / unpressed buttons named by its label', () => {
    render(<SegmentedTabs ariaLabel="Period" options={PERIODS} value="30" onChange={() => {}} />);
    const group = screen.getByRole('group', { name: 'Period' });
    expect(group).toHaveClass('inline-flex', 'rounded-lg', 'bg-zinc-100', 'p-0.5', 'dark:bg-white/[0.04]');
    expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('period-90')).toBe(screen.getByRole('button', { name: '90 days' }));
  });

  it('puts the ink pill under the selected option only, text white on ink', () => {
    render(<SegmentedTabs ariaLabel="Period" options={PERIODS} value="30" onChange={() => {}} />);
    const selected = screen.getByRole('button', { name: '30 days' });
    expect(indicatorOf(selected)).toHaveClass('absolute', 'inset-0', 'rounded-md', 'bg-zinc-900', 'dark:bg-zinc-100');
    expect(selected).toHaveClass('text-white', 'dark:text-zinc-900');
    const idle = screen.getByRole('button', { name: '7 days' });
    expect(indicatorOf(idle)).toBeNull();
    expect(idle).toHaveClass('text-zinc-600', 'dark:text-zinc-400');
  });

  it('spends no accent and no shadow', () => {
    const { container } = render(<SegmentedTabs ariaLabel="Period" options={PERIODS} value="7" onChange={() => {}} />);
    expect(container.innerHTML).not.toMatch(/secondary|shadow|gradient/);
  });

  it('asks for the option clicked, and nothing for the one already selected', () => {
    const onChange = vi.fn();
    render(<SegmentedTabs ariaLabel="Period" options={PERIODS} value="30" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '90 days' }));
    expect(onChange).toHaveBeenCalledWith('90');
    fireEvent.click(screen.getByRole('button', { name: '30 days' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['md', 'h-7'],
    ['sm', 'h-6'],
  ] as const)('sizes %s options (%s, the track 4 px taller)', (size, height) => {
    render(<SegmentedTabs ariaLabel="Period" options={PERIODS} value="7" size={size} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '7 days' })).toHaveClass(height);
  });

  it('keeps a disabled option out of reach', () => {
    const onChange = vi.fn();
    render(
      <SegmentedTabs
        ariaLabel="Period"
        options={[...PERIODS, { value: '365', label: '1 year', disabled: true }]}
        value="7"
        onChange={onChange}
      />,
    );
    const disabled = screen.getByRole('button', { name: '1 year' });
    expect(disabled).toBeDisabled();
    fireEvent.click(disabled);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('SegmentedTabs — underline', () => {
  it('draws text tabs over a hairline, the selected one in ink with a 1.5 px ink underline', () => {
    render(<SegmentedTabs variant="underline" ariaLabel="Window" options={PERIODS} value="7" onChange={() => {}} />);
    const group = screen.getByRole('group', { name: 'Window' });
    expect(group).toHaveClass('border-b', 'border-zinc-200', 'dark:border-vd-line');
    const selected = screen.getByRole('button', { name: '7 days' });
    expect(selected).toHaveClass('text-zinc-900', 'dark:text-zinc-50');
    expect(indicatorOf(selected)).toHaveClass('absolute', 'inset-x-0', '-bottom-px', 'h-[1.5px]', 'bg-zinc-900', 'dark:bg-zinc-100');
    expect(screen.getByRole('button', { name: '30 days' })).toHaveClass('text-zinc-600');
    expect(group.innerHTML).not.toMatch(/secondary/);
  });

  it('marks the selected tab with the accent when the page spends one of its two uses on it', () => {
    render(
      <SegmentedTabs
        variant="underline"
        indicator="accent"
        ariaLabel="Window"
        options={PERIODS}
        value="7"
        onChange={() => {}}
      />,
    );
    const marker = indicatorOf(screen.getByRole('button', { name: '7 days' }));
    expect(marker).toHaveClass('bg-secondary');
    expect(marker?.className).not.toMatch(/zinc/);
  });

  it('becomes navigation when its options lead somewhere, the current one marked as the page', () => {
    render(
      <MemoryRouter>
        <SegmentedTabs
          variant="underline"
          ariaLabel="Project sections"
          value="rules"
          options={[
            { value: 'rules', label: 'Rules', to: '/space/project/p-1/rules' },
            { value: 'guards', label: 'Guards', to: '/space/project/p-1/guards' },
          ]}
        />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Project sections' });
    const current = screen.getByRole('link', { name: 'Rules' });
    expect(nav).toContainElement(current);
    expect(current).toHaveAttribute('href', '/space/project/p-1/rules');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Guards' })).not.toHaveAttribute('aria-current');
  });

  it('forwards className and attributes, and is exported from the folder index', () => {
    render(
      <FromIndex ariaLabel="Period" options={PERIODS} value="7" onChange={() => {}} className="ml-auto" data-testid="tabs" />,
    );
    expect(screen.getByTestId('tabs')).toHaveClass('ml-auto');
  });
});
