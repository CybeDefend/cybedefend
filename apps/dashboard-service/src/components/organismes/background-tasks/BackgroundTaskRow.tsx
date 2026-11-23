import React from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AsyncTask } from '@/server/store/backgroundTasksSlice';
import { dismissBackgroundTask } from '@/server/store/backgroundTasksThunks';
import type { AppDispatch } from '@/server/store';
import { cn } from '@/utils/function/utils';
import { APPSEC_PREFIX, appsecPath } from '@/utils/product';
import { AlertTriangle, ArrowRight, Ban, CheckCircle, ExternalLinkAlt, FileLines, LayerGroup, MagnifyingGlass, ShieldHalved, Spinner, TimesCircle, WandMagicSparkles, Xmark } from '@/components/atoms/icon/icons';
import type { IconProps } from '@/components/atoms/icon/icons';

/** Any icon from the registry: a component taking the shared icon props. */
type IconComponent = React.ComponentType<IconProps>;

// Map task.type → icon. Add future types here without touching anything else.
const TYPE_ICONS: Record<string, IconComponent> = {
    vuln_batch_update: ShieldHalved,
    autofix: WandMagicSparkles,
    // SCA AutoFix reuses the autofix wand icon.
    sca_autofix: WandMagicSparkles,
    // Report generation.
    report_generation: FileLines,
    scan: MagnifyingGlass,
};

// A resultUrl starting with "/" is an in-app deep-link (report page) —
// navigate via the router to stay in the SPA. Anything else (autofix PR/MR) is
// an external URL opened in a new tab.
const isInternalLink = (url?: string): boolean => !!url && url.startsWith('/');

/**
 * Where a completed task's in-app link goes. A report task names the former
 * AppSec URL of its report page (`/reports?reportId=…`,
 * `/project/:id/reports?reportId=…`): the link goes straight to its AppSec
 * form, so a report page already on screen opens its drawer. Through the
 * former URL's redirect, the whole shell was torn down and mounted again.
 */
const inAppTarget = (task: AsyncTask): string =>
    task.type === 'report_generation' && !task.resultUrl!.startsWith(`${APPSEC_PREFIX}/`)
        ? appsecPath(task.resultUrl!)
        : task.resultUrl!;

const getTaskIcon = (type: string): IconComponent =>
    TYPE_ICONS[type] ?? LayerGroup;

interface BackgroundTaskRowProps {
    task: AsyncTask;
}

