import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';

/**
 * In a community build the shell's slots are empty (`ACTIVE_SLOTS = []`): the
 * Cybe chat — an ee registration of `app.shell.overlays` — never renders its
 * button, whatever the organisation's products say.
 */

vi.mock('@/edition/active', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/edition/active')>();
  return { ...actual, activeSlots: () => [], ACTIVE_SLOTS: [] };
});

const { api, openStream } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  openStream: vi.fn(),
}));

vi.mock('@/server/api/gatewayAPI', () => ({
  default: api,
  isTrialExhaustedError: () => false,
}));
vi.mock('@/server/services/realtimeStream', () => ({ openStream }));
vi.mock('@/server/api/tokenManager', () => ({
  getAccessTokenForFetch: vi.fn().mockResolvedValue('token'),
}));
vi.mock('../navigation/header/Header', () => ({ default: () => null }));
vi.mock('../navigation/sidebar/Sidebar', () => ({ default: () => null }));
// The drawer's internals are irrelevant here; the button is what is asserted.
vi.mock('@/ee/chat/components/organismes/global-chat/GlobalChatDrawer', () => ({
  GlobalChatDrawer: () => null,
}));
vi.mock('@/ee/billing/components/molecules/trial-quota-banner/TrialQuotaBanner', () => ({ TrialQuotaBanner: () => null }));
vi.mock('@/utils/hooks/useIsCompactViewport', () => ({ useIsCompactViewport: () => false }));
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import authReducer from '@/server/store/authSlice';
import userReducer from '@/server/store/userSlice';
import organizationReducer, { setSelectedOrganization } from '@/server/store/organizationSlice';
import { ACTIVE_EXTENSIONS } from '@/edition/active';
import Layout from './Layout';
import { loadEditionShell } from '@/test/editionGuard';

// The space's frame and shell effects load on demand: loaded once, so every case renders synchronously.
beforeAll(loadEditionShell);

const renderLayout = (path: string, products: { product: string; status: string }[]) => {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      user: userReducer,
      organization: organizationReducer,
      // A stand-in for the ee reducers, which a community build does not have.
      globalChat: ((s = {}) => s) as never,
      ...ACTIVE_EXTENSIONS.reducers,
    },
  });
  store.dispatch(
    setSelectedOrganization({
      id: 'org-1',
      name: 'Acme',
      myRole: 'creator',
      myTeams: [],
      subscription: null,
      products,
    } as never),
  );
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Layout currentPath="Page">
          <div />
        </Layout>
      </MemoryRouter>
    </Provider>,
  );
};

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ data: { myOrganizations: [] } });
  openStream.mockReset().mockImplementation(() => ({ close: vi.fn() }));
});

afterEach(() => cleanup());

describe('Layout in the community edition', () => {
  it('renders no chat button when AppSec is active', () => {
    renderLayout('/appsec', [{ product: 'appsec', status: 'active' }]);
    expect(screen.queryByRole('button', { name: /cybe/i })).toBeNull();
  });
});
