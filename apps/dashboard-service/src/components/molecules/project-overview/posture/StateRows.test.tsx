import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import StateRows from './StateRows';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const data = [
  { state: 'resolved', count: 134 },
  { state: 'to_verify', count: 52 },
  { state: 'confirmed', count: 21 },
  { state: 'not_exploitable', count: 11 },
  { state: 'proposed_not_exploitable', count: 6 },
];

describe('StateRows', () => {
  it('lists the states in working order: triage, fix, review, then what is closed', () => {
    render(<StateRows data={data} />);
    const rows = screen.getAllByRole('listitem').map((row) => row.textContent ?? '');
    expect(rows[0]).toContain('To verify');
    expect(rows[1]).toContain('Confirmed');
    expect(rows[2]).toContain('Proposed not exploitable');
    expect(rows[3]).toContain('Not exploitable');
    expect(rows[4]).toContain('Resolved');
    expect(rows[4]).toContain('134');
    expect(rows[4]).toContain('60%');
    expect(screen.getByText('224 findings, open and closed')).toBeInTheDocument();
  });

  it('says how much is closed: resolved or not exploitable over every finding', () => {
    render(<StateRows data={data} />);
    const closed = screen.getByTestId('closed-share');
    expect(closed).toHaveTextContent('145');
    expect(closed).toHaveTextContent('/ 224');
    expect(closed).toHaveTextContent('65%');
  });

  it('opens the findings in the state clicked', () => {
    const onStateClick = vi.fn();
    render(<StateRows data={data} onStateClick={onStateClick} />);
    fireEvent.click(screen.getByRole('button', { name: /To verify/ }));
    expect(onStateClick).toHaveBeenCalledWith('to_verify');
  });

  it('keeps a state it does not know, after the known ones, with its underscores opened', () => {
    render(<StateRows data={[{ state: 'resolved', count: 1 }, { state: 'in_review', count: 2 }]} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[1]).toHaveTextContent('in review');
  });
});
