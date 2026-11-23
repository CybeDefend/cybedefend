import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CardVulnerabilities from './CardVulnerabilities';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

/**
 * This card sits fourth in the dashboard KPI row. Its three neighbours each
 * show an icon, a headline and a sub-line; this one showed a donut and four
 * bare dots, so it did not read as the same kind of object. Its
 * legend was also hardcoded English on a French screen, and with
 * no vulnerabilities at all the percentages divided by zero, producing a
 * `NaN%` conic-gradient — an empty project got a broken ring.
 */
describe('CardVulnerabilities', () => {
  it('reads like its neighbours: a headline naming the total', () => {
    render(<CardVulnerabilities criticalCount={2} highCount={3} mediumCount={4} lowCount={1} />);

    // 2 + 3 + 4 + 1 = 10
    expect(screen.getByTestId('card-vulnerabilities-total')).toHaveTextContent('10');
    expect(screen.getByTestId('card-vulnerabilities-total')).toHaveTextContent(/vulnerabilit/i);
  });

  it('labels each severity through the shared vocabulary, not hardcoded English', () => {
    render(<CardVulnerabilities criticalCount={2} highCount={3} mediumCount={4} lowCount={1} />);

    for (const label of ['Critical', 'High', 'Medium', 'Low']) {
      expect(screen.getByText(new RegExp(label))).toBeInTheDocument();
    }
  });

  it('says so plainly when there is nothing, instead of four zeros', () => {
    render(<CardVulnerabilities criticalCount={0} highCount={0} mediumCount={0} lowCount={0} />);

    expect(screen.getByTestId('card-vulnerabilities-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('card-vulnerabilities-legend')).not.toBeInTheDocument();
  });

  it('never emits a NaN gradient when every count is zero', () => {
    const { container } = render(
      <CardVulnerabilities criticalCount={0} highCount={0} mediumCount={0} lowCount={0} />,
    );

    expect(container.innerHTML).not.toContain('NaN');
  });

  it('keeps the ring proportional to the counts', () => {
    const { container } = render(
      <CardVulnerabilities criticalCount={1} highCount={1} mediumCount={1} lowCount={1} />,
    );

    const ring = container.querySelector('[data-testid="card-vulnerabilities-ring"]') as HTMLElement;
    expect(ring.style.background).toContain('25%');
  });
  it('lets a page name what it counts, and says the empty case in its own words', () => {
    const { rerender } = render(
      <CardVulnerabilities
        criticalCount={1}
        highCount={0}
        mediumCount={2}
        lowCount={0}
        title="3 findings caught before commit"
        emptyLabel="Nothing caught"
      />,
    );

    expect(screen.getByTestId('card-vulnerabilities-total')).toHaveTextContent(
      '3 findings caught before commit',
    );
    rerender(
      <CardVulnerabilities
        criticalCount={0}
        highCount={0}
        mediumCount={0}
        lowCount={0}
        title="0 findings caught before commit"
        emptyLabel="Nothing caught"
      />,
    );
    expect(screen.getByTestId('card-vulnerabilities-empty')).toHaveTextContent('Nothing caught');
  });
});
