import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import ProjectDropdown from './ProjectDropdown';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

describe('ProjectDropdown', () => {
  it('links every entry to the AppSec page of the project', () => {
    render(
      <MemoryRouter>
        <ProjectDropdown projectId="p1" />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/appsec/project/p1',
      '/appsec/project/p1/reports',
      '/appsec/project/p1/compliance',
      '/appsec/project/p1/settings',
    ]);
  });
});
