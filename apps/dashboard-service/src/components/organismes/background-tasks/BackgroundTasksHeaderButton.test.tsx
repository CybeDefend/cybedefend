import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import backgroundTasksReducer, { AsyncTask } from '@/server/store/backgroundTasksSlice';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import { BackgroundTasksHeaderButton } from './BackgroundTasksHeaderButton';

const runningTask = (id = 'task-1'): AsyncTask => ({
    id,
    type: 'vuln_batch_update',
    status: 'running',
    total: 100,
    processed: 45,
});

const buildStore = (preloadedState?: any) =>
    configureStore({
        reducer: { backgroundTasks: backgroundTasksReducer },
        preloadedState,
    });

const renderButton = (preloadedState?: any) => {
    const store = buildStore(preloadedState);
    const utils = render(
        <Provider store={store}>
            <BackgroundTasksHeaderButton />
        </Provider>,
    );
    return { store, ...utils };
};

describe('BackgroundTasksHeaderButton', () => {
    it('renders nothing when there are no tasks', () => {
        renderButton();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('renders nothing when tasks exist but the container is closed', () => {
        renderButton({
            backgroundTasks: { tasks: [runningTask()], collapsed: false, open: false },
        });
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('shows the pill with the task count + aggregate percent when open', () => {
        renderButton({
            backgroundTasks: { tasks: [runningTask()], collapsed: false, open: true },
        });
        expect(screen.getByText(/1 task\(s\), 45%/)).toBeInTheDocument();
    });

    it('collapses the expanded panel when clicked while expanded', () => {
        const { store } = renderButton({
            backgroundTasks: { tasks: [runningTask()], collapsed: false, open: true },
        });
        fireEvent.click(screen.getByRole('button', { name: /collapse tasks panel/i }));
        expect(store.getState().backgroundTasks.collapsed).toBe(true);
    });

    it('expands the panel when clicked while collapsed', () => {
        const { store } = renderButton({
            backgroundTasks: { tasks: [runningTask()], collapsed: true, open: true },
        });
        fireEvent.click(screen.getByRole('button', { name: /expand tasks panel/i }));
        expect(store.getState().backgroundTasks.collapsed).toBe(false);
    });
});
