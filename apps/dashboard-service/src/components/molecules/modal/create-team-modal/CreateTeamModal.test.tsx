import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import enErrors from '@/i18n/locales/en/components/modal/createTeam/errors.json';
import frErrors from '@/i18n/locales/fr/components/modal/createTeam/errors.json';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import CreateTeamModal from './CreateTeamModal';

// The server accepts a team name and a description of 1 to 255 characters,
// refuses one made only of spaces and one holding a NUL character. The form
// checks the same bounds so a user sees the reason before the request.
const fill = (name: string, description: string) => {
  fireEvent.change(screen.getByPlaceholderText('Enter team name'), { target: { value: name } });
  fireEvent.change(screen.getByPlaceholderText('Enter team description'), { target: { value: description } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
};

const mount = () => {
  const onCreateTeam = vi.fn();
  const onClose = vi.fn();
  render(<CreateTeamModal onClose={onClose} onCreateTeam={onCreateTeam} />);
  return { onCreateTeam, onClose };
};

describe('CreateTeamModal validation', () => {
  it('accepts a description of exactly 255 characters', () => {
    const { onCreateTeam } = mount();
    fill('Platform', 'd'.repeat(255));
    expect(onCreateTeam).toHaveBeenCalledWith('Platform', 'd'.repeat(255));
  });

  it('refuses a description longer than 255 characters', () => {
    const { onCreateTeam } = mount();
    fill('Platform', 'd'.repeat(256));
    expect(onCreateTeam).not.toHaveBeenCalled();
    expect(screen.getByText('Description must be 255 characters or fewer')).toBeInTheDocument();
  });

  it('refuses a name longer than 255 characters', () => {
    const { onCreateTeam } = mount();
    fill('n'.repeat(256), 'Backend team');
    expect(onCreateTeam).not.toHaveBeenCalled();
    expect(screen.getByText('Team name must be 255 characters or fewer')).toBeInTheDocument();
  });

  it('refuses a name or a description made only of spaces', () => {
    const { onCreateTeam } = mount();
    fill('   ', '   ');
    expect(onCreateTeam).not.toHaveBeenCalled();
    expect(screen.getByText('Team name is required')).toBeInTheDocument();
    expect(screen.getByText('Team description is required')).toBeInTheDocument();
  });

  it('refuses a NUL character in the name or the description', () => {
    const { onCreateTeam } = mount();
    fill('Plat\u0000form', 'Back\u0000end');
    expect(onCreateTeam).not.toHaveBeenCalled();
    expect(screen.getByText('Team name contains a character that is not allowed')).toBeInTheDocument();
    expect(screen.getByText('Description contains a character that is not allowed')).toBeInTheDocument();
  });

  it('states the 255-character limit in English and French, never 1024', () => {
    const en = enErrors.components.modal.createTeam.errors;
    const fr = frErrors.components.modal.createTeam.errors as Record<string, string>;
    expect(en.descriptionLength).toContain('255');
    expect(fr.descriptionLength).toContain('255');
    expect(JSON.stringify(enErrors)).not.toContain('1024');
    expect(JSON.stringify(frErrors)).not.toContain('1024');
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });
});
