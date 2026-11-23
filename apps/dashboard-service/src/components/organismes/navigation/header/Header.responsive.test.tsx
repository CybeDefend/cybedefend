import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

vi.mock('../../../molecules/breadcrumbs/Breadcrumbs', () => ({
  Breadcrumbs: () => <span data-testid="breadcrumbs" />,
}));
vi.mock('../../../atoms/select/LanguageSwitcherSelect', () => ({ default: () => null }));
vi.mock('../../../molecules/dropdown/avatar-dropdown/AvatarDropdown', () => ({ default: () => null }));
vi.mock('../../../molecules/sidebar/sidebar-content/SidebarContent', () => ({ SidebarContent: () => null }));
vi.mock('../../background-tasks/BackgroundTasksHeaderButton', () => ({
  BackgroundTasksHeaderButton: () => null,
}));
vi.mock('../../../atoms/sidebar-toogle-button/SidebarToggleButton', () => ({
  SidebarToggleButton: () => <span data-testid="sidebar-toggle" />,
}));

import Header from './Header';

/**
 * At 768 and 1024 px the mobile trail must shrink: otherwise, on a project
 * page, the header grows past the viewport and pushes the language
 * selector and the avatar off the screen. The trail takes what is left
 * between the toggle and the actions, and no more.
 */
describe('Header below lg', () => {
  const renderHeader = () =>
    render(
      <Provider store={configureStore({ reducer: { user: () => ({ firstName: 'A', lastName: 'B' }) } })}>
        <Header currentPath="/appsec" />
      </Provider>,
    );

  it('lets the mobile trail shrink instead of widening the page', () => {
    renderHeader();
    const mobileTrail = screen.getAllByTestId('breadcrumbs')[0].parentElement as HTMLElement;
    expect(mobileTrail).toHaveClass('min-w-0', 'truncate');
    expect(mobileTrail.className).not.toMatch(/max-w-\[200px\]/);

    const row = mobileTrail.parentElement as HTMLElement;
    expect(row).toHaveClass('min-w-0');
    const block = row.parentElement as HTMLElement;
    expect(block).toHaveClass('lg:hidden', 'min-w-0', 'flex-1');
    expect(block).not.toHaveClass('flex-shrink-0');
  });
});
