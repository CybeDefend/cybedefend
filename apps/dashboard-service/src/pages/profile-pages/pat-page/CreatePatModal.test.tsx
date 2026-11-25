import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import CreatePatModal from './CreatePatModal';

afterEach(() => cleanup());

const nameField = () => screen.getByPlaceholderText('e.g. ci-pipeline, my-script');
const passwordField = () => document.querySelector<HTMLInputElement>('input[type="password"]');

/**
 * A personal access token outlives every session, so in the Community Edition
 * creating one asks for the account's password; the cloud dialog is unchanged.
 */
describe('CreatePatModal', () => {
  it('asks for the account password when required and hands it over with the name', () => {
    const onCreate = vi.fn();
    render(<CreatePatModal requirePassword onCreate={onCreate} onClose={vi.fn()} />);

    const field = passwordField();
    expect(field).not.toBeNull();
    expect(field!.autocomplete).toBe('current-password');
    expect(screen.getByText('Your password')).toBeInTheDocument();

    fireEvent.change(nameField(), { target: { value: 'ci' } });
    fireEvent.change(field!, { target: { value: 'the account password' } });
    fireEvent.click(screen.getByText('Create'));

    expect(onCreate).toHaveBeenCalledWith('ci', 0, 'the account password');
  });

  it('refuses to submit without the password', () => {
    const onCreate = vi.fn();
    render(<CreatePatModal requirePassword onCreate={onCreate} onClose={vi.fn()} />);

    fireEvent.change(nameField(), { target: { value: 'ci' } });
    fireEvent.click(screen.getByText('Create'));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText('Enter your password to create a token')).toBeInTheDocument();
  });

  it('shows no password field when not required', () => {
    const onCreate = vi.fn();
    render(<CreatePatModal onCreate={onCreate} onClose={vi.fn()} />);

    expect(passwordField()).toBeNull();
    fireEvent.change(nameField(), { target: { value: 'ci' } });
    fireEvent.click(screen.getByText('Create'));
    expect(onCreate).toHaveBeenCalledWith('ci', 0, undefined);
  });
});
