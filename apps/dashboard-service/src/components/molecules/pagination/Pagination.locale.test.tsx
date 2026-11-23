import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', async () => {
  const { translate } = await import('@/test/i18n-mock');
  return {
    useTranslation: () => ({ t: translate, i18n: { language: 'fr' } }),
    initReactI18next: { type: '3rdParty', init: () => {} },
  };
});

import Pagination from './Pagination';

/** « Showing 1-10 of 12 345 »: the counts in the interface's language. */
describe('Pagination counts', () => {
  it('writes the range and the total with the separators of the interface language', () => {
    render(
      <Pagination
        currentPage={1235}
        totalPages={1235}
        pageSize={10}
        totalItems={12345}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
        showItemsCount
      />,
    );
    expect(screen.getByText(/Showing/)).toHaveTextContent(/12\s341-12\s345 of 12\s345/);
  });

  // At 320 and 768 px, four-digit page numbers must not run out of the page.
  it('wraps its page numbers and its parts rather than widening the page', () => {
    render(
      <Pagination currentPage={1235} totalPages={1235} pageSize={10} totalItems={12345} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />,
    );
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(nav).toHaveClass('flex-wrap', 'justify-center');
    expect(nav.parentElement).toHaveClass('sm:flex-wrap');
  });
});
