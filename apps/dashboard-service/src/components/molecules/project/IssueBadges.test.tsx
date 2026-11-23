import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import IssueBadges from './IssueBadges';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

/**
 * These badges sit in the dashboard's "Issues" column as `0 C`, `0 H`, `0 M`,
 * `0 L`. Nothing on the screen said C meant Critical, while the KPI card two
 * rows above spelled the same four words out in full — two vocabularies for
 * one measure (audit 1.3). The column has no room for the full words, so the
 * short form stays and the full name is carried for anyone who hovers or uses
 * a screen reader.
 */
describe('IssueBadges', () => {
  it('spells out what each initial means', () => {
    render(<IssueBadges countCritical={2} countHigh={3} countMedium={4} countLow={5} />);

    expect(screen.getByTitle('2 Critical')).toBeInTheDocument();
    expect(screen.getByTitle('3 High')).toBeInTheDocument();
    expect(screen.getByTitle('4 Medium')).toBeInTheDocument();
    expect(screen.getByTitle('5 Low')).toBeInTheDocument();
  });

  it('keeps the compact initial visible for the column', () => {
    render(<IssueBadges countCritical={2} countHigh={0} countMedium={0} countLow={0} />);

    expect(screen.getByTitle('2 Critical')).toHaveTextContent(/^2\s*C$/);
  });

  it('names each badge for assistive technology', () => {
    render(<IssueBadges countCritical={1} countHigh={0} countMedium={0} countLow={0} />);

    expect(screen.getByLabelText('1 Critical')).toBeInTheDocument();
  });
});
