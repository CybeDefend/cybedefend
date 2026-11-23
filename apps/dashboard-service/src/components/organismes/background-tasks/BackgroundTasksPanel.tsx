import React, { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import {
    setCollapsed,
    closeContainer,
    selectBackgroundTasks,
    selectActiveTasks,
    selectAllTerminal,
    selectTasksPanelShown,
} from '@/server/store/backgroundTasksSlice';
import { BackgroundTaskRow } from './BackgroundTaskRow';
import { Xmark } from '@/components/atoms/icon/icons';

// Root state shape that the selectors expect
type BgSlice = { backgroundTasks: { tasks: any[]; collapsed: boolean; open: boolean } };

const selectOpen = (s: BgSlice) => s.backgroundTasks.open;

const AUTO_CLOSE_DELAY_MS = 4000;

export const BackgroundTasksPanel: React.FC = () => {
    const { t } = useTranslation();
    const dispatch = useDispatch();

    const tasks = useSelector(selectBackgroundTasks);
    const activeTasks = useSelector(selectActiveTasks);
    const allTerminal = useSelector(selectAllTerminal);
    const open = useSelector(selectOpen);
    const shown = useSelector(selectTasksPanelShown);

    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Auto-close: fire closeContainer 4 s after all tasks become terminal.
    // Cancel when a new active task appears (allTerminal becomes false).
    useEffect(() => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }

        if (open && allTerminal) {
            timerRef.current = setTimeout(() => {
                dispatch(closeContainer());
            }, AUTO_CLOSE_DELAY_MS);
        }

        return () => {
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [open, allTerminal, activeTasks.length, dispatch]);

    // Render nothing when there are no tasks, the container is closed, or it is
    // collapsed — collapsed state is represented by the pill in the header
    // (BackgroundTasksHeaderButton); this panel is only the expanded dropdown.
    if (!shown) {
        return null;
    }

    return (
        // Fixed dropdown anchored just below the sticky header (~64px), aligned
        // under the header pill that toggles it. z-50 keeps it above
        // page content but below modals.
        <div className="fixed top-16 right-4 z-50 w-80 max-w-[calc(100vw-2rem)]">
            {/* Global (every space shows it): the AppSec refresh is gated. */}
            <div className="bg-white dark:bg-neutral-800 rounded-xl border border-gray-200 dark:border-neutral-700 shadow-lg overflow-hidden appsec:rounded-lg appsec:border-zinc-200 appsec:shadow-[0_4px_16px_-4px_rgb(0_0_0/0.08),0_1px_2px_rgb(0_0_0/0.04)] appsec-dark:bg-as-raised appsec-dark:border-as-line-strong appsec-dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05),0_16px_40px_-8px_rgb(0_0_0/0.7)]">
                {/* Header */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-neutral-700 appsec:h-10 appsec:py-0 appsec:border-zinc-200 appsec-dark:border-as-line">
                    <span className="flex-1 text-xs font-semibold text-gray-700 dark:text-gray-200 appsec:text-[13px] appsec:font-medium appsec:text-zinc-800 appsec-dark:text-zinc-100">
                        {t('components.backgroundTasks.title')}
                        {/* The count after the title, set apart by space alone (no hairline). */}
                        <span className="ml-1.5 font-mono tabular-nums text-gray-500 dark:text-gray-400 appsec:text-zinc-500 appsec-dark:text-zinc-400">{tasks.length}</span>
                    </span>

                    {/* Close button — only collapses the dropdown back to the
                        header pill. It never removes the
                        pill: `open` stays true, so the indicator next to the
                        language switcher persists while a task exists. The user
                        re-opens the dropdown by clicking that pill. Tasks leave
                        via their own row ✕ or the auto-close once all terminal. */}
                    <button
                        type="button"
                        onClick={() => dispatch(setCollapsed(true))}
                        aria-label={t('components.backgroundTasks.close')}
                        title={t('components.backgroundTasks.close')}
                        className="relative w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-neutral-700 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors appsec:rounded-md appsec:hover:bg-zinc-100 appsec-dark:hover:bg-white/[0.06] appsec:max-md:after:absolute appsec:max-md:after:left-1/2 appsec:max-md:after:top-1/2 appsec:max-md:after:h-11 appsec:max-md:after:w-11 appsec:max-md:after:-translate-x-1/2 appsec:max-md:after:-translate-y-1/2 appsec:max-md:after:content-['']"
                    >
                        <Xmark
                            className="text-xs"
                            aria-hidden="true"
                         />
                    </button>
                </div>

                {/* Task list — caps to the viewport (below the top offset +
                    panel header) and scrolls vertically when there are many
                    background tasks, so the panel never overflows the screen. */}
                <div className="max-h-[calc(100vh-9rem)] overflow-y-auto">
                    {tasks.map((task) => (
                        <BackgroundTaskRow key={task.id} task={task} />
                    ))}
                </div>
            </div>
        </div>
    );
};
