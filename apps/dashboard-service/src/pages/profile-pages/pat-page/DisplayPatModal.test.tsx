import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import DisplayPatModal from './DisplayPatModal';

afterEach(() => cleanup());

/** The token is shown once, right after its creation: its field is marked as a secret. */
describe('DisplayPatModal', () => {
  it('marks the field that shows the new token as a secret', () => {
    render(<DisplayPatModal tokenValue="token-shown-once" onClose={vi.fn()} onCopy={vi.fn()} />);

    const field = document.querySelector<HTMLInputElement>('input[readonly]');
    expect(field).not.toBeNull();
    expect(field!.value).toBe('token-shown-once');
    expect(field!.closest('[data-sensitive="secret"]')).not.toBeNull();
  });
});
