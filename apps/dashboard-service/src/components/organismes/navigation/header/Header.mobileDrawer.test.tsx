import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

vi.mock('../../../molecules/breadcrumbs/Breadcrumbs', () => ({ Breadcrumbs: () => null }));
vi.mock('../../../atoms/select/LanguageSwitcherSelect', () => ({ default: () => null }));
vi.mock('../../../molecules/dropdown/avatar-dropdown/AvatarDropdown', () => ({ default: () => null }));
vi.mock('../../../molecules/sidebar/sidebar-content/SidebarContent', () => ({
  SidebarContent: () => <span data-testid="sidebar-content" />,
}));
vi.mock('../../background-tasks/BackgroundTasksHeaderButton', () => ({ BackgroundTasksHeaderButton: () => null }));

import Header from './Header';
import Sidebar from '../sidebar/Sidebar';

/**
 * The navigation below lg is React state, never a UI library's script. The UI
 * kit once loaded next to it (removed for its licence, see the guard in
 * atoms/__guards__) never reached these elements: no toggle named its overlay, so its
 * open variant never applied. These pin what the drawer and the rail do on
 * their own.
 */
const store = () => configureStore({ reducer: { user: () => ({ firstName: 'A', lastName: 'B' }) } });

describe('the mobile navigation drawer', () => {
  it('opens and closes on its toggle, with the classes that move it', () => {
    const { container } = render(
      <Provider store={store()}>
        <Header currentPath="/appsec" />
      </Provider>,
    );
    const toggle = container.querySelector('button[aria-controls="hs-application-sidebar"]') as HTMLButtonElement;
    const drawer = container.querySelector('#hs-application-sidebar') as HTMLElement;

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(drawer).toHaveClass('-translate-x-full', 'lg:hidden');
    expect(drawer).not.toHaveClass('translate-x-0');
    expect(drawer).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(drawer).toHaveClass('translate-x-0');
    expect(drawer).not.toHaveClass('-translate-x-full');
    expect(drawer).toHaveAttribute('aria-hidden', 'false');

    // The backdrop closes it.
    const backdrop = container.querySelector('.bg-black\\/60') as HTMLElement;
    fireEvent.click(backdrop);
    expect(drawer).toHaveClass('-translate-x-full');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('the desktop rail', () => {
  it('is out of view below lg and in view from lg, by Tailwind classes alone', () => {
    render(<Sidebar />);
    const rail = screen.getByTestId('sidebar-content').parentElement as HTMLElement;
    expect(rail).toHaveClass('-translate-x-full', 'lg:translate-x-0', 'lg:block', 'fixed', 'w-[260px]', 'lg:w-56');
    expect(rail.className).not.toMatch(/(^|\s)hs-/);
  });
});
