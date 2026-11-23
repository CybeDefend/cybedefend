import React from 'react';
import { Crosshair } from '@/components/atoms/icon/icons';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/function/utils';
import { AS_FOCUS, AS_TOUCH_SQUARE } from '@/components/atoms/appsec/styles';

interface TriageToggleProps {
    value: boolean;
    onChange: (value: boolean) => void;
    className?: string;
}

/**
 * TriageToggle — compact on/off switch shown in the listing
 * toolbars, next to ViewModeToggle.
 *
 * When enabled the parent page is expected to sort the listing by
 * priorityScore DESC. The toggle MUST NOT mutate the user-controlled
 * exploitability filter — surfacing or hiding `not_exploitable` is the
 * user's call, made via the dedicated filter dropdown.
 *
 * This component only holds the UI state; the wiring lives in the
 * individual *Page.tsx files (see ResultsSca/Sast/Iac…Page).
 */
const TriageToggle: React.FC<TriageToggleProps> = ({
    value,
    onChange,
    className,
}) => {
    const { t } = useTranslation();
    const label = t('components.resultsTable.triage');
    const tooltip = t('components.resultsTable.triageTooltip');

    return (
        <div
            className={cn(
                // A hairline, not a violet tile (the eye goes where colour is):
                // the switch says whether triage is on, in the accent; the frame and glyph stay zinc.
                'inline-flex h-8 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5',
                'dark:border-as-line-strong dark:bg-transparent',
                className,
            )}
            title={tooltip}
        >
            <Crosshair className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
            <span className="text-[13px] font-medium text-zinc-800 dark:text-zinc-200">
                {label}
            </span>
            <button
                type="button"
                role="switch"
                aria-checked={value}
                aria-label={label}
                onClick={() => onChange(!value)}
                className={cn(
                    'relative inline-flex h-[18px] w-8 items-center rounded-full transition-colors duration-[160ms]',
                    AS_FOCUS,
                    AS_TOUCH_SQUARE,
                    value
                        ? 'bg-secondary'
                        : 'bg-zinc-300 dark:bg-white/[0.16]',
                )}
            >
                <span
                    className={cn(
                        'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.15)] transition-transform duration-[160ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
                        value ? 'translate-x-4' : 'translate-x-0.5',
                    )}
                />
            </button>
        </div>
    );
};

export default TriageToggle;
