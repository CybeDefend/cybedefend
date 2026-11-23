import React from 'react';
import { List, Grid3X3 } from '@/components/atoms/icon/icons';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/function/utils';
import { AS_SEGMENT_ITEM, AS_SEGMENT_OFF, AS_SEGMENT_ON, AS_SEGMENT_TRACK, AS_TOUCH } from '@/components/atoms/appsec/styles';

export type ViewMode = 'detailed' | 'grouped';

interface ViewModeToggleProps {
    value: ViewMode;
    onChange: (mode: ViewMode) => void;
    className?: string;
}

export const ViewModeToggle: React.FC<ViewModeToggleProps> = ({
    value,
    onChange,
    className,
}) => {
    const { t } = useTranslation();

    return (
        <div
            className={cn(
                AS_SEGMENT_TRACK,
                className
            )}
        >
            <button
                type="button"
                onClick={() => onChange('detailed')}
                className={cn(
                    AS_SEGMENT_ITEM,
                    AS_TOUCH,
                    value === 'detailed' ? AS_SEGMENT_ON : AS_SEGMENT_OFF
                )}
            >
                <List className="w-4 h-4" />
                <span className="hidden sm:inline">{t('components.viewModeToggle.detailed')}</span>
            </button>
            <button
                type="button"
                onClick={() => onChange('grouped')}
                className={cn(
                    AS_SEGMENT_ITEM,
                    AS_TOUCH,
                    value === 'grouped' ? AS_SEGMENT_ON : AS_SEGMENT_OFF
                )}
            >
                <Grid3X3 className="w-4 h-4" />
                <span className="hidden sm:inline">{t('components.viewModeToggle.grouped')}</span>
            </button>
        </div>
    );
};

export default ViewModeToggle;
