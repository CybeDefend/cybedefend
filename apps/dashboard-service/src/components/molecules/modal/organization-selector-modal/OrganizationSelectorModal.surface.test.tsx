import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('@/edition/auth/useAuth', () => ({ useAuth: () => ({ loading: false }) }));

import OrganizationSelectorModal from './OrganizationSelectorModal';

/**
 * The organisation picker opened from the rail. Its behaviour is the same in
 * both spaces; only its skin changes when a zinc-kit rail asks for the
 * dark surface: a plain popover on the near-black
 * rail — hairline, 8 px radius, no shadow, 32 px rows, the current organisation
 * marked in ink, not in the accent. Without the prop it renders as it always did.
 */
const ORGS = [
  { id: 'org-1', name: 'Acme' },
  { id: 'org-2', name: 'Globex' },
];

const renderModal = (surface?: 'dark') => {
  const onClose = vi.fn();
  const store = configureStore({
    reducer: {
      organization: (state = { selectedOrganization: ORGS[0] }, action: { type: string; payload?: unknown }) =>
        action.type === 'organization/setSelectedOrganization' ? { selectedOrganization: action.payload } : state,
      user: () => ({ myOrganizations: ORGS }),
    },
  });
  const triggerRef = { current: document.createElement('button') };
  const view = render(
    <Provider store={store}>
      <OrganizationSelectorModal onClose={onClose} triggerRef={triggerRef} surface={surface} />
    </Provider>,
  );
  return { ...view, onClose, store };
};

const panel = (container: HTMLElement) => container.querySelector('.modal-content') as HTMLElement;

describe('OrganizationSelectorModal — surface', () => {
  it('keeps its own skin without the prop', () => {
    const { container } = renderModal();
    expect(panel(container)).toHaveClass(
      'fixed',
      'z-50',
      'bg-white',
      'dark:bg-neutral-900',
      'rounded-lg',
      'shadow',
      'border',
      'border-gray-200',
      'dark:border-neutral-700',
    );
    expect(panel(container)).not.toHaveClass('dark');
  });

  it('takes the dark rail skin when asked: hairline, 8 px radius, no shadow', () => {
    const { container } = renderModal('dark');
    const skin = panel(container);
    expect(skin).toHaveClass('fixed', 'z-50', 'modal-content', 'rounded-lg', 'border', 'border-white/[0.08]', 'bg-[#111113]');
    // Dark in both themes: its contents (the search box) take their dark colours.
    expect(skin).toHaveClass('dark');
    expect(skin.className).not.toMatch(/shadow|bg-white\b|secondary/);
  });

  it('draws 32 px rows and marks the current organisation in ink', () => {
    renderModal('dark');
    const current = screen.getByText('Acme').closest('[data-org-row]') as HTMLElement;
    expect(current).toHaveClass('h-8', 'text-[13px]');
    const check = current.querySelector('svg') as SVGElement;
    expect(check.getAttribute('class')).toContain('text-zinc-100');
    expect(check.getAttribute('class')).not.toContain('secondary');
  });

  it('picks an organisation and closes, as it always did', () => {
    const { onClose, store } = renderModal('dark');
    fireEvent.click(screen.getByText('Globex'));
    expect((store.getState() as { organization: { selectedOrganization: unknown } }).organization.selectedOrganization).toEqual(ORGS[1]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('enters without a fade on the dark surface: an overlay never starts see-through', () => {
    const { container } = renderModal('dark');
    expect(panel(container).style.opacity).not.toBe('0');
  });
});
