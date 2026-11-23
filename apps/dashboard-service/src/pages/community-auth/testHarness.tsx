import React from 'react';
import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import invitationReducer from '@/server/store/invitationSlice';

/** Prints where the router settled, for the pages' redirects. */
export const Where: React.FC = () => {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{`${pathname}${search}`}</output>;
};

/** Renders `element` at `path` (matched by `pattern`), every other path printing its location. */
export function renderAt(element: React.ReactElement, path: string, pattern = path.split(/[?#]/, 1)[0]) {
  const store = configureStore({ reducer: { invitation: invitationReducer } });
  const view = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={pattern} element={element} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  return { ...view, store };
}

/** An axios-shaped refusal, as the gateway answers it. */
export const answered = (status: number, data: unknown) => ({
  isAxiosError: true,
  message: 'Request failed',
  response: { status, data, headers: {} },
});

export const openSetup = { setupOpen: false, signupMode: 'invite_only' as const, passwordResetByEmail: true };
