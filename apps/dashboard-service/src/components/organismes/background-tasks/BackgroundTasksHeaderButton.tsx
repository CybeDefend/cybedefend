import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import {
    setCollapsed,
    selectActiveTasks,
    selectAggregatePercent,
    selectBackgroundTasks,
} from '@/server/store/backgroundTasksSlice';
import { Spinner } from '@/components/atoms/icon/icons';
import { cn } from '@/utils/function/utils';
import { AS_FOCUS, AS_TOUCH } from '@/components/atoms/appsec/styles';

type BgSlice = {
    backgroundTasks: { tasks: any[]; collapsed: boolean; open: boolean };
};

const selectOpen = (s: BgSlice) => s.backgroundTasks.open;
const selectCollapsed = (s: BgSlice) => s.backgroundTasks.collapsed;

/**
 * Background-tasks pill, pinned in the global header.
 *
 * Living inside the sticky header keeps the indicator locked at the very top
 * of the page instead of floating over the project header where it used to
 * collide with the scan controls. Clicking it toggles the expanded panel
 * (`BackgroundTasksPanel`), which drops down just beneath the header.
 *
 * Renders nothing unless there is at least one background task.
 */
export const BackgroundTasksHeaderButton: React.FC = () => {
    const { t } = useTranslation();
    const dispatch = useDispatch();

    const tasks = useSelector(selectBackgroundTasks);
    const activeTasks = useSelector(selectActiveTasks);
    const percent = useSelector(selectAggregatePercent);
    const open = useSelector(selectOpen);
    const collapsed = useSelector(selectCollapsed);

    if (!open || tasks.length === 0) return null;

    const hasActive = activeTasks.length > 0;

    return (
        <button
            type="button"
            onClick={() => dispatch(setCollapsed(!collapsed))}
            aria-label={t(
                collapsed
                    ? 'components.backgroundTasks.expand'
                    : 'components.backgroundTasks.collapse',
            )}
            title={t('components.backgroundTasks.title')}
            className={cn(
                'relative flex h-8 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 transition-colors duration-[120ms] hover:bg-zinc-50 dark:border-as-line-strong dark:bg-as-raised dark:text-zinc-200 dark:hover:bg-white/[0.09]',
                AS_FOCUS,
                AS_TOUCH,
            )}
        >
            {hasActive && (
                <Spinner
                    className="h-3.5 w-3.5 animate-spin text-secondary dark:text-secondary-light"
                    aria-hidden="true"
                 />
            )}
            <span className="whitespace-nowrap tabular-nums">
                {t('components.backgroundTasks.pill', {
                    count: tasks.length,
                    percent,
                })}
            </span>
        </button>
    );
};

export default BackgroundTasksHeaderButton;
