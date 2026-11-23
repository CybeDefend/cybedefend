import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// A project of the « most vulnerable » table opens on its AppSec page, under the prefix.

const h = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-router-dom', () => ({ useNavigate: () => h.navigate }));

import TopVulnerableProjectsTable from './TopVulnerableProjectsTable';

beforeEach(() => {
  h.navigate.mockReset();
});

describe('TopVulnerableProjectsTable', () => {
  it('opens a project on its AppSec page', async () => {
    render(
      <TopVulnerableProjectsTable
        projects={[
          {
            projectId: 'proj-1',
            projectName: 'Payment service',
            teamName: 'Core',
            vulnerabilityCount: 12,
            criticalCount: 2,
            highCount: 3,
          },
        ]}
      />,
    );
    await userEvent.click(screen.getByText('Payment service'));
    expect(h.navigate).toHaveBeenCalledWith('/appsec/project/proj-1');
  });
});
