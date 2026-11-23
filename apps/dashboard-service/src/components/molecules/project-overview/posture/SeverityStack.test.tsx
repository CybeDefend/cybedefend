import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SeverityStack from './SeverityStack';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const data = [
  { severity: 'CRITICAL', count: 7 },
  { severity: 'HIGH', count: 23 },
  { severity: 'MEDIUM', count: 41 },
  { severity: 'LOW', count: 19 },
];

describe('SeverityStack', () => {
  it('writes each severity with its count and its share of the open findings', () => {
    render(<SeverityStack data={data} />);
    expect(screen.getByText('90 open findings')).toBeInTheDocument();
    const critical = screen.getByText('Critical').closest('li')!;
    expect(critical).toHaveTextContent('7');
    expect(critical).toHaveTextContent('8%');
    const medium = screen.getByText('Medium').closest('li')!;
    expect(medium).toHaveTextContent('41');
    expect(medium).toHaveTextContent('46%');
  });

  it('draws the bar in the severity order, critical first, only for the severities present', () => {
    const { container } = render(<SeverityStack data={[{ severity: 'HIGH', count: 3 }, { severity: 'LOW', count: 1 }]} />);
    const segments = container.querySelectorAll('[role="img"] > span');
    expect(segments).toHaveLength(2);
    expect(segments[0].className).toContain('bg-high-risk');
    expect(segments[1].className).toContain('bg-low-risk');
    expect((segments[0] as HTMLElement).style.width).toBe('75%');
  });

  it('opens the findings of the severity clicked', () => {
    const onSeverityClick = vi.fn();
    render(<SeverityStack data={data} onSeverityClick={onSeverityClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Critical/ }));
    expect(onSeverityClick).toHaveBeenCalledWith('CRITICAL');
  });

  it('keeps an unrated bucket, in zinc, after the rated severities', () => {
    render(<SeverityStack data={[...data, { severity: 'UNKNOWN', count: 10 }]} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[4]).toHaveTextContent('Unrated');
    expect(items[4]).toHaveTextContent('10');
    expect(screen.getByText('100 open findings')).toBeInTheDocument();
  });

  it('is plain text without a click handler: nothing to press', () => {
    render(<SeverityStack data={data} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
