import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Stands in for the catalogue entry. Breadcrumbs only calls `t` for a segment
 * it finds in `SEGMENT_KEYS`, so seeing this label is proof the entry exists
 * and is looked up — an unmapped segment renders its raw slug instead and
 * never reaches `t`.
 */
const LABEL = 'Subscription';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === 'navigation.breadcrumb.subscription-expired' ? LABEL : key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import { Breadcrumbs } from './Breadcrumbs';

/**
 * `/subscription-expired` now renders inside the dashboard Layout, so its
 * header carries a breadcrumb. A segment absent from `SEGMENT_KEYS` renders as
 * the raw lowercase slug on purpose — which would have put "subscription-expired"
 * in the header of a page a user only ever reaches when something is wrong.
 */
describe('Breadcrumbs on /subscription-expired', () => {
  it('names the page from the translation catalogue, not the URL slug', () => {
    render(
      <MemoryRouter initialEntries={['/subscription-expired']}>
        <Breadcrumbs />
      </MemoryRouter>,
    );

    expect(screen.getByText(LABEL)).toBeInTheDocument();
    expect(screen.queryByText('subscription-expired')).not.toBeInTheDocument();
  });
});
