import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import type { SlotRegistration } from '@/edition/slots';
import SettingsWrapper from './SettingsWrapper';
import { SettingsTab, useSettingsTabs } from './SettingsTab';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-rebac', () => ({ useAuthorization: () => true }));

const { slots } = vi.hoisted(() => ({ slots: { current: [] as SlotRegistration[] } }));
vi.mock('@/edition/active', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/active')>()),
  activeSlots: () => slots.current,
}));

const ORGANIZATION = { id: 'org-1', name: 'Acme', myRole: 'member' };

const renderWrapper = (registrations: SlotRegistration[], selectedTab = 'organization') => {
  slots.current = registrations;
  return render(
    <Provider store={configureStore({ reducer: { organization: () => ({ selectedOrganization: ORGANIZATION }) } })}>
      <MemoryRouter initialEntries={['/appsec']}>
        <SettingsWrapper selectedTab={selectedTab}>
          <p>body</p>
        </SettingsWrapper>
      </MemoryRouter>
    </Provider>,
  );
};

/** The labels of the tab row (the organisation header has a copy button of its own). */
const tabLabels = () =>
  within(screen.getByRole('navigation')).getAllByRole('button').map((b) => b.textContent);

/** A registered tab, current when the page on screen is its own. */
const RegisteredTab = ({ value, label }: { value: string; label: string }) => {
  const { current } = useSettingsTabs();
  return <SettingsTab value={value} label={label} to={`/organization/settings/${value}`} active={current === value} />;
};

const registered = (value: string, label: string, order: number): SlotRegistration => ({
  slot: 'settings.organization.tabs',
  id: value,
  order,
  render: () => <RegisteredTab value={value} label={label} />,
});

describe('SettingsWrapper and its settings.organization.tabs slot', () => {
  it('the core settings tabs are organization, teams, integrations', () => {
    renderWrapper([]);
    expect(tabLabels()).toEqual(['Organization', 'Teams', 'Integrations']);
  });

  it('registered tabs follow, by their order', () => {
    renderWrapper([registered('second', 'Second', 50), registered('first', 'First', 40)]);
    expect(tabLabels()).toEqual(['Organization', 'Teams', 'Integrations', 'First', 'Second']);
  });

  it('tells a registered tab which page is on screen', () => {
    renderWrapper([registered('first', 'First', 40)], 'first');
    expect(screen.getByRole('button', { name: 'First' }).className).toMatch(/border-secondary/);
    expect(screen.getByRole('button', { name: 'Organization' }).className).not.toMatch(/border-secondary/);
  });
});
