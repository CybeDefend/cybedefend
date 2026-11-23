import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import backgroundTasksReducer, {
    addTask,
    setCollapsed,
    selectTasksPanelShown,
} from '@/server/store/backgroundTasksSlice';
import { BackgroundTasksPanel } from './BackgroundTasksPanel';
import { appToastStyle, TASKS_PANEL_CLEARANCE } from './toastPlacement';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const buildStore = () => configureStore({ reducer: { backgroundTasks: backgroundTasksReducer } });

const reportTask = {
    id: 'task-1',
    type: 'report_generation',
    status: 'completed' as const,
    total: 1,
    processed: 1,
    resultUrl: '/reports?reportId=r1',
};

/*
 * The app's toasts sit at the top right, above everything, exactly where the
 * background-tasks dropdown opens. After a few report generations their stack
 * covered the dropdown, and a click on « View report » landed on a toast (which
 * pauses while hovered, so it stayed there). While the dropdown is shown, the
 * toasts move to its left.
 */
describe('toast placement beside the background-tasks panel', () => {
    it('reads the panel as shown only with a task, open and not collapsed', () => {
        const store = buildStore();
        expect(selectTasksPanelShown(store.getState())).toBe(false);
        store.dispatch(addTask(reportTask));
        expect(selectTasksPanelShown(store.getState())).toBe(true);
        store.dispatch(setCollapsed(true));
        expect(selectTasksPanelShown(store.getState())).toBe(false);
    });

    it('keeps the toasts at their usual place while the panel is hidden', () => {
        const style = appToastStyle(false) as Record<string, unknown>;
        expect(style.marginTop).toBe('50px');
        expect(style.zIndex).toBe(99999);
        expect(style['--toastify-toast-right']).toBeUndefined();
    });

    it('moves the toasts left of the panel while it is shown', () => {
        const style = appToastStyle(true) as Record<string, unknown>;
        expect(style.marginTop).toBe('50px');
        expect(style.zIndex).toBe(99999);
        expect(style['--toastify-toast-right']).toBe(TASKS_PANEL_CLEARANCE);
    });

    it('clears the width and the right offset the panel actually uses', () => {
        const store = buildStore();
        store.dispatch(addTask(reportTask));
        const { container } = render(
            <Provider store={store}>
                <MemoryRouter>
                    <BackgroundTasksPanel />
                </MemoryRouter>
            </Provider>,
        );
        const panel = container.firstElementChild as HTMLElement;
        // w-80 (20rem) at right-4 (1rem): the toasts clear 21rem plus a 1rem gap.
        expect(panel.className).toContain('w-80');
        expect(panel.className).toContain('right-4');
        expect(TASKS_PANEL_CLEARANCE).toBe('22rem');
    });
});
