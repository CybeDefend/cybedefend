import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// A project of the compliance overview opens on its AppSec compliance page, under the prefix.

const h = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-router-dom', () => ({ useNavigate: () => h.navigate }));
vi.mock('@/components/molecules/pagination/Pagination', () => ({ default: () => null }));

import ProjectsComplianceTable from './ProjectsComplianceTable';

beforeEach(() => {
  h.navigate.mockReset();
});

describe('ProjectsComplianceTable', () => {
  it('opens a project on its AppSec compliance page', async () => {
    render(
      <ProjectsComplianceTable
        projects={[
          {
            projectId: 'proj-1',
            projectName: 'Payment service',
            complianceStatus: 'Non-Compliant',
            totalViolations: 3,
            blockedCount: 1,
            warnedCount: 2,
            applicablePoliciesCount: 4,
            teamIds: [],
          },
        ]}
        loading={false}
        error={null}
        currentPage={1}
        pageSize={10}
        totalPages={1}
        totalItems={1}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByText('Payment service'));
    expect(h.navigate).toHaveBeenCalledWith('/appsec/project/proj-1/compliance');
  });
});
