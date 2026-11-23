// The AI-BOM tab lists an inventory of components, NOT vulnerabilities.
// Showing a count badge on that tab makes it read as "N vulnerabilities", so the
// badge must be suppressed for the `aibom` tab while still rendered for the
// vulnerability tabs (sast/iac/…).

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import CustomTabs from './CustomTabs';

const tabs = [
  { label: 'Source Code', value: 'sast' },
  { label: 'AI-BOM', value: 'aibom' },
];

describe('CustomTabs — AI-BOM tab count badge', () => {
  it('renders a count badge for a vulnerability tab', () => {
    render(
      <CustomTabs
        selectedTab="sast"
        onSelectTab={() => {}}
        tabs={tabs}
        vulnCounts={{ sast: 5, aibom: 17 }}
        loading={false}
      />,
    );
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('does NOT render a count badge for the aibom tab even when a count is provided', () => {
    render(
      <CustomTabs
        selectedTab="sast"
        onSelectTab={() => {}}
        tabs={tabs}
        vulnCounts={{ sast: 5, aibom: 17 }}
        loading={false}
      />,
    );
    // The "17" inventory count must not appear as a tab badge.
    expect(screen.queryByText('17')).not.toBeInTheDocument();
  });
});

describe('CustomTabs — a count on the tab definition', () => {
  it('renders the count after the label as a Badge, accent on the active tab', () => {
    render(
      <CustomTabs
        selectedTab="rules"
        onSelectTab={() => {}}
        tabs={[
          { label: 'Rules', value: 'rules', count: 12 },
          { label: 'Proposals', value: 'proposals', count: 3 },
          { label: 'History', value: 'history' },
        ]}
      />,
    );

    const active = screen.getByText('12');
    expect(active).toHaveClass('bg-secondary/10', 'text-secondary', 'dark:text-secondary-light', 'text-[10px]');
    expect(screen.getByRole('button', { name: /Rules/ })).toContainElement(active);
    expect(screen.getByRole('button', { name: /Rules/ }).lastChild).toBe(active);

    const idle = screen.getByText('3');
    expect(idle).toHaveClass('bg-gray-100', 'text-gray-700', 'text-[10px]');
    expect(idle).not.toHaveClass('text-secondary');

    expect(screen.getByRole('button', { name: 'History' }).querySelector('span')).toBeNull();
  });

  it('renders a zero count', () => {
    render(<CustomTabs selectedTab="a" tabs={[{ label: 'A', value: 'a', count: 0 }]} />);

    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('marks the count of a linked tab by its active route', () => {
    render(
      <MemoryRouter initialEntries={['/p/rules']}>
        <CustomTabs
          tabs={[
            { label: 'Rules', value: 'rules', link: '/p/rules', count: 4 },
            { label: 'Guards', value: 'guards', link: '/p/guards', count: 2 },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('4')).toHaveClass('text-secondary');
    expect(screen.getByText('2')).not.toHaveClass('text-secondary');
  });
});
