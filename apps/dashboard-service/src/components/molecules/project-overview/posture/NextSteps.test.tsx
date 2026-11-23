import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NextSteps, { nextSteps } from './NextSteps';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const severityHref = (severity: string) => `/appsec/project/p1/sast?severity=${severity.toLowerCase()}`;
const stateHref = (state: string) => `/appsec/project/p1/sast?status=${state}`;

const severity = [
  { severity: 'CRITICAL', count: 7 },
  { severity: 'HIGH', count: 23 },
  { severity: 'MEDIUM', count: 41 },
];
const state = [
  { state: 'to_verify', count: 52 },
  { state: 'confirmed', count: 21 },
  { state: 'proposed_not_exploitable', count: 6 },
  { state: 'not_exploitable', count: 11 },
  { state: 'resolved', count: 134 },
];

const renderSteps = (sev = severity, st = state) =>
  render(
    <MemoryRouter>
      <NextSteps severity={sev} state={st} severityHref={severityHref} stateHref={stateHref} />
    </MemoryRouter>,
  );

describe('nextSteps', () => {
  it('orders the work: critical, high, triage, fix, review, each only when there is something to do', () => {
    expect(nextSteps(severity, state).map((s) => s.id)).toEqual(['fixCritical', 'fixHigh', 'triage', 'fixConfirmed', 'review']);
    expect(nextSteps([{ severity: 'LOW', count: 3 }], [{ state: 'resolved', count: 9 }])).toEqual([]);
    expect(nextSteps([], [{ state: 'to_verify', count: 2 }]).map((s) => s.id)).toEqual(['triage']);
  });
});

describe('NextSteps', () => {
  it('starts with the critical findings and links to their list', () => {
    renderSteps();
    expect(screen.getByTestId('next-step-lead')).toHaveTextContent('7critical findings to fix first');
    expect(screen.getByRole('link', { name: 'Open the list' })).toHaveAttribute('href', '/appsec/project/p1/sast?severity=critical');
  });

  it('then lists at most three further steps, each a link to its filtered list', () => {
    renderSteps();
    const links = screen.getAllByRole('link');
    // The lead, then high, triage, confirmed; the review step waits its turn.
    expect(links).toHaveLength(4);
    expect(links[1]).toHaveAttribute('href', '/appsec/project/p1/sast?severity=high');
    expect(links[2]).toHaveAttribute('href', '/appsec/project/p1/sast?status=to_verify');
    expect(links[3]).toHaveAttribute('href', '/appsec/project/p1/sast?status=confirmed');
    expect(screen.queryByText(/proposed as not exploitable/)).toBeNull();
  });

  it('says so when nothing is urgent, with no link', () => {
    renderSteps([{ severity: 'LOW', count: 2 }], [{ state: 'resolved', count: 5 }]);
    expect(screen.getByTestId('next-step-lead')).toHaveTextContent('Nothing urgent');
    expect(screen.queryByRole('link')).toBeNull();
  });
});