export const BackgroundTaskRow: React.FC<BackgroundTaskRowProps> = ({ task }) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    const percent =
        task.total > 0 ? Math.round((task.processed / task.total) * 100) : 0;

    const isRunning = task.status === 'queued' || task.status === 'running';
    const isCompleted = task.status === 'completed';
    const isFailed = task.status === 'failed';

    // Scan tasks carry a richer lifecycle state than the 4-value status: a
    // cancelled scan is terminal-"completed" but must read "cancelled", and a
    // degraded completion gets its own label/icon.
    const isScan = task.type === 'scan';
    const scanCancelled = isScan && task.scanState === 'cancelled';
    const scanDegraded = isScan && task.scanState === 'completed_degraded';

    const label = task.titleKey
        ? t(task.titleKey)
        : t(
              `components.backgroundTasks.types.${task.type}`,
              t('components.backgroundTasks.types.default'),
          );

    return (
        <div className="flex flex-col gap-1 py-2 px-3 border-t border-gray-100 dark:border-neutral-700 first:border-t-0 appsec:border-zinc-100 appsec-dark:border-as-line">
            {/* Row header */}
            <div className="flex items-center gap-2">
                {/* Status / type icon */}
                <span className="shrink-0 w-5 flex items-center justify-center">
                    {isRunning ? (
                        <Spinner
                            className="text-primary animate-spin text-sm appsec-dark:text-secondary-light"
                            aria-hidden="true"
                         />
                    ) : scanCancelled ? (
                        <Ban
                            className="text-gray-500 dark:text-gray-500 text-sm"
                            aria-hidden="true"
                         />
                    ) : scanDegraded ? (
                        <AlertTriangle
                            className="text-amber-500 text-sm"
                            aria-hidden="true"
                         />
                    ) : isCompleted ? (
                        <CheckCircle
                            className="text-green-500 text-sm"
                            aria-hidden="true"
                         />
                    ) : isFailed ? (
                        <TimesCircle
                            className="text-red-500 text-sm"
                            aria-hidden="true"
                         />
                    ) : (
                        React.createElement(getTaskIcon(task.type), {
                            className: 'h-4 w-4 text-gray-400 dark:text-gray-500',
                        })
                    )}
                </span>

                {/* Label */}
                <span className="flex-1 text-xs font-medium text-gray-800 dark:text-gray-200 truncate appsec:text-[13px] appsec:text-zinc-800 appsec-dark:text-zinc-100">
                    {label}
                </span>

                {/* Dismiss button */}
                <button
                    type="button"
                    onClick={() => dispatch(dismissBackgroundTask(task.id))}
                    aria-label={t('components.backgroundTasks.dismiss')}
                    title={t('components.backgroundTasks.dismiss')}
                    className="relative shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-neutral-700 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors appsec:rounded-md appsec:hover:bg-zinc-100 appsec-dark:hover:bg-white/[0.06] appsec:max-md:after:absolute appsec:max-md:after:left-1/2 appsec:max-md:after:top-1/2 appsec:max-md:after:h-11 appsec:max-md:after:w-11 appsec:max-md:after:-translate-x-1/2 appsec:max-md:after:-translate-y-1/2 appsec:max-md:after:content-['']"
                >
                    <Xmark className="text-xs" aria-hidden="true"  />
                </button>
            </div>

            {/* Progress bar */}
            <div
                className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-neutral-700 overflow-hidden appsec:h-[3px] appsec:bg-zinc-100 appsec-dark:bg-white/[0.08]"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
            >
                <div
                    className={cn(
                        'h-full rounded-full transition-all duration-300',
                        scanCancelled
                            ? 'bg-gray-400 dark:bg-gray-500'
                            : scanDegraded
                            ? 'bg-amber-500'
                            : isFailed
                            ? 'bg-red-500'
                            : isCompleted
                            ? 'bg-green-500'
                            : 'bg-primary appsec-dark:bg-secondary',
                    )}
                    style={{ width: `${isFailed ? percent : isCompleted ? 100 : percent}%` }}
                />
            </div>

            {/* Progress text / summary */}
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                {isRunning && (
                    <span className="font-mono tabular-nums">
                        {isScan ? (
                            `${percent}%`
                        ) : (
                            // « 45/100 (45%) »: ordinary punctuation, no hairline.
                            `${task.processed}/${task.total} (${percent}%)`
                        )}
                    </span>
                )}

                {/* Scan terminal states: label/colour driven by the raw scanState. */}
                {!isRunning && isScan && (
                    <span
                        className={cn(
                            scanCancelled
                                ? 'text-gray-500 dark:text-gray-400'
                                : scanDegraded
                                ? 'text-amber-600 dark:text-amber-400'
                                : isFailed
                                ? 'text-red-500 dark:text-red-400'
                                : 'text-green-600 dark:text-green-400',
                        )}
                    >
                        {t(
                            scanCancelled
                                ? 'components.backgroundTasks.scan.cancelled'
                                : scanDegraded
                                ? 'components.backgroundTasks.scan.degraded'
                                : isFailed
                                ? 'components.backgroundTasks.scan.failed'
                                : 'components.backgroundTasks.scan.completed',
                        )}
                    </span>
                )}

                {isCompleted && !isScan && (
                    <>
                        {task.type !== 'autofix' &&
                            task.type !== 'report_generation' && (
                            <>
                                <span className="text-green-600 dark:text-green-400">
                                    {t('components.backgroundTasks.summary.updated', {
                                        count: task.succeeded ?? 0,
                                    })}
                                </span>
                                {task.failed !== undefined && task.failed > 0 && (
                                    <span className="text-red-500 dark:text-red-400">
                                        {t('components.backgroundTasks.summary.failed', {
                                            count: task.failed,
                                        })}
                                    </span>
                                )}
                            </>
                        )}
                        {task.resultUrl &&
                            (isInternalLink(task.resultUrl) ? (
                                <Link
                                    to={inAppTarget(task)}
                                    className="inline-flex items-center gap-1 text-primary hover:underline font-medium appsec-dark:text-secondary-light"
                                >
                                    {t('components.backgroundTasks.viewReport')}
                                    <ArrowRight className="text-xs" aria-hidden="true"  />
                                </Link>
                            ) : (
                                <a
                                    href={task.resultUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-primary hover:underline font-medium appsec-dark:text-secondary-light"
                                >
                                    {t('components.backgroundTasks.viewPr')}
                                    <ExternalLinkAlt className="text-xs" aria-hidden="true"  />
                                </a>
                            ))}
                    </>
                )}

                {isFailed && !isScan && (
                    <span className="text-red-500 dark:text-red-400">
                        {task.error ?? t('components.backgroundTasks.failed')}
                    </span>
                )}
            </div>
        </div>
    );
};
