import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

/**
 * The sidebar is dark in both themes. The agents-space accent has one shade for
 * light surfaces and one for dark ones, and the theme alone cannot tell which
 * the sidebar needs: its two containers — the rail, and the drawer of a narrow
 * screen — say it themselves with `data-surface="dark"`. Without it, a light
 * theme would paint the sidebar's indicators in the shade meant for white,
 * under 3:1 on that background.
 */
vi.mock('@/components/molecules/sidebar/sidebar-content/SidebarContent', () => ({
  SidebarContent: () => <div data-testid="sidebar-content" />,
}));
vi.mock('@/components/molecules/modal/organization-selector-modal/OrganizationSelectorModal', () => ({
  default: () => null,
}));
vi.mock('@/components/atoms/select/LanguageSwitcherSelect', () => ({ default: () => null }));
vi.mock('@/components/atoms/sidebar-toogle-button/SidebarToggleButton', () => ({
  SidebarToggleButton: () => null,
}));
vi.mock('@/components/molecules/breadcrumbs/Breadcrumbs', () => ({ Breadcrumbs: () => null }));
vi.mock('@/components/molecules/dropdown/avatar-dropdown/AvatarDropdown', () => ({ default: () => null }));
vi.mock('@/components/organismes/background-tasks/BackgroundTasksHeaderButton', () => ({
  BackgroundTasksHeaderButton: () => null,
}));

import userReducer from '@/server/store/userSlice';
import Sidebar from './sidebar/Sidebar';
import Header from './header/Header';

const darkSurfaceOf = (element: HTMLElement) => element.closest('[data-surface="dark"]');

describe('the sidebar declares itself a dark surface', () => {
  it('on the rail of a wide screen', () => {
    render(<Sidebar />);

    expect(darkSurfaceOf(screen.getByTestId('sidebar-content'))).not.toBeNull();
  });

  it('on the drawer of a narrow screen', () => {
    const store = configureStore({ reducer: { user: userReducer } });
    render(
      <Provider store={store}>
        <Header currentPath="Page" />
      </Provider>,
    );

    expect(darkSurfaceOf(screen.getByTestId('sidebar-content'))).not.toBeNull();
    // The header itself follows the theme: only the drawer is dark in both.
    expect(document.querySelector('header')?.closest('[data-surface]')).toBeNull();
  });
});
