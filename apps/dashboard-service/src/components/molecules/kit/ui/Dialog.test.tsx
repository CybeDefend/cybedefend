import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import Button from '@/components/atoms/zinc/button/Button';
import Input from '@/components/atoms/zinc/input/Input';
import { Dialog, DialogContent, DialogTrigger } from './Dialog';

describe('Dialog', () => {
  it('traps the focus inside, closes on Escape and gives the focus back', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Button>Outside</Button>
        <Dialog>
          <DialogTrigger asChild>
            <Button>Rename</Button>
          </DialogTrigger>
          <DialogContent title="Rename the project" footer={<Button variant="ink">Save</Button>}>
            <Input aria-label="Name" />
          </DialogContent>
        </Dialog>
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename the project' });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    // Close button, field, Save: tabbing past the last one loops to the first.
    for (let i = 0; i < 5; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename' })).toHaveFocus();
  });
});
