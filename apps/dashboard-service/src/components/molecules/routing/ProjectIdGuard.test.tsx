import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ProjectIdGuard from './ProjectIdGuard';

const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

const Where: React.FC = () => <p data-testid="where">{useLocation().pathname}</p>;

const mountAt = (entry: string) => {
  const page = vi.fn(() => <p>project page</p>);
  const Page = page as unknown as React.FC;
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/appsec/project/:projectId/*"
          element={
            <ProjectIdGuard fallback="/appsec/projects">
              <Page />
            </ProjectIdGuard>
          }
        />
        <Route path="/appsec/projects" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return page;
};

describe('ProjectIdGuard', () => {
  it('renders the page for a UUID project id', () => {
    const page = mountAt(`/appsec/project/${ID}/settings`);
    expect(screen.getByText('project page')).toBeInTheDocument();
    expect(page).toHaveBeenCalled();
  });

  // React Router hands the parameter decoded: `..%2F..%2Fpolicies%2Fx` reaches
  // the page as `../../policies/x`, which a request path would resolve.
  it.each([
    `/appsec/project/..%2F..%2Fpolicies%2F${ID}/settings`,
    `/appsec/project/${ID}%2F..%2F..%2Fx/settings`,
    '/appsec/project/not-a-project/settings',
    `/appsec/project/${ID}%3Fx/sast`,
  ])('sends %s to the project list, before the page runs', (entry) => {
    const page = mountAt(entry);
    expect(page).not.toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/appsec/projects');
  });
});
