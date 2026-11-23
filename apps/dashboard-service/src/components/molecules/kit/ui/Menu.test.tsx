import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import Button from '@/components/atoms/zinc/button/Button';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from './Menu';

// Radix menus measure and capture the pointer; jsdom has neither.
beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

describe('Menu', () => {
  it('opens from the keyboard, moves with the arrows and runs the item on Enter', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <Menu>
        <MenuTrigger asChild>
          <Button>Actions</Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem shortcut="⌘N">New project</MenuItem>
          <MenuItem onSelect={onRename}>Rename</MenuItem>
          <MenuSeparator />
          <MenuItem tone="danger">Delete</MenuItem>
        </MenuContent>
      </Menu>,
    );

    screen.getByRole('button', { name: 'Actions' }).focus();
    await user.keyboard('{Enter}');

    const menu = await screen.findByRole('menu');
    expect(menu.className).toContain('rounded-lg');
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    expect(screen.getByText('⌘N')).toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
