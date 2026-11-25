import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import RouteIdGuard from './RouteIdGuard';

const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

const Where: React.FC = () => <p data-testid="where">{useLocation().pathname}</p>;

const mountAt = (entry: string) => {
  const page = vi.fn(() => <p>policy page</p>);
  const Page = page as unknown as React.FC;
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/organization/settings/policies/:policyId/edit"
          element={
            <RouteIdGuard params={['policyId']} fallback="/organization/settings/policies">
              <Page />
            </RouteIdGuard>
          }
        />
        <Route path="/organization/settings/policies" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return page;
};

describe('RouteIdGuard', () => {
  it('renders the page for a UUID id', () => {
    const page = mountAt(`/organization/settings/policies/${ID}/edit`);
    expect(screen.getByText('policy page')).toBeInTheDocument();
    expect(page).toHaveBeenCalled();
  });

  it.each([
    `/organization/settings/policies/..%2F..%2Fprojects%2F${ID}/edit`,
    `/organization/settings/policies/.%09.%2Fx/edit`,
    '/organization/settings/policies/not-a-policy/edit',
  ])('sends %s to the fallback, before the page runs', (entry) => {
    const page = mountAt(entry);
    expect(page).not.toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/organization/settings/policies');
  });
});
